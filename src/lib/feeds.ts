// ── Feed filtering, sorting, sectioning, recommendation reasons ─────
// All pure & testable. Slices are computed client-side from the
// discovery pool — no extra API calls, no invented signals. Internal
// ordering heuristics are never exposed as public "scores".

import type { CategoryId, HeuristicVerdict, PublishWindow, SortKey, VideoItem } from "../types";
import { isShort } from "./quality";
import { timeAgo, windowCutoffMillis, formatCount, formatDuration } from "./utils";
import { CATEGORY_MAP, matchesCategory, topicalStrength } from "./categories";

export interface FeedFilters {
  minDurationSec: number;
  window: PublishWindow;
  blockedChannels: string[]; // lowercase titles
  blockedKeywords: string[];
  language: string; // "any" | BCP-47-ish code
  hideUnsafe?: boolean;
  includeShorts?: boolean;
}

export function withinWindow(v: VideoItem, window: PublishWindow): boolean {
  const cut = windowCutoffMillis(window);
  if (cut === null) return true;
  return new Date(v.publishedAt).getTime() >= cut;
}

export function applyFilters(
  videos: VideoItem[],
  f: FeedFilters,
  verdicts: Map<string, HeuristicVerdict>,
  hiddenIds: Set<string>
): VideoItem[] {
  const blockedCh = new Set(f.blockedChannels.map((c) => c.trim().toLowerCase()));
  const words = f.blockedKeywords.map((w) => w.trim().toLowerCase()).filter(Boolean);
  return videos.filter((v) => {
    if (hiddenIds.has(v.id)) return false;
    if (!f.includeShorts) {
      if (isShort({ durationSec: v.durationSec, title: v.title, description: v.description })) return false;
      if (v.durationSec > 0 && v.durationSec < f.minDurationSec) return false;
    }
    if (blockedCh.has(v.channelTitle.toLowerCase()) || blockedCh.has(v.channelId.toLowerCase())) return false;
    const text = `${v.title} ${v.description}`.toLowerCase();
    if (words.some((w) => text.includes(w))) return false;
    if (f.language !== "any" && v.defaultLanguage && !v.defaultLanguage.toLowerCase().startsWith(f.language)) return false;
    if (f.hideUnsafe !== false) {
      const tier = verdicts.get(v.id)?.tier;
      if (tier === "unsafe") return false;
    }
    return true;
  });
}

/** Non-mutating sort by a single RAW YouTube statistic (never derived metrics). */
export function sortVideos(videos: VideoItem[], key: SortKey): VideoItem[] {
  const arr = [...videos];
  const stat = (v: VideoItem, k: "viewCount" | "likeCount" | "commentCount") =>
    v[k] === null ? -1 : (v[k] as number);
  switch (key) {
    case "views": return arr.sort((a, b) => stat(b, "viewCount") - stat(a, "viewCount"));
    case "likes": return arr.sort((a, b) => stat(b, "likeCount") - stat(a, "likeCount"));
    case "comments": return arr.sort((a, b) => stat(b, "commentCount") - stat(a, "commentCount"));
    case "date": return arr.sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
    case "duration": return arr.sort((a, b) => b.durationSec - a.durationSec);
    default: return arr;
  }
}

/** Internal ordering only: quality signal + freshness. Never displayed. */
export function rankForYou(videos: VideoItem[], verdicts: Map<string, HeuristicVerdict>): VideoItem[] {
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  return [...videos].sort((a, b) => score(b) - score(a));
  function score(v: VideoItem): number {
    const verdict = verdicts.get(v.id);
    let s = verdict ? verdict.score : 0;
    if (verdict?.tier === "high") s += 4;
    if (verdict?.tier === "low") s -= 4;
    if (new Date(v.publishedAt).getTime() > weekAgo) s += 2;
    if (v.durationSec >= 1200) s += 1;
    return s;
  }
}

// ── Home sections ───────────────────────────────────────────────────

export interface Section {
  id: string;
  title: string;
  note: string; // honest provenance label
  videos: VideoItem[];
}

