// ── AI analysis service ─────────────────────────────────────────────
// The single entry point for every Gemini analysis in the app.
//
// Responsibilities:
//   • Cache-first lookup (memory → localStorage), schema-validated.
//   • Per-videoId in-flight dedup — the same video is never analyzed
//     twice concurrently, even from different screens.
//   • Explicit daily budget with reserve/commit semantics: a batch is
//     CLAMPED to the remaining budget, and only successful analyses are
//     billed. Failures never consume budget.
//   • Cross-category reuse: the cache key is the videoId alone, so an
//     analysis produced in "Wealth" is reused verbatim in "Markets",
//     Home, Explore, Saved, and the details screen.
//   • Graceful degradation: when AI is disabled, unconfigured, offline,
//     or out of budget, callers get a typed reason and the app keeps
//     working with the deterministic local filter.
//
// No backend. No database. Cache is versioned localStorage with a TTL.

import type { AiAnalysis, AiBudgetState, Settings, VideoItem } from "../types";
import { AI_SCHEMA } from "../types";
import { CK, ttlGet, ttlSet } from "./storage";
import { parseChapters } from "./parse";
import { heuristicAnalyze } from "./quality";
import { getUsage, recordUsage } from "./apiClient";
import { quotaDay } from "./utils";
import {
  analyzeVideos, MAX_BATCH,
  GeminiError, GeminiKeyError, GeminiQuotaError,
  type AnalysisInput,
} from "./gemini";

/** Analyses are reused for two weeks, then re-derived on demand. */
export const AI_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Cap on how many videos one automatic (non-user-initiated) pass may analyze. */
export const AUTO_BATCH_LIMIT = 4;

// ── Availability ────────────────────────────────────────────────────

export type AiUnavailableReason =
  | "disabled"      // user turned AI off (the default)
  | "no-key"        // no Gemini key configured
  | "offline"       // browser reports no connectivity
  | "budget"        // daily analysis budget spent
  | "none";         // available

export function aiAvailability(settings: Settings, online = true): AiUnavailableReason {
  if (!settings.aiEnabled) return "disabled";
  if (!settings.geminiKey) return "no-key";
  if (!online) return "offline";
  if (budgetState(settings).remaining <= 0) return "budget";
  return "none";
}

export function isAiAvailable(settings: Settings, online = true): boolean {
  return aiAvailability(settings, online) === "none";
}

export const UNAVAILABLE_COPY: Record<Exclude<AiUnavailableReason, "none">, string> = {
  disabled: "AI analysis is off. Enable it in Settings with your own Gemini key.",
  "no-key": "Add your own Gemini API key in Settings to enable AI analysis.",
  offline: "AI analysis needs connectivity. Your saved analyses remain readable offline.",
  budget: "Today's AI analysis budget is spent. Raise it in Settings or try again tomorrow.",
};

// ── Budget ──────────────────────────────────────────────────────────

export function budgetState(settings: Settings): AiBudgetState {
  const used = getUsage().aiCalls;
  const limit = Math.max(0, settings.aiDailyBudget);
  return { day: quotaDay(), used, limit, remaining: Math.max(0, limit - used) };
}

/** How many of `wanted` analyses may actually run right now. */
export function reserveBudget(settings: Settings, wanted: number): number {
  return Math.max(0, Math.min(wanted, budgetState(settings).remaining, MAX_BATCH));
}

/** Bill only analyses that actually came back. */
function commitBudget(n: number): void {
  if (n > 0) recordUsage({ aiCalls: n });
}

// ── Cache ───────────────────────────────────────────────────────────

const memory = new Map<string, AiAnalysis>();

function valid(a: unknown): a is AiAnalysis {
  const x = a as AiAnalysis | null;
  return Boolean(
    x && typeof x === "object" &&
    x.schema === AI_SCHEMA &&          // stale schema → treated as a miss
    typeof x.videoId === "string" &&
    typeof x.summary === "string" &&
    Array.isArray(x.segments)
  );
}

/**
 * Cache-first read. Global by videoId, so the same analysis is reused
 * across every category, feed, and screen.
 */
export function getCachedAnalysis(videoId: string): AiAnalysis | null {
  const hot = memory.get(videoId);
  if (hot) return hot;
  const stored = ttlGet<AiAnalysis>(CK.ai(videoId));
  if (stored && valid(stored.value)) {
    memory.set(videoId, stored.value);
    return stored.value;
  }
  return null;
}

export function putAnalysis(a: AiAnalysis): void {
  memory.set(a.videoId, a);
  ttlSet(CK.ai(a.videoId), a, AI_TTL_MS);
}

export function hasAnalysis(videoId: string): boolean {
  return getCachedAnalysis(videoId) !== null;
}

/** Drop one cached analysis so the next request re-derives it. */
export function invalidateAnalysis(videoId: string): void {
  memory.delete(videoId);
  try { localStorage.removeItem("lv:" + CK.ai(videoId)); } catch { /* noop */ }
}

export function clearAnalysisMemory(): void {
  memory.clear();
}

// ── In-flight dedup (per videoId) ───────────────────────────────────

const inflight = new Map<string, Promise<AiAnalysis | null>>();

export function inflightCount(): number {
  return inflight.size;
}

// ── Input building ──────────────────────────────────────────────────

/** Chapters come only from the real description — never invented. */
export function toAnalysisInput(v: VideoItem): AnalysisInput {
  return {
    id: v.id,
    title: v.title,
    channelTitle: v.channelTitle,
    publishedAt: v.publishedAt,
    durationSec: v.durationSec,
    description: v.description,
    chapters: parseChapters(v.description, v.durationSec),
  };
}

// ── Public API ──────────────────────────────────────────────────────

