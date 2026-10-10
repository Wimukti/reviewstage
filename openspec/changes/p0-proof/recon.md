# p0-proof — recon and design for the five P0 lanes (10/10/26)

Read-only reconnaissance of the tree at `main` plus a binding design per lane, written so each
lane can be implemented by a separate agent without colliding. Line numbers are from this
checkout; re-grep before editing. Every lane states which of the five non-negotiable properties
(`openspec/config.yaml`) it touches.

## 0. Baseline: what runs today, and the gates

| Suite | Command (from the repo root) | Observed 10/10/26 |
| --- | --- | --- |
| Python | `python3 -m unittest discover -s bin -p 'test_*.py'` | 565 tests, OK, 92 s |
| Dashboard unit | `cd dashboard-ui && pnpm test` (`node --import tsx --test src/*.test.ts`) | 86 pass, 0 fail, 0.8 s |
| Dashboard browser | `cd dashboard-ui && RS_E2E_PORT=8993 pnpm test:browser` | 269 `test(` across 26 spec files (not run here; builds the SPA and boots the real `bin/server.py` against `e2e/.fixture`) |
| Desktop | `cd desktop && node --test test/*.test.mjs` | 32 tests, 31 pass, 1 skipped (smoke), 0 fail |
| Website | `cd website && pnpm build` | not run; note `pnpm verify` points at `scripts/verify-site.mjs`, which does not exist in the tree (docs/commands drift, fix or drop in lane 4) |

Gate for every lane: all four green, plus the lane-specific additions named below. Type check
with `cd dashboard-ui && pnpm typecheck`.

### Shared facts the lanes build on

- **State is files under ROOT** (`bin/rs_paths.py:22-26`: `ROOT=$ROOT|~/.reviewstage`, `STATE=ROOT/state`,
  per-PR `state/<owner>__<name>/<pr>/users/<login>/review.json`). Runtime settings are
  `ROOT/settings.json` (`bin/rs_settings.py:1-25` schema, `validate()` :118-190, atomic `save()` :192-204,
  precedence settings.json > .env > default). Users and their encrypted tokens are `ROOT/users.json`
  (`bin/server.py:312`, `enc`/`dec` :364/:387, `load_users` :418, `modify_users` :434). Learnings are
  `ROOT/learnings.jsonl` capped at 300 rows with a never-truncated tally in `ROOT/learnings_totals.json`
  (`bin/rs_learn.py:33-36`). The desktop app's own memory is `ROOT/desktop.json`
  `{phone, phoneVia}` (`desktop/lifecycle.js:293-311`, atomic tmp+rename, mode 600).
- **The SPA talks to the server through one wrapper**: `dashboard-ui/src/api.ts:23` (`fetch(\`${BASE}${path}\`)`),
  `get/post/put` :75-95, and the `api` object :825-949 (every endpoint the UI uses is a method there).
  `Me` (:107-142) carries `personal`, `claude_connected`, `dry_run`, `is_admin`.
- **Settings is sectioned by URL hash**: `dashboard-ui/src/Settings.tsx:58-70` (`SectionId`, `SECTIONS`
  with `group`), `sectionsFor(me)` :76-79 hides phone/desktop sections outside the desktop app, the
  `switch` that renders a section starts at :755 (the `desktop` case :766-772 is the model for a
  bridge-backed section: `SectionHeader` + `DesktopApp`). Rows are `SettingRow` from `ui.tsx`.
- **Outbound calls that exist today** (so "zero network" can be asserted honestly): desktop
  `desktop/update.js:13` `CHECK_EVERY_MS = 6 h`, `fetchLatest()` :30-40 to the npm registry — the
  only call nobody clicked for. Everything else is user-initiated and goes to a party the user
  chose: GitHub (`bin/server.py:3065 gh()`, OAuth/device token exchange :729, `bin/rs_device_flow.py:53`),
  Anthropic (`claude` CLI; the PKCE token exchange :887), the browser push service the phone
  subscribed to (`bin/rs_push.py:354-355`), and the operator's own Slack/Discord/webhook URLs
  (`bin/notify.sh`). `urlopen` is imported in exactly three modules: `server.py:46`,
  `rs_device_flow.py:33`, `rs_push.py:38`.
- **The e2e fixture is not a mock server.** `dashboard-ui/playwright.config.ts` boots the real
  Python server with `ROOT=e2e/.fixture`, `RS_SPA=1`, and a fake `gh` on PATH that fails every
  call (`e2e/fixture.ts:1-6`, `.env` :73-83, `review.json` bodies :204-295). Specs that need a
  different server answer rewrite it with `page.route("**/api/…")` (`e2e/audit.spec.ts:14,39,79`).
  `bin/demo-fixture.py` is the Python port of the same fixture for a Docker demo.
- **The desktop bridge**: `desktop/preload.cjs:7-21` exposes `window.reviewstage.{phone,update,openAtLogin,appShortcut}`;
  handlers are `ipcMain.handle(...)` in `desktop/main.js:594-636`; the SPA reads them through
  `dashboard-ui/src/desktop.ts` (`updateBridge()` etc.), which returns `undefined` in a browser.

---

## Lane 1 — Zero-by-default telemetry with local counters

### Current state

Nothing. No event counter, no install id, no consent flag, no endpoint. The only non-interactive
outbound call is the desktop update check (`desktop/update.js:13-40`). The Insights/rollup page
(`bin/rs_rollup.py`, `/api/rollup`) computes usage from on-disk runs and never leaves the box.

### Design

**1.1 Storage — `ROOT/telemetry/`** (new; never under `state/`, so it survives PR cleanup and is one
directory to delete):

