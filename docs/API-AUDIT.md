# API Request Audit & Request Map

> Audit of every outbound request in the app, the defects found, and the exact
> request each user action triggers. No backend, no database — all coordination
> is client-side.

---

## 1. Complete inventory of outbound requests

There are exactly **two** `fetch()` call sites in the codebase, both funnelled
through the coordinator (`src/lib/apiClient.ts`):

| # | Endpoint | Cost (units) | Caller | Trigger |
|---|----------|--------------|--------|---------|
| 1 | `GET /youtube/v3/search` | **100** | `searchVideoIds()` | user opens/refreshes a feed, submits a search, taps a topic chip |
| 2 | `GET /youtube/v3/videos?id=…` | **1** / batch of ≤50 | `fetchVideoDetails()` | always paired with #1; also video-detail hydration |
| 3 | `GET /youtube/v3/videos?chart=mostPopular` | **1** | `fetchPopularEducation()` | Home load/refresh only |
| 4 | `GET /youtube/v3/commentThreads` | **1** | `fetchTopComments()` | **explicit button press only** |
| 5 | `POST generativelanguage…:generateContent` | n/a (own Gemini budget) | `aiService.analyzeOne/analyzeBatch` | manual "Analyze" / "Re-analyze" / "Analyze N", or budgeted auto-batch |

Non-API network traffic (never routed through the coordinator, never cached by
the SW): YouTube IFrame player script, thumbnail images (`i.ytimg.com`), fonts.

---

## 2. Defects found and fixed

| # | Severity | Defect | Fix |
|---|----------|--------|-----|
| D1 | **High** | `recordUsage()` fired *before* `fetchJson()`, so an in-flight-deduped call still billed 100 units to the ledger. Usage numbers over-reported. | Usage is now recorded **inside the coordinator at the moment of real network dispatch** only. Deduped/cached hits record nothing. |
| D2 | **High** | Dedup map was keyed by full URL and cleared in `finally` — two *sequential* identical calls (React StrictMode double-effect, fast remount) both hit the network. | Added a **post-resolution suppression window** (`DEDUPE_WINDOW_MS`): an identical request key resolved within the window is replayed from memory with zero network. |
| D3 | **High** | `quotaBlocked` lived only in React state. After a reload, the app immediately re-fired doomed 100-unit searches. | Quota block is **persisted** (`lv:quota:v1`) and auto-expires at the next Pacific-time reset. The coordinator **short-circuits before `fetch`** while blocked. |
| D4 | **High** | `useFeedLoader` never aborted on unmount — switching tabs/categories fast left orphan requests running and resolving into dead components. | Abort on unmount + abort previous request on every new load. |
| D5 | Medium | `fetchPopularEducation(...).catch(() => [])` in `loadHome` swallowed `QuotaError`, so the chart call could never trip the quota state. | Quota/auth errors now re-throw; only benign failures degrade to `[]`. |
| D6 | Medium | No burst ceiling. A scripted/rapid tap sequence could fire unbounded 100-unit searches. | **Rolling-window rate guard** (`MAX_SEARCH_PER_WINDOW` per 60 s) throws `RateGuardError` before dispatch. |
| D7 | Medium | Cache entry count was unbounded — only *expired* entries were pruned. localStorage could fill with stale feed payloads. | Bounded **LRU cap** (`MAX_CACHE_ENTRIES`) evicting oldest-written entries, plus existing TTL expiry. |
| D8 | Low | `commentThreads` was called directly from the component with no abort signal and no coordinator participation. | Routed through the coordinator with abort + dedup + accounting. |
| D9 | Low | No request observability; impossible to verify quota behaviour while developing. | **Dev-only** counter + grouped console log + `window.__LV_API__` inspector. Stripped from production builds via `import.meta.env.DEV`. |

### Verified-correct (no change needed)

- `videos.list` already batches ≤50 IDs per request with a trimmed `fields` mask.
- **No `pageToken` is ever sent.** Pagination is hard-capped at one page per query;
  there is no infinite scroll and no "load more" that walks pages.
- Quota (`403 quotaExceeded`) and auth (`400/401`) errors are **never retried**.
- No component fetches during render — every request originates in an effect or
  an event handler.
- No polling, no background refresh, no refetch-on-focus.

---

## 3. Request map — what each user action costs

`S` = `search.list` (100 units) · `V` = `videos.list` (1 unit) · `C` = `commentThreads` (1 unit)

