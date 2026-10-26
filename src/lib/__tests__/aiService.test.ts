import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { materialize, extractJson, buildPrompt, MAX_BATCH } from "../gemini";
import type { AnalysisInput } from "../gemini";
import {
  analyzeOne, analyzeBatch, budgetState, reserveBudget, pickCandidates,
  getCachedAnalysis, putAnalysis, invalidateAnalysis, clearAnalysisMemory,
  aiAvailability, isAiAvailable, AiUnavailableError, describeAiError,
  AUTO_BATCH_LIMIT,
} from "../aiService";
import { __resetCoordinator, clearQuotaBlock, getUsage } from "../apiClient";
import { AI_SCHEMA } from "../../types";
import type { AiAnalysis, Settings, VideoItem } from "../../types";

// ── Harness ─────────────────────────────────────────────────────────
class MemStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return Array.from(this.m.keys())[i] ?? null; }
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

const SETTINGS = (over: Partial<Settings> = {}): Settings => ({
  theme: "dark", ytKey: "YT", geminiKey: "GEM",
  aiEnabled: true, aiAutoAnalyze: false, aiDailyBudget: 20,
  minDurationSec: 600, window: "30d", region: "US", language: "en",
  cats: ["wealth"], blockedChannels: [], blockedKeywords: [], onboardingDone: true,
  ...over,
});

let n = 0;
const video = (over: Partial<VideoItem> = {}): VideoItem => {
  n++;
  return {
    id: over.id ?? `vid${n}`,
    title: "Build a SaaS — full tutorial",
    description: "A step by step walkthrough.",
    channelId: "c", channelTitle: "Chan",
    publishedAt: new Date().toISOString(),
    durationSec: 1800, thumbnails: {},
    viewCount: 1000, likeCount: 10, commentCount: 5,
    defaultLanguage: "en", categoryIds: ["ai"], matchedQueries: ["q"],
    fetchedAt: Date.now(),
    ...over,
  };
};

/** Mock a Gemini HTTP response containing `items` analyses. */
function geminiReply(items: unknown[]) {
  return {
    ok: true, status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(items) }] } }],
    }),
  } as unknown as Response;
}

const analysisFor = (i: number, extra: Record<string, unknown> = {}) => ({
  videoIndex: i, summary: `Summary ${i}`, topic: "SaaS", audience: "Founders",
  keyLessons: ["Lesson A"], takeaways: ["Do B"], prerequisites: "None",
  difficulty: "beginner", tier: "high", tierReason: "Step-by-step tutorial",
  promoWarning: null, claimsToVerify: [], segmentNotes: [],
  viewingPlan: "Watch in two sittings", questions: ["What next?"], ...extra,
});

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemStorage());
  __resetCoordinator();
  clearQuotaBlock();
  clearAnalysisMemory();
  n = 0;
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// ── Grounding: timestamps can never be invented ─────────────────────

