// ── Explore: user-initiated search over the YouTube Data API ────────
// One search.list + one batched videos.list per query. Results cached
// 45 min. No suggestions are fabricated — recent searches are the
// user's own (stored locally).

import { useMemo, useState } from "react";
import { Clock, Compass, RefreshCw, Search, X } from "lucide-react";
import { useApp } from "../state/store";
import { runSearch, verdictMap } from "../lib/discover";
import { applyFilters, reasonForVideo, sortVideos } from "../lib/feeds";
import { useFeedLoader, successSlice } from "../hooks/useFeedLoader";
import { FilterBar } from "../components/FilterChips";
import { VideoRow } from "../components/VideoCard";
import AnalyzeCandidates from "../components/AnalyzeCandidates";
import { EmptyState, KeyGate, QuotaState, RateGuardState, SkeletonRows } from "../components/States";
import { Page } from "../components/chrome";
import { RISING_TOPICS } from "../lib/categories";
import { readJSON, writeJSON } from "../lib/storage";
import { formatClock } from "../lib/utils";
import type { PublishWindow, SortKey } from "../types";

const RECENT_KEY = "lv:recent:v1";

export default function Explore() {
  const app = useApp();
  const { settings } = app.state;
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [window, setWindow] = useState<PublishWindow>(settings.window);
  const [sort, setSort] = useState<SortKey>("relevance");
  const [recent, setRecent] = useState<string[]>(() => readJSON<string[]>(RECENT_KEY, []));

  const scope = `search:${query}`;
  const { slice, load } = useFeedLoader(
    scope,
    async (signal, force) => {
      if (!query.trim()) return { state: "idle", videos: [], fetchedAt: 0, fromCache: false };
      const res = await runSearch(
        { key: settings.ytKey, settings: { ...settings, window }, signal },
        query,
        force
      );
      return successSlice(res);
    },
    `q:${query}|w:${window}|l:${settings.language}`
  );

  const verdicts = useMemo(() => verdictMap(slice.videos), [slice.videos]);
  const entries = app.state.library.entries;
  const hiddenIds = useMemo(
    () => new Set(Object.values(entries).filter((e) => e.hidden).map((e) => e.id)),
    [entries]
  );

  const visible = useMemo(() => {
    const filtered = applyFilters(
      slice.videos,
      {
        minDurationSec: settings.minDurationSec,
        window: "any", // server already applied the window
        blockedChannels: settings.blockedChannels,
        blockedKeywords: settings.blockedKeywords,
        language: "any",
      },
      verdicts,
      hiddenIds
    );
    return sortVideos(filtered, sort);
  }, [slice.videos, verdicts, hiddenIds, sort, settings]);

  const submit = (q: string) => {
    const clean = q.trim();
    if (!clean) return;
    setQuery(clean);
    setInput(clean);
    const next = [clean, ...recent.filter((r) => r.toLowerCase() !== clean.toLowerCase())].slice(0, 8);
    setRecent(next);
    writeJSON(RECENT_KEY, next);
  };

  if (!settings.ytKey) return <Page><KeyGate /></Page>;

  return (
    <Page>
      <h1 className="text-[21px] font-bold tracking-tight">Explore</h1>
      <p className="mt-1 text-[12.5px] text-[var(--text-dim)]">
        Search the official YouTube index for long-form educational videos. Each search is a
        single API call — results are cached locally for 45 minutes.
      </p>

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => { e.preventDefault(); submit(input); }}
        role="search"
      >
        <div className="relative flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
          <input
            className="input pl-9"
            placeholder="e.g. “risk management course”, “AI agents tutorial”…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-label="Search videos"
          />
        </div>
        <button type="submit" className="btn shrink-0" disabled={!input.trim() || slice.state === "loading"}>
          Search
        </button>
      </form>

      {!query && recent.length > 0 && (
        <div className="mt-5">
          <div className="label mb-2 flex items-center gap-1.5"><Clock size={11} /> Recent searches</div>
          <div className="flex flex-wrap gap-1.5">
            {recent.map((r) => (
              <span key={r} className="chip !gap-0 !pr-1">
                <button
                  type="button"
                  className="max-w-[180px] truncate"
                  onClick={() => submit(r)}
                  aria-label={`Search again for ${r}`}
                >
                  {r}
                </button>
                <button
                  type="button"
                  className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-[var(--bg-sunk)]"
                  aria-label={`Remove recent search ${r}`}
                  onClick={() => {
                    const next = recent.filter((x) => x !== r);
                    setRecent(next);
                    writeJSON(RECENT_KEY, next);
                  }}
                >
                  <X size={12} aria-hidden />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {!query && (
        <div className="mt-6">
          <div className="label mb-2">Try a rising topic</div>
          <div className="flex flex-wrap gap-1.5">
            {RISING_TOPICS.map((t) => (
              <button key={t.label} className="chip" onClick={() => submit(t.query)}>{t.label}</button>
            ))}
          </div>
        </div>
      )}

      {query && (
        <>
          <div className="mt-3">
            <FilterBar window={window} setWindow={setWindow} sort={sort} setSort={setSort} />
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px] text-[var(--text-faint)]">
            <span>
              {slice.state === "success" &&
                `${visible.length} results · snapshot ${formatClock(slice.fetchedAt)}${slice.fromCache ? " · cached" : ""}`}
            </span>
            <button
              className="inline-flex items-center gap-1 font-semibold text-[var(--text-dim)] hover:text-[var(--text)] disabled:opacity-40"
              onClick={() => void load(true)}
              disabled={slice.state === "loading" || !app.state.online || app.state.quotaBlocked}
            >
              <RefreshCw size={11} className={slice.state === "loading" ? "animate-spin" : ""} /> Refresh
            </button>
          </div>

          {app.state.quotaBlocked && <div className="mt-3"><QuotaState /></div>}
          {slice.state === "loading" && <div className="mt-3"><SkeletonRows n={6} /></div>}
          {slice.state === "error" && (
            /rate|slow down|short period/i.test(slice.error ?? "")
              ? <RateGuardState onRetry={() => void load(true)} />
              : <EmptyState
                  title="Search failed"
                  body={slice.error ?? "Network error."}
                  action={<button className="btn btn-ghost" onClick={() => void load(true)}>Retry</button>}
                />
          )}
          {slice.state === "success" && visible.length > 0 && <AnalyzeCandidates videos={visible} />}
          {slice.state === "success" && (
            <div className="mt-1 flex flex-col divide-y divide-[var(--border)]">
              {visible.map((v) => (
                <VideoRow
                  key={v.id}
                  v={v}
                  verdict={verdicts.get(v.id)}
                  aiTier={app.state.ai[v.id]?.tier ?? null}
                  entry={entries[v.id]}
                  reason={reasonForVideo(v, {
                    tier: app.state.ai[v.id]?.tier ?? verdicts.get(v.id)?.tier,
                    cats: v.categoryIds,
                  })}
                />
              ))}
              {visible.length === 0 && (
                <EmptyState
                  icon={<Compass size={22} />}
                  title="No matches with these filters"
                  body="Try a wider time window, or lower the minimum duration in Settings."
                />
              )}
            </div>
          )}
        </>
      )}
    </Page>
  );
}
