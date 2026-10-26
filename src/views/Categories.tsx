// ── Category discovery ──────────────────────────────────────────────

import { useMemo, useState } from "react";
import {
  ArrowLeft, BarChart3, Briefcase, Clock, Cpu, GraduationCap, HeartPulse, Landmark, PieChart,
  RefreshCw, Search, Sparkles, Target,
} from "lucide-react";
import { useApp } from "../state/store";
import { CATEGORIES, CATEGORY_MAP } from "../lib/categories";
import { loadCategoryFeed, runSearch, verdictMap } from "../lib/discover";
import {
  applyFilters, buildCategorySections, filterByCategory, reasonForVideo, BASIS_LABEL,
} from "../lib/feeds";
import type { CategorySectionId } from "../lib/feeds";
import { useFeedLoader, successSlice } from "../hooks/useFeedLoader";
import { maybeAutoAnalyze } from "../lib/autoai";
import { VideoRow } from "../components/VideoCard";
import AnalyzeCandidates from "../components/AnalyzeCandidates";
import { EmptyState, KeyGate, QuotaState, RateGuardState, SkeletonRows } from "../components/States";
import { Page } from "../components/chrome";
import { formatClock } from "../lib/utils";
import type { CategoryId, PublishWindow } from "../types";

export const CAT_ICONS: Record<CategoryId, typeof Landmark> = {
  wealth: Landmark,
  business: Briefcase,
  ai: Cpu,
  markets: PieChart,
  health: HeartPulse,
  focus: Target,
  knowledge: GraduationCap,
};

export function CategoriesHome() {
  const app = useApp();
  const { settings } = app.state;
  return (
    <Page>
      <h1 className="text-[21px] font-bold tracking-tight">Categories</h1>
      <p className="mt-1 text-[12.5px] text-[var(--text-dim)]">
        Dedicated feeds per discipline. Each category loads only when you open it — no
        background refreshes.
      </p>
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CATEGORIES.map((c) => {
          const Icon = CAT_ICONS[c.id];
          const enabled = settings.cats.includes(c.id);
          return (
            <button
              key={c.id}
              onClick={() => app.navigate({ view: "category", id: c.id })}
              className="card group p-4 text-left transition-colors hover:border-[var(--border-strong)]"
            >
              <div className="flex items-center justify-between">
                <span className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-[var(--border)] bg-[var(--bg-elev)]">
                  <Icon size={17} strokeWidth={2.1} />
                </span>
                {!enabled && <span className="badge">Not in your interests</span>}
              </div>
              <h2 className="mt-3 text-[15px] font-bold tracking-tight">{c.label}</h2>
              <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--text-dim)]">{c.blurb}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {c.topics.slice(0, 4).map((t) => (
                  <span key={t.label} className="badge !font-medium">{t.label}</span>
                ))}
                <span className="badge !font-medium">+{c.topics.length - 4} more</span>
              </div>
            </button>
          );
        })}
      </div>
    </Page>
  );
}

