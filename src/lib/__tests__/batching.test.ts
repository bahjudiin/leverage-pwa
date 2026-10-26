import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { fetchVideoDetails, MAX_IDS_PER_BATCH } from "../youtube";
import { __resetCoordinator, clearQuotaBlock, getUsage } from "../apiClient";
import { enforceCacheBound, ttlSet, ttlGet, pruneExpired, clearApiCaches, MAX_CACHE_ENTRIES } from "../storage";

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

const ids = (n: number) => Array.from({ length: n }, (_, i) => `id${i}`);

function mockVideos() {
  return vi.fn(async (url: string) => {
    const idParam = new URL(url).searchParams.get("id") ?? "";
    const items = idParam.split(",").filter(Boolean).map((id) => ({ id }));
    return { ok: true, status: 200, json: async () => ({ items }) } as unknown as Response;
  });
}

describe("videos.list batching", () => {
  it("sends exactly one request for ≤50 IDs", async () => {
    const f = mockVideos();
    vi.stubGlobal("fetch", f);
    const out = await fetchVideoDetails("KEY", ids(50));
    expect(f).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(50);
    expect(getUsage().units).toBe(1);
  });

  it("splits 120 IDs into 3 batches = 3 units (not 120)", async () => {
    const f = mockVideos();
    vi.stubGlobal("fetch", f);
    const out = await fetchVideoDetails("KEY", ids(120));
    expect(f).toHaveBeenCalledTimes(3);
    expect(out).toHaveLength(120);
    expect(getUsage().units).toBe(3);
  });

  it("never exceeds MAX_IDS_PER_BATCH ids per request", async () => {
    const f = mockVideos();
    vi.stubGlobal("fetch", f);
    await fetchVideoDetails("KEY", ids(137));
    for (const c of f.mock.calls) {
      const n = new URL(c[0] as string).searchParams.get("id")!.split(",").length;
      expect(n).toBeLessThanOrEqual(MAX_IDS_PER_BATCH);
    }
  });

  it("deduplicates repeated IDs before batching", async () => {
    const f = mockVideos();
    vi.stubGlobal("fetch", f);
    await fetchVideoDetails("KEY", ["a", "a", "b", "b", "b", "c"]);
    expect(f).toHaveBeenCalledTimes(1);
    const sent = new URL(f.mock.calls[0][0] as string).searchParams.get("id");
    expect(sent).toBe("a,b,c");
  });

  it("returns [] without any request for an empty ID list", async () => {
    const f = mockVideos();
    vi.stubGlobal("fetch", f);
    expect(await fetchVideoDetails("KEY", [])).toEqual([]);
    expect(f).not.toHaveBeenCalled();
    expect(getUsage().units).toBe(0);
  });

  it("requests a trimmed `fields` mask and never sends pageToken", async () => {
    const f = mockVideos();
    vi.stubGlobal("fetch", f);
    await fetchVideoDetails("KEY", ids(3));
    const u = new URL(f.mock.calls[0][0] as string);
    expect(u.searchParams.get("fields")).toContain("items(id,snippet");
    expect(u.searchParams.get("pageToken")).toBeNull();
  });

  it("the same ID set in a different order reuses one cached dispatch", async () => {
    const f = mockVideos();
    vi.stubGlobal("fetch", f);
    await fetchVideoDetails("KEY", ["a", "b", "c"]);
    await fetchVideoDetails("KEY", ["c", "b", "a"]); // order-insensitive key
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("bounded local cache", () => {
  it("evicts oldest entries beyond MAX_CACHE_ENTRIES", () => {
    for (let i = 0; i < MAX_CACHE_ENTRIES + 15; i++) {
      ttlSet(`feed:${i}`, { i }, 60_000);
    }
    let cached = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith("lv:") && k.includes("feed:")) cached++;
    }
    expect(cached).toBeLessThanOrEqual(MAX_CACHE_ENTRIES);
  });

  it("never evicts user data (settings / library / usage)", () => {
    localStorage.setItem("lv:settings:v1", JSON.stringify({ theme: "dark" }));
    localStorage.setItem("lv:library:v1", JSON.stringify({ entries: { a: 1 } }));
    for (let i = 0; i < MAX_CACHE_ENTRIES + 25; i++) ttlSet(`f${i}`, { i }, 60_000);
    enforceCacheBound();
    expect(localStorage.getItem("lv:settings:v1")).toBeTruthy();
    expect(localStorage.getItem("lv:library:v1")).toBeTruthy();
  });

  it("expires entries past their TTL", () => {
    ttlSet("short", { a: 1 }, 5);
    expect(ttlGet("short")).not.toBeNull();
    vi.setSystemTime(Date.now() + 1000);
    expect(ttlGet("short")).toBeNull();
    vi.useRealTimers();
  });

  it("pruneExpired removes only expired envelopes", () => {
    ttlSet("keep", { a: 1 }, 10 * 60_000);
    ttlSet("drop", { a: 1 }, 1);
    vi.setSystemTime(Date.now() + 5_000);
    const removed = pruneExpired();
    expect(removed).toBe(1);
    expect(ttlGet("keep")).not.toBeNull();
    vi.useRealTimers();
  });

  it("clearApiCaches wipes caches but preserves user data", () => {
    localStorage.setItem("lv:settings:v1", "{}");
    ttlSet("a", 1, 60_000);
    ttlSet("b", 2, 60_000);
    const n = clearApiCaches();
    expect(n).toBeGreaterThanOrEqual(2);
    expect(localStorage.getItem("lv:settings:v1")).toBe("{}");
  });
});