export function buildHomeSections(
  pool: VideoItem[],
  verdicts: Map<string, HeuristicVerdict>,
  popular: VideoItem[],
  hiddenIds: Set<string>
): Section[] {
  const live = pool.filter((v) => !hiddenIds.has(v.id));
  const week = live.filter((v) => withinWindow(v, "7d"));
  const month = live.filter((v) => withinWindow(v, "30d"));
  const oldEnough = live.filter((v) => Date.now() - +new Date(v.publishedAt) > 180 * 24 * 3600 * 1000);

  const sections: Section[] = [];

  const forYou = rankForYou(live.filter((v) => (verdicts.get(v.id)?.tier ?? "unrated") !== "low"), verdicts).slice(0, 12);
  if (forYou.length) sections.push({
    id: "foryou", title: "For You",
    note: "Ordered by local editorial signals (quality filter, freshness, depth) — not by any hidden YouTube metric.",
    videos: forYou,
  });

  if (popular.length) sections.push({
    id: "trending", title: "Trending Now",
    note: "Official YouTube “Most popular — Education” chart, filtered to your topics. Snapshot — not real-time.",
    videos: popular.filter((v) => !hiddenIds.has(v.id)).slice(0, 10),
  });

  if (week.length) sections.push({
    id: "popular-week", title: "Popular This Week",
    note: "Published in the last 7 days, ordered by raw view count from the API snapshot.",
    videos: sortVideos(week, "views").slice(0, 10),
  });

  if (month.length) sections.push({
    id: "most-viewed", title: "Most Viewed",
    note: "Highest raw view counts in your discovery pool (last 30 days).",
    videos: sortVideos(month, "views").slice(0, 10),
  });

  const liked = month.filter((v) => v.likeCount !== null);
  if (liked.length) sections.push({
    id: "most-liked", title: "Most Liked",
    note: "Highest raw like counts in your discovery pool. Videos with hidden counts are excluded.",
    videos: sortVideos(liked, "likes").slice(0, 10),
  });

  const discussed = month.filter((v) => v.commentCount !== null && v.commentCount > 0);
  if (discussed.length) sections.push({
    id: "most-discussed", title: "Most Discussed",
    note: "Highest raw comment counts in your discovery pool.",
    videos: sortVideos(discussed, "comments").slice(0, 10),
  });

  if (month.length) sections.push({
    id: "recent", title: "Recently Published",
    note: "Newest first, straight from publication dates.",
    videos: sortVideos(month, "date").slice(0, 10),
  });

  const deep = live.filter((v) => v.durationSec >= 20 * 60);
  if (deep.length) sections.push({
    id: "deep", title: "Deep Dives",
    note: "20+ minute videos — room for real substance.",
    videos: sortVideos(deep, "views").slice(0, 10),
  });

  const evergreen = oldEnough.filter((v) => {
    const t = verdicts.get(v.id)?.tier;
    return t !== "low" && t !== "unsafe" && (v.viewCount ?? 0) > 20_000;
  });
  if (evergreen.length) sections.push({
    id: "evergreen", title: "Evergreen Learning",
    note: "6+ months old and still worth your time — foundations don't expire.",
    videos: sortVideos(evergreen, "views").slice(0, 10),
  });

  return sections;
}

// ── Recommendation reasons (editorial, factual, from snapshot data) ──

export function reasonForVideo(
  v: VideoItem,
  ctx: { tier?: string; cats?: CategoryId[]; defaultCat?: CategoryId }
): string {
  const ageDays = (Date.now() - +new Date(v.publishedAt)) / 86400000;
  if (ctx.tier === "high" && v.durationSec >= 1500)
    return `Long-form (${formatDuration(v.durationSec)}) rated high educational value by the local quality filter.`;
  if (ctx.tier === "high") return "Rated high educational value by the local quality filter.";
  if (ageDays <= 2 && (v.viewCount ?? 0) >= 100_000)
    return `Published ${timeAgo(v.publishedAt)} — already ${formatCount(v.viewCount)} views in the snapshot.`;
  if (ageDays <= 7) return `Fresh — published ${timeAgo(v.publishedAt)}.`;
  if ((v.commentCount ?? 0) >= 1000) return `Active discussion: ${formatCount(v.commentCount)} comments.`;
  if (v.durationSec >= 1500) return `Long-form deep dive (${formatDuration(v.durationSec)}).`;
  if (ageDays > 180) return "Evergreen — older video with enduring relevance.";
  const cat = ctx.cats?.[0] ?? ctx.defaultCat;
  if (cat) return `Matches your ${CATEGORY_MAP[cat].label} focus.`;
  return "From your curated discovery pool.";
}


// ── Category feed sections ──────────────────────────────────────────
//
// `basis` makes the provenance of every feed explicit in the data model
// so the UI can never blur the line between what YouTube reported and
// what this app decided:
//
//   "statistic" — ordering comes from a RAW YouTube API field, unmodified.
//   "recency"   — ordering comes from the real publishedAt field.
//   "editorial" — ordering is OUR judgement (local quality filter +
//                 topical fit + depth). Never derived from statistics.

export type FeedBasis = "statistic" | "recency" | "editorial";

export interface CategorySection {
  id: string;
  title: string;
  basis: FeedBasis;
  /** Honest provenance sentence shown under the heading. */
  note: string;
  /** Explains omissions, e.g. videos whose like count is hidden. */
  caveat?: string;
  videos: VideoItem[];
}

export const SECTION_IDS = ["editorial", "views", "likes", "comments", "recent"] as const;
export type CategorySectionId = (typeof SECTION_IDS)[number];