```
ROOT/telemetry/counters.json   { "schema": 1, "days": { "2026-10-10": { "<event>": n, … } } }
ROOT/telemetry/consent.json    { "schema": 1, "decided": true, "consented": false, "at": 1760000000,
                                 "install_id": "…" }      # install_id minted ONLY when consented
ROOT/telemetry/outbox.json     [ { "sent_at"?: …, "payload": {…} } ]   # what View queued shows
```

Written by one new module **`bin/rs_telemetry.py`** (flock + tmp/rename like `rs_learn._atomic_write`
`:97-111`; mode 600). `bump(event, **dims)` is the only write entry point; it is a no-op that
swallows `OSError` — a counter that fails to write must never break a review or a post (same rule
as `rs_learn.record` :218-219).

**1.2 Event classes** (counters only; a day is a UTC date; no per-event rows are kept):

| event | dimensions (fixed vocabularies, no free text) | where it is bumped |
| --- | --- | --- |
| `install_completed` | — | `bin/server.py` sign-in path when `PERSONAL` and `users.json` goes from empty to one user (the first sign-in is the install) |
| `connect_result` | `service ∈ {github, claude}`, `error_category ∈ {ok, denied, expired_code, network, bad_token, other}` | `claude_connect_code()` :903, device-flow completion in `rs_device_flow.py` / `oauth_store()` :737 |
| `review_started` | `effort ∈ {quick, standard, deep}` | `/api/review` handler before the spawn (`_spawn_review`) |
| `review_completed` | `outcome ∈ {done, failed, stopped, timeout}` | `bin/run-review.sh` next to `status "done (…)"` :396 via `python3 -c 'import rs_telemetry…'` (same shape as the `rs_learn.render` call :200-201) |
| `run_duration_bucket` | `bucket ∈ {lt1m, 1to3m, 3to10m, gt10m}` | same place, from `usage.json.duration_ms` :355-365 |
| `findings_shown` | count | `run-review.sh` :396 (`$n`) — at completion, not per page load |
| `findings_kept` / `findings_edited` / `findings_dropped` | count | `Handler._learn` (server.py ~:6221) — reuse the `outcome` `rs_learn.record` already computes :178-184 |
| `dismissal_reason` | `reason ∈` lane 2 taxonomy | same place, from the lane 2 `reason_i` fields |
| `post_attempted` / `post_succeeded` | `dry ∈ {0,1}` | `_post_locked` around `gh(["api","--method","POST",…])` (~:6306) |
| `return_7d` / `return_28d` | — | not stored: derived at flush time from the set of `days` keys with any activity |

**1.3 Decision order (first match wins), evaluated on every flush and surfaced in the UI**:

1. `RS_TELEMETRY=0` in the environment or `.env` → `killed` (brand-neutral name now; after the
   rename add `KEEPDROP_TELEMETRY` as an alias read in the same place, both documented).
2. `settings.json.telemetry_enabled === false` → `disabled_by_admin` (new runtime setting in
   `rs_settings.validate()`; default **true meaning "allowed to ask"**, never "send").
3. `consent.json.consented !== true` → `no_consent` (the default on every install).
4. `RS_TELEMETRY_ENDPOINT` unset or not `https://` → `no_endpoint` — **the shipped default is
   unset**, so a build with consent and no endpoint still sends nothing.
5. Otherwise `active`.

`rs_telemetry.flush()` runs from a daemon thread in `server.py` once a day and on clean shutdown;
it POSTs one JSON body per day with the counters and `install_id`, `app_version`, `platform`,
`mode ∈ {personal, team}`; a non-2xx keeps the day in the outbox (max 30 days, then dropped).
No third-party SDK; `urllib.request` only.

**NEVER fields** (asserted by a test that walks the payload): login, name, email, repo names or
slugs, PR numbers or titles, file paths, finding text or gists, tokens of any kind, hostnames,
`PUBLIC_URL`, IP (the server never adds one; the receiving endpoint is documented as not storing
it), free-text error messages, timestamps finer than the day.

**1.4 API** (`server.py`, cookie-authenticated like every `/api/*` route):

- `GET /api/telemetry` → `{ state, reason, consented, decided, counters, outbox, endpointSet, adminDisabled, killSwitch }`.
- `POST /api/telemetry/consent {consented: bool}` → writes `consent.json` (mints or deletes `install_id`).
- `POST /api/telemetry/clear` → deletes `counters.json` + `outbox.json`, re-mints `install_id` if consented.
- `GET /api/telemetry/export` → `application/json` download of the three files.
- `PUT /api/settings` learns `telemetry_enabled` (admin-only, as every runtime setting :4947).

`api.ts`: `telemetry()`, `telemetryConsent(on)`, `telemetryClear()`, and an `exportUrl` constant.

**1.5 UI**

- **Consent prompt, once**: a fourth card on the personal-mode wizard after repositories
  (`dashboard-ui/src/Welcome.tsx` — three steps today, `welcomeStep()` :27), shown only when
  `me.personal && !telemetry.decided`. It lists the exact event table above, the NEVER list, the
  endpoint (or "none configured — nothing is sent"), and two equal buttons **Keep it local**
  (default focus) / **Share counters**. Team mode never prompts; the admin opts in from Settings.
- **Settings → Privacy** (new `SectionId "privacy"`, group **This device**, visible everywhere):
  one card with rows **Status** (state + reason sentence), **Share anonymous counters** (switch,
  disabled with a hint when killed/admin-disabled), **View queued** (expands a `<pre>` of
  `counters` + `outbox`), **Export** (link to `/api/telemetry/export`), **Clear** (destructive
  button, confirm), and in team mode for the admin **Allow telemetry on this server** (the
  `telemetry_enabled` runtime setting; goes through the dirty bar like Poller).
