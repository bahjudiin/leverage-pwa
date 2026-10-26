// ── Centralized API request coordinator ─────────────────────────────
// EVERY outbound Data-API request in the app passes through dispatch().
// Responsibilities, in order of execution:
//   1. Quota gate      — short-circuit while the daily quota is known-spent.
//   2. Rate guard      — rolling-window ceiling on expensive search calls.
//   3. Dedup           — identical in-flight request shares one promise.
//   4. Suppression     — identical request resolved <N ms ago replays memory.
//   5. Dispatch        — timeout + bounded retry (never on quota/auth).
//   6. Accounting      — usage recorded ONLY on real network dispatch.
//   7. Dev telemetry   — counted/logged in development builds only.
//
// No backend. No database. All state is in-memory or localStorage.

import { readJSON, writeJSON, KEYS } from "./storage";
import { quotaDay } from "./utils";

// ── Tunables ────────────────────────────────────────────────────────
export const TIMEOUT_MS = 12_000;
export const MAX_ATTEMPTS = 3;
/** Identical request resolved within this window replays from memory. */
export const DEDUPE_WINDOW_MS = 8_000;
/** Rolling ceiling on search.list dispatches (abuse / runaway-loop guard). */
export const SEARCH_WINDOW_MS = 60_000;
export const MAX_SEARCH_PER_WINDOW = 12;

export type RequestKind =
  | "search.list"
  | "videos.list"
  | "videos.chart"
  | "commentThreads.list"
  | "gemini.generate";

export const UNIT_COST: Record<RequestKind, number> = {
  "search.list": 100,
  "videos.list": 1,
  "videos.chart": 1,
  "commentThreads.list": 1,
  "gemini.generate": 0, // separate Gemini budget, not YouTube units
};

// ── Errors ──────────────────────────────────────────────────────────
export class QuotaError extends Error {
  constructor(msg = "YouTube API daily quota exhausted") {
    super(msg);
    this.name = "QuotaError";
  }
}
export class AuthError extends Error {
  constructor(msg = "YouTube API key rejected") {
    super(msg);
    this.name = "AuthError";
  }
}
export class ApiError extends Error {
  status: number;
  constructor(status: number, msg: string) {
    super(msg);
    this.status = status;
    this.name = "ApiError";
  }
}
/** Thrown by the local burst guard — nothing was sent to YouTube. */
export class RateGuardError extends Error {
  constructor(msg = "Too many discovery requests in a short period. Pause a moment, then retry.") {
    super(msg);
    this.name = "RateGuardError";
  }
}

export function isTerminalError(e: unknown): boolean {
  return e instanceof QuotaError || e instanceof AuthError || e instanceof RateGuardError;
}

// ── Usage ledger (local estimate, resets on Pacific-time day change) ─
export interface Usage {
  day: string;
  units: number;
  searchCalls: number;
  videoCalls: number;
  aiCalls: number;
}

const ZERO_USAGE = (): Usage => ({ day: quotaDay(), units: 0, searchCalls: 0, videoCalls: 0, aiCalls: 0 });

export function getUsage(): Usage {
  const u = readJSON<Usage>(KEYS.usage, ZERO_USAGE());
  return u.day !== quotaDay() ? ZERO_USAGE() : u;
}

export function recordUsage(delta: Partial<Omit<Usage, "day">>): Usage {
  const u = getUsage();
  const next: Usage = {
    day: u.day,
    units: u.units + (delta.units ?? 0),
    searchCalls: u.searchCalls + (delta.searchCalls ?? 0),
    videoCalls: u.videoCalls + (delta.videoCalls ?? 0),
    aiCalls: u.aiCalls + (delta.aiCalls ?? 0),
  };
  writeJSON(KEYS.usage, next);
  return next;
}

// ── Persisted quota block ───────────────────────────────────────────
// Survives reloads so we never re-fire doomed 100-unit searches.
const QUOTA_KEY = "lv:quota:v1";

interface QuotaBlock { day: string; at: number }

