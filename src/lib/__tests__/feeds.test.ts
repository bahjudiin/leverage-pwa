import { describe, expect, it } from "vitest";
import { applyFilters, buildHomeSections, reasonForVideo, sortVideos } from "../feeds";
import type { HeuristicVerdict, VideoItem } from "../../types";

let seq = 0;
function makeVideo(partial: Partial<VideoItem>): VideoItem {
  seq += 1;
  return {
    id: `v${seq}`,
    title: "Sample educational video " + seq,
    description: "A step by step tutorial.",
    channelId: "ch1",
    channelTitle: "Test Channel",
    publishedAt: new Date(Date.now() - 2 * 86400e3).toISOString(),
    durationSec: 1200,
    thumbnails: {},
    viewCount: 1000,
    likeCount: 100,
    commentCount: 50,
    defaultLanguage: "en",
    categoryIds: ["wealth"],
    matchedQueries: ["test"],
    fetchedAt: Date.now(),
    ...partial,
  };
}

const verdictOf = (tier: HeuristicVerdict["tier"]): HeuristicVerdict => ({ tier, flags: [], positives: [], score: 0 });

describe("applyFilters", () => {
  const base = {
    minDurationSec: 600, window: "any" as const,
    blockedChannels: [], blockedKeywords: [], language: "any" as const,
  };

  it("excludes shorts and below-minimum durations", () => {
    const good = makeVideo({ durationSec: 900 });
    const short = makeVideo({ durationSec: 59 });
    const folded = applyFilters([good, short], base, new Map(), new Set());
    expect(folded.map((v) => v.id)).toEqual([good.id]);
  });

  it("excludes hidden videos, blocked channels and keywords", () => {
    const a = makeVideo({ channelTitle: "Spammy Guy", title: "Normal title" });
    const b = makeVideo({ title: "Big giveaway inside" });
    const c = makeVideo({});
    const out = applyFilters(
      [a, b, c],
      { ...base, blockedChannels: ["spammy guy"], blockedKeywords: ["giveaway"] },
      new Map(),
      new Set()
    );
    expect(out.map((v) => v.id)).toEqual([c.id]);
  });

  it("excludes unsafe-rated items via the verdict map", () => {
    const a = makeVideo({});
    const b = makeVideo({ title: "Make $1000 per day" });
    const verdicts = new Map<string, HeuristicVerdict>([[b.id, verdictOf("unsafe")]]);
    const out = applyFilters([a, b], base, verdicts, new Set());
    expect(out.map((v) => v.id)).toEqual([a.id]);
  });

  it("filters by declared language when set", () => {
    const en = makeVideo({ defaultLanguage: "en" });
    const es = makeVideo({ defaultLanguage: "es" });
    const out = applyFilters([en, es], { ...base, language: "en" }, new Map(), new Set());
    expect(out.map((v) => v.id)).toEqual([en.id]);
  });
});

describe("sortVideos (raw stats only)", () => {
  it("sorts by raw views with nulls last", () => {
    const a = makeVideo({ viewCount: 500 });
    const b = makeVideo({ viewCount: null });
    const c = makeVideo({ viewCount: 9000 });
    const out = sortVideos([a, b, c], "views");
    expect(out.map((v) => v.id)).toEqual([c.id, a.id, b.id]);
  });

  it("sorts by date descending and does not mutate input", () => {
    const old = makeVideo({ publishedAt: new Date(Date.now() - 30 * 86400e3).toISOString() });
    const fresh = makeVideo({ publishedAt: new Date().toISOString() });
    const input = [old, fresh];
    const out = sortVideos(input, "date");
    expect(out[0].id).toBe(fresh.id);
    expect(input[0].id).toBe(old.id); // untouched
  });
});

describe("buildHomeSections", () => {
  it("builds provenance-labeled sections from the pool", () => {
    const vids = [
      makeVideo({ viewCount: 50000, commentCount: 2000 }),
      makeVideo({ durationSec: 2400, viewCount: 30000 }),
      makeVideo({ publishedAt: new Date(Date.now() - 300 * 86400e3).toISOString(), viewCount: 90000 }),
    ];
    const verdicts = new Map<string, HeuristicVerdict>(vids.map((v) => [v.id, verdictOf("high")]));
    const sections = buildHomeSections(vids, verdicts, [], new Set());
    const ids = sections.map((s) => s.id);
    expect(ids).toContain("foryou");
    expect(ids).toContain("deep");
    expect(ids).toContain("evergreen");
    for (const s of sections) expect(s.note.length).toBeGreaterThan(10);
  });

  it("handles an empty pool without throwing", () => {
    expect(buildHomeSections([], new Map(), [], new Set())).toEqual([]);
  });
});

describe("reasonForVideo", () => {
  it("returns factual, non-fabricated reasons", () => {
    const v = makeVideo({ commentCount: 1500, publishedAt: new Date(Date.now() - 10 * 86400e3).toISOString() });
    const reason = reasonForVideo(v, { cats: ["wealth"] });
    expect(reason).toMatch(/comments|Matches your/);
  });
});
