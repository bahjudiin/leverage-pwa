// ── Discovery orchestration ─────────────────────────────────────────
// Coordinates search.list (expensive, user-action-only) + videos.list
// (batched, cheap) with versioned TTL caching. Nothing here polls or
// runs in the background.

import type { CategoryId, FeedResult, Settings, VideoItem, HeuristicVerdict } from "../types";
import { CATEGORY_MAP, matchCategories, matchesCategory } from "./categories";
import { heuristicAnalyze, isShort } from "./quality";
import { ttlGet, ttlSet, CK } from "./storage";
import {
  fetchPopularEducation,
  fetchVideoDetails,
  mergeVideos,
  normalizeVideo,
  searchVideoIds,
  isTerminalError,
} from "./youtube";
import { publishedAfterIso } from "./utils";

const FEED_TTL_MS = 45 * 60 * 1000; // cached feeds refresh ≤ ~45 min

export interface Ctx {
  key: string;
  settings: Settings;
  signal?: AbortSignal;
}

/** Rotate through a category's query pack a few times a day so
 *  refreshes surface fresh material without hammering one query. */
function pickQuery(queries: string[], salt = 0): string {
  const slot = Math.floor(Date.now() / (6 * 3600 * 1000));
  return queries[(slot + salt) % queries.length];
}

function ingest(videos: (VideoItem | null)[]): VideoItem[] {
  return videos
    .filter((v): v is VideoItem => Boolean(v))
    .filter((v) => !isShort({ durationSec: v.durationSec, title: v.title, description: v.description }));
}

export function verdictMap(videos: VideoItem[]): Map<string, HeuristicVerdict> {
  const m = new Map<string, HeuristicVerdict>();
  for (const v of videos) {
    m.set(v.id, heuristicAnalyze({ title: v.title, description: v.description, durationSec: v.durationSec }));
  }
  return m;
}

function withInferredCats(videos: VideoItem[], fallback: CategoryId[]): VideoItem[] {
  return videos.map((v) =>
    v.categoryIds.length > 0 ? v : { ...v, categoryIds: matchCategories(v.title, v.description).length ? matchCategories(v.title, v.description) : fallback }
  );
}

// ── Category feed: 2 search calls + 1 batched videos call per refresh ─

export async function loadCategoryFeed(cat: CategoryId, ctx: Ctx, force = false): Promise<FeedResult> {
  const ck = CK.categoryFeed(cat, ctx.settings.window);
  if (!force) {
    const cached = ttlGet<VideoItem[]>(ck);
    if (cached) return { videos: cached.value, fetchedAt: cached.at, fromCache: true };
  }
  const def = CATEGORY_MAP[cat];
  const publishedAfter = publishedAfterIso(ctx.settings.window);
  const lang = ctx.settings.language === "any" ? undefined : ctx.settings.language;

  const [relIds, popIds] = await Promise.all([
    searchVideoIds(
      ctx.key,
      {
        q: pickQuery(def.queries, 0), order: "relevance", publishedAfter,
        maxResults: 12, relevanceLanguage: lang, videoDuration: "medium", force,
      },
      ctx.signal
    ),
    searchVideoIds(
      ctx.key,
      {
        q: pickQuery(def.queries, 1), order: "viewCount", publishedAfter,
        maxResults: 10, relevanceLanguage: lang, videoDuration: "medium", force,
      },
      ctx.signal
    ),
  ]);

  const ids = Array.from(new Set([...relIds, ...popIds]));
  if (ids.length === 0) {
    ttlSet(ck, [], 10 * 60 * 1000);
    return { videos: [], fetchedAt: Date.now(), fromCache: false };
  }
  const raws = await fetchVideoDetails(ctx.key, ids, ctx.signal, force);
  const rel = new Set(relIds);
  const videos = mergeVideos(
    ingest(
      raws.map((r) => {
        const v = normalizeVideo(r, {
          categories: [],
          matchedQuery: rel.has(r.id) ? pickQuery(def.queries, 0) : "viewCount order",
        });
        if (!v) return null;
        // Only tag the category when the deterministic relevance rules
        // actually agree — search.list is fuzzy, so a result arriving
        // from a category query is NOT proof that it belongs there.
        const belongs = matchesCategory(cat, v.title, v.description);
        return {
          ...v,
          categoryIds: belongs
            ? Array.from(new Set([cat, ...matchCategories(v.title, v.description)]))
            : matchCategories(v.title, v.description),
        };
      })
    )
  );
  ttlSet(ck, videos, FEED_TTL_MS);
  return { videos, fetchedAt: Date.now(), fromCache: false };
}

