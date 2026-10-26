// End-to-end pipeline audit: real YouTube Data API v3 response shapes
// flowing through normalize → Shorts exclusion → dedupe → filters →
// feeds, plus the documented quota/auth error envelopes.

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { fetchVideoDetails, normalizeVideo, mergeVideos, parseIso8601Duration } from "../youtube";
import type { RawVideo } from "../youtube";
import { __resetCoordinator, clearQuotaBlock, QuotaError, AuthError, isQuotaBlocked } from "../apiClient";
import { isShort, heuristicAnalyze } from "../quality";
import { applyFilters, buildCategorySections, sortVideos } from "../feeds";
import { parseChapters } from "../parse";
import { formatCount, formatFull } from "../utils";
import type { HeuristicVerdict, VideoItem } from "../../types";

class MemStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return Array.from(this.m.keys())[i] ?? null; }
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemStorage());
  __resetCoordinator();
  clearQuotaBlock();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// ── Realistic API payloads ──────────────────────────────────────────

/** A normal long-form educational video. */
const LONGFORM: RawVideo = {
  id: "abc123DEF45",
  snippet: {
    publishedAt: "2024-03-12T14:00:03Z",
    channelId: "UCchan1", channelTitle: "Teaching Channel",
    title: "Risk Management for Traders — Full Course",
    description: "Position sizing explained.\n\n0:00 Intro\n4:30 Position sizing\n18:45 Drawdowns\n41:10 Recap\n\nhttps://example.com/sheet",
    thumbnails: {
      default: { url: "https://i.ytimg.com/vi/abc123DEF45/default.jpg" },
      medium: { url: "https://i.ytimg.com/vi/abc123DEF45/mqdefault.jpg" },
      high: { url: "https://i.ytimg.com/vi/abc123DEF45/hqdefault.jpg" },
    },
    defaultAudioLanguage: "en",
  },
  contentDetails: { duration: "PT52M17S" },
  statistics: { viewCount: "184302", likeCount: "9120", commentCount: "631" },
};

/** A Short: 48s, and the API still reports contentDetails.duration. */
const SHORT: RawVideo = {
  id: "shortVID001",
  snippet: {
    publishedAt: "2024-05-01T09:00:00Z",
    channelId: "UCchan2", channelTitle: "Clips",
    title: "Quick money tip #Shorts",
    description: "#shorts #finance",
    thumbnails: { medium: { url: "https://i.ytimg.com/vi/shortVID001/mqdefault.jpg" } },
  },
  contentDetails: { duration: "PT48S" },
  statistics: { viewCount: "2500000", likeCount: "180000", commentCount: "4200" },
};

/** Creator hid likes → the API OMITS likeCount entirely (not zero). */
const HIDDEN_LIKES: RawVideo = {
  id: "hiddenLK002",
  snippet: {
    publishedAt: "2024-02-02T00:00:00Z",
    channelId: "UCchan3", channelTitle: "Quiet Channel",
    title: "Nutrition Science Explained: Evidence Based Guide",
    description: "A full lecture based on peer-reviewed studies.",
    thumbnails: { medium: { url: "https://i.ytimg.com/vi/hiddenLK002/mqdefault.jpg" } },
  },
  contentDetails: { duration: "PT33M05S" },
  statistics: { viewCount: "44100", commentCount: "88" }, // no likeCount
};

/** Comments disabled → commentCount omitted too. */
const NO_COMMENTS: RawVideo = {
  id: "noCommts003",
  snippet: {
    publishedAt: "2024-01-15T00:00:00Z",
    channelId: "UCchan4", channelTitle: "Docs",
    title: "How Blockchain Works — Explained",
    description: "Fundamentals documentary.",
    thumbnails: { medium: { url: "https://i.ytimg.com/vi/noCommts003/mqdefault.jpg" } },
  },
  contentDetails: { duration: "PT21M00S" },
  statistics: { viewCount: "9800", likeCount: "410" }, // no commentCount
};

/** A ~4min video: NOT a Short, but below the 10-min long-form default. */
const MEDIUM: RawVideo = {
  id: "medium00004",
  snippet: {
    publishedAt: "2024-04-04T00:00:00Z",
    channelId: "UCchan5", channelTitle: "Brief",
    title: "Compound interest explained quickly",
    description: "Short explainer.",
    thumbnails: { medium: { url: "https://i.ytimg.com/vi/medium00004/mqdefault.jpg" } },
  },
  contentDetails: { duration: "PT4M2S" },
  statistics: { viewCount: "1200", likeCount: "30", commentCount: "4" },
};

const norm = (r: RawVideo) =>
  normalizeVideo(r, { categories: [], matchedQuery: "test" }) as VideoItem;

const verdictsFor = (vs: VideoItem[]) => {
  const m = new Map<string, HeuristicVerdict>();
  vs.forEach((v) => m.set(v.id, heuristicAnalyze({
    title: v.title, description: v.description, durationSec: v.durationSec,
  })));
  return m;
};

