# Lane 1 — zero-by-default telemetry with local counters

Proposal, build contract and what shipped, in one file. `recon.md` §"Lane 1" is the
reconnaissance this was built from; where the two differ, this file says what is actually in the
tree. Built 10/11/26 on branch `p0-telemetry`.

## Why

Nothing in the tree counted anything about itself, and nothing could send anything either — the
only unprompted outbound call was the desktop update check. That is a fine place to be, and the
point of this lane is to add *counters a person can read on their own machine* without giving
that up: the product needs to know whether reviews finish, whether findings are kept, whether
posts land — and the person running it needs to be able to prove, not trust, that none of it
leaves the box unless they said so and a receiver exists.

So the design is "local always, send never by default", with the sending path present in the
code but inert: four gates, the last of which (an endpoint) is unset in every released build.

## Non-negotiable properties touched

None. The review step still only produces JSON (`run-review.sh` calls `rs_telemetry.py bump`,
which writes a counter file and nothing else); nothing posts under any token but the user's;
nothing runs unasked (the flush thread sends only in the `active` state, and the shipped default
never reaches it); reviews still run on the clicker's account; and counters are **per install,
not per user** — nothing in them can tell two reviewers apart, which keeps property 5 by
construction.

## The schema as shipped (`bin/rs_telemetry.py` `SCHEMA`)

| event | dimensions (closed vocabulary) | bumped where |
| --- | --- | --- |
| `install_completed` | — | `server.tally_install()` from `/api/login` and the device-flow poll: `PERSONAL`, first sign-in, `users.json` now holds exactly one user |
| `connect_result` | `service ∈ {github, claude}` · `error_category ∈ {ok, denied, expired_code, network, bad_token, other}` | `/api/login`, `device_poll()`, `_claude_result()` (`rs_telemetry.connect_error_category` folds the message; the message is never stored) |
| `review_started` | `effort ∈ {quick, standard, deep}` | `_start_review_locked()` |
| `review_completed` | `outcome ∈ {done, failed, stopped, timeout}` | `run-review.sh` `fail()` (timeout when the message says so) and the `done` line; `stop_review()`; the cached-reuse path in `_start_review_locked()` |
| `run_duration_bucket` | `bucket ∈ {lt1m, 1to3m, 3to10m, gt10m}` | `run-review.sh` from `usage.json.duration_ms`; `lt1m` for a cache hit |
| `findings_shown` | count | `run-review.sh` (`$n`) and the cache hit |
| `findings_kept` / `findings_edited` / `findings_dropped` | count | `Handler._learn()` → `rs_telemetry.record_decisions()`, the same kept/edited/dropped reading `rs_learn.record` makes |
| `dismissal_reason` | `reason`: slug `^[a-z][a-z0-9_-]{0,31}$` | `Handler._learn()` from `reason_i` form fields when present (lane 2 adds them; absent today) |
| `post_attempted` / `post_succeeded` | `dry ∈ {0, 1}` | `_post_locked()` before the dry-run branch; after `learn(dry=True)`; after the live `learn()` |
| `return_7d` / `return_28d` | derived booleans | `payload_for()` at packaging time, from the set of active days |

Counter key = `event` or `event|dim=value|…` (dimensions sorted). `key_for()` returns `None`
for anything outside the table and `bump()` then writes nothing; `assert_allowed()` walks a
payload and refuses any top-level key outside `schema, install_id, day, app_version, platform,
mode, counters, return_7d, return_28d`, any counter key that does not parse back through the
schema, and any non-integer count. Both are unit-tested with a repo name, a login, a path, a PR
number, a token and a free-text error.

**Where recon differs:** `dismissal_reason` accepts a slug *shape* rather than a fixed set,
because the lane 2 taxonomy is being written concurrently; the shape rule still forbids free
text. `rs_telemetry.dismissal_reason_counts(rows)` is the tolerant reader — it returns `{}` when
no row carries `reason` — and `rs_learn.py`, `PrPage.tsx` and `PhoneReview.tsx` are untouched.

## Storage

`ROOT/telemetry/{counters.json, consent.json, outbox.json}`, mode 600, flock + tmp/rename
(`_file_lock`, `_atomic_write`, the `rs_learn` shape). Paths are read from `rs_paths.ROOT` at
call time, so a test that reloads `rs_paths` moves the module with it. `install_id` is minted
only on consent and deleted on revoke; **Clear** re-mints it. The outbox keeps at most 30 days.

## Decision order (`rs_telemetry.decision()`)

`RS_TELEMETRY=0` (or `KEEPDROP_TELEMETRY=0`) → `killed` · `settings.json.telemetry_enabled ==
false` → `disabled_by_admin` · `consent.json.consented != true` → `no_consent` (every install's
default) · `RS_TELEMETRY_ENDPOINT` unset or not `https://` → `no_endpoint` (**shipped default**) ·
else `active`. `flush()` enqueues complete days when consented (so **View queued** can show what
would go) and POSTs only in `active`, one `urllib` request per day, `2xx` marks it sent. The
server runs it from a daemon thread once a day and from a `finally` around `serve_forever()`
(SIGTERM now raises `SystemExit` so that `finally` runs); it holds no server lock.

## API, UI, docs

- `GET /api/telemetry` · `POST /api/telemetry/consent {consented}` · `POST /api/telemetry/clear`
  · `GET /api/telemetry/export` (attachment) · `PUT /api/settings` learns `telemetry_enabled`
  (`rs_settings.validate`, default `true` = "allowed to ask"). `/api/me` gains `telemetry_decided`.
