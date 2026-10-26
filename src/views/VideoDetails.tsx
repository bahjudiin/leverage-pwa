// ── Video details: player, stats, quality, AI guide, chapters ───────
// Every fact shown traces to an API snapshot or explicit local/AI
// analysis. Transcripts are unavailable (captions API requires OAuth),
// so AI confidence is always "limited" — stated, never implied.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, BadgeCheck, Ban, Bookmark, BookmarkCheck, CalendarDays, CheckCircle2, ChevronDown,
  Clock, ExternalLink, Eye, EyeOff, Flame, ListVideo, Loader2, MessageSquare, Play, RotateCw,
  SkipForward, Sparkles, ThumbsUp, TriangleAlert,
} from "lucide-react";
import { useApp } from "../state/store";
import { Page } from "../components/chrome";
import { YTPlayer } from "../components/Player";
import type { PlayerHandle } from "../components/Player";
import { TierBadge, VideoRow } from "../components/VideoCard";
import { EmptyState } from "../components/States";
import { heuristicAnalyze, TIER_LABEL } from "../lib/quality";
import { parseChapters, formatTimestamp } from "../lib/parse";
import { hydrateIds, verdictMap } from "../lib/discover";
import {
  analyzeOne, aiAvailability, budgetState, describeAiError, UNAVAILABLE_COPY,
} from "../lib/aiService";
import { fetchTopComments } from "../lib/youtube";
import type { TopComment } from "../lib/youtube";
import { CATEGORY_MAP } from "../lib/categories";
import { formatCount, formatDate, formatDuration, formatFull, timeAgo } from "../lib/utils";
import type { AiAnalysis, AiSegment, Chapter, VideoItem } from "../types";

function snapshotFallback(entry: import("../types").WatchEntry): VideoItem {
  return {
    id: entry.id,
    title: entry.title,
    description: "",
    channelId: "",
    channelTitle: entry.channelTitle,
    publishedAt: new Date(entry.updatedAt).toISOString(),
    durationSec: entry.durationSec,
    thumbnails: { medium: entry.thumb },
    viewCount: null, likeCount: null, commentCount: null,
    defaultLanguage: null,
    categoryIds: entry.categoryIds,
    matchedQueries: ["library snapshot"],
    fetchedAt: entry.updatedAt,
  };
}