const BASE_FILTERS = {
  minDurationSec: 600, window: "any" as const,
  blockedChannels: [], blockedKeywords: [], language: "any",
};

// ── Normalization against real shapes ───────────────────────────────

describe("normalization of real API payloads", () => {
  it("parses every documented ISO-8601 duration form", () => {
    expect(parseIso8601Duration("PT52M17S")).toBe(3137);
    expect(parseIso8601Duration("PT48S")).toBe(48);
    expect(parseIso8601Duration("PT1H2M3S")).toBe(3723);
    expect(parseIso8601Duration("P0D")).toBe(0);     // live/edge case
    expect(parseIso8601Duration(undefined)).toBe(0);
  });

  it("maps a long-form video completely and correctly", () => {
    const v = norm(LONGFORM);
    expect(v.id).toBe("abc123DEF45");
    expect(v.durationSec).toBe(3137);
    expect(v.viewCount).toBe(184302);
    expect(v.likeCount).toBe(9120);
    expect(v.commentCount).toBe(631);
    expect(v.thumbnails.medium).toContain("i.ytimg.com");
    expect(v.defaultLanguage).toBe("en");
  });

  it("represents omitted statistics as null — never 0", () => {
    const hidden = norm(HIDDEN_LIKES);
    expect(hidden.likeCount).toBeNull();
    expect(hidden.likeCount).not.toBe(0);
    expect(hidden.viewCount).toBe(44100);

    const noComments = norm(NO_COMMENTS);
    expect(noComments.commentCount).toBeNull();
  });

  it("renders unavailable statistics honestly in the UI formatters", () => {
    expect(formatCount(null)).toBe("—");
    expect(formatFull(null)).toBe("Not disclosed");
    expect(formatCount(0)).toBe("0");          // a real zero is distinguishable
    expect(formatFull(0)).toBe("0");
  });

  it("rejects malformed items instead of inventing fields", () => {
    expect(normalizeVideo({ id: "x" }, { categories: [], matchedQuery: "q" })).toBeNull();
    expect(normalizeVideo(
      { id: "y", snippet: { title: "No date" } },
      { categories: [], matchedQuery: "q" }
    )).toBeNull();
  });
});

// ── Shorts exclusion ────────────────────────────────────────────────

describe("Shorts exclusion", () => {
  it("detects Shorts by duration and by hashtag", () => {
    expect(isShort({ durationSec: 48, title: "x", description: "" })).toBe(true);
    expect(isShort({ durationSec: 600, title: "clip #shorts", description: "" })).toBe(true);
    expect(isShort({ durationSec: 3137, title: "Full Course", description: "" })).toBe(false);
  });

  it("removes a Short even when its statistics dwarf everything else", () => {
    const vids = [norm(LONGFORM), norm(SHORT)];
    const out = applyFilters(vids, BASE_FILTERS, verdictsFor(vids), new Set());
    expect(out.map((v) => v.id)).toEqual(["abc123DEF45"]);
    // 2.5M views must not buy its way back in.
    expect(out.find((v) => v.id === "shortVID001")).toBeUndefined();
  });

  it("applies the configurable long-form floor independently of Shorts", () => {
    const vids = [norm(LONGFORM), norm(MEDIUM)];
    const verdicts = verdictsFor(vids);
    expect(isShort({ durationSec: 242, title: "x", description: "" })).toBe(false); // not a Short
    expect(applyFilters(vids, BASE_FILTERS, verdicts, new Set()).map((v) => v.id))
      .toEqual(["abc123DEF45"]);                                   // but below 10-min floor
    expect(applyFilters(vids, { ...BASE_FILTERS, minDurationSec: 180 }, verdicts, new Set()))
      .toHaveLength(2);                                            // floor lowered → included
  });
});

// ── Duplicates ──────────────────────────────────────────────────────

