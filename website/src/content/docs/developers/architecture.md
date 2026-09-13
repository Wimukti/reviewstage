---
title: Architecture
description: The pieces, where state lives, and the design decisions worth defending.
sidebar:
  order: 1
---

Read this before changing anything. Most of the layout decisions look arbitrary and are not.

## The pieces

| Piece | Runs as | Does |
| --- | --- | --- |
| `bin/pr-watch.sh` | poller, every 3 min | Finds PRs awaiting any signed-in user's review → `queue.json` + a notification card. Never runs a review. |
| `bin/prbot-server.py` | the dashboard service, `127.0.0.1:8899` | Serves the React SPA shell and a JSON API: sessions, queue, PR pages, runs, posting, approving, skills, learnings, insights, QA. |
| `bin/run-review.sh` | spawned per click, detached | Worktree → `claude -p` with the chosen skill + output contract → `review.json`. **Never writes to GitHub.** |
| `bin/run-qa.sh` | spawned per click | Same shape, runs the QA-guide skill → `qa.md`. |
| `bin/profile-repo.sh` | spawned per click, or by the poller | Deterministic signals → one Sonnet call with `skills/repo-profile` → validated `profiles/<slug>/profile.json` + `profile.md`. |
| `bin/prbot_profile.py` | imported + CLI | The profile: signals gathering, prompt, validation against the tree, risk-rule merge, the critical-path prompt block, markdown round-trip, versioning. |
| `bin/prbot_diff.py` | imported | Diff-anchor validation so GitHub cannot 422 a whole review. |
| `bin/prbot_learn.py` | imported | Learnings loop: scores kept/edited/dropped, renders recent decisions into the next prompt, scores skills. |
| `bin/prbot_agree.py` | imported | Matches findings across independent runs; independence-weighted agreement. |
| `bin/prbot_rollup.py` | imported | Insights aggregation. |
| `bin/prbot_md.py` | imported | Dependency-free markdown → HTML. |
| `bin/prbot_paths.py` | imported | The repository dimension: slugs, `base_dir` / `prdir` / `udir`, `iter_prdirs`, and the one-time legacy migration. |
| `bin/lib-common.sh` | sourced | Config (`REPOS`, `REPO_ALLOW_ORG`), the bash twins of the path helpers, HMAC link signing, Slack posting (webhook or bot token). |
| `dashboard-ui/` | built once | React 19 + TypeScript SPA: queue, PR page, stack page, QA, skills, learnings, insights, integrations, tour, command palette. |
| `skills/pr-review/` · `skills/pr-qa-guide/` | installed | The built-in review and QA-guide procedures, as Claude Code skills. |

The backend is Python's standard library plus bash, `gh`, `jq`, `git`, `openssl` and `claude`. There is no database; state is files.

## Request flow

```
browser ──HTTPS──▶ reverse proxy ──▶ prbot-server.py (127.0.0.1:8899)
                                        ├─ GET  /            SPA shell (React Router handles the rest)
                                        ├─ GET  /api/*       me · queue · pr?repo=&pr= · qa · skills · learnings · rollup?repo= · stack
                                        ├─ POST /api/review  start_review → spawn run-review.sh (session leader)
                                        ├─ POST /api/post    decrypt clicker's token → validate anchors → COMMENT review
                                        ├─ POST /api/approve LGTM comment → APPROVE, as the clicker
                                        ├─ POST /api/stop · /api/explain · /api/markdone · /api/archive · /api/skill/* · /api/claude/*
                                        └─ GET  /oauth/start · /oauth/callback · /health
```

Every `POST` carries an HMAC token minted at render time (30 minutes) over `action:owner/name#pr:expiry`; the old `action:pr:expiry` form still verifies for `PRBOT_SIGNATURE_GRACE_DAYS` after the upgrade. Pages are gated by the session cookie, not a signature, so they stay bookmarkable. A PR is addressed as `?repo=owner/name&pr=N`; `?pr=N` alone resolves when one repository is configured or when the number exists under exactly one repository's state, and otherwise returns the candidate repos for a picker.

