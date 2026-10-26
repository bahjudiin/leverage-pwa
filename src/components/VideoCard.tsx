// ── Video cards (row + spotlight) ───────────────────────────────────
// Stats shown are RAW YouTube API fields only (views / likes / comments).
// No ratios, no composite scores, no invented metrics.

import { Bookmark, BookmarkCheck, Eye, EyeOff, MessageSquare, Sparkles, ThumbsUp } from "lucide-react";
import type { HeuristicVerdict, QualityTier, VideoItem, WatchEntry } from "../types";
import { TIER_LABEL, TIER_TONE } from "../lib/quality";
import { formatCount, formatDuration, timeAgo, formatFull } from "../lib/utils";
import { CATEGORY_MAP } from "../lib/categories";
import { useApp } from "../state/store";

export function TierBadge({ tier, ai }: { tier: QualityTier | undefined; ai?: boolean }) {
  if (!tier || tier === "unrated") return null;
  const tone = TIER_TONE[tier];
  const color =
    tone === "good" ? "var(--good)" : tone === "warn" ? "var(--warn)" : tone === "bad" ? "var(--bad)" : "var(--text-faint)";
  return (
    <span className="badge" title={ai ? "Provisional AI classification — not a verified fact" : "Local quality-filter classification"}>
      <span className="dot" style={{ background: color }} />
      {TIER_LABEL[tier]}
      {ai && <Sparkles size={9} />}
    </span>
  );
}

function Stats({ v, dense }: { v: VideoItem; dense?: boolean }) {
  const size = dense ? 11 : 12.5;
  const cls = `tnum flex items-center gap-3 text-[var(--text-faint)] ${dense ? "text-[10.5px]" : "text-[11.5px]"}`;
  // A hidden count is UNKNOWN, not zero — it is shown as "—" and the
  // tooltip says so explicitly. Nothing is ever inferred to fill it in.
  const hidden = "Not returned by the YouTube API (hidden by the creator)";
  return (
    <span className={cls}>
      <span
        className="inline-flex items-center gap-1"
        title={v.viewCount === null ? `Views: ${hidden}` : `${formatFull(v.viewCount)} views (API snapshot)`}
      >
        <Eye size={size} aria-hidden />{formatCount(v.viewCount)}
      </span>
      <span
        className="inline-flex items-center gap-1"
        title={v.likeCount === null ? `Likes: ${hidden}` : `${formatFull(v.likeCount)} likes (API snapshot)`}
      >
        <ThumbsUp size={size} aria-hidden />{formatCount(v.likeCount)}
      </span>
      <span
        className="inline-flex items-center gap-1"
        title={v.commentCount === null ? `Comments: ${hidden}` : `${formatFull(v.commentCount)} comments (API snapshot)`}
      >
        <MessageSquare size={size} aria-hidden />{formatCount(v.commentCount)}
      </span>
    </span>
  );
}

function Thumb({ v, entry }: { v: VideoItem; entry?: WatchEntry }) {
  const src = v.thumbnails.medium ?? v.thumbnails.default ?? v.thumbnails.high ?? "";
  return (
    <span className="relative block h-full w-full overflow-hidden rounded-[10px] bg-[var(--bg-sunk)]">
      {src && (
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
        />
      )}
      {v.durationSec > 0 && (
        <span className="tnum absolute bottom-1 right-1 rounded-[5px] bg-black/85 px-1.5 py-0.5 text-[10px] font-semibold text-white">
          {formatDuration(v.durationSec)}
        </span>
      )}
      {entry && entry.progress > 0.01 && (
        <span className="absolute inset-x-0 bottom-0 h-[3px] bg-white/25">
          <span
            className="block h-full bg-[var(--good)]"
            style={{ width: `${Math.round(entry.progress * 100)}%` }}
          />
        </span>
      )}
    </span>
  );
}