/**
 * Topical relevance gate: keep only videos that genuinely belong in this
 * category. search.list is fuzzy, so this deterministic local pass is
 * what makes a category feed actually category-specific.
 */
export function filterByCategory(cat: CategoryId, videos: VideoItem[]): VideoItem[] {
  return videos.filter(
    (v) => v.categoryIds.includes(cat) || matchesCategory(cat, v.title, v.description)
  );
}

/**
 * Editorial ranking — our curation, built ONLY from:
 *   • the deterministic local quality verdict,
 *   • topical fit with the category,
 *   • long-form depth, and
 *   • publication recency.
 *
 * It deliberately ignores view/like/comment counts so that an editorial
 * pick is never a disguised popularity metric.
 */
export function rankEditorial(
  cat: CategoryId,
  videos: VideoItem[],
  verdicts: Map<string, HeuristicVerdict>,
  aiTiers?: Map<string, string>
): VideoItem[] {
  const score = (v: VideoItem): number => {
    let s = 0;
    const tier = aiTiers?.get(v.id) ?? verdicts.get(v.id)?.tier;
    if (tier === "high") s += 6;
    else if (tier === "verify") s += 2;
    else if (tier === "promotional") s -= 2;
    else if (tier === "low") s -= 5;
    else if (tier === "unsafe") s -= 20;

    s += Math.max(0, topicalStrength(cat, v.title, v.description)) * 1.5;

    if (v.durationSec >= 2400) s += 2.5;        // 40min+ : substantial
    else if (v.durationSec >= 1200) s += 1.5;   // 20min+ : deep
    else if (v.durationSec < 420) s -= 1;       // under 7min : thin

    const ageDays = (Date.now() - +new Date(v.publishedAt)) / 86_400_000;
    if (ageDays <= 30) s += 1;
    if (ageDays > 1460) s -= 1;                 // 4y+ may be outdated

    return s;
  };
  return [...videos].sort((a, b) => score(b) - score(a));
}

/**
 * Build the five category feeds.
 *
 * Statistic-based feeds EXCLUDE videos whose counts the creator has
 * hidden, rather than coercing a missing value to zero — a hidden count
 * is unknown, not low.
 */
export function buildCategorySections(
  cat: CategoryId,
  videos: VideoItem[],
  verdicts: Map<string, HeuristicVerdict>,
  opts: { aiTiers?: Map<string, string>; limit?: number } = {}
): CategorySection[] {
  const limit = opts.limit ?? 24;
  const label = CATEGORY_MAP[cat]?.label ?? "this category";

  const withViews = videos.filter((v) => v.viewCount !== null);
  const withLikes = videos.filter((v) => v.likeCount !== null);
  const withComments = videos.filter((v) => v.commentCount !== null);

  const hiddenViews = videos.length - withViews.length;
  const hiddenLikes = videos.length - withLikes.length;
  const hiddenComments = videos.length - withComments.length;

  const omitted = (n: number, field: string) =>
    n > 0
      ? `${n} video${n === 1 ? "" : "s"} omitted — ${field} not returned by the API (creator has hidden it).`
      : undefined;

  return [
    {
      id: "editorial",
      title: "Curated picks",
      basis: "editorial",
      note:
        `Our editorial ordering for ${label}: local quality filter, topical fit, and depth. ` +
        "Independent of view, like, and comment counts.",
      videos: rankEditorial(cat, videos, verdicts, opts.aiTiers).slice(0, limit),
    },
    {
      id: "views",
      title: "Most Viewed",
      basis: "statistic",
      note: "Ordered by the raw viewCount field from the YouTube API snapshot. Not a trending score.",
      caveat: omitted(hiddenViews, "view count"),
      videos: sortVideos(withViews, "views").slice(0, limit),
    },
    {
      id: "likes",
      title: "Most Liked",
      basis: "statistic",
      note: "Ordered by the raw likeCount field from the YouTube API snapshot.",
      caveat: omitted(hiddenLikes, "like count"),
      videos: sortVideos(withLikes, "likes").slice(0, limit),
    },
    {
      id: "comments",
      title: "Most Discussed",
      basis: "statistic",
      note: "Ordered by the raw commentCount field. A count of comments, not a measure of sentiment.",
      caveat: omitted(hiddenComments, "comment count"),
      videos: sortVideos(withComments, "comments").slice(0, limit),
    },
    {
      id: "recent",
      title: "Recently Published",
      basis: "recency",
      note: "Ordered by the publishedAt field, newest first.",
      videos: sortVideos(videos, "date").slice(0, limit),
    },
  ];
}

export const BASIS_LABEL: Record<FeedBasis, string> = {
  statistic: "YouTube statistic",
  recency: "Publication date",
  editorial: "Editorial judgment",
};
