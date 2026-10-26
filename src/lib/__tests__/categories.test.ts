import { describe, expect, it } from "vitest";
import {
  CATEGORIES, CATEGORY_MAP, ALL_CATEGORY_IDS, RISING_TOPICS,
  matchesCategory, matchCategories, topicalStrength,
} from "../categories";
import {
  buildCategorySections, filterByCategory, rankEditorial, SECTION_IDS, BASIS_LABEL,
} from "../feeds";
import type { CategoryId, HeuristicVerdict, VideoItem } from "../../types";
import { heuristicAnalyze } from "../quality";

let n = 0;
const video = (over: Partial<VideoItem> = {}): VideoItem => {
  n++;
  return {
    id: over.id ?? `v${n}`,
    title: "Untitled", description: "", channelId: "c", channelTitle: "Chan",
    publishedAt: new Date(Date.now() - 10 * 86400e3).toISOString(),
    durationSec: 1500, thumbnails: {},
    viewCount: 1000, likeCount: 50, commentCount: 10,
    defaultLanguage: "en", categoryIds: [], matchedQueries: ["q"],
    fetchedAt: Date.now(), ...over,
  };
};

const verdictsFor = (vs: VideoItem[]) => {
  const m = new Map<string, HeuristicVerdict>();
  vs.forEach((v) =>
    m.set(v.id, heuristicAnalyze({ title: v.title, description: v.description, durationSec: v.durationSec }))
  );
  return m;
};

// ── Taxonomy ────────────────────────────────────────────────────────

describe("taxonomy", () => {
  it("covers all seven required areas", () => {
    expect(ALL_CATEGORY_IDS.sort()).toEqual(
      ["ai", "business", "focus", "health", "knowledge", "markets", "wealth"]
    );
  });

  it("every category has curated queries, topics and relevance rules", () => {
    for (const c of CATEGORIES) {
      expect(c.queries.length).toBeGreaterThanOrEqual(8);
      expect(c.topics.length).toBeGreaterThanOrEqual(6);
      expect(c.relevance.include).toBeInstanceOf(RegExp);
      expect(c.relevance.exclude).toBeInstanceOf(RegExp);
      expect(c.blurb.length).toBeGreaterThan(20);
    }
  });

  it("queries are phrased for instruction, not hype", () => {
    const all = CATEGORIES.flatMap((c) => c.queries);
    const instructional = all.filter((q) =>
      /explained|tutorial|course|guide|case study|documentary|fundamentals|breakdown|walkthrough|lecture|review|how/i.test(q)
    );
    expect(instructional.length / all.length).toBeGreaterThan(0.9);
    expect(all.some((q) => /get rich|guaranteed|overnight/i.test(q))).toBe(false);
  });

  it("rising topics all reference real categories", () => {
    RISING_TOPICS.forEach((t) => expect(CATEGORY_MAP[t.cat]).toBeDefined());
  });
});

// ── Deterministic relevance ─────────────────────────────────────────

