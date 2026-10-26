// ── Horizontally scrollable filter chip bars ────────────────────────

import type { PublishWindow, SortKey } from "../types";

const WINDOWS: { id: PublishWindow; label: string }[] = [
  { id: "24h", label: "24h" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "any", label: "All time" },
];

const SORTS: { id: SortKey; label: string }[] = [
  { id: "relevance", label: "Relevance" },
  { id: "views", label: "Views" },
  { id: "likes", label: "Likes" },
  { id: "comments", label: "Comments" },
  { id: "date", label: "Newest" },
  { id: "duration", label: "Longest" },
];

export function FilterBar({
  window, setWindow, sort, setSort, sortKeys,
}: {
  window: PublishWindow;
  setWindow: (w: PublishWindow) => void;
  sort: SortKey;
  setSort: (s: SortKey) => void;
  sortKeys?: SortKey[];
}) {
  const allowed = sortKeys ?? ["relevance", "views", "likes", "comments", "date", "duration"];
  return (
    <div className="no-scrollbar -mx-4 flex items-center gap-1.5 overflow-x-auto px-4 py-2" role="toolbar" aria-label="Filters">
      <span className="mr-0.5 shrink-0 text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-faint)]">Period</span>
      {WINDOWS.map((w) => (
        <button key={w.id} className="chip" data-on={window === w.id} aria-pressed={window === w.id}
          onClick={() => setWindow(w.id)}>
          {w.label}
        </button>
      ))}
      <span className="mx-1 h-4 w-px shrink-0 bg-[var(--border-strong)]" aria-hidden />
      <span className="mr-0.5 shrink-0 text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-faint)]">Sort</span>
      {SORTS.filter((s) => allowed.includes(s.id)).map((s) => (
        <button key={s.id} className="chip" data-on={sort === s.id} aria-pressed={sort === s.id}
          onClick={() => setSort(s.id)}>
          {s.label}
        </button>
      ))}
    </div>
  );
}

export function ChipRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="no-scrollbar -mx-4 flex items-center gap-1.5 overflow-x-auto px-4 py-2">
      {children}
    </div>
  );
}

export function Chip({
  on, onClick, children, title,
}: { on?: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button className="chip" data-on={on} aria-pressed={on} onClick={onClick} title={title}>
      {children}
    </button>
  );
}
