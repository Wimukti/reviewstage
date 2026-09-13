/* ReviewStage service worker.
 *
 * Scope: the whole origin (served from /sw.js, not /static/sw.js).
 *   - /api/*            network only. Never cached: every response is per-user, per-session
 *                       and often changes between two clicks (run status, posted markers).
 *   - /static/*, /icons/* cache-first. app.js/app.css are rebuilt per release; the cache is
 *                       keyed by VERSION and old caches are dropped on activate.
 *   - navigations       network-first, falling back to the cached shell, then offline.html.
 *
 * No push handler yet: web push needs VAPID keys on the server and a subscription store per
 * device — see docs/MOBILE.md. */
const VERSION = "rs-v1";
const SHELL = ["/", "/offline.html", "/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/static/") || url.pathname.startsWith("/icons/")) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }))
    );
    return;
  }

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put("/", copy));
        }
        return res;
      }).catch(async () =>
        (await caches.match("/")) || (await caches.match("/offline.html")) ||
        new Response("ReviewStage needs a connection to your server.", {
          status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" },
        })
      )
    );
  }
});
