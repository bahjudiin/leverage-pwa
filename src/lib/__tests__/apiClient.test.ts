import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  dispatch, __resetCoordinator, clearQuotaBlock, isQuotaBlocked, markQuotaBlocked,
  getUsage, redact, isTerminalError,
  QuotaError, AuthError, RateGuardError, ApiError,
  MAX_SEARCH_PER_WINDOW,
} from "../apiClient";

// ── localStorage shim ───────────────────────────────────────────────
class MemStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return Array.from(this.m.keys())[i] ?? null; }
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}
function errResponse(status: number, body: unknown) {
  return { ok: false, status, json: async () => body } as unknown as Response;
}

const QUOTA_BODY = { error: { message: "quotaExceeded", errors: [{ reason: "quotaExceeded" }] } };

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemStorage());
  __resetCoordinator();
  clearQuotaBlock();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const call = (key: string, kind: Parameters<typeof dispatch>[0]["kind"] = "videos.list", extra = {}) =>
  dispatch<{ ok: number }>({ key, kind, url: `https://example.test/${key}?key=SECRET`, ...extra });

describe("coordinator — in-flight deduplication", () => {
  it("shares one network call across concurrent identical requests", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return okResponse({ ok: calls });
    });
    vi.stubGlobal("fetch", fetchMock);

    const [a, b, c] = await Promise.all([call("same"), call("same"), call("same")]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it("does not dedupe distinct keys", async () => {
    const fetchMock = vi.fn(async () => okResponse({ ok: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    await Promise.all([call("a"), call("b")]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("coordinator — post-resolution suppression", () => {
  it("replays a just-resolved identical request without touching the network", async () => {
    const fetchMock = vi.fn(async () => okResponse({ ok: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    await call("k");               // network
    await call("k");               // suppressed
    await call("k");               // suppressed
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("force:true bypasses suppression (explicit Refresh)", async () => {
    const fetchMock = vi.fn(async () => okResponse({ ok: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    await call("k");
    await call("k", "videos.list", { force: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("coordinator — usage accounting", () => {
  it("bills only real network dispatches, never deduped/suppressed hits", async () => {
    const fetchMock = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return okResponse({ ok: 1 });
    });
    vi.stubGlobal("fetch", fetchMock);

    // 3 concurrent (1 network) + 1 suppressed replay = still 1 search billed.
    await Promise.all([
      call("s", "search.list"), call("s", "search.list"), call("s", "search.list"),
    ]);
    await call("s", "search.list");

    const u = getUsage();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(u.units).toBe(100);
    expect(u.searchCalls).toBe(1);
  });

  it("counts videos.list as 1 unit each", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResponse({ ok: 1 })));
    await call("v1");
    await call("v2");
    expect(getUsage().units).toBe(2);
    expect(getUsage().videoCalls).toBe(2);
  });
});

describe("coordinator — quota handling", () => {
  it("persists the block on 403 quotaExceeded and never retries", async () => {
    const fetchMock = vi.fn(async () => errResponse(403, QUOTA_BODY));
    vi.stubGlobal("fetch", fetchMock);

    await expect(call("q", "search.list")).rejects.toBeInstanceOf(QuotaError);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no retry
    expect(isQuotaBlocked()).toBe(true);
  });

  it("short-circuits later requests while blocked — zero network, zero units", async () => {
    markQuotaBlocked();
    const fetchMock = vi.fn(async () => okResponse({ ok: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(call("later", "search.list")).rejects.toBeInstanceOf(QuotaError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getUsage().units).toBe(0);
  });
});

describe("coordinator — auth errors", () => {
  it("throws AuthError without retrying on 400", async () => {
    const fetchMock = vi.fn(async () => errResponse(400, { error: { message: "API key not valid" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(call("bad")).rejects.toBeInstanceOf(AuthError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(isQuotaBlocked()).toBe(false); // auth failure must not block quota
  });
});

describe("coordinator — transient retry", () => {
  it("retries 500s with backoff then succeeds", async () => {
    let n = 0;
    const fetchMock = vi.fn(async () => {
      n++;
      return n < 3 ? errResponse(500, {}) : okResponse({ ok: 9 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(call("flaky")).resolves.toEqual({ ok: 9 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up after MAX_ATTEMPTS and surfaces ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => errResponse(503, {})));
    await expect(call("down")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("coordinator — rate guard", () => {
  it("blocks runaway search bursts locally without sending them", async () => {
    const fetchMock = vi.fn(async () => okResponse({ ok: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    for (let i = 0; i < MAX_SEARCH_PER_WINDOW; i++) {
      await call(`burst${i}`, "search.list");
    }
    expect(fetchMock).toHaveBeenCalledTimes(MAX_SEARCH_PER_WINDOW);

    await expect(call("overflow", "search.list")).rejects.toBeInstanceOf(RateGuardError);
    expect(fetchMock).toHaveBeenCalledTimes(MAX_SEARCH_PER_WINDOW); // nothing extra sent
  });

  it("does not rate-limit cheap videos.list calls", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResponse({ ok: 1 })));
    for (let i = 0; i < MAX_SEARCH_PER_WINDOW + 5; i++) {
      await expect(call(`cheap${i}`, "videos.list")).resolves.toBeTruthy();
    }
  });
});

describe("coordinator — abort", () => {
  it("propagates AbortError and does not cache the result", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
      return await new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener("abort", () => rej(new DOMException("Aborted", "AbortError")));
      });
    }));
    const ctrl = new AbortController();
    const p = dispatch({ key: "ab", kind: "videos.list", url: "https://x.test", signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("helpers", () => {
  it("redact() strips the API key from any logged string", () => {
    expect(redact("https://x/y?part=id&key=AIzaSUPERSECRET&q=a")).toBe(
      "https://x/y?part=id&key=REDACTED&q=a"
    );
  });

  it("isTerminalError identifies non-retryable failures", () => {
    expect(isTerminalError(new QuotaError())).toBe(true);
    expect(isTerminalError(new AuthError())).toBe(true);
    expect(isTerminalError(new RateGuardError())).toBe(true);
    expect(isTerminalError(new ApiError(500, "x"))).toBe(false);
  });
});
