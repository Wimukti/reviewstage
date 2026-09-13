---
title: Mobile
description: PWA now, Capacitor later, and the device-token auth flow a mobile client needs.
sidebar:
  order: 4
---

A recommendation for iOS and Android, grounded in how ReviewStage actually works today:

- one **self-hosted server per team**, reached at a URL the team chooses;
- **GitHub OAuth (or a pasted fine-grained token) already completes server-side**, and a
  signed HMAC **session cookie** is the only credential the browser holds;
- each reviewer connects Claude **per user, via PKCE** to the genuine `claude setup-token` flow;
- every piece of data the UI shows or changes goes through **`/api/*` JSON**; the HTML shell
  is static and the React SPA does the rest.

Those four facts make the decision easy: the product is already an API plus a client. A mobile
strategy is a question of packaging that client, not of writing a second one.

## Recommendation in one paragraph

Ship the **PWA now** (done: manifest, root-scoped service worker, icons, phone-width layout).
When store presence or push notifications become a real ask from a paying team, wrap the **same
React build in Capacitor** for the App Store and Play Store, add a **device-token** path to the
server so the wrapper can hold a long-lived credential, and implement push as one more backend of
the `notify` abstraction. Do not write a React Native app; there is nothing in this UI that
needs native widgets, and a second codebase would immediately lag the web dashboard.

## Phase 1 (now): installable PWA

**What ships.** `dashboard-ui/public/manifest.webmanifest` (standalone display, the app's dark
palette, 192/512 + maskable icons generated from `assets/logo.png` by
`dashboard-ui/scripts/icons.mjs`), `public/sw.js` served from the origin root at `/sw.js`, an
`offline.html` fallback, and `src/mobile.css`, a sheet of media queries for phone widths. The
server exposes `/manifest.webmanifest`, `/sw.js`, `/offline.html` and `/icons/*` at the root;
everything else in `bin/static/` is unchanged.

**Caching policy.** Cache-first for `/static/*` and `/icons/*`; network-first for navigations
with the cached shell, then `offline.html`, as fallbacks; **`/api/*` is never cached**. API
responses are per-user, HMAC-signed action tokens expire in 30 minutes, and run status changes
between two clicks, so a cached API response would only ever be wrong. The worker is registered
from `main.tsx` in production bundles only, so `pnpm dev` never serves a stale shell.

**Why it is enough for most teams.** Installable from the browser on both platforms, zero
store friction, one codebase, and the whole sign-in story (GitHub token or OAuth, Claude
connect) is unchanged because the installed app is the same origin with the same cookie.
Team members already open the dashboard from a Slack card; on a phone that card now opens an
app-shaped window.

**Limits, honestly.**

- **iOS web push exists only for the home-screen app**, since iOS 16.4. A Safari tab gets
  nothing. Android Chrome delivers web push to tabs and installed apps alike.
- **No background sync** worth relying on. The queue refreshes when the app is foregrounded.
- **No push at all yet, on either platform.** Web push needs a VAPID key pair on the server,
  a per-device subscription store, and a `notify` backend that fans out to those subscriptions.
  None of that exists; it is the same work as Phase 2's push, so it is scheduled there rather
  than built twice.
- iOS Safari evicts storage for installed web apps that go unused for weeks; the session
  cookie may need a fresh sign-in after a long gap. Acceptable for a work tool.

**Effort.** Done in this change. Ongoing cost is near zero: the icon step runs inside
`pnpm build`, the e2e suite checks the served content types and phone-width overflow.

## Phase 2: Capacitor wrapper for store presence and native push