export function isQuotaBlocked(): boolean {
  const b = readJSON<QuotaBlock | null>(QUOTA_KEY, null);
  return Boolean(b && b.day === quotaDay());
}

export function markQuotaBlocked(): void {
  writeJSON(QUOTA_KEY, { day: quotaDay(), at: Date.now() } satisfies QuotaBlock);
}

export function clearQuotaBlock(): void {
  try { localStorage.removeItem(QUOTA_KEY); } catch { /* noop */ }
}

// ── Dev-only telemetry ──────────────────────────────────────────────
export type Outcome = "net" | "dedup" | "suppressed" | "blocked" | "error";

export interface LogEntry {
  t: number;
  kind: RequestKind;
  outcome: Outcome;
  units: number;
  ms: number;
  detail: string;
}

const devLog: LogEntry[] = [];
const counters = { total: 0, net: 0, dedup: 0, suppressed: 0, blocked: 0, error: 0, units: 0 };

/** Strip the API key from any string before it can reach a console/log. */
export function redact(s: string): string {
  return s.replace(/([?&]key=)[^&]+/g, "$1REDACTED");
}

/** Console output is silenced under test; counters still record. */
const SILENT = Boolean(import.meta.env.VITEST);

function telemetry(kind: RequestKind, outcome: Outcome, units: number, ms: number, detail: string) {
  if (!import.meta.env.DEV) return;
  counters.total++;
  counters[outcome]++;
  counters.units += units;
  const entry: LogEntry = { t: Date.now(), kind, outcome, units, ms: Math.round(ms), detail: redact(detail) };
  devLog.push(entry);
  if (devLog.length > 200) devLog.shift();
  if (SILENT) return;
  const tag = outcome === "net" ? "" : ` (${outcome})`;
  // eslint-disable-next-line no-console
  console.info(
    `%c[api]%c ${kind}${tag} · ${units}u · ${Math.round(ms)}ms · total ${counters.units}u`,
    "color:#6e9bff;font-weight:600", "color:inherit",
    entry.detail
  );
}

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__LV_API__ = {
    get log() { return [...devLog]; },
    summary: () => ({ ...counters, ledger: getUsage(), quotaBlocked: isQuotaBlocked() }),
    reset: () => {
      devLog.length = 0;
      Object.keys(counters).forEach((k) => { (counters as Record<string, number>)[k] = 0; });
    },
  };
}

// ── Coordinator state ───────────────────────────────────────────────
const inflight = new Map<string, Promise<unknown>>();
const recent = new Map<string, { at: number; value: unknown }>();
let searchTimestamps: number[] = [];

/** Test/debug helper — clears all coordinator memory (not localStorage). */
export function __resetCoordinator(): void {
  inflight.clear();
  recent.clear();
  searchTimestamps = [];
}

export function coordinatorStats() {
  return { inflight: inflight.size, suppressionEntries: recent.size, searchesInWindow: searchTimestamps.length };
}

function pruneRecent(now: number) {
  for (const [k, v] of recent) if (now - v.at > DEDUPE_WINDOW_MS) recent.delete(k);
}

function rateGuardOk(now: number): boolean {
  searchTimestamps = searchTimestamps.filter((t) => now - t < SEARCH_WINDOW_MS);
  return searchTimestamps.length < MAX_SEARCH_PER_WINDOW;
}