- Phone: the section is reachable from the You tab like the others (`/you/privacy`).

**1.6 Tests**

- `bin/test_rs_telemetry.py`: `bump` writes/accumulates; decision order for all five states; a
  `flush()` with `urlopen` monkeypatched to `raise AssertionError("network")` for each of
  `RS_TELEMETRY=0`, admin-disabled, no consent, no endpoint — none raises; with all four
  satisfied the fake opener receives exactly one POST whose body passes the NEVER-field walker;
  `clear()` re-mints the id; `install_completed` fires once.
- `bin/test_rs_settings.py` (exists? extend the nearest `test_rs_server_auth.py`/settings test): `telemetry_enabled` validation.
- `dashboard-ui/e2e/privacy.spec.ts`: `page.on("request")` collects every URL whose origin is not
  the fixture server; drive sign-in → PR page → keep/drop → post (dry run) → Settings#privacy →
  Export; assert the collected set is empty **and** `/api/telemetry` reports `no_consent`.
  Second test: consent switch on, still no external request (no endpoint in the fixture).
- `desktop/test/update.test.mjs` (new or extend `lifecycle.test.mjs`): `createUpdater` is the only
  `fetch` caller in `desktop/*.js` — a grep-based test over the shipped `files` list in
  `package.json`, so a future outbound call has to be named there.

**1.7 Docs page outline** — `website/src/content/docs/security/telemetry.md`, linked from
`security/index.md` "What is stored, and how" (:14): What is counted (the table) · What is never
sent (the list) · Where it lives (`ROOT/telemetry/`, 600) · Retention (30 days outbox, counters
until Clear) · Deletion (Clear button, or `rm -rf ~/.reviewstage/telemetry`) · Endpoint (unset by
default; `RS_TELEMETRY_ENDPOINT`; what the receiver logs — no IP, no UA) · Switches
(`RS_TELEMETRY=0`, admin setting, consent) · Logging (the server prints one line per flush with
the byte count, never the body).

**Files touched**: `bin/rs_telemetry.py` (new), `bin/test_rs_telemetry.py` (new), `bin/server.py`
(routes, hooks, sign-in bump, flush thread), `bin/rs_settings.py`, `bin/run-review.sh` (two bumps),
`dashboard-ui/src/{api.ts,Settings.tsx,Welcome.tsx,Privacy.tsx(new)}`, `dashboard-ui/e2e/privacy.spec.ts`
(new), `desktop/test/*.test.mjs`, `website/src/content/docs/security/{index.md,telemetry.md}`,
`website/src/content/docs/operations/configuration.md` (the two env vars).

**Risks vs the five properties**: none touched. Watch-outs: the flush thread must never hold
`act_lock` (:3485) or the users file lock; counters are per install, not per user, so nothing in
them can distinguish two reviewers (property 5 stays intact by construction).

---

## Lane 2 — Dismissal reasons

### Current state

- Desktop PR page: `selected: Set<number>` initialised from `preselect` (`dashboard-ui/src/PrPage.tsx:757-762`);
  `toggle` :781-786; phone-only `dropped` set :774 with `keep/drop/restore` :794-804 (`drop` removes
  from `selected`, adds to `dropped`, haptic). `submitPost()` :838-866 sends
  `{selected, bodies, suggs, request_changes, review_key}` through `api.post` (`api.ts:869-881`).
- Phone: `PhoneFindingCard` (`PhoneReview.tsx:176-330`), swipe commit at 96 px (`CARD_COMMIT` :59),
  `onLeft: onDrop`; the dropped state renders one dimmed line with **Restore** :222-247; the ⋯ menu
  has Keep/Don't keep/Drop :300-320. Toasts: `showToast({text, action, ms})` (`Toast.tsx:17`),
  default 5 s with an action.
- Server: `/api/post` (`server.py:5532-5553`) → `_post_form` :5555-5582 rebuilds `sel_i/body_i/sugg_i/path_i/line_i/sev_i`
  from the stored review (path/line/severity never come from the client) → `_post_locked`
  → `_learn` → `rs_learn.record` (`rs_learn.py:153-220`): outcome `dropped` = not selected,
  `edited` = selected and normalised body differs, else `kept`; row = `{at, repo, pr, user, skill,
  path, line, severity, gist, outcome, [critical_path], [edited_gist], [key], [dry]}`.
- Clustering: `_same_group` :371-386 (outcome + severity + top-two dirs + token overlap ≥ 0.5),
  `signature` :396-410, `clusters()` :445-458 needs ≥ `RULE_SUGGEST_MIN` rows from ≥ 2 PRs; the
  Skills page proposes a rule from a qualifying `dropped` cluster (`server.py:1388-1401`).
- No reason is recorded anywhere; a drop is a bare `outcome: "dropped"`.

### Design

**2.1 Taxonomy** (ids are stable API values; labels are UI copy):
`incorrect` · `irrelevant` · `already_handled` · `style_nit` · `lacks_context` · `duplicate` ·
`not_worth_raising`. Exported once as `REASONS` in `rs_learn.py` and mirrored as a `const` in
`api.ts` with a unit test (`src/api.test.ts`) that the two lists are identical, so the server
can reject anything else with a 400 in `_post_form`.

**2.2 Drop stays instant.** No modal, no required field, no change to what a swipe or a tap does.
After a drop the card offers a reason for ~6 s or until the next decision on any card:

