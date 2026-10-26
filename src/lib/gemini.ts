// ── Gemini educational analysis client ──────────────────────────────
// Honesty rules enforced BY CONSTRUCTION, not by asking the model nicely:
//
//  1. Only title + description (+ chapter LABELS parsed from the
//     description) are ever sent. There is no transcript access in a
//     backend-free app, so `confidence` is hard-coded to "limited".
//  2. The model may only reference chapters by INDEX. Timestamps are
//     attached locally from our own parse of the description, so the
//     model cannot fabricate a seek point even if it tries.
//  3. If a video has no verified chapters, `segments` is forced to []
//     and the UI states that no timeline is available.
//  4. Nothing in the prompt or output implies the model watched anything.
//
// This module performs no caching and no budget bookkeeping — that is
// the AI service's job (./aiService). It is a pure request/validate layer.

import type { AiAnalysis, AiSegment, Chapter, QualityTier, SegmentKind } from "../types";
import { AI_SCHEMA } from "../types";
import { compactDescription } from "./parse";
import { dispatch, AuthError, ApiError } from "./apiClient";
import { hashKey } from "./utils";

export const GEMINI_MODEL = "gemini-2.0-flash";

/** Hard ceiling on videos per request — keeps payload + latency bounded. */
export const MAX_BATCH = 5;

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  promptFeedback?: { blockReason?: string };
}

export class GeminiKeyError extends Error {
  constructor(msg = "Gemini API key rejected") { super(msg); this.name = "GeminiKeyError"; }
}
export class GeminiQuotaError extends Error {
  constructor(msg = "Gemini quota or rate limit reached") { super(msg); this.name = "GeminiQuotaError"; }
}
export class GeminiError extends Error {
  constructor(msg: string) { super(msg); this.name = "GeminiError"; }
}

export interface AnalysisInput {
  id: string;
  title: string;
  channelTitle: string;
  publishedAt: string;
  durationSec: number;
  description: string;
  /** Verified chapters parsed from the description — the ONLY timestamp source. */
  chapters: Chapter[];
}

const TIERS: QualityTier[] = ["high", "promotional", "verify", "low", "unsafe"];
const DIFFS = ["beginner", "intermediate", "advanced", "mixed"] as const;
const KINDS: SegmentKind[] = ["essential", "peak", "skip"];

interface RawAnalysis {
  videoIndex?: number;
  summary?: string;
  topic?: string;
  audience?: string;
  keyLessons?: unknown;
  takeaways?: unknown;
  prerequisites?: string;
  difficulty?: string;
  tier?: string;
  tierReason?: string;
  promoWarning?: string | null;
  claimsToVerify?: unknown;
  segmentNotes?: { chapterIndex?: number; kind?: string; reason?: string }[];
  viewingPlan?: string;
  questions?: unknown;
}

function asStringList(x: unknown, max: number, maxLen = 160): string[] {
  if (!Array.isArray(x)) return [];
  return x
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim().slice(0, maxLen))
    .slice(0, max);
}

function str(x: unknown, fallback: string, maxLen: number): string {
  const v = typeof x === "string" && x.trim() ? x.trim() : fallback;
  return v.slice(0, maxLen);
}

// ── Prompt ──────────────────────────────────────────────────────────