## The review step

`start_review` records effort, focus, model and the clicker's login, archives any previous run into `history/<ts>/`, then spawns `run-review.sh` as a new session leader (so **Stop** can kill the whole process group). The script:

1. Clones the repository's base clone if it does not exist yet (`repos/<owner>__<name>`, blobless), fetches the PR head and creates a **git worktree** per repo per reviewer per PR, so two people never collide.
2. Picks the skill, in order: a per-repo override (`skills/repos/<owner>__<name>/SKILL.md`), else the clicker's personal skill if selected, else the editable team default, else the installed built-in — and logs which one it used. It runs that skill's logic and **always appends an explicit `review.json` output contract**, so any skill yields the shape the dashboard needs.
3. Renders recent learnings and the focus note into the prompt, plus a depth instruction for the effort level.
4. Runs `claude -p` headless with `--allowedTools "Bash Read Glob Grep Write"`, an optional `--model`, and a timeout (12/25/40 minutes by effort), with the clicker's Claude token in the environment.
5. Parses token usage and the model from the stream log, records the head SHA (for staleness) and a path-based risk flag, copies `review.json` out, and removes the worktree.

The prompt tells the agent a human will read `explainer` and `analysis` in a dashboard to decide whether to trust the findings. That framing is load-bearing: it is what makes the prose readable rather than a wall of bullets.

A run keyed on (login, head, effort, focus, model, skill) is cached; an identical request reuses the earlier result.

## Repositories and state layout

One install reviews many repositories (`REPOS`; `REPO` is a single-entry alias; `REPO_ALLOW_ORG` accepts any repo under an org on demand). Internally a PR is `(repo, number)`. On disk a repository is the slug `<owner>__<name>` — GitHub owners cannot contain `_`, so the first `__` is always the separator and the mapping is reversible:

```
ROOT/repos/<owner>__<name>/                 base clone (blobless); review worktrees branch off it
ROOT/state/<owner>__<name>/<pr>/            per-PR state
ROOT/state/<owner>__<name>/<pr>/users/<login>/   one reviewer's run and markers
ROOT/skills/repos/<owner>__<name>/SKILL.md  optional per-repo team default
```

`prbot_paths.py` (`repo_slug`, `slug_repo`, `base_dir`, `prdir`, `udir`, `iter_prdirs`, `repos_with_pr`) and the same-named bash functions in `lib-common.sh` are the only code that builds these paths.

**Migration.** Installs from before this layout kept the clone at `ROOT/repo` and state at `ROOT/state/<pr>`. On start, `migrate_legacy()` moves both into the new layout once — when exactly one repository is configured — stamps `repo` onto `queue.json` rows, `seen` lines and `learnings.jsonl` rows, logs each step and writes `ROOT/MIGRATED`. Nothing is ever deleted; if a destination already exists the contents are merged file by file without overwriting. With several repositories configured and legacy state present the server refuses to start and prints the env to set, because the state cannot be attributed safely.

## Per-PR state

`ROOT/state/<owner>__<name>/<pr>/` holds the shared PR identity (`meta.json`, with `repo`), QA files (`qa.md`, `qa.status`, `qa_meta.json`), the agreement indices and `users/<login>/` — each reviewer's run (`review.json`, `status`, `effort`, `focus`, `skill`, `head`, `risk`, `pid`, `usage.json`, logs, `history/`, `cache/`) and markers (`opened`, `posted.json`, `payload.json`, `approved`, `archived`). `queue.json` rows carry `repo` and `requested: [logins]`, the union of everyone awaiting the PR, and the dashboard filters on both so one poller output serves every user.

`meta.json` exists because `queue.json` only holds PRs *currently* awaiting review; the moment you post, the PR leaves it, and without the cache the dashboard would lose the title of the review you just ran.