- Desktop (`FindingCard` in `ReviewParts.tsx:202`): when a card goes from checked to unchecked
  (or `preselect` false and the user unticks nothing — we only ask on an explicit untick), a
  single-line **chip row** appears under the header: muted "Why?" then seven small toggle chips
  and a ✕. One tap sets the reason, the row collapses to one chip `Dropped · incorrect ✕`
  (tap ✕ to clear). Re-ticking the card clears the reason. Keyboard: the chips are buttons in a
  `role="group"`, Escape dismisses the row. No toast on desktop — the row is in place and does
  not steal focus.
- Phone (`PhoneFindingCard`): the dropped one-liner :222-247 gains the same chip row beneath it
  for 6 s (`data-testid="reason-row"`), horizontally scrollable, 44 px targets; swipe or Restore
  cancels it. The ⋯ menu gains **Why I dropped this…** which opens the row again at any time.
- State lives in `PrPage`: `reasons: Record<number, Reason>`; `drop(i)`/`toggle(i)` start a 6 s
  timer that hides the row (the reason, if chosen, stays). The row is purely presentational
  (`ReasonChips` in `ReviewParts.tsx`) and is reused by both cards.

**2.3 Wire** — `api.post` payload gains `reasons: Record<number, string>`; `_post_form` adds
`form[f"reason_{i}"] = [reason]` for dropped indexes only (a reason on a kept finding is ignored
server-side); `rs_learn.record` writes `row["reason"] = reason` when present and the outcome is
`dropped`. Nothing else in the row changes.

**2.4 Counting and clustering**

- `_apply_row` :233-250 adds `reasons[reason] += sign` to each tally slot (global, per skill,
  per day); `rebuild_totals` picks it up for free; `TOTALS_VERSION` stays 1 — the key is
  additive and `_blank()` gains `"reasons": {}`. Rows without a reason count under `unspecified`.
- `_cluster_info` :428-443 adds `reasons: {id: n}` and `topReason`. **`_same_group` does not use
  the reason** (the hard call: splitting clusters by reason would fragment the evidence a rule
  needs, and early rows have none). Instead the proposer uses it as a filter: a cluster whose
  `topReason ∈ {already_handled, duplicate}` is situational and is **not** proposed as a rule;
  `incorrect`/`irrelevant`/`not_worth_raising`/`style_nit` are; `lacks_context` is proposed with
  the hint "ask the skill to read the surrounding code" baked into the drafted rule prompt
  (`server.py:1330-1358`).
- `render()` (the prompt block) appends the reason word to a dropped gist when present:
  `- [nit] Use const instead of let (style nit)`.

**2.5 UI readouts** — Learnings page (`Learnings.tsx`, `LearningRow` in `api.ts:605`): a reason
chip on dropped rows; Insights/rollup: a small "Why findings are dropped" bar list from
`totals.reasons` (counts, percentages to one decimal as per house style). Skills page cluster
card: `topReason` chip.

**2.6 Backward compatibility** — old rows have no `reason` (read as `unspecified`); old totals
have no `reasons` key (`load_totals` fills `{}`); old clients post without `reasons` (server
treats as `{}`); old servers ignore the new key (unknown JSON key, `_post_form` reads only what it
knows). Learnings `CAP`/windows unchanged.

**2.7 Tests** — `bin/test_rs_learn.py`: record with reasons → row has `reason`; tally per reason;
`rebuild_totals` on mixed old/new rows; cluster `topReason`; proposer skips `already_handled`;
`render()` suffix. `bin/test_rs_post.py`: `_post_form` passes `reason_i` only for dropped indexes
and 400s an unknown reason. `src/api.test.ts`: taxonomy parity. `e2e/pr-page.spec.ts`: untick →
row visible → pick → chip; the row disappears after 6 s without a pick (use `page.clock`).
`e2e/mobile-screens.spec.ts` (:326, :441 are the models): swipe-drop → reason row → pick → the
posted body (via `page.route("**/api/post")` capture) carries `reasons[i]`.

**Files touched**: `bin/rs_learn.py`, `bin/server.py` (`_post_form`, proposer filter),
`bin/test_rs_learn.py`, `bin/test_rs_post.py`, `dashboard-ui/src/{api.ts,PrPage.tsx,ReviewParts.tsx,PhoneReview.tsx,Learnings.tsx,Rollup.tsx}`,
`dashboard-ui/src/api.test.ts`, `dashboard-ui/e2e/{pr-page,mobile-screens}.spec.ts`,
`website/src/content/docs/guides/skills-and-learnings.mdx`.

**Risks vs the five properties**: none touched — reasons ride the existing post body and are
recorded only where `rs_learn.record` already is (after the POST, or in the dry-run branch).
Do not record on the client's say-so before the post: that is the exact ordering bug `_learn`'s
docstring (~:6225) warns about.

---

## Lane 3 — Verification contract on every finding card

### Current state

- The schema is the `CONTRACT` string the job script appends to every skill
  (`bin/run-review.sh:229-259`): `comments[]` of `{path, line, severity ∈ blocker|should-fix|nit|question,
  title, impact, body, reply_to, suggestion, confidence ∈ high|medium|low, critical_path}`. The
  bundled skill repeats it (`skills/pr-review/SKILL.md:88-125`; the desktop copy is
  `desktop/server/skills/pr-review/SKILL.md`, produced by `desktop/scripts/prepack.mjs`).
- Validation is shape-only: `jq` asserts an object with a `comments` array
  (`run-review.sh:331-341`); anything else about a comment is tolerated.
- Server mapping `_review_data` (`server.py:4645-4666`): `title` (fallback `_fallback_title`),
  `impact`, `structured = title && impact`, `low = confidence == "low"`; `confidence` itself is
  **not** sent to the client beyond `low`.