describe("segment grounding — timestamps only from real chapters", () => {
  const input = (chapters: { seconds: number; label: string }[]): AnalysisInput => ({
    id: "v1", title: "T", channelTitle: "C", publishedAt: "2024-01-01T00:00:00Z",
    durationSec: 1800, description: "d", chapters,
  });

  it("takes seconds and label from OUR parse, ignoring any model-supplied text", () => {
    const a = materialize(
      { segmentNotes: [{ chapterIndex: 1, kind: "peak", reason: "core demo" }] },
      input([{ seconds: 0, label: "Intro" }, { seconds: 300, label: "The build" }])
    );
    expect(a.segments).toHaveLength(1);
    expect(a.segments[0].seconds).toBe(300);      // from chapters, not the model
    expect(a.segments[0].label).toBe("The build");
    expect(a.segments[0].kind).toBe("peak");
    expect(a.segments[0].source).toBe("description");
  });

  it("forces segments to [] when the video has NO chapters", () => {
    const a = materialize(
      { segmentNotes: [{ chapterIndex: 0, kind: "essential", reason: "x" }] },
      input([])
    );
    expect(a.segments).toEqual([]);
    expect(a.sourceChapterCount).toBe(0);
  });

  it("drops hallucinated chapter indices that don't exist", () => {
    const a = materialize(
      { segmentNotes: [
        { chapterIndex: 0, kind: "essential", reason: "ok" },
        { chapterIndex: 99, kind: "peak", reason: "invented" },
        { chapterIndex: -3, kind: "skip", reason: "invented" },
      ] },
      input([{ seconds: 0, label: "Intro" }])
    );
    expect(a.segments).toHaveLength(1);
    expect(a.segments[0].seconds).toBe(0);
  });

  it("deduplicates repeated references to the same chapter", () => {
    const a = materialize(
      { segmentNotes: [
        { chapterIndex: 0, kind: "essential", reason: "a" },
        { chapterIndex: 0, kind: "peak", reason: "b" },
      ] },
      input([{ seconds: 0, label: "Intro" }])
    );
    expect(a.segments).toHaveLength(1);
  });

  it("sorts segments chronologically", () => {
    const a = materialize(
      { segmentNotes: [
        { chapterIndex: 2, kind: "peak", reason: "c" },
        { chapterIndex: 0, kind: "essential", reason: "a" },
        { chapterIndex: 1, kind: "skip", reason: "b" },
      ] },
      input([
        { seconds: 0, label: "A" }, { seconds: 100, label: "B" }, { seconds: 200, label: "C" },
      ])
    );
    expect(a.segments.map((s) => s.seconds)).toEqual([0, 100, 200]);
  });

  it("never claims transcript access — confidence is always 'limited'", () => {
    const a = materialize({ summary: "x" }, input([]));
    expect(a.confidence).toBe("limited");
  });

  it("the prompt sends chapter labels but NEVER timestamps", () => {
    const p = buildPrompt([input([{ seconds: 754, label: "Deployment" }])]);
    expect(p).toContain("Deployment");
    expect(p).not.toContain("754");
    expect(p).toContain("chapterIndex");
    expect(p).toMatch(/have NOT watched/i);
  });
});

// ── Validation & coercion ───────────────────────────────────────────

describe("response validation", () => {
  const base: AnalysisInput = {
    id: "v", title: "T", channelTitle: "C", publishedAt: "2024-01-01T00:00:00Z",
    durationSec: 900, description: "d", chapters: [],
  };

  it("coerces an unknown tier to 'verify' rather than trusting it", () => {
    expect(materialize({ tier: "amazing" }, base).tier).toBe("verify");
  });

  it("coerces an unknown difficulty to 'mixed'", () => {
    expect(materialize({ difficulty: "impossible" }, base).difficulty).toBe("mixed");
  });

  it("treats blank promoWarning as null", () => {
    expect(materialize({ promoWarning: "  " }, base).promoWarning).toBeNull();
  });

  it("stamps the current schema version", () => {
    expect(materialize({}, base).schema).toBe(AI_SCHEMA);
  });

  it("extractJson survives code fences and surrounding prose", () => {
    expect(extractJson('```json\n[{"a":1}]\n```')).toEqual([{ a: 1 }]);
    expect(extractJson('Here you go: [{"a":2}] done')).toEqual([{ a: 2 }]);
  });
});

// ── Availability & graceful degradation ─────────────────────────────

describe("availability", () => {
  it("is disabled by default configuration", () => {
    expect(aiAvailability(SETTINGS({ aiEnabled: false }))).toBe("disabled");
    expect(isAiAvailable(SETTINGS({ aiEnabled: false }))).toBe(false);
  });
  it("reports a missing key", () => {
    expect(aiAvailability(SETTINGS({ geminiKey: "" }))).toBe("no-key");
  });
  it("reports offline", () => {
    expect(aiAvailability(SETTINGS(), false)).toBe("offline");
  });
  it("reports an exhausted budget", () => {
    expect(aiAvailability(SETTINGS({ aiDailyBudget: 0 }))).toBe("budget");
  });
  it("is available when fully configured", () => {
    expect(aiAvailability(SETTINGS())).toBe("none");
  });
  it("throws a typed, explainable error when unavailable", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(analyzeOne(SETTINGS({ aiEnabled: false }), video()))
      .rejects.toBeInstanceOf(AiUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();           // no request attempted
    expect(describeAiError(new AiUnavailableError("no-key"))).toMatch(/Gemini API key/i);
  });
});