- `dashboard-ui/src/Privacy.tsx` (new): `EVENT_ROWS`/`NEVER` (the schema as prose),
  `TelemetrySchema`, `ConsentCard` (the wizard's fourth card at `/welcome/privacy`; **Keep it
  local** first and focused, **Share anonymous product events** beside it, both `outline`),
  `PrivacyRows` (Status + reason, consent switch locked with the reason under the kill switch or
  the admin switch, View queued, Export, Clear with confirm). Settings gains section `privacy`
  (group *This device*, `/you/privacy` on the phone) and, in team mode, the admin's **Allow
  telemetry on this server** row through the dirty bar. `welcomeFlow.ts` (new) holds
  `welcomeStep`/`welcomeRedirect` so they can be unit-tested without the logo's SVG import;
  the redirect sends a set-up personal install to `/welcome/privacy` once, while
  `telemetry_decided === false`, and never on older servers (flag absent). The stepper keeps its
  three chips — the privacy card configures nothing, so it is not a step.
- Docs: `website/src/content/docs/security/telemetry.md` (schema table, never-list, storage,
  retention, deletion, the four switches, **the endpoint does not exist in 1.0.x**, what a
  receiver would log — the IP is seen on the wire and the commitment is not to store it — and
  the server's one log line), linked from the security table, `configuration.md`
  (`RS_TELEMETRY`, `RS_TELEMETRY_ENDPOINT`, `telemetry_enabled`), FAQ "Does it phone home?",
  the install page and `docs/INSTALL-DESKTOP.md`.

## How this is proven

- `bin/test_rs_telemetry.py` (26 tests): `flush()` with `urlopen` replaced by a function that
  raises, under each gate — none raises, nothing is sent; with all four satisfied exactly one
  POST per complete day whose body passes `assert_allowed`; a non-2xx keeps the day queued;
  the allowlist refuses forbidden keys and keys outside the schema; `bump` refuses unknown
  events/values and writes nothing; counters persist across a reload at mode 600; Clear
  re-mints; revoke drops the id and the queue; the CLI used by `run-review.sh`; and the server
  hooks — a dry-run post counts kept/edited/dropped and a `reason_i` slug, and the raw counters
  file contains no repo, login, path or finding text; `install_completed` fires once and never
  in team mode; `telemetry_enabled` validates and flips the decision.
- `dashboard-ui/src/telemetry.test.ts` (5 tests): the schema table names every shipped class
  and the never-list; the card's two equal buttons with local first and focused; the section's
  state/reason and every control; the locked switch under each gate; the wizard routing rules.
- `dashboard-ui/e2e/privacy.spec.ts` (4 tests): `page.on("request")` collects every URL not on
  the fixture origin through sign-in → PR page → keep/drop → post (stubbed, as `pr-page.spec`
  does, so the shared fixture's learnings stay untouched) → Settings#privacy → View queued →
  Export, and asserts the set is empty **and** `/api/telemetry` says `no_consent`. The first run
  of that spec found the one honest exception: the page loads reviewer and repository avatars
  as `<img>` from `github.com` / `avatars.githubusercontent.com` — GitHub, the party the person
  signed in with. The spec names exactly those two hosts, image resources only, and anything
  else (a script, an XHR, a fetch) to any host still fails it; consent on →
  `no_endpoint`, still empty, Clear and revoke; the admin switch through the save bar →
  `disabled_by_admin` and a locked consent switch; the phone's You tab reaches the section at 390.
  `welcome.spec.ts`'s "Start reviewing" test now walks through the card and asserts the flag.
- `desktop/test/outbound.test.mjs` (2 tests): every shipped desktop file that calls
  `fetch`/`https.request`/… is named with its reason; no analytics SDK is mentioned.

The real-GitHub scenario this would have caught: a future "send a crash report" change that
adds a key with the failing PR's title, or a `requests` import — the allowlist test and the
"only `urllib`, no SDK" assertions fail before the change can ship.

## Gates (10/11/26)

| Suite | Result |
| --- | --- |
| Python `python3 -m unittest discover -s bin -p 'test_*.py'` | 663 tests OK |
| Dashboard `pnpm typecheck && pnpm test` | clean · 97 pass, 0 fail |
| Dashboard `RS_E2E_PORT=4474 pnpm test:browser` | 320 passed, 0 failed (after the main fixture pre-answers the question — `consent.json` decided/not consented — so specs that rewrite `/api/me` into personal mode are not sent to the card; `lane-s`, `always-on` and `system-shell` nav lists gained *Privacy*) |
| Desktop `RS_SKIP_UI_BUILD=1 node scripts/prepack.mjs && node --test test/*.test.mjs` | 36 pass, 0 fail, 1 skipped (the live-tunnel test). `smoke.test.mjs` launches real Electron once `server/` is assembled and hung in this sandbox; it was excluded from the count, not failed |
| Website `pnpm build && pnpm check` | build OK · check 0 errors, 0 warnings, 0 hints |

## Not done / follow-ups

- No endpoint is operated and no receiver code exists; the docs say so plainly.
- `app_version` is sent as `""` — the server has no version constant; wire it when the desktop
  app passes one through the environment.
- The lane 2 dismissal menu is not in this branch; `dismissal_reason` counts only when a client
  sends `reason_i`.