- Cards: `FindingCard` (`ReviewParts.tsx:202-340`) renders checkbox · severity badge · placement
  badge · CopyPath `path:line` (:209, :236-248), then `title` :251 and `impact` under the label
  **Why it matters** :252-257 — so "why it matters" already exists under the name `impact`.
  `PhoneFindingCard` (`PhoneReview.tsx:176-330`) shows title (or first body line :215), severity,
  no impact. Fixtures with the current shape: `e2e/fixture.ts:271-295`, `src/stage/fixture.json`,
  `bin/demo-fixture.py`.

### Design

**3.1 Schema** — add two optional strings to each comment:

- `how_to_verify`: one imperative line, ≤ 160 chars, starting with a verb ("Run …", "Open …",
  "Call … with …"), concrete enough that the reviewer can do it in under two minutes without
  reading the whole PR. Required of the model; **optional in the data** (old runs, custom skills).
- `why_it_matters`: accepted as a synonym of `impact`; the server normalises
  `impact = impact or why_it_matters`. The prompt keeps asking for `impact` (renaming it would
  break every custom skill that already emits it) and names `why_it_matters` as the accepted alias.

**3.2 Validation in Python** — new `bin/rs_review_schema.py`: `normalize(review) -> (review, warnings)`
coerces severity/confidence to the vocabularies (unknown → `nit`/`medium` with a warning), trims
`title`/`impact`/`how_to_verify`, drops `how_to_verify` that is not a single line or exceeds the
cap, and never raises. Called (a) from `run-review.sh` right after the `jq` shape check via
`python3 -c`, writing the normalised file and appending warnings to `agent.log`; (b) from
`_review_data` for reviews on disk from before this change (so old runs render identically).
`FINDING_RENDER_CAP`/`SEV_ORDER` untouched.

**3.3 Server → client** — `Finding` (`api.ts:258-283`) gains `confidence: "high"|"medium"|"low"`
and `howToVerify: string` (`""` when absent); `_review_data` sends both. `low` stays for older
clients.

**3.4 Card layout** (both cards, same order; nothing else moves):

```
[✓] blocker · medium confidence · In summary            app/models/Product.php:42  ⧉
A product with no vendor can crash the lead-time badge                  ← claim (title)
WHY IT MATTERS  A shopper viewing such a product sees the card fail.      ← impact
HOW TO VERIFY   Open a product whose vendor is null; the badge throws.   ← new, mono label
[Explain simply] [Edit comment] [Teach the skill]
```

- Confidence: a `StatusBadge tone="graphite"` reading `high`/`medium`/`low confidence`; `high` is
  shown too (the contract is "every card states it"), smaller than the severity badge. The "maybe"
  tray behaviour for `low` is unchanged.
- `how_to_verify` absent → the row is omitted (no placeholder, no "unknown" copy); the card is
  then exactly today's card. Phone card: adds the impact line and the verify line under the title,
  both `text-[14px]`, verify line prefixed with a `ListChecks` icon.
- Not posted to GitHub in this lane: the verification line is for the human gate. (Open option,
  not in scope: a Settings toggle that appends `Verify: …` to the posted body.)

**3.5 Prompt change** — in `CONTRACT` add after `confidence`:
`"how_to_verify": "ONE imperative line telling the reviewer how to confirm this finding is real in under two minutes — a command to run, a page to open, an input to try; never 'review the code'"`.
Mirror in `skills/pr-review/SKILL.md` (the review.json block :100-116) and regenerate the desktop
copy (`prepack.mjs`). Same sentence in the repo-profile skill only if it emits findings (it does
not; leave it).

**3.6 Tests** — `bin/test_rs_review_schema.py` (new): normalise good/old/garbage reviews, the
synonym, the single-line rule, no exceptions on `None`. `bin/test_rs_job_scripts.py`: the review
script's post-jq step rewrites a review with a multi-line `how_to_verify` to `""` and logs a
warning. `bin/test_rs_prompts.py`: `CONTRACT` and `SKILL.md` both name `how_to_verify`.
`e2e/fixture.ts`: add `how_to_verify` to PR #38849's findings and `confidence` to all;
`e2e/review.spec.ts`/`pr-page.spec.ts`: the card shows the label and the line; a finding without
it shows no label. `scripts/stage-fixture.mjs` regenerates `src/stage/fixture.json`. Phone:
`mobile-screens.spec.ts` card assertions.

**Files touched**: `bin/run-review.sh`, `bin/rs_review_schema.py` (new), `bin/test_rs_review_schema.py` (new),
`bin/test_rs_job_scripts.py`, `bin/test_rs_prompts.py`, `bin/server.py` (`_review_data`),
`skills/pr-review/SKILL.md`, `desktop/server/skills/pr-review/SKILL.md` (generated),
`dashboard-ui/src/{api.ts,ReviewParts.tsx,PhoneReview.tsx,stage/fixture.json}`, `dashboard-ui/e2e/fixture.ts`
and the specs above, `bin/demo-fixture.py`, `website/src/content/docs/guides/reviewing.mdx`.

**Risks vs the five properties**: property 1 (no GitHub write path in the review step) —
`rs_review_schema.normalize` runs inside the review step and must import nothing that can reach
GitHub: keep it dependency-free (no `server.py` import). Nothing else touched.

---

## Lane 4 — Public examples + interactive replay (no auth)

### Current state

