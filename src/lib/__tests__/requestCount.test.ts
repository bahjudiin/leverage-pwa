// Verifies the published request map in docs/API-AUDIT.md is accurate:
// counts real calls + quota units for each user action, through the
// actual discovery code paths (not mocks of our own logic).

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { loadCategoryFeed, loadHome, runSearch } from "../discover";
import { __resetCoordinator, clearQuotaBlock, getUsage } from "../apiClient";
import { clearApiCaches } from "../storage";
import type { Settings } from "../../types";

class MemStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return Array.from(this.m.keys())[i] ?? null; }
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

const SETTINGS: Settings = {
  theme: "dark", ytKey: "KEY", geminiKey: "",
  aiEnabled: false, aiAutoAnalyze: false, aiDailyBudget: 20,
  minDurationSec: 600, window: "30d", region: "US", language: "en",
  cats: ["wealth", "business", "ai", "markets", "health", "focus", "knowledge"],
  blockedChannels: [], blockedKeywords: [], onboardingDone: true,
};

interface Counts { search: number; videos: number; chart: number }
let counts: Counts;

function installNetwork() {
  counts = { search: 0, videos: 0, chart: 0 };
  const fetchMock = vi.fn(async (url: string) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/search")) {
      counts.search++;
      const n = Number(u.searchParams.get("maxResults") ?? 10);
      return json({ items: Array.from({ length: n }, (_, i) => ({ id: { videoId: `s${counts.search}_${i}` } })) });
    }
    if (u.searchParams.get("chart") === "mostPopular") {
      counts.chart++;
      return json({ items: [item("chart0", "Investing explained fundamentals")] });
    }
    counts.videos++;
    const ids = (u.searchParams.get("id") ?? "").split(",").filter(Boolean);
    return json({ items: ids.map((id) => item(id, "Business model breakdown case study explained")) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const json = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body } as unknown as Response);

const item = (id: string, title: string) => ({
  id,
  snippet: {
    publishedAt: "2024-06-01T00:00:00Z",
    channelId: "c", channelTitle: "Chan",
    title, description: "A full tutorial explained step by step.",
    thumbnails: { medium: { url: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` } },
    defaultAudioLanguage: "en",
  },
  contentDetails: { duration: "PT28M00S" },
  statistics: { viewCount: "1000", likeCount: "100", commentCount: "10" },
});

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemStorage());
  __resetCoordinator();
  clearQuotaBlock();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("documented request counts", () => {
  it("cold Home load = 3 search + 1 chart + 1 videos batch = 302 units", async () => {
    installNetwork();
    await loadHome({ key: "KEY", settings: SETTINGS }, true);
    expect(counts.search).toBe(3);   // capped at 3 interests, not 7
    expect(counts.chart).toBe(1);
    expect(counts.videos).toBe(1);   // all ids batched into ONE call
    expect(getUsage().units).toBe(3 * 100 + 1 + 1);
  });

  it("second Home load within TTL = 0 requests", async () => {
    installNetwork();
    await loadHome({ key: "KEY", settings: SETTINGS }, true);
    const after = { ...counts };
    const unitsAfter = getUsage().units;

    await loadHome({ key: "KEY", settings: SETTINGS }, false); // cached
    expect(counts).toEqual(after);
    expect(getUsage().units).toBe(unitsAfter);
  });

  it("opening a category = 2 search + 1 videos batch = 201 units", async () => {
    installNetwork();
    await loadCategoryFeed("health", { key: "KEY", settings: SETTINGS }, true);
    expect(counts.search).toBe(2);
    expect(counts.videos).toBe(1);
    expect(getUsage().units).toBe(201);
  });

  it("re-opening the same category = 0 requests", async () => {
    installNetwork();
    await loadCategoryFeed("health", { key: "KEY", settings: SETTINGS }, true);
    const before = { ...counts };
    await loadCategoryFeed("health", { key: "KEY", settings: SETTINGS }, false);
    expect(counts).toEqual(before);
  });

  it("switching categories only costs for each NEW category", async () => {
    installNetwork();
    await loadCategoryFeed("ai", { key: "KEY", settings: SETTINGS }, true);
    await loadCategoryFeed("focus", { key: "KEY", settings: SETTINGS }, true);
    await loadCategoryFeed("ai", { key: "KEY", settings: SETTINGS }, false); // cached
    expect(counts.search).toBe(4);  // 2 per new category × 2
    expect(counts.videos).toBe(2);
  });

  it("a search = 1 search + 1 videos batch = 101 units; repeat = 0", async () => {
    installNetwork();
    await runSearch({ key: "KEY", settings: SETTINGS }, "deep work explained");
    expect(counts.search).toBe(1);
    expect(counts.videos).toBe(1);
    expect(getUsage().units).toBe(101);

    await runSearch({ key: "KEY", settings: SETTINGS }, "deep work explained");
    expect(counts.search).toBe(1); // cache hit
  });

  it("never requests a second page (no pageToken anywhere)", async () => {
    const f = installNetwork();
    await loadHome({ key: "KEY", settings: SETTINGS }, true);
    await loadCategoryFeed("wealth", { key: "KEY", settings: SETTINGS }, true);
    for (const call of f.mock.calls) {
      expect(new URL(call[0] as string).searchParams.get("pageToken")).toBeNull();
    }
  });

  it("every search requests long-form only (videoDuration set, type=video)", async () => {
    const f = installNetwork();
    await loadCategoryFeed("markets", { key: "KEY", settings: SETTINGS }, true);
    const searches = f.mock.calls
      .map((c) => new URL(c[0] as string))
      .filter((u) => u.pathname.endsWith("/search"));
    expect(searches.length).toBeGreaterThan(0);
    for (const u of searches) {
      expect(u.searchParams.get("type")).toBe("video");
      expect(u.searchParams.get("videoDuration")).toBe("medium");
      expect(Number(u.searchParams.get("maxResults"))).toBeLessThanOrEqual(25);
    }
  });

  it("cache expiry forces exactly one fresh round of calls", async () => {
    installNetwork();
    await loadCategoryFeed("focus", { key: "KEY", settings: SETTINGS }, true);
    const before = { ...counts };

    clearApiCaches();          // simulates TTL expiry / manual purge
    __resetCoordinator();      // clear the short suppression window too

    await loadCategoryFeed("focus", { key: "KEY", settings: SETTINGS }, false);
    expect(counts.search).toBe(before.search + 2);
    expect(counts.videos).toBe(before.videos + 1);
  });
});
