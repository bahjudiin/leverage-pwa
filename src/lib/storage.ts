// ── Versioned localStorage layer ────────────────────────────────────
// Prefix scheme:  lv:<domain>:vN:<key>
// User data (settings, library) is stored separately from API response
// caches so each can be cleared independently.

const PREFIX = "lv:";

export const KEYS = {
  settings: "lv:settings:v1",
  library: "lv:library:v1",
  usage: "lv:usage:v1",
} as const;

export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full — prune expirable API caches and retry once.
    pruneExpired();
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* give up silently; app keeps working in-memory */
    }
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch { /* noop */ }
}

// ── TTL cache (for normalized API responses / AI analyses) ──────────

interface Envelope<T> {
  at: number; // stored at
  exp: number; // expires at
  v: T;
}

/** Hard ceiling on cached API/AI entries. Oldest-written evicted first. */
export const MAX_CACHE_ENTRIES = 80;

const USER_KEYS: string[] = [KEYS.settings, KEYS.library, KEYS.usage, "lv:quota:v1", "lv:recent:v1"];

function isCacheKey(k: string): boolean {
  return k.startsWith(PREFIX) && !USER_KEYS.includes(k);
}

/**
 * Enforce the entry ceiling by evicting the oldest-written cache
 * envelopes. User data is never considered for eviction.
 */
export function enforceCacheBound(max = MAX_CACHE_ENTRIES): number {
  try {
    const entries: { key: string; at: number }[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !isCacheKey(k)) continue;
      let at = 0;
      try {
        const env = JSON.parse(localStorage.getItem(k) || "");
        at = typeof env?.at === "number" ? env.at : 0;
      } catch { /* malformed — treat as oldest, evict first */ }
      entries.push({ key: k, at });
    }
    if (entries.length <= max) return 0;
    entries.sort((a, b) => a.at - b.at); // oldest first
    const doomed = entries.slice(0, entries.length - max);
    doomed.forEach((e) => localStorage.removeItem(e.key));
    return doomed.length;
  } catch {
    return 0;
  }
}

export function ttlSet<T>(key: string, value: T, ttlMs: number): void {
  const now = Date.now();
  writeJSON(PREFIX + key, { at: now, exp: now + ttlMs, v: value } satisfies Envelope<T>);
  enforceCacheBound();
}

export function ttlGet<T>(key: string): { value: T; at: number } | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const env = JSON.parse(raw) as Envelope<T>;
    if (!env || typeof env.exp !== "number") return null;
    if (Date.now() > env.exp) {
      localStorage.removeItem(PREFIX + key);
      return null;
    }
    return { value: env.v, at: env.at };
  } catch {
    return null;
  }
}

/** Remove every expired envelope under the app prefix. */
export function pruneExpired(): number {
  const now = Date.now();
  let removed = 0;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !isCacheKey(k)) continue;
      try {
        const env = JSON.parse(localStorage.getItem(k) || "");
        if (env && typeof env.exp === "number" && now > env.exp) doomed.push(k);
      } catch { /* not an envelope */ }
    }
    doomed.forEach((k) => localStorage.removeItem(k));
    removed = doomed.length;
  } catch { /* noop */ }
  return removed;
}

/** Clear all cached API responses & AI analyses, keep user data. */
export function clearApiCaches(): number {
  let removed = 0;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !isCacheKey(k)) continue;
      doomed.push(k);
    }
    doomed.forEach((k) => localStorage.removeItem(k));
    removed = doomed.length;
  } catch { /* noop */ }
  return removed;
}

// Cache key builders ----------------------------------------------------
export const CK = {
  categoryFeed: (catId: string, window: string) => `cat:v3:${catId}:${window}`,
  search: (q: string, window: string, lang: string) => `q:v3:${hashish(q + "|" + window + "|" + lang)}`,
  popular: (region: string) => `pop:v3:${region}`,
  ai: (videoId: string) => `ai:v3:${videoId}`,
};

function hashish(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