- Website: Astro 5 + Starlight, static output, `trailingSlash: always` (`website/astro.config.mjs`).
  The config already aliases `@app`/`@` to `dashboard-ui/src` with `dedupe` for React/radix/etc.
  (:15-30) and loads `@astrojs/react` — plumbing from landing-v2 §7 for rendering the app's own
  components in the site. **It is unused today**: no `client:` directive exists under
  `website/src`, and the `stage-proof` sitemap filter (:38) points at a page that no longer
  exists. `dashboard-ui/src/stage/{StageScene,StageProgress,StageQueueCard}.tsx` are presentational
  ports of the PR page driven by `src/stage/fixture.json` (generated from the e2e fixture by
  `scripts/stage-fixture.mjs`) — "nothing here talks to an API".
- Site CI (`.github/workflows/website.yml:34-37`) installs **only** `website/` and runs
  `pnpm build`; the dashboard is never built there. The home page is `src/pages/index.astro`
  composed of `components/home/*.astro`; docs live in `src/content/docs/**`.
- Offline operation of the SPA exists in two forms: the e2e fixture (real server + fake `gh`,
  `dashboard-ui/e2e/fixture.ts`) and `bin/demo-fixture.py` (same for Docker). Neither runs
  without Python. There is no `RS_DEMO` flag and no in-browser API adapter.
- The real keep/edit/drop UI is `PrPage.tsx` (`ReviewPane`, :740+), which reads everything through
  the `api` object (`api.ts:825`) → the single `fetch` at `api.ts:23`.

### Design

**4.1 The replay build** — a second esbuild entry, `dashboard-ui/src/replay/main.tsx`, that mounts
the **real** `PrPage` inside the real router and theme, with a **fetch shim** installed before
React: `src/replay/shim.ts` replaces `window.fetch` for same-origin `/api/*` URLs and answers from
an in-memory `ReplayStore` built from a fixture JSON; everything else (fonts, nothing else) is
left alone, and any non-`/api` network request throws so a regression cannot ship quietly. The
shim implements only what the PR page and shell call: `GET /api/me`, `GET /api/pr`,
`POST /api/post` (returns a banner and records the "would post" body), `POST /api/explain`
(returns a fixture paragraph), `POST /api/teach` (501 → the button hides), `GET /api/queue`
(one row). This is the hard call versus dependency-injecting an API interface into `PrPage`:
the shim leaves `api.ts` and `PrPage.tsx` byte-identical, so the replay is provably the shipped
UI, and the fixtures reuse the e2e `review.json` shape unchanged.

- Build: `pnpm build:replay` → `esbuild src/replay/main.tsx --bundle … --outdir=replay-dist
  --entry-names=replay --public-path=/try/` + `replay-dist/index.html` (a copy of the server's
  SPA shell `server.py:3405` minus the service worker). `website/scripts/build-replay.mjs` runs it
  and copies `replay-dist/` to `website/public/try/`; `website/package.json` `build` becomes
  `gen-brand && build-replay && astro build`; `website.yml` adds `pnpm install` in `dashboard-ui/`
  (and `website/public/try/` goes in `.gitignore`).
- `/try/` reads `?example=<slug>`; `<slug>` defaults to the first fixture. The page shows a
  one-line **disclosure banner** at the top (`data-testid="replay-banner"`): "Precomputed
  example — this review was run once on a real PR and stored. Nothing here talks to GitHub or
  Claude." Post → the existing `PostSheet`/banner is replaced in the shim by a **"What would be
  posted" sheet**: event, the kept comments as GitHub would show them (path:line + body, edits
  included), and a primary CTA **Run this on your PR → `npx reviewstage`** (link to
  `/start/install/`). Nothing is written anywhere.
- Theme follows the site's `data-theme` (the SPA's `theme.ts` already reads it).

**4.2 Fixtures** — `dashboard-ui/fixtures/replay/<slug>.json`, one per example PR:

```json
{ "slug": "lead-time-badge", "repo": "acme/widgets", "pr": 38849, "title": "…", "author": "…",
  "additions": 42, "deletions": 8, "changedFiles": 5, "headline": "one sentence for the examples index",
  "me": { "login": "you", "personal": true, "dry_run": true },
  "review": { "event": "COMMENT", "summary": "…", "keyPoints": [], "explainer": "…", "analysis": "…",
    "comments": [ { "path", "line", "severity", "title", "impact", "how_to_verify", "body",
                    "confidence", "suggestion", "teach": "keep|drop|edit" } ] },
  "explain": { "0": "…" } }
```

`comments[].teach` is replay-only: it labels the three finding types every example carries — a
**real bug to keep**, a **plausible-but-wrong to drop**, a **valid-but-badly-worded to edit** —
and drives an optional coach chip under each card ("Try: edit this one"). The server mapping the
shim applies is a TypeScript port of the 20 lines at `server.py:4645-4666` (`src/replay/map.ts`)
with a unit test asserting parity against `src/stage/fixture.json`. Ship 3 fixtures first
(a null-guard bug · a rate-limit false positive · a correct-but-rude nit), 5 at most.

**4.3 Static example pages** — `website/src/content/examples/` is an Astro content collection
backed by the same JSON (`file()` loader over `dashboard-ui/fixtures/replay/*.json` through the
`@app` path); `src/pages/examples/index.astro` lists them, `src/pages/examples/[slug].astro`
renders the PR header, verdict, and each finding card **server-side** with the real
`FindingCard`/`Verdict` components (no `client:` directive, so no JS) plus a **Try it live**
button to `/try/?example=<slug>`. Sitemap: drop the dead `stage-proof` filter.