export function CategoryView({ id }: { id: CategoryId }) {
  const app = useApp();
  const { settings } = app.state;
  const def = CATEGORY_MAP[id];
  const [window, setWindow] = useState<PublishWindow>(settings.window);
  const [within, setWithin] = useState("");
  const [topic, setTopic] = useState<string | null>(null);
  const [feed, setFeed] = useState<CategorySectionId>("editorial");

  const scope = `cat:${id}`;
  const effectiveWindow = window; // changing window triggers reloadKey refetch
  const { slice, load } = useFeedLoader(
    scope,
    async (signal, force) => {
      const res = await loadCategoryFeed(
        id,
        { key: settings.ytKey, settings: { ...settings, window: effectiveWindow }, signal },
        force
      );
      void maybeAutoAnalyze(settings, res.videos, app.setAi, app.toast);
      return successSlice(res);
    },
    `c:${id}|w:${effectiveWindow}|l:${settings.language}`
  );

  const verdicts = useMemo(() => verdictMap(slice.videos), [slice.videos]);
  const entries = app.state.library.entries;
  const hiddenIds = useMemo(
    () => new Set(Object.values(entries).filter((e) => e.hidden).map((e) => e.id)),
    [entries]
  );

  const aiTiers = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of slice.videos) {
      const t = app.state.ai[v.id]?.tier;
      if (t) m.set(v.id, t);
    }
    return m;
  }, [slice.videos, app.state.ai]);

  /** Deterministic pipeline: user filters → topical relevance → local search. */
  const visible = useMemo(() => {
    const filtered = applyFilters(
      slice.videos,
      {
        minDurationSec: settings.minDurationSec,
        window: "any",
        blockedChannels: settings.blockedChannels,
        blockedKeywords: settings.blockedKeywords,
        language: "any",
      },
      verdicts,
      hiddenIds
    );
    // Search is fuzzy; this keeps the category actually category-specific.
    const onTopic = filterByCategory(id, filtered);
    const q = within.trim().toLowerCase();
    return q
      ? onTopic.filter((v) => `${v.title} ${v.channelTitle} ${v.description}`.toLowerCase().includes(q))
      : onTopic;
  }, [slice.videos, verdicts, hiddenIds, within, settings, id]);

  const offTopicCount = useMemo(() => {
    const filtered = applyFilters(
      slice.videos,
      {
        minDurationSec: settings.minDurationSec, window: "any",
        blockedChannels: settings.blockedChannels, blockedKeywords: settings.blockedKeywords,
        language: "any",
      },
      verdicts, hiddenIds
    );
    return filtered.length - filterByCategory(id, filtered).length;
  }, [slice.videos, verdicts, hiddenIds, settings, id]);

  const sections = useMemo(
    () => buildCategorySections(id, visible, verdicts, { aiTiers }),
    [id, visible, verdicts, aiTiers]
  );
  const active = sections.find((x) => x.id === feed) ?? sections[0];

  if (!settings.ytKey) return <Page><KeyGate /></Page>;

  const Icon = CAT_ICONS[id];

  return (
    <Page>
      <button
        className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--text-dim)] hover:text-[var(--text)]"
        onClick={app.goBack}
      >
        <ArrowLeft size={14} /> All categories
      </button>

      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-[12px] border border-[var(--border)] bg-[var(--bg-elev)]">
            <Icon size={20} strokeWidth={2.1} />
          </span>
          <div>
            <h1 className="text-[19px] font-bold tracking-tight">{def.label}</h1>
            <p className="mt-0.5 max-w-[420px] text-[12px] leading-snug text-[var(--text-dim)]">{def.blurb}</p>
          </div>
        </div>
        <button
          className="btn btn-ghost shrink-0"
          onClick={() => void load(true)}
          disabled={slice.state === "loading" || !app.state.online || app.state.quotaBlocked}
          aria-label="Refresh category"
        >
          <RefreshCw size={14} className={slice.state === "loading" ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Sub-topics: user-tap discovery */}
      <div className="no-scrollbar -mx-4 mt-4 flex gap-1.5 overflow-x-auto px-4">
        {def.topics.map((t) => (
          <button key={t.label} className="chip" data-on={topic === t.query}
            onClick={() => setTopic(topic === t.query ? null : t.query)}>
            {t.label}
          </button>
        ))}
      </div>

      {topic && <TopicResults query={topic} catId={id} />}

      {/* Period — changes the API query, so it triggers a reload */}
      <div className="no-scrollbar -mx-4 mt-3 flex items-center gap-1.5 overflow-x-auto border-t border-[var(--border)] px-4 pt-3">
        <span className="mr-0.5 shrink-0 text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-faint)]">
          Published
        </span>
        {(["24h", "7d", "30d", "any"] as PublishWindow[]).map((w) => (
          <button
            key={w}
            className="chip"
            data-on={window === w}
            aria-pressed={window === w}
            onClick={() => setWindow(w)}
            title={w === "any" ? "All time" : `Last ${w}`}
          >
            {w === "any" ? "All time" : w}
          </button>
        ))}
      </div>

      {/* Feed tabs — provenance is part of the control, not fine print */}
      <div className="mt-2">
        <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4" role="tablist" aria-label="Category feeds">
          {sections.map((sec) => (
            <button
              key={sec.id}
              role="tab"
              aria-selected={feed === sec.id}
              className="chip"
              data-on={feed === sec.id}
              onClick={() => setFeed(sec.id as CategorySectionId)}
            >
              {sec.basis === "editorial" ? <Sparkles size={11} /> : sec.basis === "recency" ? <Clock size={11} /> : <BarChart3 size={11} />}
              {sec.title}
            </button>
          ))}
        </div>
      </div>

      {active && (
        <div className="mt-2.5 flex items-start gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--bg-sunk)] px-3 py-2">
          <span
            className="badge mt-px shrink-0"
            style={active.basis === "editorial"
              ? { color: "var(--info)", borderColor: "var(--info)" }
              : undefined}
          >
            {BASIS_LABEL[active.basis]}
          </span>
          <p className="text-[11px] leading-snug text-[var(--text-dim)]">
            {active.note}
            {active.caveat && (
              <>
                {" "}
                <span className="text-[var(--text-faint)]">{active.caveat}</span>
              </>
            )}
          </p>
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={13.5} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
          <input
            className="input !h-[34px] pl-8 text-[12.5px]"
            placeholder="Filter this feed (local — no API used)…"
            value={within}
            onChange={(e) => setWithin(e.target.value)}
            aria-label={`Search within ${def.label}`}
          />
        </div>
        <span className="shrink-0 text-[10.5px] text-[var(--text-faint)]">
          {slice.state === "success" && `${formatClock(slice.fetchedAt)}${slice.fromCache ? " · cache" : ""}`}
        </span>
      </div>

      {app.state.quotaBlocked && <div className="mt-3"><QuotaState /></div>}
      {slice.state === "loading" && <div className="mt-3"><SkeletonRows n={6} /></div>}
      {slice.state === "error" && (
        /rate|slow down|short period/i.test(slice.error ?? "")
          ? <RateGuardState onRetry={() => void load(true)} />
          : <EmptyState title="Couldn't load this feed" body={slice.error ?? "Network error."}
              action={<button className="btn btn-ghost" onClick={() => void load(true)}>Retry</button>} />
      )}

      {slice.state === "success" && visible.length > 0 && <AnalyzeCandidates videos={visible} />}

      {slice.state === "success" && active && (
        <>
          <div className="mt-1 flex flex-col divide-y divide-[var(--border)]">
            {active.videos.map((v) => (
              <VideoRow
                key={v.id}
                v={v}
                verdict={verdicts.get(v.id)}
                aiTier={app.state.ai[v.id]?.tier ?? null}
                entry={entries[v.id]}
                reason={
                  active.basis === "editorial"
                    ? reasonForVideo(v, {
                        tier: app.state.ai[v.id]?.tier ?? verdicts.get(v.id)?.tier,
                        cats: v.categoryIds,
                        defaultCat: id,
                      })
                    : undefined
                }
              />
            ))}
          </div>

          {active.videos.length === 0 && (
            <EmptyState
              title={visible.length === 0 ? "Nothing matched this category" : "No videos with this statistic"}
              body={
                visible.length === 0
                  ? "Widen the period, clear the local filter, or refresh to pull new results."
                  : "Every result here has that count hidden by its creator, so the feed would be misleading."
              }
            />
          )}

          {offTopicCount > 0 && (
            <p className="mt-4 text-[10.5px] leading-snug text-[var(--text-faint)]">
              {offTopicCount} result{offTopicCount === 1 ? "" : "s"} returned by the search API
              {offTopicCount === 1 ? " was" : " were"} filtered out as off-topic for {def.label} by
              the local relevance rules.
            </p>
          )}
        </>
      )}

    </Page>
  );
}