## Design decisions worth defending

- **Posting defaults to a plain `COMMENT` review.** `REQUEST_CHANGES` only when the reviewer ticks it on the post form: the agent produces notes, not a merge block, and the human approves separately.
- **Approve posts a comment and then approves.** Pre-filled `LGTM` plus a checklist of blocker/should-fix findings, editable first.
- **`run-review.sh` never touches GitHub.** This is the property that makes the whole thing safe to run against a real review queue.
- **Slack dedup is per repo + PR + login, not per head SHA.** Each reviewer is pinged once per PR (`<repo>:<pr>:<login>` in `seen`); pushing new commits must not re-ping anyone. The dashboard reflects the live queue regardless.
- **One search per user per repo per poll, not a page-through.** `review-requested:<login>` resolves server-side, so the poll costs one API call per user per repository (plus one org-wide search per user when `REPO_ALLOW_ORG` is set), and page loads never call GitHub.
- **Writes use the acting user's token.** The service token is read-only by permission, not by convention.
- **The dashboard reads `.env` once.** Deliberate: the process should not change behaviour under you because a file was edited; a restart is an explicit act.

## Subsystems

- **Learnings** (`prbot_learn.py`): on post, each original finding is scored dropped/edited/kept and appended to `learnings.jsonl` as a short gist tagged with its repository. `render(repo)` folds recent dropped/edited rows into the next prompt, same-repository rows first and the team's general preferences after. Attributed per user.
- **Skills**: the team default is a file in a small git repo on the server; every save is a commit with the editor's login, and the page shows the log. `save_skill` refuses a blank; `restore_global_skill` needs a typed confirm. Quick-add tidies a plain-English rule into a managed `## Team rules` section kept last so appends are trivial. Each run records its skill id; learnings rows carry it; keep rate is per skill.
- **Agreement** (`prbot_agree.py`): findings from independent runs on the same head are matched; a finding is confirmed when raised by runs that differ in skill, model or effort.
- **Explain simply**: a one-turn Haiku call on the clicker's account, cached per finding content.
- **Stacked PRs**: walks the chain of open PRs whose base is the previous head, on demand.
- **Staleness**: the reviewed head SHA is recorded; the page flags a mismatch without re-running.
- **Suggestion blocks**: a finding's `suggestion` is appended to the body as a ```` ```suggestion ```` block on post.
- **Stop**: the run's pid is recorded; `POST /api/stop` kills the process group and writes `stopped`.
- **Handoff**: a short signed token lets a session move between alias hostnames of the same server without re-login. Only the server's own hosts are accepted.
- **Repository profile** (`prbot_profile.py`, `profile-repo.sh`): one profile per repository under `$ROOT/profiles/<slug>/`. `run-review.sh` merges its `risk_paths` into the banner rules and, for Standard and Deep runs, appends a "Critical paths for this repository" section listing only the paths the PR touches (cap 12, `why` cut to 200 chars) with their checks, the repo's rules and do-not-flag list; findings may carry `critical_path`, which the card badges and learnings keep so Insights can report the kept rate on critical paths. The profile hash is part of the re-run cache key. `GET/PUT /api/profile`, `POST /api/profile/run|stop` (signed `profile` token, connected Claude required); `POST /api/profile/auto` is called by `pr-watch.sh` with a server-secret HMAC when `auto_profile` is on and the tree changed materially, and runs as the admin on the admin's account. See [Repository profile](/reviewstage/guides/repo-profile/).

## Repository layout

```
bin/            server, scripts, Python helpers
dashboard-ui/   React SPA (esbuild, node --test, Playwright)
skills/         built-in Claude Code skills (pr-review, pr-qa-guide) and the seeded team default
docs/           SETUP, ARCHITECTURE, SECURITY, OPERATIONS (source for this site)
website/        this site (Astro + Starlight)
docker-compose.yml, .env.example, bin/doctor.sh
```