export default function VideoDetails({ id }: { id: string }) {
  const app = useApp();
  const { settings } = app.state;
  const entry = app.state.library.entries[id];
  const hydratedRef = useRef<string | null>(null);
  const lastProgressRef = useRef(0);

  const video = useMemo(() => {
    for (const s of Object.values(app.state.pools)) {
      const hit = s.videos.find((v) => v.id === id);
      if (hit) return hit;
    }
    return entry ? snapshotFallback(entry) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, app.state.pools, entry]);

  // Hydrate a bare library snapshot with real metadata (1 unit, user-initiated open).
  // The guard key is provenance, not description length — a creator may publish
  // with an empty legitimate description.
  const isSnapshot = video?.matchedQueries[0] === "library snapshot";
  useEffect(() => {
    if (!video || !isSnapshot || hydratedRef.current === id) return;
    if (!settings.ytKey || !app.state.online) return;
    hydratedRef.current = id;
    hydrateIds({ key: settings.ytKey, settings }, [id])
      .then((vs) => {
        if (vs[0]) {
          app.dispatch({
            type: "pool/merge", scope: `video:${id}`,
            videos: vs, fetchedAt: Date.now(), fromCache: false,
          });
        }
      })
      .catch(() => { /* offline/quota: snapshot mode still works */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video?.id]);

  const verdict = useMemo(
    () => (video ? heuristicAnalyze({ title: video.title, description: video.description, durationSec: video.durationSec }) : null),
    [video]
  );
  const chapters = useMemo(
    () => (video ? parseChapters(video.description, video.durationSec) : []),
    [video]
  );
  // Memoized so the localStorage read doesn't repeat on every render.
  const ai: AiAnalysis | null = useMemo(
    () => app.getAi(id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, app.state.ai[id]]
  );
  const [facade, setFacade] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const playerRef = useRef<PlayerHandle>(null);

  // Reset facade on video change
  useEffect(() => { setFacade(true); lastProgressRef.current = 0; }, [id]);

  if (!video) {
    return (
      <Page>
        <BackRow />
        <EmptyState
          title="No local data for this video"
          body="It isn't in any loaded feed or your library. Open it from a feed or search so we can fetch its real metadata."
          action={<button className="btn btn-ghost" onClick={app.goBack}>Go back</button>}
        />
      </Page>
    );
  }

  const resumeAt = entry && entry.progress > 0.02 && entry.progress < 0.92
    ? Math.floor(entry.progress * video.durationSec) : 0;

  const availability = aiAvailability(settings, app.state.online);
  const budget = budgetState(settings);

  /** Explicit user action — the only way a single video reaches Gemini. */
  const analyzeNow = async (force = false) => {
    setAnalyzing(true);
    try {
      const result = await analyzeOne(settings, video, { force, online: app.state.online });
      app.setAi(result);
      app.toast(force ? "Re-analyzed with Gemini" : "AI guide ready", "success");
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        app.toast(describeAiError(e), "error");
      }
    } finally {
      setAnalyzing(false);
    }
  };

  const seek = (sec: number) => {
    if (facade) {
      setFacade(false);
      // player still warming up — retry a couple of times
      window.setTimeout(() => playerRef.current?.seekTo(sec), 700);
      window.setTimeout(() => playerRef.current?.seekTo(sec), 1800);
    } else {
      playerRef.current?.seekTo(sec);
    }
  };

  return (
    <Page>
      <BackRow />

      {/* ── Player ──────────────────────────────────────────── */}
      {facade ? (
        <button
          className="group relative block aspect-video w-full overflow-hidden rounded-[14px] border border-[var(--border)] bg-black text-left"
          onClick={() => setFacade(false)}
          aria-label={`Play ${video.title}`}
        >
          {(video.thumbnails.high ?? video.thumbnails.medium) && (
            <img src={video.thumbnails.high ?? video.thumbnails.medium} alt=""
              className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-75" referrerPolicy="no-referrer" />
          )}
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-black shadow-lg transition-transform group-hover:scale-105">
              <Play size={26} fill="currentColor" className="ml-1" />
            </span>
          </span>
          {resumeAt > 0 && (
            <span className="absolute bottom-3 left-3 rounded-[8px] bg-black/85 px-2.5 py-1.5 text-[11.5px] font-semibold text-white">
              Resume from {formatTimestamp(resumeAt)} ({Math.round((entry?.progress ?? 0) * 100)}%)
            </span>
          )}
        </button>
      ) : (
        <YTPlayer
          key={video.id}
          ref={playerRef}
          videoId={video.id}
          startAt={resumeAt}
          onProgress={(f) => {
            if (Math.abs(f - lastProgressRef.current) > 0.01) {
              lastProgressRef.current = f;
              app.setProgress(video, f);
            }
          }}
          onEnded={() => app.markCompleted(video, true)}
        />
      )}
      <p className="mt-2 text-[10.5px] text-[var(--text-faint)]">
        Playback uses the official YouTube embedded player, starts only on your request, and
        reports progress locally — nothing is downloaded or proxied.
      </p>

      {/* ── Title / actions ─────────────────────────────────── */}
      <h1 className="mt-4 text-[18px] font-bold leading-snug tracking-tight">{video.title}</h1>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-[var(--text-dim)]">
        <span className="font-semibold text-[var(--text)]">{video.channelTitle}</span>
        {!isSnapshot && (
          <>
            <span className="text-[var(--text-faint)]">·</span>
            <CalendarDays size={12} />
            <span>{formatDate(video.publishedAt)} ({timeAgo(video.publishedAt)})</span>
          </>
        )}
        {isSnapshot && <span className="badge" title="Stored locally when you saved/watched this video">Library snapshot</span>}
        {video.categoryIds.map((c) => (
          <span key={c} className="badge">{CATEGORY_MAP[c]?.label}</span>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn btn-ghost" onClick={() => (entry?.saved ? app.unsaveVideo(video.id) : app.saveVideo(video))}
          aria-pressed={entry?.saved}>
          {entry?.saved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
          {entry?.saved ? "Saved" : "Save"}
        </button>
        <button className="btn btn-ghost" onClick={() => app.markCompleted(video, !entry?.completed)} aria-pressed={entry?.completed}>
          <CheckCircle2 size={14} />
          {entry?.completed ? "Completed" : "Mark complete"}
        </button>
        <button className="btn btn-ghost" onClick={() => { app.hideVideo(video); app.goBack(); }}>
          <EyeOff size={14} /> Hide
        </button>
        <button className="btn btn-ghost" onClick={() => app.blockChannel(video.channelTitle)}>
          <Ban size={14} /> Block channel
        </button>
        <a className="btn btn-ghost" href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noreferrer">
          <ExternalLink size={14} /> YouTube
        </a>
      </div>

      {/* ── Raw stats ───────────────────────────────────────── */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat icon={<Eye size={14} />} label="Views" value={formatFull(video.viewCount)} />
        <Stat icon={<ThumbsUp size={14} />} label="Likes" value={formatFull(video.likeCount)} />
        <Stat icon={<MessageSquare size={14} />} label="Comments" value={formatFull(video.commentCount)} />
        <Stat icon={<Clock size={14} />} label="Length" value={formatDuration(video.durationSec)} />
      </div>
      <p className="mt-1.5 text-[10.5px] text-[var(--text-faint)]">
        {isSnapshot ? (
          <span className="inline-flex items-center gap-1.5">
            <Loader2 size={11} className="animate-spin" />
            Fetching fresh metadata from YouTube in the background… stats appear when retrieved.
          </span>
        ) : (
          <>
            Raw values from the YouTube API snapshot · retrieved {formatDate(new Date(video.fetchedAt).toISOString())}.
            No ratios or composite scores are derived from these stats.
          </>
        )}
      </p>

      {/* ── Quality panel ───────────────────────────────────── */}
      {verdict && (
        <section className="card mt-5 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[13.5px] font-bold tracking-tight">Content quality — local filter</h2>
            <TierBadge tier={ai?.tier ?? verdict.tier} ai={Boolean(ai)} />
          </div>
          <p className="mt-1 text-[11px] text-[var(--text-faint)]">
            Deterministic rules over title/description — every reason is listed. This is an editorial
            signal, not a fact check.
          </p>
          {(verdict.flags.length > 0 || verdict.positives.length > 0) && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {verdict.positives.length > 0 && (
                <ul className="space-y-1.5">
                  {verdict.positives.map((p) => (
                    <li key={p} className="flex items-start gap-2 text-[12px] leading-snug text-[var(--text-dim)]">
                      <BadgeCheck size={13} className="mt-0.5 shrink-0 text-[var(--good)]" /> {p}
                    </li>
                  ))}
                </ul>
              )}
              {verdict.flags.length > 0 && (
                <ul className="space-y-1.5">
                  {verdict.flags.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-[12px] leading-snug text-[var(--text-dim)]">
                      <TriangleAlert size={13} className="mt-0.5 shrink-0 text-[var(--warn)]" /> {f}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}

      {/* ── AI learning guide ───────────────────────────────── */}
      <section className="card mt-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-[13.5px] font-bold tracking-tight">
            <Sparkles size={14} /> AI learning guide
          </h2>
          <div className="flex items-center gap-1.5">
            {ai && <span className="badge" title="Derived from title + description only">Provisional · limited confidence</span>}
            {settings.aiEnabled && (
              <span className="badge tnum" title="Analyses remaining in today's budget">
                {budget.remaining}/{budget.limit} left
              </span>
            )}
          </div>
        </div>

        {/* Unavailable — explain why, never silently do nothing. */}
        {!ai && availability !== "none" && (
          <div className="mt-2">
            <p className="text-[12.5px] leading-relaxed text-[var(--text-dim)]">
              {UNAVAILABLE_COPY[availability]}
            </p>
            {availability === "disabled" || availability === "no-key" ? (
              <button className="btn btn-ghost mt-3" onClick={() => app.navigate({ view: "settings" })}>
                <Sparkles size={14} /> Open AI settings
              </button>
            ) : null}
            <p className="mt-2 text-[11px] leading-snug text-[var(--text-faint)]">
              The local quality filter above works without AI and never leaves your device.
            </p>
          </div>
        )}

        {/* Available, not yet analyzed — explicit user action required. */}
        {!ai && availability === "none" && (
          <div className="mt-3">
            <button className="btn" onClick={() => void analyzeNow(false)} disabled={analyzing}>
              {analyzing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {analyzing ? "Analyzing…" : "Analyze with Gemini"}
            </button>
            <p className="mt-2 text-[11px] leading-snug text-[var(--text-faint)]">
              One request, counted against today&apos;s budget. Gemini receives only this video&apos;s
              title, description, and any chapter labels the creator published — it has{" "}
              <strong>not watched the video</strong> and has no transcript access.
            </p>
          </div>
        )}

        {ai && (
          <div className="rise mt-3 space-y-4">
            <p className="text-[13.5px] leading-relaxed">{ai.summary}</p>

            <div className="flex flex-wrap gap-1.5">
              <span className="badge">{ai.topic}</span>
              <span className="badge">{ai.difficulty}</span>
              <span className="badge">For: {ai.audience}</span>
              {ai.prerequisites && ai.prerequisites !== "None" && (
                <span className="badge">Prereq: {ai.prerequisites}</span>
              )}
            </div>

            {ai.promoWarning && (
              <p className="flex items-start gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--bg-sunk)] p-3 text-[12px] leading-snug text-[var(--text-dim)]">
                <TriangleAlert size={14} className="mt-0.5 shrink-0 text-[var(--warn)]" />
                <span><strong className="text-[var(--text)]">Promotional content: </strong>{ai.promoWarning}</span>
              </p>
            )}

            <GuideList title="Key lessons" items={ai.keyLessons} />
            <GuideList title="Practical takeaways" items={ai.takeaways} ordered />

            {ai.claimsToVerify.length > 0 && (
              <div>
                <h3 className="label mb-1.5">Verify independently</h3>
                <ul className="space-y-1">
                  {ai.claimsToVerify.map((c) => (
                    <li key={c} className="flex items-start gap-2 text-[12px] leading-snug text-[var(--text-dim)]">
                      <TriangleAlert size={12} className="mt-0.5 shrink-0 text-[var(--text-faint)]" />{c}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {ai.viewingPlan && (
              <p className="rounded-[10px] border border-[var(--border)] bg-[var(--bg-sunk)] p-3 text-[12.5px] leading-relaxed text-[var(--text-dim)]">
                <span className="font-semibold text-[var(--text)]">Suggested viewing plan: </span>
                {ai.viewingPlan}
              </p>
            )}

            {ai.questions.length > 0 && (
              <div>
                <h3 className="label mb-1.5">Ask yourself after watching</h3>
                <ol className="list-decimal space-y-1 pl-4 text-[12px] leading-snug text-[var(--text-dim)]">
                  {ai.questions.map((q) => <li key={q}>{q}</li>)}
                </ol>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
              <p className="text-[10.5px] leading-snug text-[var(--text-faint)]">
                {TIER_LABEL[ai.tier]} — {ai.tierReason}
                <br />
                Analyzed {formatDate(new Date(ai.analyzedAt).toISOString())} · {ai.model} · from
                title + description{ai.sourceChapterCount > 0 ? ` + ${ai.sourceChapterCount} published chapters` : ""}.
                Provisional editorial signal, not a verified fact.
              </p>
              <button
                className="btn btn-ghost !h-[28px] !px-2.5 !text-[11px]"
                onClick={() => void analyzeNow(true)}
                disabled={analyzing || availability !== "none"}
                title="Discard the cached analysis and ask Gemini again"
              >
                {analyzing ? <Loader2 size={12} className="animate-spin" /> : <RotateCw size={12} />}
                Re-analyze
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── Efficient viewing ───────────────────────────────── */}
      <EfficientViewing
        chapters={chapters}
        segments={ai?.segments ?? []}
        hasAi={Boolean(ai)}
        durationSec={video.durationSec}
        onSeek={seek}
        onPlayFull={() => seek(0)}
      />

      {/* ── Description ─────────────────────────────────────── */}
      {video.description && <Description text={video.description} />}

      {/* ── Comments (opt-in) ───────────────────────────────── */}
      <Comments videoId={video.id} />

      {/* ── Related ─────────────────────────────────────────── */}
      <Related video={video} />
    </Page>
  );

  function BackRow() {
    return (
      <button
        className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--text-dim)] hover:text-[var(--text)]"
        onClick={app.goBack}
      >
        <ArrowLeft size={14} /> Back
      </button>
    );
  }
}

// ── Sub-sections ──────────────────────────────────────────────────────

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="surface rounded-[12px] p-3">
      <div className="flex items-center gap-1.5 text-[var(--text-faint)]">{icon}<span className="text-[10px] font-bold uppercase tracking-wide">{label}</span></div>
      <div className="tnum mt-1 truncate text-[15px] font-bold" title={value}>{value}</div>
    </div>
  );
}

function GuideList({ title, items, ordered }: { title: string; items: string[]; ordered?: boolean }) {
  if (items.length === 0) return null;
  const Tag = ordered ? "ol" : "ul";
  return (
    <div>
      <h3 className="label mb-1.5">{title}</h3>
      <Tag className={`space-y-1 text-[12px] leading-snug text-[var(--text-dim)] ${ordered ? "list-decimal pl-4" : ""}`}>
        {items.map((it) => <li key={it}>{ordered ? it : `• ${it}`}</li>)}
      </Tag>
    </div>
  );
}

/**
 * Efficient viewing mode.
 *
 * Every seek point here originates from a timestamp the creator
 * published in the video description and that we parsed locally.
 * When no such timestamps exist, we say so instead of inventing a
 * timeline — Gemini is never asked for, and never given, times.
 */
function EfficientViewing({
  chapters, segments, hasAi, durationSec, onSeek, onPlayFull,
}: {
  chapters: Chapter[];
  segments: AiSegment[];
  hasAi: boolean;
  durationSec: number;
  onSeek: (sec: number) => void;
  onPlayFull: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const essential = segments.filter((s) => s.kind === "essential");
  const peak = segments.filter((s) => s.kind === "peak");
  const skip = segments.filter((s) => s.kind === "skip");
  const hasTimeline = chapters.length > 0;

  const saved = skip.reduce((acc, s, i) => {
    const next = chapters.find((c) => c.seconds > s.seconds);
    return acc + Math.max(0, (next?.seconds ?? s.seconds) - s.seconds) * (i < 6 ? 1 : 0);
  }, 0);

  return (
    <section className="card mt-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-[13.5px] font-bold tracking-tight">
          <ListVideo size={14} /> Efficient viewing
        </h2>
        <button className="btn btn-ghost !h-[28px] !px-2.5 !text-[11px]" onClick={onPlayFull}>
          <Play size={11} /> Play full video ({formatDuration(durationSec)})
        </button>
      </div>

      {!hasTimeline && (
        <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--text-dim)]">
          This creator didn&apos;t publish chapter timestamps in the description, so there are no
          verified seek points for this video. We don&apos;t generate a timeline from guesswork —
          {hasAi ? " the AI guide above summarises the content instead." : " enable the AI guide above for a content summary instead."}
        </p>
      )}

      {hasTimeline && segments.length === 0 && (
        <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-dim)]">
          {hasAi
            ? "The AI guide didn't single out specific sections for this video. All published chapters are listed below."
            : "Chapter navigation below comes straight from the creator's description. Run the AI guide above to highlight essential, peak-value, and skippable sections."}
        </p>
      )}

      {peak.length > 0 && (
        <SegmentGroup
          title="Peak value" tone="var(--good)" icon={<Flame size={12} />}
          note="Highest-value sections identified by AI, anchored to real chapters."
          items={peak} onSeek={onSeek}
        />
      )}
      {essential.length > 0 && (
        <SegmentGroup
          title="Essential sections" tone="var(--info)" icon={<BadgeCheck size={12} />}
          note="Needed to follow the topic."
          items={essential} onSeek={onSeek}
        />
      )}
      {skip.length > 0 && (
        <SegmentGroup
          title="Safe to skip" tone="var(--warn)" icon={<SkipForward size={12} />}
          note={saved > 60 ? `Roughly ${formatDuration(saved)} of sponsor/intro padding.` : "Sponsor reads, intros, or filler."}
          items={skip} onSeek={onSeek}
        />
      )}

      {hasTimeline && (
        <div className="mt-4">
          <button
            className="flex w-full items-center justify-between text-left"
            onClick={() => setShowAll(!showAll)}
            aria-expanded={showAll}
          >
            <h3 className="label">All {chapters.length} chapters (creator-published)</h3>
            <ChevronDown size={14} className={`transition-transform ${showAll ? "rotate-180" : ""}`} />
          </button>
          {showAll && (
            <div className="mt-1 flex flex-col divide-y divide-[var(--border)]">
              {chapters.map((c) => (
                <button
                  key={`${c.seconds}-${c.label}`}
                  className="flex items-center gap-3 py-2.5 text-left hover:opacity-80"
                  onClick={() => onSeek(c.seconds)}
                >
                  <span className="tnum w-14 shrink-0 text-[12px] font-bold">{formatTimestamp(c.seconds)}</span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{c.label}</span>
                  <Play size={12} className="shrink-0 text-[var(--text-faint)]" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function SegmentGroup({
  title, note, tone, icon, items, onSeek,
}: {
  title: string; note: string; tone: string; icon: React.ReactNode;
  items: AiSegment[]; onSeek: (s: number) => void;
}) {
  return (
    <div className="mt-4">
      <h3 className="label mb-0.5 flex items-center gap-1.5" style={{ color: tone }}>{icon}{title}</h3>
      <p className="mb-1.5 text-[10.5px] text-[var(--text-faint)]">{note}</p>
      <div className="flex flex-col divide-y divide-[var(--border)]">
        {items.map((s) => (
          <button
            key={`${s.kind}-${s.seconds}`}
            className="flex items-start gap-3 py-2.5 text-left hover:opacity-80"
            onClick={() => onSeek(s.seconds)}
          >
            <span className="tnum w-14 shrink-0 pt-px text-[12px] font-bold">{formatTimestamp(s.seconds)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-semibold">{s.label}</span>
              <span className="block text-[11px] leading-snug text-[var(--text-faint)]">{s.reason}</span>
            </span>
            <Play size={12} className="mt-1 shrink-0 text-[var(--text-faint)]" />
          </button>
        ))}
      </div>
    </div>
  );
}

function Description({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="card mt-4 p-4">
      <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <h2 className="text-[13.5px] font-bold tracking-tight">Description</h2>
        <ChevronDown size={15} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <p className={`mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-[var(--text-dim)] ${open ? "" : "line-clamp-5"}`}>
        {text}
      </p>
    </section>
  );
}

function Comments({ videoId }: { videoId: string }) {
  const app = useApp();
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  const [comments, setComments] = useState<TopComment[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // Reset when the user navigates to a different video; abort any
  // in-flight comment request so it can't resolve into a stale view.
  useEffect(() => {
    setState("idle");
    setComments([]);
    setMsg("");
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [videoId]);

  // Explicit user action only — never called from an effect.
  const load = async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setState("loading");
    try {
      const list = await fetchTopComments(app.state.settings.ytKey, videoId, ctrl.signal);
      if (ctrl.signal.aborted) return;
      setComments(list);
      setState("done");
    } catch (e) {
      if (ctrl.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
      setMsg(e instanceof Error ? e.message : "Comments unavailable");
      setState("error");
    }
  };

  return (
    <section className="card mt-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-[13.5px] font-bold tracking-tight">
          <MessageSquare size={14} /> Top comments
        </h2>
        {state === "idle" && (
          <button className="btn btn-ghost !h-[30px] !px-3 !text-[12px]" onClick={() => void load()}
            disabled={!app.state.settings.ytKey || !app.state.online}>
            Load (1 API unit)
          </button>
        )}
        {state === "loading" && <Loader2 size={15} className="animate-spin text-[var(--text-dim)]" />}
      </div>
      <p className="mt-1 text-[10.5px] text-[var(--text-faint)]">
        Comments are fetched only when you ask — never automatically. Ordered by YouTube&apos;s relevance.
      </p>
      {state === "error" && (
        <p className="mt-3 text-[12.5px] text-[var(--text-dim)]">
          Couldn&apos;t load comments{msg ? `: ${msg}` : " (they may be disabled for this video)"}.
        </p>
      )}
      {state === "done" && (
        <div className="mt-3 flex flex-col divide-y divide-[var(--border)]">
          {comments.map((c, i) => (
            <div key={i} className="py-2.5">
              <div className="flex items-center gap-2 text-[11px] text-[var(--text-faint)]">
                <span className="font-semibold text-[var(--text-dim)]">{c.author}</span>
                <span>{timeAgo(c.publishedAt)}</span>
                <span className="tnum ml-auto inline-flex items-center gap-1"><ThumbsUp size={10} />{formatCount(c.likeCount)}</span>
              </div>
              <p className="mt-1 text-[12.5px] leading-snug">{c.text}</p>
            </div>
          ))}
          {comments.length === 0 && <p className="py-3 text-[12.5px] text-[var(--text-dim)]">No top comments returned.</p>}
        </div>
      )}
    </section>
  );
}

function Related({ video }: { video: VideoItem }) {
  const app = useApp();
  const entries = app.state.library.entries;
  const related = useMemo(() => {
    const mine = new Set(video.categoryIds);
    if (mine.size === 0) return [];
    const out: VideoItem[] = [];
    const seen = new Set([video.id]);
    for (const s of Object.values(app.state.pools)) {
      for (const v of s.videos) {
        if (seen.has(v.id)) continue;
        if (v.categoryIds.some((c) => mine.has(c))) { seen.add(v.id); out.push(v); }
      }
    }
    return out.sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0)).slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.id, video.categoryIds, app.state.pools]);

  const verdicts = useMemo(() => verdictMap(related), [related]);
  if (related.length === 0) return null;

  return (
    <section className="mt-6">
      <h2 className="mb-1 text-[15px] font-bold tracking-tight">Related in your pool</h2>
      <p className="mb-2 text-[11px] text-[var(--text-faint)]">
        From feeds already on this device — no extra API calls.
      </p>
      <div className="flex flex-col divide-y divide-[var(--border)]">
        {related.map((v) => (
          <VideoRow key={v.id} v={v} verdict={verdicts.get(v.id)}
            aiTier={app.state.ai[v.id]?.tier ?? null} entry={entries[v.id]} />
        ))}
      </div>
    </section>
  );
}
