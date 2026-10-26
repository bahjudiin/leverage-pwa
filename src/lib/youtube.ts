// ── YouTube Data API v3 endpoint layer ──────────────────────────────
// This module builds URLs and normalizes responses. It performs NO
// fetching, retrying, accounting or caching itself — every request is
// handed to the coordinator in ./apiClient, which is the single place
// where a network call can originate.
//
// Guarantees enforced here:
//  • `fields` masks keep payloads minimal.
//  • videos.list batches ≤50 IDs per request.
//  • No `pageToken` is ever sent — one page per query, by design.
//  • Dedup keys never contain the API key.

import type { VideoItem } from "../types";
import { dispatch } from "./apiClient";
import { hashKey } from "./utils";

const BASE = "https://www.googleapis.com/youtube/v3";

export const MAX_IDS_PER_BATCH = 50;

// Re-exported so callers have one import surface for errors/accounting.
export {
  QuotaError, AuthError, ApiError, RateGuardError,
  getUsage, recordUsage, isQuotaBlocked, clearQuotaBlock, markQuotaBlocked,
  isTerminalError, coordinatorStats, UNIT_COST,
} from "./apiClient";

export const COST_SEARCH = 100;
export const COST_VIDEOS = 1;

// ── URL helper ──────────────────────────────────────────────────────
function qs(params: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") p.set(k, String(v));
  }
  return p.toString();
}

// ── search.list (100 units — user-initiated actions only) ───────────
export interface SearchOptions {
  q: string;
  order?: "relevance" | "date" | "viewCount" | "rating";
  publishedAfter?: string;
  maxResults?: number;
  regionCode?: string;
  relevanceLanguage?: string;
  videoDuration?: "medium" | "long" | "any";
  /** Explicit Refresh bypasses the suppression replay. */
  force?: boolean;
}

interface SearchListResponse {
  items?: { id?: { videoId?: string } }[];
}

export async function searchVideoIds(
  key: string,
  o: SearchOptions,
  signal?: AbortSignal
): Promise<string[]> {
  const params = {
    part: "snippet",
    type: "video",
    q: o.q,
    order: o.order ?? "relevance",
    publishedAfter: o.publishedAfter,
    maxResults: Math.min(o.maxResults ?? 12, 25), // hard ceiling, single page
    regionCode: o.regionCode,
    relevanceLanguage: o.relevanceLanguage !== "any" ? o.relevanceLanguage : undefined,
    videoDuration: o.videoDuration ?? "medium",
    safeSearch: "none",
    fields: "items(id/videoId)",
  };
  const data = await dispatch<SearchListResponse>({
    kind: "search.list",
    key: `search:${hashKey(JSON.stringify(params))}`,
    url: `${BASE}/search?${qs({ ...params, key })}`,
    signal,
    force: o.force,
  });
  return (data.items ?? [])
    .map((i) => i.id?.videoId)
    .filter((x): x is string => Boolean(x));
}

// ── videos.list (1 unit per batch of ≤50) ───────────────────────────
const VIDEOS_FIELDS =
  "items(id,snippet(publishedAt,channelId,channelTitle,title,description,thumbnails,defaultLanguage,defaultAudioLanguage),contentDetails(duration),statistics(viewCount,likeCount,commentCount))";

export interface RawVideo {
  id: string;
  snippet?: {
    publishedAt?: string;
    channelId?: string;
    channelTitle?: string;
    title?: string;
    description?: string;
    defaultLanguage?: string;
    defaultAudioLanguage?: string;
    thumbnails?: Record<string, { url?: string } | undefined>;
  };
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Fetch full details for any number of IDs.
 * Deduped, batched ≤50/request, issued in parallel (each batch = 1 unit).
 */
export async function fetchVideoDetails(
  key: string,
  ids: string[],
  signal?: AbortSignal,
  force?: boolean
): Promise<RawVideo[]> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return [];

  const batches = chunk(unique, MAX_IDS_PER_BATCH);
  const responses = await Promise.all(
    batches.map((part) => {
      // Sort inside the batch key so identical ID sets dedupe regardless of order.
      const idParam = part.join(",");
      return dispatch<{ items?: RawVideo[] }>({
        kind: "videos.list",
        key: `videos:${hashKey([...part].sort().join(","))}`,
        url: `${BASE}/videos?${qs({
          part: "snippet,contentDetails,statistics",
          id: idParam,
          fields: VIDEOS_FIELDS,
          maxResults: MAX_IDS_PER_BATCH,
          key,
        })}`,
        signal,
        force,
      });
    })
  );
  return responses.flatMap((r) => r.items ?? []);
}