export function VideoRow({
  v, verdict, aiTier, reason, entry,
}: {
  v: VideoItem;
  verdict?: HeuristicVerdict;
  aiTier?: QualityTier | null;
  reason?: string;
  entry?: WatchEntry;
}) {
  const { navigate, saveVideo, unsaveVideo, hideVideo } = useApp();
  const open = () => navigate({ view: "video", id: v.id });
  const saved = entry?.saved;

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } }}
      className="group flex cursor-pointer gap-3 rounded-[14px] border border-transparent p-2 transition-colors hover:border-[var(--border)] hover:bg-[var(--bg-elev)] focus-visible:border-[var(--ring)]"
      aria-label={`${v.title} — open details`}
    >
      <div className="h-[74px] w-[126px] shrink-0 sm:h-[84px] sm:w-[144px]">
        <Thumb v={v} entry={entry} />
      </div>

      <div className="min-w-0 flex-1">
        <h3 className="line-clamp-2 text-[13.5px] font-semibold leading-snug tracking-[-0.01em]">
          {v.title}
        </h3>
        <p className="mt-1 truncate text-[11.5px] text-[var(--text-dim)]">
          {v.channelTitle}
          <span className="mx-1.5 text-[var(--text-faint)]">·</span>
          {timeAgo(v.publishedAt)}
          {v.categoryIds[0] && (
            <>
              <span className="mx-1.5 text-[var(--text-faint)]">·</span>
              {CATEGORY_MAP[v.categoryIds[0]]?.label}
            </>
          )}
        </p>
        <div className="mt-1.5">
          <Stats v={v} />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <TierBadge tier={aiTier ?? verdict?.tier} ai={Boolean(aiTier)} />
          {v.durationSec >= 20 * 60 && <span className="badge">Deep dive</span>}
        </div>
        {reason && (
          <p className="mt-1.5 line-clamp-2 text-[11px] italic leading-snug text-[var(--text-faint)]" title={reason}>
            Why: {reason}
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-center gap-0.5 pt-0.5">
        <button
          className="iconbtn"
          data-on={saved}
          aria-label={saved ? "Remove from saved" : "Save video"}
          aria-pressed={saved}
          onClick={(e) => { e.stopPropagation(); saved ? unsaveVideo(v.id) : saveVideo(v); }}
        >
          {saved ? <BookmarkCheck size={16.5} /> : <Bookmark size={16.5} />}
        </button>
        <button
          className="iconbtn opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100 md:opacity-40"
          aria-label="Hide this video from feeds"
          title="Hide this video from feeds"
          onClick={(e) => { e.stopPropagation(); hideVideo(v); }}
        >
          <EyeOff size={16} />
        </button>
      </div>
    </article>
  );
}

export function SpotlightCard({
  v, verdict, aiTier, entry,
}: {
  v: VideoItem;
  verdict?: HeuristicVerdict;
  aiTier?: QualityTier | null;
  entry?: WatchEntry;
}) {
  const { navigate } = useApp();
  const open = () => navigate({ view: "video", id: v.id });
  return (
    <article
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } }}
      className="group w-[232px] shrink-0 cursor-pointer rounded-[14px] border border-transparent p-2 transition-colors hover:border-[var(--border)] hover:bg-[var(--bg-elev)] sm:w-[252px]"
      aria-label={`${v.title} — open details`}
    >
      <div className="aspect-video w-full">
        <Thumb v={v} entry={entry} />
      </div>
      <h3 className="mt-2 line-clamp-2 text-[12.5px] font-semibold leading-snug tracking-[-0.01em]">
        {v.title}
      </h3>
      <p className="mt-1 truncate text-[11px] text-[var(--text-dim)]">{v.channelTitle}</p>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <Stats v={v} dense />
        <span className="text-[10px] text-[var(--text-faint)]">{timeAgo(v.publishedAt)}</span>
      </div>
      <div className="mt-1.5">
        <TierBadge tier={aiTier ?? verdict?.tier} ai={Boolean(aiTier)} />
      </div>
    </article>
  );
}
