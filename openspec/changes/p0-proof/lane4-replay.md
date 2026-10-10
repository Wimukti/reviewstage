# Lane 4 — Public examples + interactive replay (no auth)

Branch `p0-replay`, implemented 10/10/26–10/11/26 against the design in `recon.md` §"Lane 4".
Non-negotiable properties touched: **none** — the replay has no server, no token and no GitHub;
its one write is to this browser's localStorage, and the shell's Content-Security-Policy makes
"nothing leaves this page" a browser-enforced fact rather than a promise.

## What shipped

### The replay build (`dashboard-ui/src/replay/`)

A second esbuild entry, `src/replay/main.tsx`, mounts the **shipped** PR page — `PrPage.tsx`,
`ReviewParts.tsx`, `PhoneReview.tsx`, `api.ts` all byte-identical — over an in-memory server:

| File | Role |
| --- | --- |
| `boot.ts` | First import: picks the fixture from `?example=<slug>`, installs the fetch shim, puts `?repo=&pr=` in the URL (PrPage reads them), exposes the counters, counts `replay_started`. |
| `shim.ts` | Replaces `window.fetch`. Same-origin `/api/*` → `ReplayStore`; anything else throws `replay: network is disabled`. |
| `store.ts` | Answers `GET /me`, `/pr`, `/queue`, `/stack`, `/public-url`; `POST /post` (records the would-post body, returns a dry-run `warn` banner, dispatches `rs-replay:posted`), `/explain` (fixture paragraph), `/tour-seen`, `/logout`; `/teach` → 501; `/review`, `/stop`, `/approve`, `/markdone`, `/archive`, `/qa/gen` → 400 "precomputed example"; everything else 404. |
| `map.ts` | TypeScript port of `bin/server.py` `_review_data` / `_fallback_title` / `_as_markdown` / `sev_counts` / `default_approve_msg` and the `api_pr` envelope. Anchorability comes from the fixture's diff hunks (`linesInDiff`), as the server derives it from GitHub's files API. |
| `events.ts` | Local-only counters in `localStorage["rs_replay_events"]`: `example_viewed`, `replay_started`, `first_decision`, `replay_completed`, `install_copied`. Every access is try/catch; exposed as `window.__rsReplayEvents` (`read`, `bump`, `reset`). Never transmitted. |
| `PostPreview.tsx` | The "What would be posted" bottom sheet: event, repo#pr, acting login, each kept comment as GitHub would show it (path:line, severity, body with edits, suggestion), labelled "Precomputed example — nothing was sent", and the CTA — a copy button for `npx reviewstage` (counts `install_copied`) plus a link to `/start/install/`. |
| `ReplayBanner.tsx` | The sticky disclosure, `data-testid="replay-banner"`: "**Precomputed example.** Nothing leaves this page." with links to the example's page and the install guide. |
| `fixtures.ts`, `types.ts` | The three fixtures in index order, and their shape. |

Decisions worth knowing:

- **`dryRun: true` in the fixture `me`.** The shipped UI then says "Post as sam (dry run)" and
  "Dry run — this records your picks; nothing reaches GitHub" on its own — the truthful labels for
  a replay for free — and `postedFromBanner` accepts the store's `warn` banner as a completed post,
  so the page reaches its posted state (desktop CommitBar / phone PostSuccess) exactly as it would.
- **The CSP** (`scripts/build-replay.mjs`): `default-src 'none'; script-src 'self'; style-src
  'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'`.
  Found by the Playwright spec on its first run: the PR header renders `<img>` avatars for the
  author and repo owner through `ui.tsx` `avatarUrl()` — a real request to github.com for a
  fictional login, which no fetch shim can see. Blocked, Radix `AvatarFallback` shows initials.
  The theme bootstrap is `theme-boot.js` (a file) so `script-src` needs no `'unsafe-inline'`.
- **No app shell.** `PrPage` is mounted directly (no `App`, Sidebar or PhoneShell), inside the
  same container classes the desktop shell uses. `setNavigationWrapper` turns the queue crumb into
  `/examples/` and ignores every other in-app destination. Consequence: on a phone the ⋯ action
  sheet (summary / approve / re-run) is unreachable because `NavBarAction` portals into a slot
  only PhoneShell renders. Acceptable for a replay; noted for lane owners.
- **Theme** follows the site's `localStorage["starlight-theme"]`, mapped onto the app's
  `applyTheme`, live on `storage` events.
- **`first_decision`** is read off the DOM (a click on a finding checkbox / menu item, or input in
  a comment editor) so `PrPage` stays untouched; counted once per page load.
- The recon's optional coach chip under each card (`comments[].teach`) was **not** built — it
  would need a hook in `ReviewParts`/`PhoneReview`, which another lane owns. The banner carries
  the one-line hint instead; `teach` stays in the fixtures and the unit test asserts the
  keep/drop/edit trio.

### Fixtures (`dashboard-ui/fixtures/replay/*.json`)

Three PRs, each with exactly one finding to **keep** (a real correctness bug), one to **drop**
(plausible but wrong against the diff) and one to **edit** (valid, said badly), with diff hunks,
`confidence`, `how_to_verify`, per-finding `explain` paragraphs, and the human `decisions`
(action, reason, `edited_body`). No real company names.

| slug | PR | keep | drop | edit |
| --- | --- | --- | --- | --- |
| `webhook-retry` | northwind/dispatch#412, TS | retries 4xx that can never succeed | "backoff is uncapped" (it is capped in `backoff.ts:9`) | jitter nit, rude |
| `rate-limit-tenant` | lumen-labs/gateway#207, Python asyncio | `b.last = now` before computing elapsed → bucket never refills | "check-then-decrement races" (no `await` in `take()`, single event loop) | `Retry-After` nit, rude |
| `cache-stale-read` | harbor-tools/catalog-api#88, TS | invalidation deletes `id`, entries keyed `tenant:id` | "unbounded growth" (FIFO eviction at 5,000 in `cache.ts:20`) | magic-number nit, rude |