export function buildPrompt(videos: AnalysisInput[]): string {
  const payload = videos.map((v, i) => ({
    videoIndex: i,
    title: v.title,
    channel: v.channelTitle,
    publishedAt: v.publishedAt,
    durationMinutes: Math.round(v.durationSec / 60),
    description: compactDescription(v.description),
    // Labels only — no timestamps are sent, so none can be echoed back.
    chapters: v.chapters.map((c, ci) => ({ chapterIndex: ci, label: c.label })),
  }));

  return `You are an educational-content analyst for a curated learning app covering wealth/business, AI & software, markets & trading, evidence-based health, focus/productivity, and paid-knowledge platforms (Whop, Skool, Udemy, Coursera).

CRITICAL CONSTRAINTS — you are being audited for honesty:
- You have ONLY the title, description text, and chapter labels below.
- You have NOT watched these videos. You have NO transcript, NO captions, NO audio.
- Never state or imply that you watched, listened to, or read a transcript.
- Never invent facts, quotes, statistics, speaker claims, sources, timestamps, or chapters.
- Never output a timestamp or time string. Refer to sections ONLY by the chapterIndex values given.
- If the metadata is too thin to judge something, say so plainly instead of guessing.
- Base every judgement on observable evidence in the supplied text.

Classify each video into exactly one tier:
- "high": substantive educational value (step-by-step tutorials, transparent case studies, expert explanation, evidence-based claims)
- "promotional": genuinely useful but materially promotional, affiliate-driven, or a funnel to a paid offer
- "verify": plausible and potentially useful, but makes claims that need independent verification
- "low": thin, repetitive, or motivational filler without substantive instruction
- "unsafe": misleading or potentially harmful (income guarantees, "get rich overnight", guaranteed returns, cure claims, dangerous rapid weight-loss advice, deceptive framing)

Judgement rules:
- Do NOT treat trading, crypto, affiliate marketing, or AI-business topics as scams by default. Judge the specific claims made.
- A video that merely DISCUSSES Whop/Skool/Udemy/Coursera is not necessarily an official course or product on that platform. Do not imply it is.
- Health content: favour evidence-based framing. Flag cure/guarantee/miracle language as "unsafe".
- Mentioning risks, costs, limitations, or failures is a POSITIVE signal of honesty.

Return a JSON ARRAY, one object per video, with ONLY these fields:
{
  "videoIndex": number (must match the input),
  "summary": string — one sentence, max 40 words, what the viewer will actually learn,
  "topic": string — max 6 words,
  "audience": string — max 12 words, who this is for,
  "keyLessons": string[] — up to 6 concepts taught, each max 18 words,
  "takeaways": string[] — up to 6 concrete actions a viewer could apply, each max 18 words,
  "prerequisites": string — max 15 words, or "None",
  "difficulty": "beginner" | "intermediate" | "advanced" | "mixed",
  "tier": one of the tiers above,
  "tierReason": string — max 28 words, quote or paraphrase the specific evidence from the metadata that drove the tier,
  "promoWarning": string or null — set only if there is real promotional/affiliate pressure,
  "claimsToVerify": string[] — up to 4 specific claims a careful viewer should check independently,
  "segmentNotes": array of { "chapterIndex": number, "kind": "essential" | "peak" | "skip", "reason": string (max 14 words) }
      — reference ONLY chapterIndex values present in that video's "chapters" array.
      — if a video has an empty "chapters" array, you MUST return [] for it.
      — "essential" = needed to understand the topic, "peak" = highest-value part, "skip" = sponsor/filler/intro padding.
  "viewingPlan": string — max 35 words, how to watch efficiently given the duration,
  "questions": string[] — up to 4 reflection questions to ask after watching
}

VIDEOS:
${JSON.stringify(payload)}

Respond with the JSON array only, no prose, no code fences.`;
}

// ── Response parsing ────────────────────────────────────────────────

export function extractJson(text: string): unknown {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* fall through */ }
  }
  const os = cleaned.indexOf("{");
  const oe = cleaned.lastIndexOf("}");
  if (os >= 0 && oe > os) {
    try { return JSON.parse(cleaned.slice(os, oe + 1)); } catch { /* fall through */ }
  }
  throw new GeminiError("Gemini returned output that could not be parsed as JSON");
}

/**
 * Map raw model output onto ground-truth metadata.
 *
 * Segments are built from OUR parsed chapters: the model supplies an
 * index and a reason; the seconds and label come from the real
 * description. A video with no chapters can never receive segments.
 */
