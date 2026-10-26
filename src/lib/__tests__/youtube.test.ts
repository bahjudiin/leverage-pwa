import { describe, expect, it } from "vitest";
import { chunk, mergeVideos, normalizeVideo, parseIso8601Duration } from "../youtube";
import type { VideoItem } from "../../types";

describe("parseIso8601Duration", () => {
  it("parses all shapes", () => {
    expect(parseIso8601Duration("PT1H2M3S")).toBe(3723);
    expect(parseIso8601Duration("PT45S")).toBe(45);
    expect(parseIso8601Duration("PT10M")).toBe(600);
    expect(parseIso8601Duration("PT2H")).toBe(7200);
    expect(parseIso8601Duration(undefined)).toBe(0);
    expect(parseIso8601Duration("garbage")).toBe(0);
  });
});

describe("chunk (request batching)", () => {
  it("batches IDs in groups of ≤50", () => {
    const ids = Array.from({ length: 120 }, (_, i) => `id${i}`);
    const parts = chunk(ids, 50);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toHaveLength(50);
    expect(parts[2]).toHaveLength(20);
  });
});

describe("normalizeVideo", () => {
  const raw = {
    id: "abc123",
    snippet: {
      publishedAt: "2024-01-01T00:00:00Z",
      channelId: "ch",
      channelTitle: "Ch",
      title: "Title",
      description: "Desc",
      thumbnails: { medium: { url: "https://i.ytimg.com/x.jpg" } },
      defaultLanguage: "en",
    },
    contentDetails: { duration: "PT25M" },
    statistics: { viewCount: "123456", commentCount: "42" },
  };

  it("normalizes with raw numbers or nulls (never derived)", () => {
    const v = normalizeVideo(raw, { categories: ["ai"], matchedQuery: "q" })!;
    expect(v.viewCount).toBe(123456);
    expect(v.likeCount).toBeNull(); // missing → null, not 0-fabricated
    expect(v.commentCount).toBe(42);
    expect(v.durationSec).toBe(1500);
  });

  it("rejects items without a snippet/title", () => {
    expect(normalizeVideo({ id: "x" }, { categories: [], matchedQuery: "q" })).toBeNull();
  });
});

describe("mergeVideos (dedup)", () => {
  const base = (id: string, cats: VideoItem["categoryIds"], queries: string[]): VideoItem => ({
    id, title: "t", description: "", channelId: "c", channelTitle: "c",
    publishedAt: "2024-01-01T00:00:00Z", durationSec: 600, thumbnails: {},
    viewCount: 1, likeCount: 1, commentCount: 1, defaultLanguage: "en",
    categoryIds: cats, matchedQueries: queries, fetchedAt: 1,
  });

  it("unions categories and queries across duplicates", () => {
    const merged = mergeVideos([
      base("a", ["wealth"], ["q1"]),
      base("a", ["ai"], ["q2"]),
      base("b", ["focus"], ["q1"]),
    ]);
    expect(merged).toHaveLength(2);
    const a = merged.find((v) => v.id === "a")!;
    expect(a.categoryIds.sort()).toEqual(["ai", "wealth"]);
    expect(a.matchedQueries.sort()).toEqual(["q1", "q2"]);
  });
});
