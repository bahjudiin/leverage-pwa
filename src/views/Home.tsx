// ── Home feed ───────────────────────────────────────────────────────
// One user-action-triggered discovery pass builds the pool; EVERY
// section below is a client-side slice of that pool (zero extra quota).

import { useMemo, useState } from "react";
import { ArrowRight, ChevronRight, Flame, MonitorPlay, RefreshCw, Sparkles } from "lucide-react";
import { useApp } from "../state/store";
import { loadHome, runSearch, verdictMap } from "../lib/discover";
import { buildHomeSections, reasonForVideo } from "../lib/feeds";
import { useFeedLoader, successSlice } from "../hooks/useFeedLoader";
import { maybeAutoAnalyze } from "../lib/autoai";
import { RISING_TOPICS } from "../lib/categories";
import { SpotlightCard, VideoRow } from "../components/VideoCard";
import { SkeletonCards, KeyGate, QuotaState, RateGuardState, EmptyState } from "../components/States";
import { Page } from "../components/chrome";
import { formatClock, truncate } from "../lib/utils";
import type { WatchEntry } from "../types";

export default function Home() {
  const app = useApp();
  const { settings } = app.state;

  const { slice, load } = useFeedLoader(
    "home",
    async (signal, force) => {
      const res = await loadHome(
        { key: settings.ytKey, settings: { ...settings, window: "any" }, signal },
        force
      );
      app.dispatch({
        type: "pool/set",
        scope: "home:popular",
        slice: { state: "success", videos: res.popular, fetchedAt: res.fetchedAt, fromCache: res.fromCache },
      });
      void maybeAutoAnalyze(settings, res.pool, app.setAi, app.toast);
      return { state: "success", videos: res.pool, fetchedAt: res.fetchedAt, fromCache: res.fromCache };
    },
    `cats:${settings.cats.join(".")}|r:${settings.region}|l:${settings.language}|k:${settings.ytKey.slice(-6)}`
  );

  const popularSlice = app.pool("home:popular");
  const entries = app.state.library.entries;
  const hiddenIds = useMemo(
    () => new Set(Object.values(entries).filter((e) => e.hidden).map((e) => e.id)),
    [entries]
  );

  const all = useMemo(() => {
    const map = new Map([...slice.videos, ...popularSlice.videos].map((v) => [v.id, v]));
    return Array.from(map.values());
  }, [slice.videos, popularSlice.videos]);

  const verdicts = useMemo(() => verdictMap(all), [all]);

  const popularOnTopic = useMemo(
    () =>
      popularSlice.videos.filter(
        (v) => v.categoryIds.length === 0 || v.categoryIds.some((c) => settings.cats.includes(c))
      ),
    [popularSlice.videos, settings.cats]
  );

  const sections = useMemo(
    () => buildHomeSections(slice.videos, verdicts, popularOnTopic, hiddenIds),
    [slice.videos, verdicts, popularOnTopic, hiddenIds]
  );

  const continueList = useMemo(
    () =>
      Object.values(entries)
        .filter((e) => !e.hidden && e.progress > 0.02 && e.progress < 0.92)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 8),
    [entries]
  );

  const [rising, setRising] = useState<string | null>(null);

  if (!settings.ytKey) {
    return (
      <Page>
        <KeyGate />
      </Page>
    );
  }

  const loading = slice.state === "loading";

  return (
    <Page wide>
      {/* Header */}
      <div className="mb-1 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-[21px] font-bold tracking-tight sm:text-[24px]">Your learning feed</h1>
          <p className="mt-1 text-[12.5px] text-[var(--text-dim)]">
            {slice.fetchedAt
              ? `Snapshot updated ${formatClock(slice.fetchedAt)}${slice.fromCache ? " · served from local cache" : ""}`
              : "Discovery runs only when you open or refresh — never in the background."}
          </p>
        </div>
        <button
          className="btn btn-ghost shrink-0"
          onClick={() => void load(true)}
          disabled={loading || !app.state.online || app.state.quotaBlocked}
          aria-label="Refresh feed"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {app.state.quotaBlocked && (
        <div className="mt-3">
          <QuotaState />
        </div>
      )}

      {/* Continue Learning */}
      {continueList.length > 0 && (
        <Section title="Continue Learning" note="Progress recorded on this device via the official player.">
          <div className="snaprow no-scrollbar">
            {continueList.map((e) => (
              <ContinueCard key={e.id} entry={e} onOpen={() => app.navigate({ view: "video", id: e.id })} />
            ))}
          </div>
        </Section>
      )}

      {/* Rising Topics (user-tap-only discovery) */}
      <div className="mt-6">
        <SectionHeader
          title="Rising Topics"
          note="Curated queries — tapping one spends a single search request. Nothing loads until you tap."
        />
        <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 py-2">
          {RISING_TOPICS.map((t) => (
            <button
              key={t.label}
              className="chip"
              data-on={rising === t.query}
              onClick={() => setRising(rising === t.query ? null : t.query)}
            >
              <Flame size={12} />
              {t.label}
            </button>
          ))}
        </div>
        {rising && <RisingResults query={rising} settings={settings} />}
      </div>

      {/* Loading skeleton */}
      {loading && slice.videos.length === 0 && (
        <div className="mt-6 space-y-8">
          <div>
            <div className="skeleton mb-3 h-4 w-32" />
            <SkeletonCards n={4} />
          </div>
          <div>
            <div className="skeleton mb-3 h-4 w-40" />
            <SkeletonCards n={4} />
          </div>
        </div>
      )}

      {/* Sections */}
      {!loading && slice.state === "error" && (
        <div className="mt-6">
          {/rate|slow down|short period/i.test(slice.error ?? "") ? (
            <RateGuardState onRetry={() => void load(true)} />
          ) : (
            <EmptyState
              title="Couldn't load discovery"
              body={slice.error ?? "Network error."}
              action={<button className="btn btn-ghost" onClick={() => void load(true)}><RefreshCw size={14} /> Retry</button>}
            />
          )}
        </div>
      )}

      {slice.videos.length > 0 &&
        sections.map((s) => (
          <Section key={s.id} title={s.title} note={s.note}>
            <div className="snaprow no-scrollbar">
              {s.videos.map((v) => (
                <SpotlightCard
                  key={v.id}
                  v={v}
                  verdict={verdicts.get(v.id)}
                  aiTier={app.state.ai[v.id]?.tier ?? null}
                  entry={entries[v.id]}
                />
              ))}
            </div>
          </Section>
        ))}

      {slice.state === "success" && slice.videos.length === 0 && (
        <EmptyState
          icon={<Sparkles size={22} />}
          title="Nothing discovered yet"
          body="Try widening the time window or enabling more interests in Settings."
        />
      )}

      {/* Attribution footer */}
      <footer className="mt-10 border-t border-[var(--border)] pt-5 text-[11px] leading-relaxed text-[var(--text-faint)]">
        <p className="flex items-center gap-1.5 font-semibold text-[var(--text-dim)]">
          <MonitorPlay size={13} /> Powered by the official YouTube Data API v3
        </p>
        <p className="mt-1.5">
          Statistics are raw snapshot values from the API — no derived scores, no estimated velocities.
          Quality badges come from a transparent local filter (and optional Gemini analysis, marked as
          provisional). By using this app you agree to the{" "}
          <a className="underline underline-offset-2" href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">YouTube Terms of Service</a>{" "}
          and{" "}
          <a className="underline underline-offset-2" href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Google Privacy Policy</a>.
        </p>
      </footer>
    </Page>
  );
}

