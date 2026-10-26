// ── Post-discovery automatic analysis pass ──────────────────────────
// Runs at most ONE batched Gemini request after a discovery load, and
// only when the user has explicitly opted in (aiEnabled + aiAutoAnalyze
// + own key) and budget remains. Never per-card, never per-render.
//
// All real work lives in ./aiService — this is the discovery hook.

import type { AiAnalysis, Settings, VideoItem } from "../types";
import {
  analyzeBatch, pickCandidates, AiUnavailableError, describeAiError, AUTO_BATCH_LIMIT,
} from "./aiService";

export async function maybeAutoAnalyze(
  settings: Settings,
  videos: VideoItem[],
  setAi: (a: AiAnalysis) => void,
  toast: (msg: string, kind?: "info" | "success" | "error") => void,
  online = true
): Promise<void> {
  // Opt-in only. Default configuration performs zero AI calls.
  if (!settings.aiEnabled || !settings.aiAutoAnalyze || !settings.geminiKey) return;

  // Deterministic local filter first — only ambiguous videos reach Gemini.
  const candidates = pickCandidates(videos, AUTO_BATCH_LIMIT);
  if (candidates.length === 0) return;

  try {
    const res = await analyzeBatch(settings, candidates, { limit: AUTO_BATCH_LIMIT, online });
    res.analyses.forEach(setAi);
  } catch (e) {
    // Budget exhaustion is normal and silent; real faults inform the user once.
    if (e instanceof AiUnavailableError && e.reason === "budget") return;
    if (e instanceof DOMException && e.name === "AbortError") return;
    toast(describeAiError(e), "error");
  }
}
