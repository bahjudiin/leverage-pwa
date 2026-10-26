// ── Saved library: bookmarks, progress, completed, hidden ───────────
// Fully local (works offline). Snapshots were captured from real API
// data at save/progress time — never fabricated.

import { useMemo, useState } from "react";
import { BookMarked, BookmarkX, CheckCircle2, Eye, EyeOff, ListChecks } from "lucide-react";
import { useApp } from "../state/store";
import { Page } from "../components/chrome";
import { SavedEmpty, EmptyState } from "../components/States";
import { formatDuration } from "../lib/utils";
import type { WatchEntry } from "../types";

type Tab = "saved" | "progress" | "completed" | "hidden";

export default function Saved() {
  const app = useApp();
  const [tab, setTab] = useState<Tab>("saved");
  const entries = Object.values(app.state.library.entries);

  const lists = useMemo(() => {
    const byUpdated = (a: WatchEntry, b: WatchEntry) => b.updatedAt - a.updatedAt;
    return {
      saved: entries.filter((e) => e.saved && !e.hidden).sort(byUpdated),
      progress: entries.filter((e) => !e.hidden && e.progress > 0.02 && e.progress < 0.92 && !e.completed).sort(byUpdated),
      completed: entries.filter((e) => e.completed && !e.hidden).sort(byUpdated),
      hidden: entries.filter((e) => e.hidden).sort(byUpdated),
    };
  }, [entries]);

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "saved", label: "Saved", count: lists.saved.length },
    { id: "progress", label: "In progress", count: lists.progress.length },
    { id: "completed", label: "Completed", count: lists.completed.length },
    { id: "hidden", label: "Hidden", count: lists.hidden.length },
  ];

  const list = lists[tab];

  return (
    <Page>
      <h1 className="text-[21px] font-bold tracking-tight">Saved</h1>
      <p className="mt-1 text-[12.5px] text-[var(--text-dim)]">
        Your library lives in this device&apos;s localStorage — no account, no sync. Export it
        from Settings any time.
      </p>

      <div className="no-scrollbar -mx-4 mt-4 flex gap-1.5 overflow-x-auto px-4" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id}
            className="chip" data-on={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
            <span className="tnum text-[10px] opacity-70">{t.count}</span>
          </button>
        ))}
      </div>

      {list.length === 0 && tab === "saved" && <SavedEmpty />}
      {list.length === 0 && tab === "progress" && (
        <EmptyState icon={<ListChecks size={22} />} title="Nothing in progress"
          body="Videos you partially watch with the built-in player show up here automatically." />
      )}
      {list.length === 0 && tab === "completed" && (
        <EmptyState icon={<CheckCircle2 size={22} />} title="No completions yet"
          body="Finish a video or mark one complete from its details page." />
      )}
      {list.length === 0 && tab === "hidden" && (
        <EmptyState icon={<EyeOff size={22} />} title="No hidden videos"
          body="Hidden videos are excluded from every feed. Unhide them here." />
      )}

      <div className="mt-3 flex flex-col divide-y divide-[var(--border)]">
        {list.map((e) => (
          <SavedRow key={e.id} entry={e} tab={tab} />
        ))}
      </div>
    </Page>
  );
}

function SavedRow({ entry, tab }: { entry: WatchEntry; tab: Tab }) {
  const app = useApp();
  const open = () => app.navigate({ view: "video", id: entry.id });
  return (
    <article
      role="button" tabIndex={0} onClick={open}
      onKeyDown={(k) => { if (k.key === "Enter") open(); }}
      className="group flex cursor-pointer items-center gap-3 py-3"
    >
      <div className="relative h-[62px] w-[106px] shrink-0 overflow-hidden rounded-[10px] bg-[var(--bg-sunk)]">
        {entry.thumb && <img src={entry.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />}
        {entry.durationSec > 0 && (
          <span className="tnum absolute bottom-1 right-1 rounded-[5px] bg-black/85 px-1 py-0.5 text-[9.5px] font-semibold text-white">
            {formatDuration(entry.durationSec)}
          </span>
        )}
        {entry.progress > 0.01 && !entry.completed && (
          <span className="absolute inset-x-0 bottom-0 h-[3px] bg-white/25">
            <span className="block h-full bg-[var(--good)]" style={{ width: `${Math.round(entry.progress * 100)}%` }} />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="line-clamp-2 text-[13px] font-semibold leading-snug">{entry.title}</h3>
        <p className="mt-1 truncate text-[11.5px] text-[var(--text-dim)]">
          {entry.channelTitle}
          {entry.completed && <span className="ml-1.5 inline-flex items-center gap-1 text-[var(--good)]"><CheckCircle2 size={11} />Completed</span>}
          {!entry.completed && entry.progress > 0.01 && (
            <span className="tnum ml-1.5">{Math.round(entry.progress * 100)}% watched</span>
          )}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {tab === "hidden" ? (
          <button className="iconbtn" aria-label="Unhide video"
            onClick={(ev) => { ev.stopPropagation(); app.unhideVideo(entry.id); }}>
            <Eye size={16} />
          </button>
        ) : entry.saved ? (
          <button className="iconbtn" aria-label="Remove from saved"
            onClick={(ev) => { ev.stopPropagation(); app.unsaveVideo(entry.id); }}>
            <BookmarkX size={16} />
          </button>
        ) : (
          <BookMarked size={15} className="mx-2 text-[var(--text-faint)]" />
        )}
      </div>
    </article>
  );
}