export interface AnalyzeResult {
  analyses: AiAnalysis[];
  /** Served from cache without any network call. */
  reused: number;
  /** Newly produced by Gemini in this call. */
  fresh: number;
  /** Requested but skipped because the budget was exhausted. */
  skipped: number;
}

/**
 * Analyze ONE video — user-initiated (an explicit "Analyze" press).
 *
 * Returns the cached analysis immediately when present (no request).
 * Concurrent calls for the same video share a single promise.
 */
export async function analyzeOne(
  settings: Settings,
  video: VideoItem,
  opts: { force?: boolean; online?: boolean; signal?: AbortSignal } = {}
): Promise<AiAnalysis> {
  const { force = false, online = true } = opts;

  if (!force) {
    const cached = getCachedAnalysis(video.id);
    if (cached) return cached;
  } else {
    invalidateAnalysis(video.id);
  }

  const reason = aiAvailability(settings, online);
  if (reason !== "none") throw new AiUnavailableError(reason);

  const existing = inflight.get(video.id);
  if (existing) {
    const shared = await existing;
    if (shared) return shared;
  }

  const job = (async (): Promise<AiAnalysis | null> => {
    const allowed = reserveBudget(settings, 1);
    if (allowed < 1) throw new AiUnavailableError("budget");

    const results = await analyzeVideos(settings.geminiKey, [toAnalysisInput(video)], opts.signal);
    commitBudget(results.length);          // bill only what returned
    results.forEach(putAnalysis);
    return results[0] ?? null;
  })();

  inflight.set(video.id, job);
  try {
    const result = await job;
    if (!result) throw new GeminiError("Gemini returned no analysis for this video");
    return result;
  } finally {
    inflight.delete(video.id);
  }
}

/**
 * Analyze a small, explicitly budgeted batch of UNCACHED candidates.
 *
 * Used both by the post-discovery auto pass and by the manual
 * "Analyze candidates" button. Already-cached videos are returned
 * without consuming budget or issuing a request.
 */
export async function analyzeBatch(
  settings: Settings,
  videos: VideoItem[],
  opts: { limit?: number; online?: boolean; signal?: AbortSignal } = {}
): Promise<AnalyzeResult> {
  const { limit = AUTO_BATCH_LIMIT, online = true } = opts;
  const out: AnalyzeResult = { analyses: [], reused: 0, fresh: 0, skipped: 0 };

  // 1. Serve everything already known — zero cost, cross-category reuse.
  const pending: VideoItem[] = [];
  for (const v of videos) {
    const cached = getCachedAnalysis(v.id);
    if (cached) { out.analyses.push(cached); out.reused++; }
    else if (!inflight.has(v.id)) pending.push(v);
  }
  if (pending.length === 0) return out;

  const reason = aiAvailability(settings, online);
  if (reason !== "none") {
    out.skipped = pending.length;
    if (reason === "budget") return out;        // soft-fail: budget is normal
    throw new AiUnavailableError(reason);
  }

  // 2. Clamp to the remaining daily budget AND the per-request ceiling.
  const allowed = reserveBudget(settings, Math.min(pending.length, limit));
  if (allowed < 1) { out.skipped = pending.length; return out; }

  const batch = pending.slice(0, allowed);
  out.skipped = pending.length - batch.length;

  const job = (async () => {
    const results = await analyzeVideos(settings.geminiKey, batch.map(toAnalysisInput), opts.signal);
    commitBudget(results.length);
    results.forEach(putAnalysis);
    return results;
  })();

  // Register the shared job against every id in the batch.
  batch.forEach((v) => {
    inflight.set(v.id, job.then((rs) => rs.find((r) => r.videoId === v.id) ?? null));
  });

  try {
    const results = await job;
    out.analyses.push(...results);
    out.fresh = results.length;
    return out;
  } finally {
    batch.forEach((v) => inflight.delete(v.id));
  }
}

/**
 * Pick the videos most worth spending AI budget on.
 *
 * Deterministic local rules run FIRST: anything the heuristic filter
 * already settled ("high" / "low" / "unsafe") does not need an AI call.
 * Only genuinely ambiguous candidates are forwarded.
 */
export function pickCandidates(videos: VideoItem[], limit = AUTO_BATCH_LIMIT): VideoItem[] {
  return videos
    .filter((v) => !hasAnalysis(v.id))
    .map((v) => ({
      v,
      verdict: heuristicAnalyze({ title: v.title, description: v.description, durationSec: v.durationSec }),
    }))
    .filter(({ verdict }) => verdict.tier === "verify" || verdict.tier === "promotional")
    .sort((a, b) => (b.v.viewCount ?? 0) - (a.v.viewCount ?? 0))
    .slice(0, limit)
    .map(({ v }) => v);
}

// ── Errors ──────────────────────────────────────────────────────────

export class AiUnavailableError extends Error {
  reason: Exclude<AiUnavailableReason, "none">;
  constructor(reason: Exclude<AiUnavailableReason, "none">) {
    super(UNAVAILABLE_COPY[reason]);
    this.name = "AiUnavailableError";
    this.reason = reason;
  }
}

/** Human-readable message for any analysis failure. */
export function describeAiError(e: unknown): string {
  if (e instanceof AiUnavailableError) return e.message;
  if (e instanceof GeminiKeyError) return "Gemini rejected the API key — check it in Settings.";
  if (e instanceof GeminiQuotaError) return "Gemini rate limit reached — try again in a minute.";
  if (e instanceof GeminiError) return e.message;
  if (e instanceof DOMException && e.name === "AbortError") return "Analysis cancelled.";
  return "Analysis failed — the app continues to work without AI.";
}

export { GeminiError, GeminiKeyError, GeminiQuotaError };