function linkSignals(signals: AbortSignal[]): { signal: AbortSignal; dispose: () => void } {
  const ctrl = new AbortController();
  const listeners: { s: AbortSignal; fn: () => void }[] = [];
  for (const s of signals) {
    if (s.aborted) { ctrl.abort(); break; }
    const fn = () => ctrl.abort();
    s.addEventListener("abort", fn, { once: true });
    listeners.push({ s, fn });
  }
  return {
    signal: ctrl.signal,
    dispose: () => listeners.forEach(({ s, fn }) => s.removeEventListener("abort", fn)),
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const backoff = (attempt: number) => sleep(400 * 2 ** (attempt - 1) + Math.random() * 200);

export interface DispatchOptions {
  /** Stable identity for dedup/suppression. MUST NOT contain the API key. */
  key: string;
  kind: RequestKind;
  url: string;
  signal?: AbortSignal;
  init?: RequestInit;
  /** Units to bill on real dispatch. Defaults to UNIT_COST[kind]. */
  units?: number;
  /** Skip the suppression replay (used by explicit Refresh). */
  force?: boolean;
}

/**
 * The single chokepoint for every Data-API request.
 * Returns parsed JSON of type T.
 */
export async function dispatch<T>(o: DispatchOptions): Promise<T> {
  const now = Date.now();
  const units = o.units ?? UNIT_COST[o.kind];
  const isYouTube = o.kind !== "gemini.generate";

  // 1. Quota gate — never spend a request we know will 403.
  if (isYouTube && isQuotaBlocked()) {
    telemetry(o.kind, "blocked", 0, 0, o.key);
    throw new QuotaError();
  }

  // 2. Rate guard — only expensive searches are ceilinged.
  if (o.kind === "search.list" && !rateGuardOk(now)) {
    telemetry(o.kind, "blocked", 0, 0, `rate-guard ${o.key}`);
    throw new RateGuardError();
  }

  // 3. In-flight dedup — identical concurrent request shares one promise.
  const existing = inflight.get(o.key);
  if (existing) {
    telemetry(o.kind, "dedup", 0, 0, o.key);
    return existing as Promise<T>;
  }

  // 4. Suppression — identical request that just resolved replays memory.
  if (!o.force) {
    pruneRecent(now);
    const hit = recent.get(o.key);
    if (hit) {
      telemetry(o.kind, "suppressed", 0, 0, o.key);
      return hit.value as T;
    }
  }

  const started = now;
  const job = (async (): Promise<T> => {
    for (let attempt = 1; ; attempt++) {
      const timeout = AbortSignal.timeout(TIMEOUT_MS);
      const { signal, dispose } = linkSignals(o.signal ? [o.signal, timeout] : [timeout]);

      let res: Response;
      try {
        // 5/6. Real network dispatch — bill exactly here, once.
        if (o.kind === "search.list") searchTimestamps.push(Date.now());
        if (isYouTube) {
          recordUsage({
            units,
            searchCalls: o.kind === "search.list" ? 1 : 0,
            videoCalls: o.kind === "search.list" ? 0 : 1,
          });
        }
        res = await fetch(o.url, { ...o.init, signal });
      } catch {
        dispose();
        if (o.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        if (attempt < MAX_ATTEMPTS) { await backoff(attempt); continue; }
        throw new ApiError(0, "Network error — check your connection");
      } finally {
        dispose();
      }

      if (res.ok) return (await res.json()) as T;

      let body: { error?: { message?: string; errors?: { reason?: string }[] } } = {};
      try { body = await res.json(); } catch { /* non-JSON error body */ }
      const reason = body.error?.errors?.[0]?.reason ?? "";
      const message = body.error?.message ?? "";

      // Quota — persist the block, never retry.
      if (res.status === 403 && /quota|dailyLimit/i.test(reason + message)) {
        markQuotaBlocked();
        throw new QuotaError();
      }
      // Auth / bad key — never retry.
      if (res.status === 401 || res.status === 400 || (res.status === 403 && /key|referer|blocked|forbidden/i.test(reason + message))) {
        throw new AuthError(`YouTube rejected the request (${res.status}). Check the API key and its restrictions.`);
      }
      // Server-side rate limit / transient — bounded retry.
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
        await backoff(attempt);
        continue;
      }
      throw new ApiError(res.status, message || `YouTube error ${res.status}`);
    }
  })();

  inflight.set(o.key, job);
  try {
    const value = await job;
    recent.set(o.key, { at: Date.now(), value });
    telemetry(o.kind, "net", units, Date.now() - started, o.key);
    return value;
  } catch (e) {
    if (!(e instanceof DOMException && e.name === "AbortError")) {
      telemetry(o.kind, "error", units, Date.now() - started, `${o.key} — ${(e as Error).message}`);
    }
    throw e;
  } finally {
    inflight.delete(o.key);
  }
}