/** Official popularity chart — 1 unit. videoCategoryId 27 = Education. */
export async function fetchPopularEducation(
  key: string,
  regionCode: string,
  signal?: AbortSignal,
  force?: boolean
): Promise<RawVideo[]> {
  const data = await dispatch<{ items?: RawVideo[] }>({
    kind: "videos.chart",
    key: `chart:${regionCode}`,
    url: `${BASE}/videos?${qs({
      part: "snippet,contentDetails,statistics",
      chart: "mostPopular",
      videoCategoryId: "27",
      regionCode,
      maxResults: 25,
      fields: VIDEOS_FIELDS,
      key,
    })}`,
    signal,
    force,
  });
  return data.items ?? [];
}

// ── commentThreads.list — EXPLICIT user request only (1 unit) ───────
export interface TopComment {
  author: string;
  text: string;
  likeCount: number;
  publishedAt: string;
}

export async function fetchTopComments(
  key: string,
  videoId: string,
  signal?: AbortSignal
): Promise<TopComment[]> {
  const data = await dispatch<{
    items?: {
      snippet?: {
        topLevelComment?: {
          snippet?: { authorDisplayName?: string; textDisplay?: string; likeCount?: number; publishedAt?: string };
        };
      };
    }[];
  }>({
    kind: "commentThreads.list",
    key: `comments:${videoId}`,
    url: `${BASE}/commentThreads?${qs({
      part: "snippet",
      videoId,
      order: "relevance",
      maxResults: 10,
      textFormat: "plainText",
      fields: "items(snippet/topLevelComment/snippet(authorDisplayName,textDisplay,likeCount,publishedAt))",
      key,
    })}`,
    signal,
  });
  return (data.items ?? [])
    .map((i) => i.snippet?.topLevelComment?.snippet)
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .map((s) => ({
      author: s.authorDisplayName ?? "Unknown",
      text: (s.textDisplay ?? "").replace(/<[^>]+>/g, "").slice(0, 400),
      likeCount: s.likeCount ?? 0,
      publishedAt: s.publishedAt ?? "",
    }));
}

// ── Normalization ───────────────────────────────────────────────────
export function parseIso8601Duration(iso?: string): number {
  if (!iso) return 0;
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

function num(x: string | undefined): number | null {
  if (x === undefined || x === null) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

export function normalizeVideo(
  raw: RawVideo,
  meta: { categories: VideoItem["categoryIds"]; matchedQuery: string }
): VideoItem | null {
  if (!raw.id || !raw.snippet) return null;
  const s = raw.snippet;
  if (!s.title || !s.publishedAt) return null;
  return {
    id: raw.id,
    title: s.title,
    description: s.description ?? "",
    channelId: s.channelId ?? "",
    channelTitle: s.channelTitle ?? "Unknown channel",
    publishedAt: s.publishedAt,
    durationSec: parseIso8601Duration(raw.contentDetails?.duration),
    thumbnails: {
      default: s.thumbnails?.default?.url,
      medium: s.thumbnails?.medium?.url,
      high: s.thumbnails?.high?.url,
    },
    viewCount: num(raw.statistics?.viewCount),
    likeCount: num(raw.statistics?.likeCount),
    commentCount: num(raw.statistics?.commentCount),
    defaultLanguage: s.defaultLanguage ?? s.defaultAudioLanguage ?? null,
    categoryIds: [...meta.categories],
    matchedQueries: [meta.matchedQuery],
    fetchedAt: Date.now(),
  };
}

/** Merge duplicates by ID, unioning categories/queries, newest timestamp wins. */
export function mergeVideos(list: VideoItem[]): VideoItem[] {
  const map = new Map<string, VideoItem>();
  for (const v of list) {
    const prev = map.get(v.id);
    if (!prev) { map.set(v.id, v); continue; }
    map.set(v.id, {
      ...prev,
      fetchedAt: Math.max(prev.fetchedAt, v.fetchedAt),
      categoryIds: Array.from(new Set([...prev.categoryIds, ...v.categoryIds])) as VideoItem["categoryIds"],
      matchedQueries: Array.from(new Set([...prev.matchedQueries, ...v.matchedQueries])),
    });
  }
  return Array.from(map.values());
}
