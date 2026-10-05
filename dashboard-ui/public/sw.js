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
 *                       A gateway answer (502, 503, 504, or Cloudflare's 530 for a quick
 *                       tunnel whose Mac is asleep or whose app has quit) counts as no answer:
 *                       the person sees the app or "Your Mac isn't reachable", never a raw
 *                       error page (openspec/changes/desktop-always-on F5).
 *
 *   - push             shows the notification the server encrypted for this device (title,
 *                       one line, the page to open). A notification only ever opens a page.
 *   - notificationclick focuses an open window on that URL, or opens one. A URL on another
 *                       origin (the Mac's new address after a restart) always opens a new
 *                       window: this worker's origin is the old address. */
const VERSION = "rs-__BUILD__";
const SHELL = ["/", "/offline.html", "/manifest.webmanifest", "/icons/icon-192.png"];

// What a dead tunnel or a down proxy answers. 530 is Cloudflare's "origin unreachable"
// (error 1033): the Mac is asleep or ReviewStage quit.
const GATEWAY = new Set([502, 503, 504, 530]);

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
    const fallback = async () =>
      (await caches.match("/")) || (await caches.match("/offline.html")) ||
      new Response("Your Mac isn't reachable. Open ReviewStage there, or wake the Mac, and try again.", {
        status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    e.respondWith(
      fetch(req).then((res) => {
        if (GATEWAY.has(res.status)) return fallback();
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put("/", copy));
        }
        return res;
      }).catch(fallback)
    );
  }
});

// --- web push (bin/rs_push.py) ---------------------------------------------------------------
// The payload is the JSON rs_push.notify_payload builds: {title, body, url, tag}. `tag` makes
// a repeat for the same PR replace the earlier one instead of stacking. Both icons come from
// the manifest set, so they are already cached by the install step above.
self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data && e.data.text() }; }
  const title = data.title || "ReviewStage";
  const url = typeof data.url === "string" && data.url ? data.url : "/";
  e.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/maskable-192.png",
      tag: data.tag || undefined,
      renotify: !!data.tag,
      data: { url },
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin);
  const target = url.href;
  if (url.origin !== self.location.origin) {
    e.waitUntil(self.clients.openWindow(target));
    return;
  }
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const same = wins.find((w) => w.url === target) || wins.find((w) => "focus" in w);
      if (same && same.url === target) return same.focus();
      if (same && "navigate" in same) return same.navigate(target).then((w) => (w || same).focus());
      return self.clients.openWindow(target);
    })
  );
});
