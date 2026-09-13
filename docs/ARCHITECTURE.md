# Architecture

Read this before changing anything. Most of the layout decisions here look arbitrary and are
not — each one is working around something specific about running an agent next to a real
review queue on a small server.

## The pieces

| File              | Runs as                   | Does                                                            |
| ----------------- | ------------------------- | --------------------------------------------------------------- |
| `pr-watch.sh`     | cron, every 3 min         | Finds PRs awaiting your review → `queue.json` + Slack card      |
| `server.py` | systemd, `127.0.0.1:8899` | The dashboard: renders reviews, posts, approves                 |
| `run-review.sh`   | spawned per click         | Worktree → `claude -p` → `review.json`. Never writes to GitHub  |
| `rs_diff.py`   | imported                  | Diff-anchor validation, so GitHub can't 422 the whole review    |
| `rs_md.py`     | imported                  | Dependency-free markdown → HTML (headings, tables, code, lists) |
| `lib-common.sh`   | sourced                   | Config, repo helpers, HMAC signing, Slack posting               |
| `rs_paths.py`  | imported                  | The one place that knows the on-disk layout + the legacy migration |
| `rs_queue.py`  | imported                  | queue.json / seen writers shared by pr-watch.sh and the webhook |
| `rs_webhook.py`| imported                  | `POST /webhooks/github`: HMAC check, event → queue, webhooks.json |
| `dashboard-ui/`   | built by bootstrap        | React + TypeScript SPA, bundled by esbuild into `bin/static/`   |
| `bootstrap.sh`    | you, once                 | Installs all of the above                                       |

## Why everything lives in `~/.reviewstage/`

Because a deploy tool or sync job that runs `rsync --delete` into some directory can delete
files out from under a running review. So the base clone, the worktrees, the per-PR state and
the secrets all sit in `$HOME`, outside anything else that touches the server, and the only
files written elsewhere are the systemd unit and (opt-in) an Apache vhost under `/etc/apache2`.

## Why one hostname, one knob

The server binds `127.0.0.1` only and expects a reverse proxy in front of it. Every link it
mints — Slack buttons, the OAuth callback — is built from a single `PUBLIC_URL`, so the
hostname your proxy answers on and the hostname in Slack cannot drift apart. If more than one
hostname points at the instance (an old name kept alive so already-sent links keep working),
`RS_HOST_ALIASES` lists them and an unauthenticated visit on one bounces through another to
pick up an existing session.

The app is served at the site root and still answers under the legacy `/prbot` prefix (the
server strips it), so bookmarks and signed links from earlier versions keep resolving.

## The dashboard

| Route                    |                                                                  |
| ------------------------ | ---------------------------------------------------------------- |
| `GET /login` `POST`      | Sign in with a GitHub PAT + optional Slack member ID, or OAuth  |
| `GET /settings` `POST`   | Update Slack ID / rotate PAT / connect Claude / sign out         |
| `GET /?tab=&sort=`       | Index — **your** queue: tabs, sorting, dates                     |
| `GET /pr?repo=o/n&pr=N`  | Detail — timeline, assessment, prose, editable findings, actions (`?pr=N` alone resolves when one repo is configured) |
| `GET /review?repo=&pr=N` | Start a review, redirect to the detail page                      |
| `POST /post`             | Post the selected (possibly edited) comments                     |
| `POST /approve`          | LGTM comment + approve                                           |
| `GET /health`            | Liveness                                                         |
| `GET /manifest.webmanifest` `/sw.js` `/offline.html` `/icons/*` | PWA files, served at the root so the service worker's scope covers the whole app (see `docs/MOBILE.md`) |

The React SPA talks to the same server over `/api/*`; the routes above are the URL shapes the
SPA is mounted on and the legacy HTML fallbacks.

**Tabs** — `To review` · `Reviewed` · `Posted` · `Approved` · `All`, so finished work leaves
the working set. **Sorting** — newest (default), oldest, recent activity, most findings.
Rows carry author, diff size, dates (`MM/DD/YY`) and severity chips.

**Detail** opens with a timeline (`✓ Reviewed · ✓ Comments posted · ○ Approved`), then the
agent's assessment, then collapsible *What this PR does* / *Analysis*, then the findings —
each a card with a checkbox, severity pill, `file:line`, a reply-vs-new badge and an editable
textarea. A sticky bar tracks the selected count.

Once approved, the approve form is replaced by a card showing when it happened and the exact
comment posted with it.

## Design decisions worth defending

- **Posting is always a plain `COMMENT` review.** Never `REQUEST_CHANGES` — these are review
  notes, not a merge block, and the human approves separately. The agent's own verdict is
  surfaced as an *assessment* only.
- **Approve posts a comment and then approves.** The body is pre-filled with `LGTM` plus a
  checklist of the blocker/should-fix findings (nits omitted), and is editable first.