| User action | Requests | Units | Notes |
|---|---|---|---|
| **Cold app launch (Home)** | 3×S + 1×V(batch) + 1×V(chart) | **302** | Only the first 3 selected interests search. Served from cache for 45 min after. |
| Launch again within 45 min | none | **0** | TTL cache hit, labelled "served from local cache". |
| **Home → Refresh button** | 3×S + 1×V + 1×V | **302** | Explicit user action only. |
| Switch Home → Explore → Home | none | **0** | Pool is in memory; suppression window + TTL prevent refetch. |
| **Open a category** (first time) | 2×S + 1×V | **201** | `relevance` + `viewCount` orderings, merged & deduped. |
| Re-open same category | none | **0** | TTL cache. |
| Switch category A → B → A rapidly | 2×S + 1×V per *new* category | 201 each | In-flight requests for A are **aborted**; returning to A within the window replays memory. |
| Change period/sort chips | none | **0** | Sorting and filtering are 100% client-side over the existing pool. |
| In-category text filter | none | **0** | Local string match. |
| **Tap a sub-topic / rising-topic chip** | 1×S + 1×V | **101** | Nothing loads until tapped; tapping again untoggles with no request. |
| **Submit a search** | 1×S + 1×V | **101** | Identical query within 45 min = 0 (cache). |
| Open video from a loaded feed | none | **0** | Metadata already in the pool. |
| Open video from Saved (snapshot only) | 1×V | **1** | One batched hydration call. |
| **Press "Load comments"** | 1×C | **1** | Never automatic. |
| Play / seek / chapter jump | none | **0** | Official IFrame player, no Data API involvement. |
| Save / hide / complete / block | none | **0** | localStorage only. |
| Export / import JSON | none | **0** | Local file I/O. |
| **"Analyze with Gemini"** (details) | 1 Gemini call | n/a | Manual. Cached hit = 0 calls. Deduped per videoId. |
| **"Re-analyze"** | 1 Gemini call | n/a | Explicitly discards the cached analysis first. |
| **"Analyze N"** (feed batch) | 1 Gemini call for ≤5 videos | n/a | Manual; clamped to remaining daily budget. |
| Auto-analyze after discovery | ≤1 Gemini call (≤4 videos) | n/a | **Off by default**; needs own key + opt-in + budget. |
| Opening an already-analyzed video | none | 0 | Cache is global by videoId — reused across all categories. |

**Daily default quota is 10,000 units.** A typical session (launch + 2 categories
+ 2 searches) ≈ 906 units ≈ 11 such sessions/day.

---

## 4. Caching policy (YouTube-compliant)

- **Only normalized metadata** is cached (IDs, titles, channel, counts, duration,
  thumbnail URLs). No audiovisual content is ever downloaded or stored.
- **Time-limited:** feeds/searches 45 min, popular chart 45 min, AI analyses 14 days.
- **Bounded:** hard LRU cap on entry count; oldest evicted first.
- **Versioned:** every cache key carries a schema version (`:v3:`); bumping the
  version orphans old data, which is then pruned.
- **Never presented as live:** every surface shows its snapshot time and flags
  cache-served data.
- User data (settings, library) is stored under separate keys that are never
  touched by cache eviction, and is excluded from "Clear API caches".

---

## 5. Dev-only instrumentation

In `npm run dev` only (`import.meta.env.DEV`):

```js
window.__LV_API__.summary()   // { total, byKind, units, deduped, cached, blocked }
window.__LV_API__.log         // chronological entries (API key redacted)
window.__LV_API__.reset()
```

Each dispatch logs one grouped console line:
`[api] search.list · 100u · 412ms · net` / `· dedup` / `· suppressed` / `· blocked`.

All of this is removed from production bundles by dead-code elimination.


---

## 6. Gemini analysis — cost & honesty model

**Entry point:** every analysis goes through `src/lib/aiService.ts`. The
Gemini HTTP layer (`gemini.ts`) is never called directly by a component.

**When a call can happen (all require `aiEnabled` + a user-supplied key):**

1. User presses **Analyze with Gemini** on a video detail screen.
2. User presses **Re-analyze** (invalidates the cached entry first).
3. User presses **Analyze N** on a feed — one batched request, ≤5 videos.
4. Post-discovery **auto-batch**, only if `aiAutoAnalyze` is explicitly on.

Nothing else triggers Gemini. There is no per-card, per-render, or
background analysis.

**Budget:** `aiDailyBudget` (default 20) is enforced with reserve/commit.
A batch is clamped to `min(candidates, remaining, MAX_BATCH=5)` and only
analyses that actually come back are billed — failures and aborts cost
nothing. The counter resets on the Pacific-time day boundary.

**Cache:** keyed by `videoId` alone, so one analysis is reused verbatim
across every category, Home, Explore, Saved, and the details screen.
TTL 14 days, schema-versioned (`AI_SCHEMA`); a stale schema is treated
as a miss rather than rendered with missing fields.

**Dedup:** an in-flight registry keyed by `videoId` means concurrent
requests for the same video — even from different screens, or one single
analysis overlapping a batch — share a single promise and a single bill.

**Grounding (why timestamps cannot be fabricated):**

