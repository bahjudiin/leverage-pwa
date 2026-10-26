/* Leverage service worker — application shell only.
 *
 * Policy:
 *  - Caches the shell (HTML, manifest, icons) and font files.
 *  - NEVER caches YouTube Data API / Gemini responses, thumbnails,
 *    or any audiovisual media. Those bypass the cache entirely.
 *  - Offline promise: shell + your locally stored library work.
 *    Discovery, playback, and AI require connectivity.
 */
const VERSION = "leverage-shell-v4";
const SHELL_CACHE = VERSION;
const FONT_CACHE = "leverage-fonts-v1";

const SHELL_URLS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .catch(() => undefined)
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => ![SHELL_CACHE, FONT_CACHE].includes(k))
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never touch API traffic or YouTube media — pass through to network.
  if (
    /googleapis\.com$/.test(url.hostname) ||
    /(^|\.)ytimg\.com$/.test(url.hostname) ||
    /(^|\.)ggpht\.com$/.test(url.hostname) ||
    /(^|\.)googlevideo\.com$/.test(url.hostname) ||
    /(^|\.)youtube\.com$/.test(url.hostname)
  ) {
    return;
  }

  // Fonts: stale-while-revalidate (static, contains no user data).
  if (url.hostname === "fonts.gstatic.com") {
    event.respondWith(
      caches.open(FONT_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        const net = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || net;
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Navigations: network-first, fall back to cached shell offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put("/index.html", copy));
          return res;
        })
        .catch(() =>
          caches.match("/index.html").then((hit) => hit || caches.match("/"))
        )
    );
    return;
  }

  // Same-origin static assets: cache-first with runtime fill.
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
    )
  );
});
