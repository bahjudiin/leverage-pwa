// ── Formatting & misc utilities ─────────────────────────────────────

export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const v = n / 1000;
    return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")}K`;
  }
  if (n < 1_000_000_000) {
    const v = n / 1_000_000;
    return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")}M`;
  }
  const v = n / 1_000_000_000;
  return `${v.toFixed(1).replace(/\.0$/, "")}B`;
}

export function formatFull(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "Not disclosed";
  return n.toLocaleString("en-US");
}

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "0:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function timeAgo(iso: string | number): string {
  const t = typeof iso === "string" ? new Date(iso).getTime() : iso;
  const diff = Date.now() - t;
  if (diff < 0) return "just now";
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatClock(epoch: number): string {
  return new Date(epoch).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function windowCutoffMillis(w: "24h" | "7d" | "30d" | "any"): number | null {
  const now = Date.now();
  switch (w) {
    case "24h": return now - 24 * 3600 * 1000;
    case "7d": return now - 7 * 24 * 3600 * 1000;
    case "30d": return now - 30 * 24 * 3600 * 1000;
    default: return null;
  }
}

export function publishedAfterIso(w: "24h" | "7d" | "30d" | "any"): string | undefined {
  const cut = windowCutoffMillis(w);
  return cut === null ? undefined : new Date(cut).toISOString();
}

/** Stable, small hash for cache keys (FNV-1a). */
export function hashKey(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Current calendar day in the YouTube quota timezone (America/Los_Angeles). */
export function quotaDay(d = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function dedupe<T>(arr: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of arr) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}
