// ── Manual budgeted batch analysis ──────────────────────────────────
// Lets the user spend AI budget deliberately on the ambiguous videos in
// the current feed. Rendered only when AI is configured AND there are
// uncached candidates — otherwise it stays out of the way entirely.

import { useMemo, useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { useApp } from "../state/store";
import type { VideoItem } from "../types";
import {
  AUTO_BATCH_LIMIT, aiAvailability, analyzeBatch, budgetState,
  describeAiError, pickCandidates, reserveBudget,
} from "../lib/aiService";

export default function AnalyzeCandidates({ videos }: { videos: VideoItem[] }) {
  const app = useApp();
  const { settings } = app.state;
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const availability = aiAvailability(settings, app.state.online);
  const budget = budgetState(settings);

  // Recomputed only when the pool or the known-analysis set changes.
  const candidates = useMemo(
    () => pickCandidates(videos, AUTO_BATCH_LIMIT),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [videos, app.state.ai]
  );

  // Nothing to offer: AI off/unconfigured, or no ambiguous uncached videos.
  if (availability === "disabled" || availability === "no-key") return null;
  if (candidates.length === 0) return null;

  const willRun = reserveBudget(settings, candidates.length);
  const blocked = availability !== "none" || willRun < 1;

  const run = async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    try {
      const res = await analyzeBatch(settings, candidates, {
        limit: AUTO_BATCH_LIMIT,
        online: app.state.online,
        signal: ctrl.signal,
      });
      res.analyses.forEach(app.setAi);
      if (res.fresh > 0) {
        app.toast(
          `Analyzed ${res.fresh} video${res.fresh === 1 ? "" : "s"}${res.skipped ? ` · ${res.skipped} left for later` : ""}`,
          "success"
        );
      } else if (res.reused > 0) {
        app.toast("Reused existing analyses — no API call needed");
      } else {
        app.toast("No budget remaining for new analyses", "error");
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        app.toast(describeAiError(e), "error");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-[var(--border)] bg-[var(--bg-elev)] px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-[12px] font-semibold">
          {candidates.length} video{candidates.length === 1 ? "" : "s"} need a closer look
        </p>
        <p className="mt-0.5 text-[10.5px] leading-snug text-[var(--text-faint)]">
          {availability === "budget"
            ? "Daily AI budget spent — these stay on the local filter only."
            : `The local filter couldn't settle these. One batched request analyzes ${willRun}, using ${willRun} of ${budget.remaining} remaining.`}
        </p>
      </div>
      <button className="btn btn-ghost shrink-0 !h-[30px] !text-[12px]" onClick={() => void run()} disabled={busy || blocked}>
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
        {busy ? "Analyzing…" : `Analyze ${willRun || candidates.length}`}
      </button>
    </div>
  );
}
