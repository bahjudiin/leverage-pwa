// ── Dev-only API request inspector ──────────────────────────────────
// Rendered ONLY in development. The whole module is dead-code-eliminated
// from production bundles because every usage is behind import.meta.env.DEV.

import { useEffect, useState } from "react";
import { Activity, X } from "lucide-react";
import { coordinatorStats, getUsage, isQuotaBlocked } from "../lib/youtube";
import type { LogEntry } from "../lib/apiClient";

interface Api {
  log: LogEntry[];
  summary: () => Record<string, unknown>;
  reset: () => void;
}

function readApi(): Api | null {
  return (window as unknown as { __LV_API__?: Api }).__LV_API__ ?? null;
}

const OUTCOME_COLOR: Record<string, string> = {
  net: "var(--info)",
  dedup: "var(--good)",
  suppressed: "var(--good)",
  blocked: "var(--warn)",
  error: "var(--bad)",
};

export default function DevRequestInspector() {
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  const api = readApi();
  const log = api?.log ?? [];
  const usage = getUsage();
  const stats = coordinatorStats();
  const net = log.filter((l) => l.outcome === "net").length;
  const saved = log.filter((l) => l.outcome === "dedup" || l.outcome === "suppressed").length;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Dev: API request inspector"
        className="fixed bottom-[70px] left-3 z-[60] flex items-center gap-1.5 rounded-full border border-[var(--border-strong)] bg-[var(--bg-elev)] px-2.5 py-1.5 text-[10.5px] font-bold shadow-[var(--shadow)] lg:bottom-3"
      >
        <Activity size={12} />
        <span className="tnum">{usage.units}u</span>
        <span className="tnum text-[var(--text-faint)]">{net}n/{saved}s</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-[70px] left-3 z-[60] max-h-[60vh] w-[min(380px,calc(100vw-24px))] overflow-hidden rounded-[12px] border border-[var(--border-strong)] bg-[var(--bg-elev)] shadow-[var(--shadow)] lg:bottom-3">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
        <span className="flex items-center gap-1.5 text-[11.5px] font-bold">
          <Activity size={12} /> API Inspector <span className="text-[var(--text-faint)]">(dev only)</span>
        </span>
        <div className="flex items-center gap-1">
          <button className="text-[10.5px] font-semibold text-[var(--text-dim)] underline" onClick={() => api?.reset()}>
            reset
          </button>
          <button className="iconbtn !h-6 !w-6" onClick={() => setOpen(false)} aria-label="Close inspector">
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-px border-b border-[var(--border)] bg-[var(--border)]">
        {[
          { k: "units", v: usage.units },
          { k: "network", v: net },
          { k: "saved", v: saved },
          { k: "inflight", v: stats.inflight },
        ].map((s) => (
          <div key={s.k} className="bg-[var(--bg-elev)] px-2 py-1.5 text-center">
            <div className="tnum text-[13px] font-bold">{s.v}</div>
            <div className="text-[9px] uppercase tracking-wide text-[var(--text-faint)]">{s.k}</div>
          </div>
        ))}
      </div>

      {isQuotaBlocked() && (
        <div className="border-b border-[var(--border)] bg-[var(--bg-sunk)] px-3 py-1.5 text-[10.5px] font-semibold text-[var(--warn)]">
          Quota blocked — requests short-circuit until the PT reset.
        </div>
      )}

      <div className="max-h-[36vh] overflow-y-auto">
        {log.length === 0 && (
          <p className="px-3 py-4 text-center text-[11px] text-[var(--text-faint)]">
            No requests yet. Open a feed or press Refresh.
          </p>
        )}
        {[...log].reverse().map((l, i) => (
          <div key={i} className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-1.5 text-[10.5px]">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: OUTCOME_COLOR[l.outcome] }} />
            <span className="w-[108px] shrink-0 truncate font-semibold">{l.kind}</span>
            <span className="w-[62px] shrink-0 text-[var(--text-dim)]">{l.outcome}</span>
            <span className="tnum w-[38px] shrink-0 text-right">{l.units}u</span>
            <span className="tnum w-[48px] shrink-0 text-right text-[var(--text-faint)]">{l.ms}ms</span>
          </div>
        ))}
      </div>
    </div>
  );
}