// ── Building blocks ─────────────────────────────────────────────────

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <SectionHeader title={title} note={note} />
      {children}
    </section>
  );
}

function SectionHeader({ title, note }: { title: string; note: string }) {
  return (
    <div className="mb-2">
      <div className="flex items-center gap-1.5">
        <h2 className="text-[15px] font-bold tracking-tight">{title}</h2>
        <ChevronRight size={14} className="text-[var(--text-faint)]" />
      </div>
      <p className="mt-0.5 text-[11px] leading-snug text-[var(--text-faint)]">{note}</p>
    </div>
  );
}

function ContinueCard({ entry, onOpen }: { entry: WatchEntry; onOpen: () => void }) {
  return (
    <article
      role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}
      className="group w-[252px] shrink-0 cursor-pointer rounded-[14px] border border-[var(--border)] bg-[var(--bg-elev)] p-2.5 transition-colors hover:border-[var(--border-strong)]"
    >
      <div className="flex gap-2.5">
        <div className="relative h-[52px] w-[88px] shrink-0 overflow-hidden rounded-[8px] bg-[var(--bg-sunk)]">
          {entry.thumb && <img src={entry.thumb} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />}
        </div>
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-[12px] font-semibold leading-snug">{entry.title}</h3>
          <p className="mt-0.5 truncate text-[10.5px] text-[var(--text-faint)]">{entry.channelTitle}</p>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-[var(--border)]">
          <div className="h-full bg-[var(--good)]" style={{ width: `${Math.round(entry.progress * 100)}%` }} />
        </div>
        <span className="tnum text-[10px] font-semibold text-[var(--text-dim)]">
          {Math.round(entry.progress * 100)}%
        </span>
      </div>
    </article>
  );
}

function RisingResults({ query, settings }: { query: string; settings: import("../types").Settings }) {
  const app = useApp();
  const scope = `rising:${query}`;
  const { slice } = useFeedLoader(
    scope,
    async (signal) => successSlice(await runSearch({ key: settings.ytKey, settings, signal }, query)),
    `q:${query}|w:${settings.window}|l:${settings.language}`
  );
  const verdicts = useMemo(() => verdictMap(slice.videos), [slice.videos]);
  const entries = app.state.library.entries;
  const hidden = new Set(Object.values(entries).filter((e) => e.hidden).map((e) => e.id));

  if (slice.state === "loading") return <div className="py-3"><SkeletonCards n={4} /></div>;
  const visible = slice.videos.filter((v) => !hidden.has(v.id)).slice(0, 6);
  if (visible.length === 0) return null;
  return (
    <div className="rise py-1">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] text-[var(--text-faint)]">
          {slice.fromCache ? "Cached results" : "Fresh results"} · “{truncate(query, 42)}”
        </span>
        <a
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--text-dim)] hover:text-[var(--text)]"
          href={`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`}
          target="_blank" rel="noreferrer"
        >
          More on YouTube <ArrowRight size={11} />
        </a>
      </div>
      <div className="flex flex-col divide-y divide-[var(--border)]">
        {visible.map((v) => (
          <VideoRow
            key={v.id}
            v={v}
            verdict={verdicts.get(v.id)}
            aiTier={app.state.ai[v.id]?.tier ?? null}
            entry={entries[v.id]}
            reason={reasonForVideo(v, { tier: app.state.ai[v.id]?.tier ?? verdicts.get(v.id)?.tier, cats: v.categoryIds })}
          />
        ))}
      </div>
    </div>
  );
}