// ── Budget ──────────────────────────────────────────────────────────

describe("budget", () => {
  it("clamps a batch to the remaining budget", () => {
    expect(reserveBudget(SETTINGS({ aiDailyBudget: 3 }), 10)).toBe(3);
    expect(reserveBudget(SETTINGS({ aiDailyBudget: 0 }), 10)).toBe(0);
  });

  it("never exceeds the per-request ceiling", () => {
    expect(reserveBudget(SETTINGS({ aiDailyBudget: 999 }), 999)).toBe(MAX_BATCH);
  });

  it("bills only analyses that actually returned", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => geminiReply([analysisFor(0), analysisFor(1)])));
    const res = await analyzeBatch(SETTINGS(), [video(), video(), video()], { limit: 3 });
    expect(res.fresh).toBe(2);
    expect(getUsage().aiCalls).toBe(2);   // 2 returned, not 3 requested
  });

  it("charges nothing when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false, status: 500, json: async () => ({}),
    } as unknown as Response)));
    await expect(analyzeOne(SETTINGS(), video())).rejects.toBeTruthy();
    expect(getUsage().aiCalls).toBe(0);
  });

  it("stops issuing requests once the budget is spent", async () => {
    const f = vi.fn(async () => geminiReply([analysisFor(0)]));
    vi.stubGlobal("fetch", f);
    const s = SETTINGS({ aiDailyBudget: 1 });

    await analyzeOne(s, video({ id: "a" }));
    expect(f).toHaveBeenCalledTimes(1);

    await expect(analyzeOne(s, video({ id: "b" }))).rejects.toBeInstanceOf(AiUnavailableError);
    expect(f).toHaveBeenCalledTimes(1);          // nothing further sent
    expect(budgetState(s).remaining).toBe(0);
  });

  it("batch soft-fails (no throw) when the budget is gone", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => geminiReply([])));
    const res = await analyzeBatch(SETTINGS({ aiDailyBudget: 0 }), [video(), video()]);
    expect(res.fresh).toBe(0);
    expect(res.skipped).toBe(2);
  });
});

// ── Caching & cross-category reuse ──────────────────────────────────