describe("category relevance filters", () => {
  const cases: [CategoryId, string, boolean][] = [
    ["health", "Protein Intake Science Explained: What Research Shows", true],
    ["health", "Bitcoin price prediction this week", false],
    ["ai", "Build a SaaS from scratch with Next.js — full course", true],
    ["ai", "My morning routine vlog", false],
    ["markets", "Risk Management for Traders: Position Sizing Explained", true],
    ["markets", "Best protein powder review", false],
    ["business", "How I Built a $2M Agency — business model breakdown", true],
    ["focus", "Deep Work: the neuroscience of attention explained", true],
    ["focus", "Lofi beats to study to", false],
    ["knowledge", "Skool community business model explained", true],
    ["wealth", "Index Fund Investing Explained for Beginners", true],
  ];

  it.each(cases)("%s ← %s = %s", (cat, title, expected) => {
    expect(matchesCategory(cat, title, "")).toBe(expected);
  });

  it("excludes signal-selling from Markets even though it is topical", () => {
    expect(
      matchesCategory("markets", "Join my telegram signals group — copy my trades", "crypto trading")
    ).toBe(false);
  });

  it("excludes miracle-cure content from Health even though it is topical", () => {
    expect(
      matchesCategory("health", "This miracle cure melts fat overnight", "weight loss diet")
    ).toBe(false);
  });

  it("excludes study-music from Focus", () => {
    expect(matchesCategory("focus", "3 hour study with me lofi", "focus concentration")).toBe(false);
  });

  it("matchCategories can return several genuine categories", () => {
    const cats = matchCategories(
      "How I built a SaaS business — revenue breakdown",
      "Software startup case study with real customer numbers."
    );
    expect(cats).toContain("ai");
    expect(cats).toContain("business");
  });

  it("returns [] for genuinely off-topic content", () => {
    expect(matchCategories("Cute puppy compilation", "funny dogs")).toEqual([]);
  });

  it("topicalStrength rewards instructional framing and rejects excluded text", () => {
    const weak = topicalStrength("ai", "Some thoughts on software", "");
    const strong = topicalStrength("ai", "AI Agents Explained: Full Tutorial", "build from scratch");
    expect(strong).toBeGreaterThan(weak);
    expect(topicalStrength("health", "Miracle cure for diabetes", "nutrition")).toBe(-1);
  });
});

describe("filterByCategory", () => {
  it("keeps on-topic videos and drops off-topic ones", () => {
    const onTopic = video({ id: "on", title: "Sleep science explained by a researcher" });
    const offTopic = video({ id: "off", title: "Top 10 movie trailers" });
    const out = filterByCategory("health", [onTopic, offTopic]).map((v) => v.id);
    expect(out).toEqual(["on"]);
  });

  it("trusts an explicit categoryId assigned at discovery time", () => {
    const tagged = video({ id: "t", title: "Ambiguous title", categoryIds: ["focus"] });
    expect(filterByCategory("focus", [tagged])).toHaveLength(1);
  });

  // Regression: discovery must not blanket-tag every search result with
  // the category it was searched under, or the relevance gate is a no-op.
  it("off-topic results are not tagged with the searched category", () => {
    const offTopic = {
      title: "Top 10 funniest fails compilation",
      description: "comedy clips",
    };
    const belongs = matchesCategory("health", offTopic.title, offTopic.description);
    const tags = belongs
      ? Array.from(new Set(["health", ...matchCategories(offTopic.title, offTopic.description)]))
      : matchCategories(offTopic.title, offTopic.description);
    expect(tags).not.toContain("health");
    expect(filterByCategory("health", [video({ categoryIds: tags as CategoryId[], ...offTopic })])).toHaveLength(0);
  });
});

// ── Feed construction & provenance ──────────────────────────────────