// ── Home pool: ≤3 searches across selected cats + 1-unit chart ──────

export interface HomeResult {
  pool: VideoItem[];
  popular: VideoItem[];
  fetchedAt: number;
  fromCache: boolean;
}

export async function loadHome(ctx: Ctx, force = false): Promise<HomeResult> {
  const cats = ctx.settings.cats;
  const ck = `home:v3:${cats.join(".")}:${ctx.settings.window}:${ctx.settings.region}`;
  if (!force) {
    const cached = ttlGet<{ pool: VideoItem[]; popular: VideoItem[] }>(ck);
    if (cached) return { pool: cached.value.pool, popular: cached.value.popular, fetchedAt: cached.at, fromCache: true };
  }

  const publishedAfter = publishedAfterIso(ctx.settings.window);
  const lang = ctx.settings.language === "any" ? undefined : ctx.settings.language;
  const chosen = cats.slice(0, 3); // cap to keep quota sane

  const searches = chosen.map((cat, i) =>
    searchVideoIds(
      ctx.key,
      {
        q: pickQuery(CATEGORY_MAP[cat].queries, i),
        order: i === 0 ? "viewCount" : "relevance",
        publishedAfter, maxResults: 12, relevanceLanguage: lang,
        videoDuration: "medium", force,
      },
      ctx.signal
    ).then((ids) => ({ cat, ids }))
  );

  const [byCat, popularRaws] = await Promise.all([
    Promise.all(searches),
    fetchPopularEducation(ctx.key, ctx.settings.region || "US", ctx.signal, force).catch((e) => {
      // Quota/auth must surface; a benign chart failure degrades gracefully.
      if (isTerminalError(e)) throw e;
      return [];
    }),
  ]);

  const allIds = new Set<string>();
  for (const { ids } of byCat) ids.forEach((id) => allIds.add(id));
  const raws = allIds.size ? await fetchVideoDetails(ctx.key, Array.from(allIds), ctx.signal, force) : [];

  const catOf = new Map<string, CategoryId[]>();
  for (const { cat, ids } of byCat) {
    for (const id of ids) catOf.set(id, [...(catOf.get(id) ?? []), cat]);
  }
  const pool = mergeVideos(
    ingest(raws.map((r) => normalizeVideo(r, { categories: catOf.get(r.id) ?? [], matchedQuery: "categorized discovery" })))
  );

  const popular = withInferredCats(
    ingest(popularRaws.map((r) => normalizeVideo(r, { categories: [], matchedQuery: "mostPopular chart (Education)" }))),
    []
  ).filter((v) => v.categoryIds.length > 0); // only keep on-topic chart entries

  ttlSet(ck, { pool, popular }, FEED_TTL_MS);
  return { pool, popular, fetchedAt: Date.now(), fromCache: false };
}

// ── Explore / Rising-topics search: one search + one batch call ─────

export async function runSearch(ctx: Ctx, q: string, force = false): Promise<FeedResult> {
  const lang = ctx.settings.language === "any" ? undefined : ctx.settings.language;
  const ck = CK.search(q, ctx.settings.window, ctx.settings.language);
  if (!force) {
    const cached = ttlGet<VideoItem[]>(ck);
    if (cached) return { videos: cached.value, fetchedAt: cached.at, fromCache: true };
  }

  const ids = await searchVideoIds(
    ctx.key,
    {
      q, order: "relevance",
      publishedAfter: publishedAfterIso(ctx.settings.window),
      maxResults: 15, relevanceLanguage: lang,
      videoDuration: "medium", force,
    },
    ctx.signal
  );
  if (ids.length === 0) {
    ttlSet(ck, [], 10 * 60 * 1000);
    return { videos: [], fetchedAt: Date.now(), fromCache: false };
  }
  const raws = await fetchVideoDetails(ctx.key, ids, ctx.signal, force);
  const videos = mergeVideos(
    ingest(raws.map((r) => normalizeVideo(r, { categories: [], matchedQuery: `search: ${q}` })))
  );
  const videosWithCats = videos.map((v) => ({ ...v, categoryIds: matchCategories(v.title, v.description) }));
  ttlSet(ck, videosWithCats, FEED_TTL_MS);
  return { videos: videosWithCats, fetchedAt: Date.now(), fromCache: false };
}

/** Fetch details for IDs we only have as strings (e.g. imported saves). */
export async function hydrateIds(ctx: Ctx, ids: string[]): Promise<VideoItem[]> {
  const raws = await fetchVideoDetails(ctx.key, ids, ctx.signal);
  return mergeVideos(ingest(raws.map((r) => normalizeVideo(r, { categories: [], matchedQuery: "direct fetch" }))));
}