- **`run-review.sh` never touches GitHub.** It only produces `review.json`. Every write is a
  separate, deliberate human click. This is the property that makes the whole thing safe to
  run against a real review queue.
- **Slack dedup is per repo + PR + login, not per head SHA.** Each reviewer is pinged once per PR and
  never again; pushing new commits must not re-ping anyone. The dashboard always reflects the
  live queue regardless of what has been announced, so Slack is a one-time nudge, not the
  source of truth.
- **One search per user per poll, not a page-through.** A busy repository sees hundreds of PR
  updates a week. `review-requested:<login>` resolves server-side, so the poll costs one API
  call per user per 3 minutes, and `queue.json` means page loads never call `gh` at all.

## Repositories

One install reviews many repositories. `REPOS` lists them (`REPO` is a single-entry alias);
`REPO_ALLOW_ORG` accepts any repo under that org where a signed-in user has a review request
(discovered by the poller, cloned lazily). Internally a PR is `(repo, number)`; on disk a repo is
the slug `<owner>__<name>` (owners cannot contain `_`, so the first `__` is the separator):

| Path                                   | What                                            |
| -------------------------------------- | ----------------------------------------------- |
| `repos/<owner>__<name>/`               | blobless base clone; worktrees branch off it    |
| `state/<owner>__<name>/<pr>/`          | per-PR state (below)                            |
| `skills/repos/<owner>__<name>/SKILL.md`| optional per-repo override of the team default  |

`rs_paths.py` (`repo_slug`, `base_dir`, `prdir`, `udir`, `iter_prdirs`) and the matching bash
helpers in `lib-common.sh` are the only places that build these paths. Legacy installs kept the
clone at `repo/` and state at `state/<pr>`; `migrate_legacy()` moves both into the new layout the
first time the server starts with exactly one repo configured, stamps `repo` onto `queue.json`,
`seen` and `learnings.jsonl` rows, and writes a `MIGRATED` marker. With several repos configured
and legacy state present it refuses to start and says which env to set — it never guesses.

Signed links cover `action:owner/name#pr:expiry`; signatures of the old `action:pr:expiry` form
verify for `RS_SIGNATURE_GRACE_DAYS` (default 7) after the first repo-aware start.

## Per-PR state

`~/.reviewstage/state/<owner>__<name>/<pr>/`:

| File            | What                                                              |
| --------------- | ------------------------------------------------------------------ |
| `review.json`   | The agent's raw output — the artefact the dashboard renders       |
| `meta.json`     | PR identity, cached so titles survive after the PR leaves the queue |
| `payload.json`  | Exactly what was sent to GitHub                                   |
| `posted.json`   | Marker + timestamp                                                |
| `approved`      | Marker + timestamp                                                |
| `agent.log`     | What the agent did                                                |
| `run.log`       | The run wrapper's log                                             |
| `status`        | `fetching` / `reviewing` / `done (N findings)` / `failed: …`      |

Per-user markers live one level down, in `state/<pr>/users/<login>/`: `opened`, `posted.json`,
`payload.json`, `approved`, `archived`, and — since reviews became per reviewer — that
reviewer's own `review.json`, `status`, `effort`, `focus`, `risk`, `head` and `history/`.
Markers found directly in `state/<pr>/` predate multi-user and are read as the owner's.

`queue.json` rows carry `repo` and `requested: [logins]` — the union of everyone awaiting that
PR — and the dashboard filters on both, so one poller output serves every user.

`meta.json` exists because `queue.json` only holds PRs *currently* awaiting review — the
moment you submit, the PR drops out of it, and without the cache the dashboard would lose the
title of the review you just ran.

## The review step

`run-review.sh` creates a git worktree off the PR's head, then runs headless Claude Code with
`--allowedTools "Bash Read Glob Grep Write"` and an effort-dependent timeout (12 / 25 / 40
minutes), pointing it at the chosen skill plus an explicit output contract: no bottom table,
no GitHub writes, just a `review.json` with `event`, `summary`, `keyPoints`, `explainer`,
`analysis`, and a `comments` array carrying `path`, `line`, `severity`, `title`, `impact`,
`body`, `reply_to`, `suggestion` and `confidence`.

The prompt tells the agent a human will read `explainer` and `analysis` in a dashboard to
decide whether to trust the findings. That framing is load-bearing — it is what makes the
prose readable rather than a wall of bullet points.

The worktree is removed as soon as `review.json` is copied out.

## Subsystems added since the first cut

- **Learnings** (`rs_learn.py`): on post, each original finding is scored dropped / edited /
  kept and appended to `learnings.jsonl` (short gists, capped, tagged with the repo).
  `render(repo)` folds recent dropped/edited rows — same-repo first, then the rest — into the
  next review prompt so the agent stops re-raising rejected noise; the `/learnings` page shows
  it. Attributed per user. Not ML — in-context
  steering with your own recent decisions.