describe("duplicate handling", () => {
  it("collapses the same video arriving from two different queries", () => {
    const a = { ...norm(LONGFORM), categoryIds: ["markets"] as VideoItem["categoryIds"], matchedQueries: ["risk management"] };
    const b = { ...norm(LONGFORM), categoryIds: ["business"] as VideoItem["categoryIds"], matchedQueries: ["trading course"] };
    const merged = mergeVideos([a, b]);
    expect(merged).toHaveLength(1);
    expect(merged[0].categoryIds.sort()).toEqual(["business", "markets"]);
    expect(merged[0].matchedQueries.sort()).toEqual(["risk management", "trading course"]);
  });

  it("deduplicates IDs before they ever reach the network", async () => {
    const f = vi.fn(async (url: string) => {
      const ids = new URL(url).searchParams.get("id")!.split(",");
      return { ok: true, status: 200, json: async () => ({ items: ids.map((id) => ({ id })) }) } as unknown as Response;
    });
    vi.stubGlobal("fetch", f);
    await fetchVideoDetails("KEY", ["a", "a", "b", "a", "b"]);
    expect(new URL(f.mock.calls[0][0] as string).searchParams.get("id")).toBe("a,b");
  });

  it("a feed never renders the same video twice", () => {
    const dupes = [norm(LONGFORM), norm(LONGFORM), norm(HIDDEN_LIKES)];
    const merged = mergeVideos(dupes);
    const sections = buildCategorySections("markets", merged, verdictsFor(merged));
    for (const s of sections) {
      const ids = s.videos.map((v) => v.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

// ── Missing statistics in feeds ─────────────────────────────────────

describe("missing statistics in statistic feeds", () => {
  const vids = [norm(LONGFORM), norm(HIDDEN_LIKES), norm(NO_COMMENTS)];
  const sections = buildCategorySections("markets", vids, verdictsFor(vids));
  const byId = (id: string) => sections.find((s) => s.id === id)!;

  it("omits videos lacking the statistic and explains the omission", () => {
    expect(byId("likes").videos.map((v) => v.id)).not.toContain("hiddenLK002");
    expect(byId("likes").caveat).toMatch(/omitted/i);
    expect(byId("comments").videos.map((v) => v.id)).not.toContain("noCommts003");
  });

  it("still includes those videos in feeds whose statistic IS available", () => {
    expect(byId("views").videos.map((v) => v.id)).toContain("hiddenLK002");
    expect(byId("recent").videos.map((v) => v.id)).toContain("noCommts003");
    expect(byId("editorial").videos.map((v) => v.id)).toContain("hiddenLK002");
  });

  it("never sorts a null count as if it were zero", () => {
    const sorted = sortVideos(vids, "likes").map((v) => v.likeCount);
    expect(sorted[sorted.length - 1]).toBeNull(); // nulls last, not ranked as 0
  });
});

// ── Chapter accuracy ────────────────────────────────────────────────

describe("chapter accuracy against a real description", () => {
  it("extracts exactly the creator's timestamps", () => {
    const v = norm(LONGFORM);
    const ch = parseChapters(v.description, v.durationSec);
    expect(ch.map((c) => c.seconds)).toEqual([0, 270, 1125, 2470]);
    expect(ch.map((c) => c.label)).toEqual(["Intro", "Position sizing", "Drawdowns", "Recap"]);
  });

  it("returns none when the description has no timestamps", () => {
    expect(parseChapters(norm(HIDDEN_LIKES).description, 1985)).toEqual([]);
  });

  it("discards timestamps beyond the real video duration", () => {
    const ch = parseChapters("0:00 Start\n5:00 Middle\n99:00 Impossible", 600);
    expect(ch.map((c) => c.seconds)).toEqual([0, 300]);
  });

  it("ignores a single stray time reference (needs ≥2 to be chapters)", () => {
    expect(parseChapters("Jump to 3:15 for the good part", 600)).toEqual([]);
  });
});

// ── Error envelopes (shapes verified against the live API) ──────────

describe("API error handling with real envelopes", () => {
  const reply = (status: number, body: unknown) =>
    ({ ok: false, status, json: async () => body } as unknown as Response);

  it("maps the live invalid-key 400 envelope to AuthError without retrying", async () => {
    // Captured verbatim from googleapis.com on an invalid key.
    const live400 = {
      error: {
        code: 400, message: "API key not valid. Please pass a valid API key.",
        errors: [{ message: "API key not valid. Please pass a valid API key.", domain: "global", reason: "badRequest" }],
        status: "INVALID_ARGUMENT",
      },
    };
    const f = vi.fn(async () => reply(400, live400));
    vi.stubGlobal("fetch", f);
    await expect(fetchVideoDetails("BAD", ["x"])).rejects.toBeInstanceOf(AuthError);
    expect(f).toHaveBeenCalledTimes(1);
    expect(isQuotaBlocked()).toBe(false);  // auth failure must not block quota
  });

  it("maps the documented quotaExceeded 403 envelope to QuotaError and blocks further calls", async () => {
    const quota403 = {
      error: {
        code: 403, message: "The request cannot be completed because you have exceeded your quota.",
        errors: [{ message: "The request cannot be completed because you have exceeded your quota.", domain: "youtube.quota", reason: "quotaExceeded" }],
      },
    };
    const f = vi.fn(async () => reply(403, quota403));
    vi.stubGlobal("fetch", f);
    await expect(fetchVideoDetails("K", ["x"])).rejects.toBeInstanceOf(QuotaError);
    expect(f).toHaveBeenCalledTimes(1);     // never retried
    expect(isQuotaBlocked()).toBe(true);

    // Subsequent calls short-circuit locally — zero further network.
    await expect(fetchVideoDetails("K", ["y"])).rejects.toBeInstanceOf(QuotaError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("surfaces an empty item list without inventing placeholder videos", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      ({ ok: true, status: 200, json: async () => ({ items: [] }) } as unknown as Response)));
    expect(await fetchVideoDetails("K", ["missing"])).toEqual([]);
  });
});