export function materialize(raw: RawAnalysis, video: AnalysisInput): AiAnalysis {
  const segments: AiSegment[] = [];
  const seen = new Set<number>();

  if (Array.isArray(raw.segmentNotes) && video.chapters.length > 0) {
    for (const note of raw.segmentNotes.slice(0, 12)) {
      const ci = typeof note.chapterIndex === "number" ? note.chapterIndex : -1;
      const ch = video.chapters[ci];
      if (!ch) continue;                   // hallucinated index → dropped
      if (seen.has(ch.seconds)) continue;  // duplicate section → dropped
      const reason = typeof note.reason === "string" ? note.reason.trim() : "";
      if (!reason) continue;
      const kind: SegmentKind = KINDS.includes(note.kind as SegmentKind)
        ? (note.kind as SegmentKind)
        : "essential";
      seen.add(ch.seconds);
      segments.push({
        seconds: ch.seconds,   // ← from our parse, never from the model
        label: ch.label,       // ← from our parse, never from the model
        reason: reason.slice(0, 140),
        kind,
        source: "description",
      });
    }
    segments.sort((a, b) => a.seconds - b.seconds);
  }

  const tier: QualityTier = TIERS.includes(raw.tier as QualityTier)
    ? (raw.tier as QualityTier)
    : "verify";
  const difficulty = (DIFFS as readonly string[]).includes(raw.difficulty ?? "")
    ? (raw.difficulty as AiAnalysis["difficulty"])
    : "mixed";

  const promo = typeof raw.promoWarning === "string" && raw.promoWarning.trim().length > 2
    ? raw.promoWarning.trim().slice(0, 240)
    : null;

  return {
    schema: AI_SCHEMA,
    videoId: video.id,
    summary: str(raw.summary, "No summary was produced for this video.", 320),
    topic: str(raw.topic, "General", 80),
    audience: str(raw.audience, "General audience", 140),
    keyLessons: asStringList(raw.keyLessons, 6),
    takeaways: asStringList(raw.takeaways, 6),
    prerequisites: str(raw.prerequisites, "None", 140),
    difficulty,
    tier,
    tierReason: str(raw.tierReason, "No explanation returned.", 240),
    promoWarning: promo,
    claimsToVerify: asStringList(raw.claimsToVerify, 4),
    segments,
    sourceChapterCount: video.chapters.length,
    viewingPlan: str(raw.viewingPlan, "", 240),
    questions: asStringList(raw.questions, 4),
    confidence: "limited",
    analyzedAt: Date.now(),
    model: GEMINI_MODEL,
  };
}

// ── Request ─────────────────────────────────────────────────────────

/**
 * Analyze up to MAX_BATCH videos in a single request.
 * Throws typed errors; performs no caching or budget accounting.
 */
export async function analyzeVideos(
  key: string,
  videos: AnalysisInput[],
  signal?: AbortSignal
): Promise<AiAnalysis[]> {
  if (!key) throw new GeminiKeyError("No Gemini API key configured");
  if (videos.length === 0) return [];

  const batch = videos.slice(0, MAX_BATCH);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`;
  const idKey = batch.map((b) => b.id).sort().join(",");

  let data: GeminiResponse;
  try {
    data = await dispatch<GeminiResponse>({
      kind: "gemini.generate",
      key: `gemini:${hashKey(idKey)}`,
      url,
      signal,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: buildPrompt(batch) }] }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json",
            maxOutputTokens: 4096,
          },
        }),
      },
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    if (e instanceof AuthError) throw new GeminiKeyError();
    if (e instanceof ApiError) {
      if (e.status === 429) throw new GeminiQuotaError();
      if (e.status === 400 || e.status === 401 || e.status === 403) throw new GeminiKeyError();
    }
    throw new GeminiError("Gemini network error — check your connection");
  }

  if (data.promptFeedback?.blockReason) {
    throw new GeminiError(`Gemini blocked this request (${data.promptFeedback.blockReason})`);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new GeminiError("Gemini returned an empty response");

  const parsed = extractJson(text);
  const arr: RawAnalysis[] = Array.isArray(parsed) ? parsed : [parsed as RawAnalysis];

  const out: AiAnalysis[] = [];
  const used = new Set<number>();
  for (const rawItem of arr) {
    let idx = typeof rawItem.videoIndex === "number" ? rawItem.videoIndex : -1;
    if (idx < 0 || idx >= batch.length || used.has(idx)) {
      // Fall back to the next unconsumed slot rather than dropping data.
      idx = batch.findIndex((_, i) => !used.has(i));
    }
    if (idx < 0) break;
    used.add(idx);
    out.push(materialize(rawItem, batch[idx]));
  }
  return out;
}