describe("buildCategorySections", () => {
  const vids = [
    video({ id: "a", title: "AI agents explained full tutorial", viewCount: 9000, likeCount: 900, commentCount: 90 }),
    video({ id: "b", title: "Build a SaaS from scratch course", viewCount: 50_000, likeCount: 100, commentCount: 800 }),
    video({ id: "c", title: "LLM fundamentals explained", viewCount: 300, likeCount: 5000, commentCount: 5 }),
  ];
  const verdicts = verdictsFor(vids);
  const sections = buildCategorySections("ai", vids, verdicts);

  it("produces exactly the five required feeds", () => {
    expect(sections.map((s) => s.id)).toEqual([...SECTION_IDS]);
    expect(sections.map((s) => s.title)).toEqual([
      "Curated picks", "Most Viewed", "Most Liked", "Most Discussed", "Recently Published",
    ]);
  });

  it("labels provenance on every feed", () => {
    const byId = Object.fromEntries(sections.map((s) => [s.id, s.basis]));
    expect(byId.editorial).toBe("editorial");
    expect(byId.views).toBe("statistic");
    expect(byId.likes).toBe("statistic");
    expect(byId.comments).toBe("statistic");
    expect(byId.recent).toBe("recency");
    sections.forEach((s) => expect(s.note.length).toBeGreaterThan(20));
    expect(BASIS_LABEL.editorial).toMatch(/Editorial/);
    expect(BASIS_LABEL.statistic).toMatch(/YouTube/);
  });

  it("orders statistic feeds by the raw API field only", () => {
    const find = (id: string) => sections.find((s) => s.id === id)!;
    expect(find("views").videos.map((v) => v.id)).toEqual(["b", "a", "c"]);
    expect(find("likes").videos.map((v) => v.id)).toEqual(["c", "a", "b"]);
    expect(find("comments").videos.map((v) => v.id)).toEqual(["b", "a", "c"]);
  });

  it("omits videos with hidden counts instead of treating them as zero", () => {
    const withHidden = [...vids, video({ id: "hid", title: "AI explained", likeCount: null })];
    const s = buildCategorySections("ai", withHidden, verdictsFor(withHidden));
    const likes = s.find((x) => x.id === "likes")!;
    expect(likes.videos.map((v) => v.id)).not.toContain("hid");
    expect(likes.caveat).toMatch(/1 video omitted/);
    // …but it still appears where the data exists.
    expect(s.find((x) => x.id === "views")!.videos.map((v) => v.id)).toContain("hid");
  });

  it("has no caveat when every count is present", () => {
    expect(sections.find((s) => s.id === "views")!.caveat).toBeUndefined();
  });

  it("recency feed is ordered by publishedAt", () => {
    const older = video({ id: "old", title: "AI explained", publishedAt: new Date(Date.now() - 400 * 86400e3).toISOString() });
    const newer = video({ id: "new", title: "AI explained", publishedAt: new Date().toISOString() });
    const s = buildCategorySections("ai", [older, newer], verdictsFor([older, newer]));
    expect(s.find((x) => x.id === "recent")!.videos[0].id).toBe("new");
  });
});

// ── Editorial independence from popularity ──────────────────────────

describe("editorial ranking is independent of YouTube statistics", () => {
  it("ignores view/like/comment counts entirely", () => {
    const base = {
      title: "AI agents explained — full step by step tutorial",
      description: "Evidence-based walkthrough. Covers risks and limitations.",
      durationSec: 2600,
    };
    const lowStats = video({ id: "low", ...base, viewCount: 1, likeCount: 0, commentCount: 0 });
    const highStats = video({ id: "high", ...base, viewCount: 9_000_000, likeCount: 500_000, commentCount: 90_000 });
    const vs = [lowStats, highStats];
    const ranked = rankEditorial("ai", vs, verdictsFor(vs)).map((v) => v.id);

    // Identical editorially ⇒ popularity must not break the tie.
    const reversed = rankEditorial("ai", [highStats, lowStats], verdictsFor(vs)).map((v) => v.id);
    expect(ranked).toEqual(["low", "high"]);
    expect(reversed).toEqual(["high", "low"]);
  });

  it("ranks a high-quality low-view video above a thin high-view video", () => {
    const quality = video({
      id: "quality",
      title: "Risk Management Explained: Full Course on Position Sizing",
      description: "Evidence-based. We cover mistakes, limitations and realistic expectations.",
      durationSec: 3000, viewCount: 500,
    });
    const thin = video({
      id: "thin",
      title: "Crypto millionaire reveals secret money method",
      description: "Link in description. Limited time!",
      durationSec: 300, viewCount: 5_000_000,
    });
    const vs = [thin, quality];
    expect(rankEditorial("markets", vs, verdictsFor(vs))[0].id).toBe("quality");
  });

  it("pushes locally flagged unsafe content to the bottom", () => {
    const ok = video({ id: "ok", title: "Trading risk management explained full course" });
    const bad = video({ id: "bad", title: "Guaranteed returns — make $5000 per day trading" });
    const vs = [bad, ok];
    expect(rankEditorial("markets", vs, verdictsFor(vs))[0].id).toBe("ok");
  });

  it("prefers the more topically relevant video for the category", () => {
    const onTopic = video({ id: "on", title: "Nutrition science explained: full research review" });
    const tangential = video({ id: "tan", title: "My thoughts on health", description: "health" });
    const vs = [tangential, onTopic];
    expect(rankEditorial("health", vs, verdictsFor(vs))[0].id).toBe("on");
  });
});
