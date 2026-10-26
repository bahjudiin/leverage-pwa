// ── Deterministic, explainable quality pre-filter ───────────────────
// Runs locally on every video before any AI call. It never fabricates:
// it only pattern-matches title/description text and duration, and every
// verdict ships with human-readable reasons.

import type { HeuristicVerdict, QualityTier } from "../types";

export interface MetaInput {
  title: string;
  description: string;
  durationSec: number;
}

interface Rule {
  re: RegExp;
  weight: number;
  reason: string;
  hard?: boolean; // hard violations cap the tier
}

const NEGATIVE: Rule[] = [
  { re: /(make|earn|get|generate)\s+\$\s?[\d,.]+\s?(k)?\s*(per|a|every|each)\s*(day|hour|week|month)/i, weight: 4, hard: true, reason: "Promises specific recurring income figures" },
  { re: /get rich (quick|overnight|fast)|overnight (millionaire|success|riches)/i, weight: 4, hard: true, reason: "'Get rich overnight' framing" },
  { re: /guaranteed (income|returns?|profits?|results?)/i, weight: 4, hard: true, reason: "Guarantees financial outcomes" },
  { re: /(secret|hidden)\s+(money|income|wealth)\s+(method|system|trick|loophole)/i, weight: 3, reason: "'Secret method' marketing language" },
  { re: /\b\d{2,}\s?(x|×)\s+(returns?|gains?|profit)/i, weight: 4, hard: true, reason: "Implausible return-multiplier claim" },
  { re: /(quit your job|retire)\s+(in|within)\s+\d+\s+(days?|weeks?|months?)/i, weight: 3, hard: true, reason: "Unrealistic timeline promises" },
  { re: /(lose|drop|burn|melt)\s+\d+\s?(lbs?|pounds|kg|kilos)\s+in\s+\d+\s?(days?|weeks?)/i, weight: 4, hard: true, reason: "Rapid weight-loss claim" },
  { re: /\bcure[sd]?\b|\bmiracle\s+(cure|pill|diet|supplement)/i, weight: 4, hard: true, reason: "Unsupported medical cure claim" },
  { re: /burn fat (overnight|while you sleep|in your sleep)/i, weight: 4, hard: true, reason: "Physiologically impossible claim" },
  { re: /(doctors?|experts?|scientists?)\s+(hate|don'?t want you to know|are hiding)/i, weight: 3, hard: true, reason: "Conspiracy-style health framing" },
  { re: /(one weird trick|this simple trick)/i, weight: 2, reason: "Clickbait phrasing" },
  { re: /you won'?t believe|shocking truth|gone (wrong|sexual)|mind[- ]?blowing|insane results?/i, weight: 2, reason: "Sensationalist language" },
  { re: /\bpassive income\b/i, weight: 1, reason: "Passive-income framing — check substantiation" },
  { re: /\b100x\b|\b1000x\b/i, weight: 4, hard: true, reason: "Implausible multiplier language" },
  { re: /(limited time|act now|don'?t miss out|last chance)/i, weight: 1, reason: "Artificial urgency" },
  { re: /sign up (with|using) my (link|code)|use (my )?(code|link) (for|to get)/i, weight: 1.5, reason: "Affiliate promotion inside pitch" },
  { re: /(free )?(course|training|webinar).{0,30}(link in (the )?(description|bio))/i, weight: 1.5, reason: "Funnels to external promotion" },
];

const POSITIVE: Rule[] = [
  { re: /step[- ]?by[- ]?step|full (tutorial|course|guide|walkthrough)/i, weight: 2, reason: "Structured instructional format" },
  { re: /explained|breakdown|deep ?dive|fundamentals|masterclass|lecture/i, weight: 1.5, reason: "Explanatory framing" },
  { re: /case study|real numbers|behind the scenes|how (i|we) (built|made|grew)/i, weight: 1.5, reason: "Case-study transparency" },
  { re: /documentary|biography|the (story|rise|history) of/i, weight: 1.5, reason: "Documentary format" },
  { re: /evidence[- ]?based|peer[- ]?reviewed|studies (show|suggest)|according to (a )?(study|meta-?analysis|research)/i, weight: 2, reason: "References evidence" },
  { re: /\brisk[sd]?\b|\bdownsides?\b|\bmistakes?\b|\brealistic\b|\bhonest\b|limitations/i, weight: 1.5, reason: "Acknowledges risks/limitations" },
  { re: /for beginners|beginner'?s guide|from scratch|zero to/i, weight: 1, reason: "Beginner-accessible" },
  { re: /citation|references in (the )?description|sources (below|linked)/i, weight: 1, reason: "Cites sources" },
];

/** Fraction of letters in the title that are uppercase. */
export function capsRatio(title: string): number {
  const letters = title.replace(/[^a-zA-Z]/g, "");
  if (letters.length < 8) return 0;
  const caps = letters.replace(/[^A-Z]/g, "").length;
  return caps / letters.length;
}

/** YouTube gives no explicit Shorts flag; combine duration + explicit
 *  hashtag signals, and prefer the `videoDuration` search filter upstream. */
export function isShort(meta: { durationSec: number; title: string; description: string }): boolean {
  if (meta.durationSec > 0 && meta.durationSec < 181) return true;
  if (/#shorts?\b/i.test(meta.title) || /#shorts?\b/i.test(meta.description.slice(0, 200))) return true;
  return false;
}

/** Count "0:00 …" style chapter lines in a description. */
export function hasChapters(description: string): boolean {
  const matches = description.match(/^\s*(?:\d{1,2}:)?\d{1,2}:\d{2}\s/mg);
  return (matches?.length ?? 0) >= 2;
}

export function heuristicAnalyze(meta: MetaInput): HeuristicVerdict {
  const text = `${meta.title}\n${meta.description.slice(0, 1200)}`;
  const flags: string[] = [];
  const positives: string[] = [];
  let score = 0;
  let hard = false;

  for (const rule of NEGATIVE) {
    if (rule.re.test(text)) {
      flags.push(rule.reason);
      score -= rule.weight;
      if (rule.hard) hard = true;
    }
  }
  for (const rule of POSITIVE) {
    if (rule.re.test(text)) {
      positives.push(rule.reason);
      score += rule.weight;
    }
  }

  if (capsRatio(meta.title) > 0.65) {
    flags.push("All-caps sensational title");
    score -= 1.5;
  }
  if ((meta.title.match(/!/g)?.length ?? 0) >= 3) {
    flags.push("Excessive exclamation");
    score -= 1;
  }
  if (hasChapters(meta.description)) {
    positives.push("Structured with chapters");
    score += 1.5;
  }
  if (meta.durationSec >= 20 * 60 && meta.durationSec <= 3 * 3600) {
    positives.push("Long-form (20+ min)");
    score += 1;
  }
  if (meta.durationSec > 0 && meta.durationSec < 4 * 60) {
    flags.push("Very short — limited depth");
    score -= 1;
  }

  let tier: QualityTier;
  if (hard) tier = "unsafe";
  else if (score >= 3.5 && flags.length === 0) tier = "high";
  else if (flags.length === 0 && score > 0) tier = "verify"; // promising but light evidence
  else if (flags.length > 0 && score >= 1) tier = "promotional";
  else if (flags.length > 0) tier = "low";
  else tier = "unrated";

  return { tier, flags, positives, score: Math.round(score * 10) / 10 };
}

export const TIER_LABEL: Record<QualityTier, string> = {
  high: "High value",
  promotional: "Promotional",
  verify: "Verify",
  low: "Low value",
  unsafe: "Misleading",
  unrated: "Unrated",
};

export const TIER_TONE: Record<QualityTier, "good" | "warn" | "bad" | "dim"> = {
  high: "good",
  promotional: "warn",
  verify: "dim",
  low: "warn",
  unsafe: "bad",
  unrated: "dim",
};