- **Review effort + focus** (`effort`, `focus`): starting a review is a form (`run_form`), not
  a link — the reviewer picks an effort level (auto-sized from the diff) and can add a
  free-text focus note. `start_review` writes both and passes `RS_EFFORT` / `RS_FOCUS`;
  `run-review.sh` maps effort to a timeout and a depth instruction, and appends the focus to
  the prompt. `deep` tells the agent to search the whole repo for impact before judging. The
  depth instructions are editable per team on the Skills page (`_effort_<level>.md`).
- **Re-run history**: `start_review` calls `archive_review`, which copies the current run's files
  into `history/<ts>/` and clears the live `review.json` so the re-run starts clean. The
  detail page lists earlier runs; `/pr?pr=N&v=<ts>` renders one read-only.
- **Stop**: `start_review` records the run's pid (`pid`, a session leader via
  `start_new_session`); `POST /stop` kills the process group and writes a `stopped` status.
- **Active skill choice** (`state/skills/<login>.use`): one selector on `/skills` sets whether a
  user's reviews run with their own skill or the team default. `start_review` passes it as
  `RS_SKILL_CHOICE`, which `run-review.sh` honors (`team` ignores a personal skill on file). The
  team default is guarded — `save_skill` refuses to blank it, and `restore_global_skill` (typed
  confirm) is the only way back to the installed skill.
- **Skills**: a user can bring their own review skill (`~/.reviewstage/skills/<login>.md`), and
  the **team default** is an editable file (`skills/_global.md`, seeded by bootstrap from
  `skills/global-review.md`) maintained from the `/skills` page. `run-review.sh` picks the
  clicker's skill (`RS_ACTOR`), else the editable team default, else the installed
  `pr-review` skill — and before all of those, a per-repo override at
  `skills/repos/<owner>__<name>/SKILL.md` if one exists (recorded as skill id `repo:<slug>`); it
  runs the skill's logic and **always appends an explicit `review.json` output contract**, so any skill yields the shape the dashboard needs. **Quick-add rule**:
  `add_skill_rule` tidies a plain-English preference into a managed `## Team rules` section of
  the target skill (kept last so appends are trivial). Each review records the skill id
  (`skill`); learnings rows carry it; the `/skills` page scores each skill by kept-rate. The
  flywheel: usage → accept/reject signal → which skills work → a better team default
  (human-approved). Dashboard edits also commit to a local git repo in `$ROOT/skills` so the
  team's review standard has a who/when/why history.
- **Risk-area flags** (`risk`): `run-review.sh` matches the PR's file list against the
  `RISK_PATHS` rules from `.env` (`label:pattern`, comma-separated; a per-repo
  `RISK_PATHS__<OWNER>__<NAME>` replaces the list for that repo) and records the labels; the
  detail page shows a context banner per label. It is informational — never a gate, never
  routing or auto-mentions. Empty `RISK_PATHS` turns it off.
- **Suggestion blocks**: a finding may carry a `suggestion` (single-line replacement); on post
  it's appended to the comment body as a GitHub ```` ```suggestion ```` block (one-click apply).
- **Staleness**: `run-review.sh` records the reviewed head SHA (`head`); the detail page flags
  the review stale when the PR's current head differs — without auto-re-running.
- **Slack threading**: with `SLACK_BOT_TOKEN` + `SLACK_CHANNEL`, `slack_post` (in `bin/notify.sh`, behind `notify_card`) uses
  `chat.postMessage`, stores the request card's ts, and threads the review-ready reply under it;
  otherwise it falls back to the send-only webhook.
- **Per-run cache, agreement and insights** (`rs_agree.py`, `rs_rollup.py`): a reviewer's
  identical re-run on the same commit is served from a content-addressed cache; independent
  runs on the same SHA are clustered so the dashboard can show where reviewers agree; the
  Insights page aggregates activity, keep-rate and agreement from the files already on disk.
  See `docs/specs/multi-reviewer-trust-plan-v2.md`.
- **Repository profile** (`rs_profile.py`, `profile-repo.sh`): a per-repo
  `profiles/<slug>/profile.json` naming the critical paths, risk paths, review rules and
  do-not-flag list, built from deterministic git signals plus one Sonnet call and validated
  against the tree (hallucinated globs dropped and logged). `run-review.sh` merges the risk paths
  into the banners and, for Standard/Deep, appends the critical paths the PR touches with their
  checks; findings may set `critical_path` (badge on the card, kept in learnings, kept-rate in
  Insights). Editable as markdown from the Skills page, versioned on every write; `auto_profile`
  in settings.json lets `pr-watch.sh` ask the server to re-profile (as the admin) when the tree
  changes materially, at most once a day.

## What this is not

ReviewStage reacts to **review requests** and writes **nothing** to GitHub on its own. It is
deliberately not a comment-triggered bot that pushes commits; if you run one of those too,
keep it in its own directory and its own credentials — they share nothing but a server.