**What it is.** [Capacitor](https://capacitorjs.com) puts the *same* `bin/static` build inside
a native WebView shell with a small plugin bridge. The web app does not change; it gains
`window.Capacitor` and a handful of plugins.

**Why Capacitor over React Native or Expo here.**

- The dashboard is **forms and lists**: a queue, cards with checkboxes, markdown editors, a
  settings page. Nothing needs native scrolling physics, maps, camera or heavy animation. The
  WebView renders the existing app at full fidelity.
- **100% reuse.** One team, one codebase, one release train. A React Native app would be a
  second UI over the same API, and every feature (stack review, QA guides, Insights, the
  command palette) would land on web first and mobile later, or never.
- **The server is the product.** What a mobile client adds is presence (an icon, a badge,
  a notification), not capability. Capacitor gives exactly that at the lowest cost.

**When React Native / Expo would win instead.** If the mobile experience needed to diverge
from the web (a swipe-to-triage queue, offline review reading with local storage of diffs,
native diff rendering), or if the web dashboard were being retired in favour of mobile-first,
or if the team already had RN expertise and a design system in it. None of those hold today.

**Native pieces to add.**

| Piece | Plugin | Notes |
| --- | --- | --- |
| Push | `@capacitor/push-notifications` | FCM on Android, APNs on iOS. The device registers its token with the server (see Push, below). |
| Biometric unlock | `capacitor-native-biometric` or the OS keychain via `@capacitor/preferences` + Face ID prompt | Guards the stored **device token**, not the GitHub token, which never leaves the server. |
| In-app browser for sign-in | `@capacitor/browser` | `ASWebAuthenticationSession` on iOS, Custom Tabs on Android. Cookies of the system browser are available, so an existing GitHub session completes OAuth in one tap. |
| Deep links | `@capacitor/app` + associated domains / App Links | `reviewstage://pr?repo=owner/name&pr=123` opens the PR page; the same path as an `https://<server>/pr?...` link is registered as a universal link, so a Slack card works whether or not the app is installed. If the app is not installed the link is just the web URL and the PWA (or browser) opens it. |
| Badge count | `@capawesome/capacitor-badge` | Mirrors the "to review" count from `/api/queue`. |

**Multi-server.** Every team self-hosts, so the app cannot hard-code a URL. On first launch it
asks for the server URL (with `https://` assumed and `/health` probed before saving) and stores a
**list** of servers, each with its own device token. A picker in Settings switches between them;
deep links carry the host so they select the right one. The web build reads its base URL from
`window.location` today; under Capacitor it reads the selected server instead, which is a small
change to `src/api.ts` (one `base()` function) and nothing else.

**Effort.** Roughly two to three weeks for one engineer who knows the codebase, including the
Apple and Google developer-account plumbing, plus the server changes below, which are about
two days of Python and a Settings → Devices page. Store review is the long pole: budget a week
of calendar time for the first submission.

## Auth for a mobile client: the device-token flow

The constraint is the one that defines the product: **the app must sign in with GitHub once
and reuse the same server-side token for posting**, as the signed-in person. The GitHub token
never leaves the server; the client only ever proves who it is.

Today that proof is a session cookie set by `/oauth/callback` (or by the token sign-in form).
Cookies work in a WebView but are awkward across an in-app browser boundary and are cleared by
the OS more readily than a keychain item, so the native wrapper needs a bearer credential it can
keep in the keychain behind biometrics. Hence **device tokens**.

**Flow.**

1. App opens `https://<server>/login?device=1` in an in-app browser
   (`ASWebAuthenticationSession` / Custom Tabs).
2. The server runs the existing GitHub OAuth (or the token paste) exactly as for the web and
   sets the normal session cookie.
3. With that session, the in-app page calls `POST /api/device-token` (name from the OS, e.g.
   "Wimukthi's iPhone"). The server mints an opaque token, stores **only its SHA-256 hash** in
   `users.json`, and returns the plaintext once.
4. The page hands the token back to the app through the custom scheme
   (`reviewstage://auth?token=...&server=...`); the in-app browser closes. The app stores it in
   the keychain, optionally gated by Face ID / fingerprint.
5. Every `/api/*` call from the app carries `Authorization: Bearer <token>`. The server accepts
   **bearer or cookie**; nothing else about the API changes.
6. Settings → Devices lists the user's devices (name, created, last seen) with a Revoke button.
   Revoking deletes the hash; the next call from that device gets `401` and the app returns to
   step 1.

**Server changes** (implemented — `bin/prbot_devices.py`, `bearer_user()` and the `/api/devices*`
handlers in `bin/prbot-server.py`; deviations from the original spec are listed after the list):

- `bearer_user(headers) -> login | None` in the auth layer next to `session_user()`: read
  `Authorization: Bearer <tok>`, hash it, look up `users[login]["devices"][hash]`, refuse if
  the user has been removed from `users.json`, bump `last_seen` (rate-limited to once a minute
  to keep `users.json` writes rare). `api_get` / `api_post` call
  `session_user(h) or bearer_user(h)`. HMAC action tokens are unchanged: the app fetches them
  from the same `/api/pr` payload the web does.
- `POST /api/device-token` — session-cookie auth only (a bearer may not mint another bearer).
  Body `{ "name": str }`. Response `{ "token": str, "id": str, "created": int }`. Token is
  32 random bytes, base64url; storage is
  `users[login]["devices"] = { sha256_hex: { "id", "name", "created", "last_seen" } }`.
  Cap at 10 devices per user; oldest is evicted with a warning in the response.
- `GET /api/devices` — list for the signed-in user: `[{ id, name, created, last_seen,
  current: bool }]` (never the hash or token).
- `POST /api/devices/revoke` — `{ "id": str }`, cookie or bearer auth; a device may revoke
  itself. Signing out on the web (`/logout`) does not revoke devices; a "Sign out everywhere"
  button in Settings revokes all.
- Token lifetime: **180 days since last use**, sliding; the poller's nightly pass drops expired
  hashes. Tokens are never logged; `users.json` stays `chmod 600` as today.
- `/login?device=1` — the existing login page with one extra step after success: call
  `POST /api/device-token` and redirect to `reviewstage://auth?...`. The page must show the
  server URL and the GitHub login it is about to bind, so a phished user sees the mismatch.
- Threat notes: a stolen device token is as powerful as a stolen session cookie (post and
  approve as that user) and no more; it cannot read the GitHub token or the Claude token. It is
  revocable per device, which the cookie is not. The `DRY_RUN` gate applies to bearer calls too.

**Deviations in the implementation** (each deliberate; the rest is as specified):

- **Pairing goes through an interstitial, `/device`.** `/login?device=1` keeps the flag through
  either sign-in path and lands on a server-rendered page that shows the server URL and the
  GitHub login being bound, with an editable device name (default from `?name=` or the
  User-Agent) and an **Open the app** button. The token is minted *on that click*, never as a
  side effect of the login redirect, and the page then navigates to
  `reviewstage://auth?token=…&server=…`; if the scheme does not open, the same link and the
  token itself are shown once for the CLI. The OAuth callback skips the first-run welcome detour
  for this path.
- **`GET /api/devices` returns an object**, `{ "devices": [...], "max": 10, "ttl_days": 180 }`,
  not a bare array, so the UI can state the cap and lifetime. Rows are newest first.
- **`POST /api/device-token` also returns `name`** (after trimming to 60 chars) and, when the cap
  evicted something, a human-readable `warning`. A bearer calling it gets **403**, a session gets
  the token.
- **Eviction is least-recently-used** (by `last_seen`, then `created`), not strictly oldest
  created: an old device still in daily use survives a burst of new pairings.
- **`/api/me` never returns 401.** As on the web, an unknown or revoked bearer gets `200
  {"authed": false}` there; every other `/api/*` route returns `401` as specified.
- **`/api/me` reports `auth` (`cookie` | `bearer`) and `login_via` (`oauth` | `pat`)** so the
  Settings card can disable minting when the current session is itself a bearer.
- **The nightly prune is one poller step** (`pr-watch.sh` → `python3 prbot_devices.py prune`),
  guarded by a per-day stamp, and it rewrites `users.json` only when something actually expired,
  so the poller almost never writes the file the server owns.

## Push

Push is implemented **once, server-side**, as a `push` backend of the `notify` abstraction being
built now (`slack`, `discord`, `webhook`, later `email`, `push`). When `pr-watch.sh` finds a
review request, `notify` fans out to every backend the requested user has enabled; the `push`
backend looks up the user's registered devices and sends the card's title and deep link.

- **Registration.** `POST /api/devices/push` `{ "id": <device id>, "platform": "fcm" |
  "apns" | "webpush", "token" | "subscription" }`, bearer auth. Stored beside the device record.
- **Transport.** FCM HTTP v1 for Android and, via APNs relay, iOS from the Capacitor app; raw
  web push (RFC 8291, VAPID) for the installed PWA. Both are a few hundred lines of stdlib
  Python (JWT signing with `cryptography` or `openssl` as the rest of the codebase does).
- **Payload.** Title, PR number, repo, and the deep link. Never the finding text: it goes
  through a third-party relay.
- **iOS caveat.** Web push only reaches the home-screen PWA; the native wrapper is the way to
  reach every iPhone user.

## Roadmap placement

| Phase | Items | Status | Effort |
| --- | --- | --- | --- |
| **1 — PWA** | Manifest, icons, root-scoped service worker, offline page, `mobile.css`, e2e checks | **Shipped** in this change | Done; ongoing cost nil |
| **2a — Device tokens** | `bearer_user`, `/api/device-token`, `/api/devices`, `/api/devices/revoke`, `/device` pairing page, Settings → Devices | **Shipped** | Done |
| **2b — Push** | `push` notify backend, web push (VAPID) for the PWA, FCM/APNs for the wrapper, device registration | Roadmap (P2 with email) | ~1 week |
| **2c — Capacitor apps** | Wrapper, in-app-browser sign-in, biometrics, deep links, multi-server picker, store listings | Roadmap (P2) | 2–3 weeks + store review |

The order is deliberate: device tokens unblock both push registration and the wrapper, and are
useful on their own (a CLI or a second browser could use one). Push before the wrapper, because
the PWA on Android and the iOS home-screen app can receive it already. The wrapper last, when
a team asks for the store icon or for iPhone push that reaches a Safari-tab user.