**4.4 Local-only conversion counters** — the site has no server, so counters live in
`localStorage["rs_try_counters"]` with the lane-1 event names `try_opened`, `try_finding_kept|dropped|edited`,
`try_post_clicked`, `try_cta_clicked`; incremented by the shim, readable in devtools and on
`/try/?debug=1`, never transmitted (asserted by the Playwright test below). When the desktop app
is later installed there is no join — by design.

**4.5 Tests** — `dashboard-ui/src/replay/map.test.ts` (parity), `dashboard-ui/e2e/replay.spec.ts`
(serve `replay-dist/` with Playwright's static `webServer`: the banner is visible; keep/drop/edit
all work; Post opens the would-post sheet with the kept bodies; `page.on("request")` sees no
request outside the static origin; the CTA points at the install page). Website:
`website/scripts/verify-site.mjs` (make the existing `pnpm verify` real): `/try/index.html`,
`/examples/`, and each `/examples/<slug>/` exist in `dist/`.

**Files touched**: `dashboard-ui/src/replay/{main.tsx,shim.ts,store.ts,map.ts,PostPreview.tsx}` (new),
`dashboard-ui/fixtures/replay/*.json` (new), `dashboard-ui/package.json`, `dashboard-ui/e2e/replay.spec.ts` (new),
`website/scripts/{build-replay.mjs,verify-site.mjs}` (new), `website/package.json`, `website/astro.config.mjs`,
`website/src/content.config.ts`, `website/src/pages/{try/index.astro,examples/index.astro,examples/[slug].astro}` (new),
`website/src/components/home/Start.astro` (link to Try), `.github/workflows/website.yml`, `.gitignore`.

**Risks vs the five properties**: none — the replay has no server, no token, no GitHub; the
would-post sheet is explicitly labelled as not posting. Keep the shim from ever being bundled
into `src/main.tsx` (separate entry; a `src/*.test.ts` grep guards that `main.tsx` does not
import `replay/`).

---

## Lane 5 — `--doctor` extensions

### Current state

- `desktop/bin/reviewstage.js:17-27`: `--doctor` spawns `bash server/bin/doctor.sh` with
  `ROOT`, `RS_PERSONAL=1`, and `ROOT/bin` prepended to PATH; exits with its status. Nothing else
  in the desktop participates.