### Website

- `website/scripts/build-replay.mjs` runs `pnpm build:replay` in dashboard-ui with
  `RS_REPLAY_PUBLIC_PATH=/try/app/` and copies `replay-dist/` to `public/try/app/`;
  `pnpm build` = `gen-brand && build-replay && astro build`. `public/try/` and
  `dashboard-ui/replay-dist/` are gitignored; `tsconfig.json` excludes `public/try` (the 700 KB
  bundle pushed `astro check` past a 4 GB heap).
- `/try/` (`src/pages/try/index.astro`): MarketingLayout, h1, disclosure, a three-way example
  switcher, and an `<iframe data-replay-frame>` on `/try/app/?example=<slug>` (the iframe keeps
  the site's styles and the replay's CSS apart; `?example=` on the host page is forwarded).
- `/examples/` and `/examples/<slug>/`: static, no client JS beyond the counter script. Rendered
  from the same JSON via `src/content/examples.ts` (`import.meta.glob` over
  `dashboard-ui/fixtures/replay/*.json`, mapping through `@app/replay/map`). Each example page:
  PR header · disclosure · "Try it live" · the real `Verdict` (SSR) with key points and a
  disclosure for the full summary and reviewer's notes · per finding: severity `StatusBadge`,
  title, why it matters, the file's diff with the finding's line marked (`DiffHunk.astro`), the
  drafted comment (`MdText.tsx` wraps `@app/Md` — Astro hands framework children as a slot, not a
  string), evidence & confidence badges, how to verify, the human decision with reason and the
  edited text · "The review that posts" (kept + edited comments as GitHub would show them) ·
  the `npx reviewstage` CommandPill and install link.
- Deviation from recon §4.3: the per-finding cards are Astro markup rather than SSR'd
  `FindingCard` — `FindingCard` always renders live "Explain simply" / "Edit comment" buttons
  that would do nothing without hydration. `Verdict`, `StatusBadge` and `Md` are the app's.
- Nav/footer: "Examples" in the primary nav; "Examples" and "Try it live" in the Product column;
  `Start.astro` links "Try a stored review live". Sitemap: the dead `stage-proof` filter is now
  `/try/` (an app, not a page); the three example pages and the index are in the map.
- `scripts/verify-site.mjs` now also asserts: `/try/app/` serves the shell with
  `connect-src 'none'`, `replay.js`/`replay.css`/`theme-boot.js` serve with the right types,
  `/try/` embeds the frame and the disclosure, the sitemap has every `/examples/<slug>/` and not
  `/try/`, each example page has 3 findings in keep/drop/edit order, the posted count equals the
  kept count and every named part is present; `/examples/`, `/examples/webhook-retry/` and
  `/try/` are in the screenshot/theme/no-sideways-scroll pass. The docs-sidebar label check now
  applies only to Starlight pages (marketing pages have no sidebar).
- `.github/workflows/website.yml`: `pnpm install --frozen-lockfile` in `dashboard-ui` before
  `website` (cache keyed on both lockfiles); the trigger paths include `dashboard-ui/src/**`,
  `dashboard-ui/fixtures/**` and the build script.

### Tests

- `dashboard-ui/src/replay.test.ts` (9 tests): map parity against `src/stage/fixture.json`
  (the real server's rendering of the e2e fixture), sort/fallback-title/preselect rules, hunk
  parsing, approve message, the keep/drop/edit trio in every fixture, store routing and the
  recorded post, the shim's refusal of non-`/api` URLs, counters under a broken localStorage,
  and a guard that `main.tsx`/`App.tsx`/`api.ts` never import `replay/`.
- `dashboard-ui/e2e/replay.spec.ts` (4 tests) against `e2e/replay-server.ts` — a static
  server with no `/api`, booted as a second `webServer` in `playwright.config.ts` on
  `RS_E2E_PORT + 2` (`+1` is the personal-mode server `welcome.spec.ts` boots): desktop
  keep/drop/edit → Post → the would-post sheet with the two kept bodies (edit included), the CTA
  href, counters; `page.route("**/api/**")` sees zero hits, no response arrives from outside
  the static origin, and the avatar requests are the ones the CSP refused; explain-simply from
  the fixture; unknown slug falls back; phone: `post-pill` → real `PostSheet` ("nothing reaches
  GitHub") → `post-confirm` → the preview, no sideways scroll at 390.

## Gates (10/11/26)

| Gate | Result |
| --- | --- |
| `dashboard-ui`: `pnpm typecheck` | clean |
| `dashboard-ui`: `pnpm test` | 95 pass, 0 fail (86 before) |
| `dashboard-ui`: `pnpm build` | ok |
| `dashboard-ui`: `RS_E2E_PORT=4472 pnpm test:browser` | see the report (the first run's one failure was the `+1` port collision above, fixed) |
| `website`: `pnpm build` | 27 pages + `/try/app/` |
| `website`: `pnpm check` | 0 errors, 0 warnings, 0 hints |
| `website`: `pnpm verify` | 182 ok, 0 fail; Lighthouse performance 96 on `/` |

## Hooks another lane may want

- A coach chip ("Try: drop this one") under each card needs `FindingCard` / `PhoneFindingCard`
  to accept an optional `hint` node; the fixtures already carry `comments[].teach`.
- If the phone action sheet should work in the replay, `PhoneReview`'s `PrActionSheet` needs a
  render path that does not depend on `NavBarAction`'s portal slot.
