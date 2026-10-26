# Leverage — Signal Learning Feed

A mobile-first **PWA that discovers, filters, ranks, and organizes high-value long-form
educational YouTube videos** about: wealth & entrepreneurship · AI, SaaS & software ·
trading, crypto & risk · evidence-based health · focus & learning systems · and the
paid-knowledge economy (Whop / Skool / Udemy / Coursera & creator-led education).

It is a **curated learning feed** — not a YouTube clone, downloader, or trading tool.

---

## Architecture (read this first)

- **No backend. No server. No serverless functions. No database. No auth.**
- The browser calls the **official YouTube Data API v3** directly with a key you supply.
- **Gemini is optional and OFF by default** — enabled only with *your own* key, stored
  locally. (Shared production AI access would require a backend; this app deliberately
  does not have one, and stays fully functional without AI.)
- **Persistence = `localStorage` only**: settings, watchlist, progress, hidden
  videos/channels, export files, plus small versioned TTL caches for API responses and
  AI analyses (45 min / 14 days respectively).
- **PWA**: installable manifest + icons + service worker that caches the *application
  shell* only. It never caches API responses, thumbnails, or audiovisual content.
  Offline = shell + your library + notes. Fresh discovery / playback / AI need network.

## Honest-metrics policy

- View / like / comment counts are **raw snapshot fields** from the API. Every feed shows
  its snapshot time; cached data is labeled as cached.
- **No derived metrics** (no engagement ratios, no composite scores, no "velocity").
  "Trending Now" is the **official `chart=mostPopular` Education ranking** (filtered to
  your topics), labeled as a snapshot — not claimed to be real-time.
- Quality badges ("High value", "Verify", "Promotional", "Low", "Misleading") come from a
  **transparent local heuristic filter** (every reason is shown) and optionally Gemini.
  Gemini judgments are labeled **provisional** and its confidence is always **"limited"**
  because a backend-free app cannot access transcripts (captions API requires OAuth).
  The AI is never told it "watched" a video, and **section timestamps can only come from
  real description chapters** — fabricated timelines are impossible by construction.

## API setup

### 1. YouTube Data API v3 (required)
1. Go to [Google Cloud Console](https://console.cloud.google.com) → create a project.
2. **APIs & Services → Library** → enable **YouTube Data API v3**.
3. **Credentials → Create credentials → API key.**
4. **Restrict the key**: API restriction = *YouTube Data API v3 only*; for production add
   an **HTTP-referrer restriction** for your domain.
5. Supply the key either:
   - pasted into the app's first-run screen / Settings (stored on-device only), or
   - at build time via `VITE_YOUTUBE_API_KEY=...` (⚠️ bundled env vars are **public** —
     they are *not* secrets; restriction is what protects your quota).

### 2. Gemini (optional, off by default)
- Create a key at [Google AI Studio](https://aistudio.google.com), paste it in
  **Settings → Gemini**. Keep a spend cap on it. Remove it any time.
- Risk disclosure shown in-app: a browser-resident key can be observed on the device /
  in traffic — hence *your own* key, never a shared one.

## Quota discipline

`search.list` (100 units) runs **only** on explicit user actions: opening/refreshing a
feed, searching, tapping a topic. `videos.list` (1 unit) batches up to 50 IDs with trimmed
`fields`. No polling, no background refresh, no per-card AI calls (one batch call, budgeted,
deduped, cached). Quota errors surface a dedicated state instead of retrying. An on-device
usage ledger estimates daily spend (Settings → Data & cache).

## Features

| Implemented | Notes |
|---|---|
| Home sections | For You · Trending (official chart) · Popular This Week · Most Viewed/Liked/Discussed · Recently Published · Deep Dives · Evergreen · Continue Learning · Rising Topics (tap-to-load) |
| 6 category feeds | Curated educational query packs + sub-topic discovery + in-feed local search + period/sort filters |
| Explore | User-initiated search, recent searches (local), window + raw-stat sort |
| Video details | Official embedded player (facade → user-initiated), progress + resume, raw stats, local quality panel with reasons, **Efficient viewing** (peak / essential / skip sections + full chapter list), AI guide (summary, lessons, takeaways, promo warning, viewing plan, questions, provisional tier), re-analyze, opt-in top comments (1 unit) |
| Library | Saved / In-progress / Completed / Hidden — all local, works offline |
| Filters | Min duration (Shorts always excluded via duration + hashtag + API filter), period (24h/7d/30d/all), sort by raw views/likes/comments/date/duration, language, region, blocked channels/keywords |
| AI analysis (optional) | Off by default. Own key only. Budgeted (reserve/commit, failures cost nothing), batched ≤5, deduped per videoId, cached 14 days and **reused across all categories**. Seek points derive only from creator-published chapters — never invented. |
| Clickbait filter | Deterministic, explainable rules (income guarantees, cure claims, multiplier hype, urgency, affiliate funnels…) with visible evidence lists |
| Export/Import | JSON backup of settings + library (**never includes API keys**) |
| PWA | Manifest, icons (192/512 maskable), service-worker shell, update prompt, offline indicator |

**Known limitations (stated, not worked around):** no transcripts (no OAuth), no view
velocity/trending math, no YouTube-wide category rankings, no Shorts *flag* in the API
(hence heuristics), videos "about Whop/Skool/Udemy" are not implied to be official
products on those platforms, and AI classifications are provisional signals — not fact checks.

## Development

```bash
npm install
npm run dev        # local dev
npm run build      # production build → dist/
npx vitest run     # 157 tests (coordinator, quota, cache, Shorts, dupes,
                   # chapters, categories, AI budget/grounding, request counts)
```

## Deploy to Vercel

1. Push this repo and import it in Vercel (framework preset **Vite**, `vercel.json` included —
   SPA rewrites + correct `sw.js`/manifest headers).
2. Optionally set `VITE_YOUTUBE_API_KEY` in project env (see warning above).
3. Add your deployment domain to the API key's HTTP-referrer restrictions.
4. Ship it — the service worker activates on first load and the app installs from the browser menu.

## Testing checklist covered

Request batching (`chunk`) · duplicate removal (`mergeVideos`) · Shorts exclusion · category
filters · cache TTL & pruning · chapter parsing · quality heuristics & false-positive guard ·
quota/auth error surfaces · AI-disabled mode (default) · missing stats → `null` rendering ·
settings & library persistence · offline shell via SW.