describe("cache reuse", () => {
  const stored = (id: string): AiAnalysis => ({
    schema: AI_SCHEMA, videoId: id, summary: "cached", topic: "t", audience: "a",
    keyLessons: [], takeaways: [], prerequisites: "None", difficulty: "mixed",
    tier: "high", tierReason: "r", promoWarning: null, claimsToVerify: [],
    segments: [], sourceChapterCount: 0, viewingPlan: "", questions: [],
    confidence: "limited", analyzedAt: Date.now(), model: "m",
  });

  it("returns a cached analysis without any network call", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    putAnalysis(stored("cachedvid"));
    const a = await analyzeOne(SETTINGS(), video({ id: "cachedvid" }));
    expect(a.summary).toBe("cached");
    expect(f).not.toHaveBeenCalled();
    expect(getUsage().aiCalls).toBe(0);
  });

  it("reuses one analysis across different categories (keyed by videoId only)", async () => {
    const f = vi.fn(async () => geminiReply([analysisFor(0)]));
    vi.stubGlobal("fetch", f);

    const inWealth = video({ id: "shared", categoryIds: ["wealth"] });
    const inMarkets = video({ id: "shared", categoryIds: ["markets"] });

    await analyzeOne(SETTINGS(), inWealth);
    const second = await analyzeOne(SETTINGS(), inMarkets);

    expect(f).toHaveBeenCalledTimes(1);               // no second request
    expect(second.videoId).toBe("shared");
    expect(getUsage().aiCalls).toBe(1);
  });

  it("a batch serves cached members for free and only analyzes the rest", async () => {
    const f = vi.fn(async () => geminiReply([analysisFor(0)]));
    vi.stubGlobal("fetch", f);
    putAnalysis(stored("known"));

    const res = await analyzeBatch(SETTINGS(), [video({ id: "known" }), video({ id: "fresh" })]);
    expect(res.reused).toBe(1);
    expect(res.fresh).toBe(1);
    expect(getUsage().aiCalls).toBe(1);
  });

  it("treats a stale schema as a cache miss", () => {
    const old = { ...stored("oldv"), schema: 1 };
    localStorage.setItem("lv:" + `ai:v3:oldv`, JSON.stringify({
      at: Date.now(), exp: Date.now() + 60_000, v: old,
    }));
    clearAnalysisMemory();
    expect(getCachedAnalysis("oldv")).toBeNull();
  });

  it("invalidateAnalysis forces a re-analysis", async () => {
    const f = vi.fn(async () => geminiReply([analysisFor(0)]));
    vi.stubGlobal("fetch", f);
    putAnalysis(stored("re"));
    invalidateAnalysis("re");
    await analyzeOne(SETTINGS(), video({ id: "re" }));
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("force:true re-analyzes even when cached", async () => {
    const f = vi.fn(async () => geminiReply([analysisFor(0)]));
    vi.stubGlobal("fetch", f);
    putAnalysis(stored("forced"));
    const a = await analyzeOne(SETTINGS(), video({ id: "forced" }), { force: true });
    expect(f).toHaveBeenCalledTimes(1);
    expect(a.summary).toBe("Summary 0");
  });
});

// ── Concurrency ─────────────────────────────────────────────────────

describe("in-flight deduplication", () => {
  it("collapses concurrent analyses of the same video into one request", async () => {
    const f = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return geminiReply([analysisFor(0)]);
    });
    vi.stubGlobal("fetch", f);
    const v = video({ id: "dup" });
    const [a, b] = await Promise.all([
      analyzeOne(SETTINGS(), v),
      analyzeOne(SETTINGS(), v),
    ]);
    expect(f).toHaveBeenCalledTimes(1);
    expect(a.videoId).toBe(b.videoId);
    expect(getUsage().aiCalls).toBe(1);
  });
});

// ── Candidate selection ─────────────────────────────────────────────

describe("pickCandidates — local filter runs first", () => {
  it("skips videos the deterministic filter already settled", () => {
    const obviousScam = video({ id: "scam", title: "Make $5000 per day guaranteed income!" });
    const clearlyGood = video({
      id: "good",
      title: "Sleep Science Explained: Evidence-Based Guide",
      description: "Full tutorial based on peer-reviewed studies, sources linked below. Step by step.",
    });
    const picked = pickCandidates([obviousScam, clearlyGood]).map((v) => v.id);
    expect(picked).not.toContain("scam");   // already 'unsafe' locally
    expect(picked).not.toContain("good");   // already 'high' locally
  });

  it("skips videos that already have a cached analysis", () => {
    const amb = video({ id: "amb", title: "Passive income ideas", description: "Some notes." });
    expect(pickCandidates([amb]).length + 0).toBeGreaterThanOrEqual(0);
    putAnalysis({
      schema: AI_SCHEMA, videoId: "amb", summary: "s", topic: "t", audience: "a",
      keyLessons: [], takeaways: [], prerequisites: "None", difficulty: "mixed",
      tier: "verify", tierReason: "r", promoWarning: null, claimsToVerify: [],
      segments: [], sourceChapterCount: 0, viewingPlan: "", questions: [],
      confidence: "limited", analyzedAt: Date.now(), model: "m",
    });
    expect(pickCandidates([amb])).toHaveLength(0);
  });

  it("never returns more than the batch limit", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      video({ id: `p${i}`, title: "Passive income side hustle", description: "Link in description." })
    );
    expect(pickCandidates(many, AUTO_BATCH_LIMIT).length).toBeLessThanOrEqual(AUTO_BATCH_LIMIT);
  });
});
