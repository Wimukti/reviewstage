/* ReviewStage service worker.
 *
 * This file is a TEMPLATE. `__BUILD__` is replaced with the bundle fingerprint by
 * scripts/icons.mjs when the file is copied into bin/static, so VERSION changes on every
 * build whose output changed, and never otherwise. Do not hardcode a version here: the
 * previous one was a constant `rs-v1`, which made the activate handler below a no-op across
 * releases and left upgraded users staring at the old interface until they hard-reloaded.
 *
 * Scope: the whole origin (served from /sw.js, not /static/sw.js).
 *   - /api/*            network only. Never cached: every response is per-user, per-session
 *                       and often changes between two clicks (run status, posted markers).
 *   - fingerprinted bundle + /icons/*  cache-first. app-<hash>.js/.css cannot change under a
 *                       given URL, and the icons are rebuilt byte-identical from the same
 *                       logo, so both are safe to serve from the cache without asking.
 *   - other /static/*   network-first, cache fallback. Anything not fingerprinted (a bundle
 *                       from a build that skipped scripts/icons.mjs, offline.html, the
 *                       manifest) can change under a stable URL, so a reachable server always
 *                       wins and the cache only covers being offline.
 *   - navigations       network-first, falling back to the cached shell, then offline.html.
 *
 * No push handler yet: web push needs VAPID keys on the server and a subscription store per
 * device — see docs/MOBILE.md. */
const VERSION = "rs-__BUILD__";
const SHELL = ["/", "/offline.html", "/manifest.webmanifest", "/icons/icon-192.png"];

// Content-addressed: the hash is over the bytes, so one URL only ever has one body.
const IMMUTABLE = /^\/static\/app-[0-9a-f]{8,}\.(?:js|css)$/;

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

const keep = (req, res) => {
  if (res && res.ok) {
    const copy = res.clone();
    caches.open(VERSION).then((c) => c.put(req, copy));
  }
  return res;
};

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/icons/") || IMMUTABLE.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => keep(req, res)))
    );
    return;
  }

  if (url.pathname.startsWith("/static/")) {
    e.respondWith(
      fetch(req).then((res) => keep(req, res)).catch(async () =>
        (await caches.match(req)) ||
        new Response("", { status: 504, statusText: "offline" })
      )
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