function TopicResults({ query, catId }: { query: string; catId: CategoryId }) {
  const app = useApp();
  const { settings } = app.state;
  const scope = `topic:${query}`;
  const { slice } = useFeedLoader(
    scope,
    async (signal) => successSlice(await runSearch({ key: settings.ytKey, settings, signal }, query)),
    `q:${query}|w:${settings.window}`
  );
  const verdicts = useMemo(() => verdictMap(slice.videos), [slice.videos]);
  const entries = app.state.library.entries;
  const hidden = new Set(Object.values(entries).filter((e) => e.hidden).map((e) => e.id));
  const visible = slice.videos.filter((v) => !hidden.has(v.id)).slice(0, 5);

  if (slice.state === "loading") return <div className="py-3"><SkeletonRows n={3} /></div>;
  if (visible.length === 0) return null;

  return (
    <div className="rise mt-2 rounded-[14px] border border-[var(--border)] bg-[var(--bg-elev)] px-2">
      <p className="px-2 pt-2.5 text-[10.5px] text-[var(--text-faint)]">
        Sub-topic results · {slice.fromCache ? "from cache" : "freshly fetched"} — independent of the main {CATEGORY_MAP[catId].label} feed below.
      </p>
      <div className="flex flex-col divide-y divide-[var(--border)]">
        {visible.map((v) => (
          <VideoRow
            key={v.id}
            v={v}
            verdict={verdicts.get(v.id)}
            aiTier={app.state.ai[v.id]?.tier ?? null}
            entry={entries[v.id]}
          />
        ))}
      </div>
    </div>
  );
}
