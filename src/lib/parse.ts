// ── Description / chapter parsing (pure functions) ──────────────────
// Chapters are only ever extracted from real description timestamps —
// never invented.

import type { Chapter } from "../types";

const LINE_RE = /^\s*(?:[•\-*▸►▶]\s*)?(?:(\d{1,2}):)?(\d{1,3}):(\d{2})\s*[-–—|·:.)]*\s*(.+?)\s*$/;

export function tsToSeconds(h: string | undefined, m: string, s: string): number {
  return (h ? Number(h) * 3600 : 0) + Number(m) * 60 + Number(s);
}

export function formatTimestamp(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Extract chapters from a video description.
 * Requires at least 2 timestamped lines to avoid false positives.
 */
export function parseChapters(description: string, durationSec = 0): Chapter[] {
  if (!description) return [];
  const out: Chapter[] = [];
  for (const line of description.split("\n")) {
    const m = LINE_RE.exec(line);
    if (!m) continue;
    const seconds = tsToSeconds(m[1], m[2], m[3]);
    if (durationSec > 0 && seconds > durationSec + 30) continue;
    let label = (m[4] ?? "").replace(/^[-–—|·:.)]+\s*/, "").trim();
    if (!label || label.length < 2) label = "Section";
    if (label.length > 90) label = label.slice(0, 89) + "…";
    out.push({ seconds, label });
  }
  if (out.length < 2) return [];
  // dedupe identical timestamps, keep order of appearance
  const seen = new Set<number>();
  const chapters = out.filter((c) => (seen.has(c.seconds) ? false : (seen.add(c.seconds), true)));
  return chapters.sort((a, b) => a.seconds - b.seconds).slice(0, 40);
}

/** Strip URLs + excessive whitespace for AI payload compaction. */
export function compactDescription(description: string, max = 1600): string {
  const noUrls = description.replace(/https?:\/\/\S+/g, "").replace(/[ \t]+/g, " ");
  const lines = noUrls.split("\n").filter((l) => l.trim().length > 0);
  let out = "";
  for (const l of lines) {
    if (out.length + l.length > max) break;
    out += l.trim() + "\n";
  }
  return out.trim();
}