- The prompt sends chapter **labels and indices only** — never times.
- The model returns a `chapterIndex`; `materialize()` looks the real
  `seconds` and `label` up from our own description parse.
- Unknown/out-of-range indices are dropped; duplicates are dropped.
- A video with **no** published chapters is forced to `segments: []`,
  and the UI states plainly that no verified seek points exist.
- `confidence` is hard-coded to `"limited"`, and the UI always says the
  analysis came from title + description (+ chapter labels), never from
  watching or a transcript.

**Degradation:** `aiAvailability()` returns `disabled | no-key | offline |
budget | none`, and the UI renders the matching explanation plus a route
into Settings. With AI off — the default — the app runs entirely on the
deterministic local quality filter and makes zero Gemini requests.

---

## 7. Pre-delivery audit (final)

**Verification run:** `tsc --noEmit` clean · **157 tests / 10 files passing** ·
production build clean (383.64 kB, 116.37 kB gzip).

### Defects found and fixed in this audit

| # | Severity | Finding | Fix |
|---|---|---|---|
| F1 | **High** | No `.gitignore` — `node_modules/`, `dist/`, and any future `.env` were committable. | Added `.gitignore` (ignores `.env*`, allows `.env.example`) + documented `.env.example`. |
| F2 | **High** | Blocked channels/keywords could not be removed by keyboard: an `<svg onClick>` inside a non-interactive `<span>`. | Replaced with real `<button aria-label>` elements. |
| F3 | Medium | Explore's recent-search chip nested a clickable `<X>` inside a `<button>` (invalid HTML; delete unreachable by keyboard). | Split into two sibling buttons inside a styled wrapper. |
| F4 | Medium | Both PWA icons were **1600×1600** while the manifest declared 192×192 / 512×512; the "maskable" entry reused the full-bleed icon so Android would crop the glyph. | Resized to true dimensions (58 kB → 2.9/12.9 kB) and generated a dedicated maskable icon with a 76% safe zone. |
| F5 | Low | `VITE_GEMINI_API_KEY` was declared in `vite-env.d.ts` but never read — implied a shared production Gemini key was supported. | Removed the declaration; replaced with a comment explaining why it is deliberately unsupported. |
| F6 | Low | No guard against horizontal page scroll on narrow handsets. | `overflow-x: hidden` on `body`; per-component opt-in via `.snaprow`. |

### Verified behaviours

- **Real API contract** — live call to `googleapis.com` with an invalid key returns
  `400 / badRequest`; the coordinator maps it to `AuthError` and does **not** retry.
  The documented `403 quotaExceeded` envelope maps to `QuotaError`, persists the
  block, and short-circuits all later calls with zero network.
- **Request counts** (asserted, not assumed): cold Home = 3 search + 1 chart +
  **1 batched** videos call = 302 units; cached Home = 0; category = 201; repeat = 0;
  search = 101; repeat = 0. No `pageToken` is ever sent.
- **Shorts** — a 48 s Short with 2.5 M views is still excluded; the long-form floor
  is applied independently and is configurable.
- **Duplicates** — same video from two queries merges to one record (union of
  categories/queries); IDs deduped before the network; no feed renders a dupe.
- **Missing statistics** — omitted fields become `null`, never `0`; such videos are
  excluded from the affected statistic feed with a visible caveat, yet still appear
  in feeds whose data exists; `null` sorts last rather than as zero.
- **Chapters** — parsed exactly from a real description (`0:00/4:30/18:45/41:10` →
  `0/270/1125/2470`); timestamps beyond the true duration are discarded; a single
  stray time reference does not become a chapter list.
- **Gemini disabled** — default config (`aiEnabled: false`) issues zero AI requests;
  the only `generativelanguage` URL is reachable solely through `aiService`.

### Remaining limitations (honest)

1. **No authenticated live testing.** This environment has no valid YouTube key, so
   quota exhaustion and real search payloads were exercised against captured/
   documented response envelopes, not a live quota burn.
2. **Layout and install verified structurally, not visually.** No headless browser is
   available here, so 360 px behaviour was audited via the responsive class
   structure, and installability via manifest/icon/SW validity — not a rendered
   screenshot or a real install prompt.
3. **Offline uses system fonts.** The SW deliberately bypasses `googleapis.com`,
   which includes `fonts.googleapis.com`, so the webfont CSS is not cached. The
   shell renders offline with the system font fallback stack.
4. **Shorts detection remains heuristic** — the Data API exposes no Shorts flag.
5. **No transcripts** — the captions API requires OAuth, so AI confidence is
   permanently `"limited"`.
6. **No view velocity / trending score** — not computable compliantly; deliberately
   absent rather than approximated.
7. **A user-supplied Gemini key is exposed to that browser.** Unavoidable without a
   backend; disclosed in-app with a removal control.