- `bin/doctor.sh` (310 lines, read-only, PASS/WARN/FAIL + exit 1 on any FAIL, no `--json`):
  Docker re-exec (:39-75) · `.env` present/mode 600 (:90-104) · repositories shaped (:106-121) ·
  `RS_SECRET` length (:124-134) · tools git/gh/claude/jq/… (:143-153) · **GitHub via `GITHUB_PAT`
  only** (:156-182: FAILs "GITHUB_PAT not set — nothing can read GitHub" — a **false FAIL on every
  personal/desktop install**, which has no service token by design: `rs_personal.py:3-6`,
  `review_env()` `server.py:976-986`) · base clones · disk/mem (:197-217) · STATE writable (:220-227)
  · `/health` on `RS_PORT|8899` (:230-235: the desktop picks a **random free port**,
  `desktop/main.js:159` → `server.js:14`, so this check cannot find the desktop's server) ·
  PUBLIC_URL (:236-257) · notifications/push · users.json counts incl. `claude_token_enc` (:294-304).
- How the app knows Claude is connected: `claude_connected(login)` = `users[login].claude_token_enc`
  present (`server.py:964-967`); expiry `claude_exp`, refresh `claude_refresh()` :932-946.
  GitHub per user: `gh_token_enc`, `gh_exp` (0 = never expires), `gh_refresh_enc`,
  `gh_refresh_exp`, `gh_client ∈ {oauth, device}` (`oauth_store` :737-757, `oauth_fresh_token` :760-779),
  PAT users have `pat_enc` (:312). Decryption needs `RS_SECRET` (`enc/dec` :364/:387).
- Tunnel tooling: `desktop/tools.js` `onPath()` :25, `ensureTool()` :92 fetches pinned `gh`/`jq`/`cloudflared`
  into `ROOT/bin` (`tools.json`); `desktop.json.phone`/`phoneVia` says whether the phone path is
  on and whether it is cloudflared or Tailscale (`tailscale.js:13-50`). Node floor is `>=20`
  (`desktop/package.json` engines), Electron pinned `44.5.1`.

### Design

**5.1 Shape** — keep `doctor.sh` as the single report (team installs call it as `docker compose
exec app doctor`), add a `--json` flag that emits `{checks:[{id, status, text, note?}], fails, warns}`
and the exit code policy **0 all pass · 1 any FAIL · 2 only WARNs when `--strict`**. Add
`--live` for checks that make a network call (default off: the doctor stays offline unless asked).
The desktop launcher gains `desktop/doctor.js` which runs the Node-side checks first, then the
bash doctor, merging into one list; `reviewstage.js --doctor` calls it and forwards `--json`/`--strict`/`--live`.

**5.2 New checks**

| id | where | PASS / WARN / FAIL |
| --- | --- | --- |
| `env.node` | doctor.js | node ≥ 20 PASS · else FAIL (`process.versions.node`) |
| `env.electron` | doctor.js | `require("electron")` resolves and the binary exists PASS · missing FAIL with the reinstall line (:30-34) |
| `env.os` | doctor.js | darwin/linux PASS · win32 WARN "unsupported, best effort" |
| `env.chromium_sandbox` | doctor.js (linux) | helper root-owned 4755 PASS · else WARN "runs with --no-sandbox" (mirrors :74-80) |
| `tools.cloudflared` / `tools.tailscale` | doctor.js | only when `desktop.json.phone` is true: the selected `phoneVia` binary on PATH or in `ROOT/bin` PASS · else FAIL; when phone is off, a `note` line |
| `port.free` | doctor.js | personal: the desktop writes its chosen port to `desktop.json.port` (new key, written in `main.js` next to the server spawn); doctor reads it and asks `/health` PASS · no answer WARN "app not running" (not FAIL — the doctor is often run while the app is closed); team: existing `RS_PORT` check unchanged |
| `perms.root` | doctor.sh | `ROOT` is 700 PASS · group/world readable WARN; `.env`, `users.json`, `settings.json`, `desktop.json`, `telemetry/*` are 600 PASS · else WARN naming the file |
| `github.auth` | doctor.sh → `bin/rs_doctor.py` | personal: ≥ 1 user with `gh_token_enc` or `pat_enc` PASS; for each user: `gh_exp` in the future (or 0) PASS · within 24 h WARN · past FAIL "sign in again"; `gh_refresh_exp` past WARN; `gh_client` printed as a note. `--live`: decrypt with `RS_SECRET` and `gh api user` (GH_TOKEN in the subprocess env only) PASS/FAIL. Team: today's `GITHUB_PAT` branch, unchanged |
| `claude.cli` | doctor.sh | existing `claude --version` check, plus FAIL when `~/.claude` is unwritable (the CLI needs it) |
| `claude.auth` | doctor.sh → `rs_doctor.py` | ≥ 1 user with `claude_token_enc` PASS · none WARN (today :299); `claude_exp` past **and** no `claude_refresh_enc` FAIL · past with refresh WARN "will refresh on next review". `--live`: `claude -p 'say ok'` with the decrypted token (`verify_claude_token` :801-807 is the existing probe) |
| `callback.device` | doctor.sh `--live` | `curl -sI https://github.com/login/device` 2xx/3xx PASS · else FAIL "device flow unreachable (proxy/firewall)" |
| `callback.claude` | doctor.sh `--live` | HEAD on the Claude OAuth authorize host from `CLAUDE_OAUTH_*` constants PASS/FAIL |
| `callback.public_url` | doctor.sh | existing check; add: when `desktop.json.phone` is true and `PUBLIC_URL` is still loopback → WARN "phone address not published" |

`bin/rs_doctor.py` is a small CLI (`python3 rs_doctor.py users [--live]`) that imports `enc/dec`
and `load_users` — those live in `server.py`, which has import-time side effects (env parsing,
`migrate_legacy`), so first **move `enc/dec/load_users/modify_users` into `bin/rs_users.py`** and
have `server.py` re-export them (no behaviour change; `test_rs_server_auth.py` keeps passing).
`rs_doctor.py` prints booleans and expiries only, never a token.

**5.3 Output copy** — one line per check, same `pass/warn/fail` helpers (:31-34); personal-mode
header `ReviewStage doctor — desktop install at <ROOT>`; the summary line gains the exit code
meaning. `--json` is the same list, un-coloured.

**5.4 Tests** — `desktop/test/doctor.test.mjs`: every doctor.js check with injected
`versions/platform/exists/which/readDesktopState/fetch` (the `tools.test.mjs` style), the exit-code
policy, and `--json` shape. `bin/test_rs_doctor.py`: fixture `users.json` with expired/valid/no
tokens → statuses; `--live` guarded by a fake `gh`/`claude` on PATH (the `test_rs_job_scripts.py`
fakebin pattern). `bin/test_rs_job_scripts.py`: run `doctor.sh --json` against a personal fixture
ROOT and assert **no FAIL for a missing `GITHUB_PAT`** and a FAIL for an expired token. Launcher:
`desktop/test/smoke.test.mjs` runs `node bin/reviewstage.js --doctor --json` and parses it.

**Files touched**: `desktop/bin/reviewstage.js`, `desktop/doctor.js` (new), `desktop/main.js`
(`desktop.json.port`), `desktop/lifecycle.js` (doc comment for the new key), `desktop/package.json`
(`files`), `desktop/test/{doctor.test.mjs(new),smoke.test.mjs}`, `bin/doctor.sh`, `bin/rs_doctor.py` (new),
`bin/rs_users.py` (new, extracted), `bin/server.py` (imports), `bin/test_rs_doctor.py` (new),
`bin/test_rs_job_scripts.py`, `website/src/content/docs/operations/troubleshooting.md` (the new
checks and flags; the docs rule says every flag named must exist).

**Risks vs the five properties**: property 2/4 (tokens) — `--live` decrypts a user's token to
probe it; it must pass the token through the subprocess environment only, never argv, never a
file, never stdout (the same rule `rs_personal.py:14-16` states), and the default run never
decrypts at all. Property 3 — the doctor never starts a review; the Claude probe is `claude -p`
on a fixed string, not a review.

---

## Cross-lane ordering

1. Lane 3 first (schema + card) — lanes 2 and 4 render the new card and ship fixtures in the new shape.
2. Lane 2 next (adds `reasons` to the post body that lane 1 counts).
3. Lane 1 (counts lane 2's reasons; its Privacy section lands beside lane 5's perms check).
4. Lane 5 and lane 4 are independent of each other and of 1–2 except for fixtures (lane 4 copies
   the lane-3 fixture shape) — run them in parallel worktrees.

Shared files several lanes touch — serialise edits or rebase carefully: `bin/server.py`
(1, 2, 3, 5), `dashboard-ui/src/api.ts` (1, 2, 3), `dashboard-ui/src/ReviewParts.tsx` (2, 3),
`dashboard-ui/src/PhoneReview.tsx` (2, 3), `dashboard-ui/e2e/fixture.ts` (3, then 4 copies).
