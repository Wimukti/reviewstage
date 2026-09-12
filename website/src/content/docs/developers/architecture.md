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
| `bin/prbot_diff.py` | imported | Diff-anchor validation so GitHub cannot 422 a whole review. |
| `bin/prbot_learn.py` | imported | Learnings loop: scores kept/edited/dropped, renders recent decisions into the next prompt, scores skills. |
| `bin/prbot_agree.py` | imported | Matches findings across independent runs; independence-weighted agreement. |
| `bin/prbot_rollup.py` | imported | Insights aggregation. |
| `bin/prbot_md.py` | imported | Dependency-free markdown → HTML. |
| `bin/lib-common.sh` | sourced | Config, HMAC link signing, Slack posting (webhook or bot token). |
| `dashboard-ui/` | built once | React 18 + TypeScript SPA: queue, PR page, stack page, QA, skills, learnings, insights, integrations, tour, command palette. |
| `skills/pr-review/` · `skills/pr-qa-guide/` | installed | The built-in review and QA-guide procedures, as Claude Code skills. |

The backend is Python's standard library plus bash, `gh`, `jq`, `git`, `openssl` and `claude`. There is no database; state is files.

## Request flow

```
browser ──HTTPS──▶ reverse proxy ──▶ prbot-server.py (127.0.0.1:8899)
                                        ├─ GET  /            SPA shell (React Router handles the rest)
                                        ├─ GET  /api/*       me · queue · pr · qa · skills · learnings · rollup · stack
                                        ├─ POST /api/review  start_review → spawn run-review.sh (session leader)
                                        ├─ POST /api/post    decrypt clicker's token → validate anchors → COMMENT review
                                        ├─ POST /api/approve LGTM comment → APPROVE, as the clicker
                                        ├─ POST /api/stop · /api/explain · /api/markdone · /api/archive · /api/skill/* · /api/claude/*
                                        └─ GET  /oauth/start · /oauth/callback · /health
```

Every `POST` carries an HMAC token minted at render time (30 minutes) over `action:pr:expiry`. Pages are gated by the session cookie, not a signature, so they stay bookmarkable.

## The review step

`start_review` records effort, focus, model and the clicker's login, archives any previous run into `history/<ts>/`, then spawns `run-review.sh` as a new session leader (so **Stop** can kill the whole process group). The script:

1. Fetches the PR head and creates a **git worktree** per reviewer per PR, so two people never collide.
2. Picks the skill: the clicker's personal skill if selected, else the editable team default, else the installed built-in. It runs that skill's logic and **always appends an explicit `review.json` output contract**, so any skill yields the shape the dashboard needs.
3. Renders recent learnings and the focus note into the prompt, plus a depth instruction for the effort level.
4. Runs `claude -p` headless with `--allowedTools "Bash Read Glob Grep Write"`, an optional `--model`, and a timeout (12/25/40 minutes by effort), with the clicker's Claude token in the environment.
5. Parses token usage and the model from the stream log, records the head SHA (for staleness) and a path-based risk flag, copies `review.json` out, and removes the worktree.

The prompt tells the agent a human will read `explainer` and `analysis` in a dashboard to decide whether to trust the findings. That framing is load-bearing: it is what makes the prose readable rather than a wall of bullets.

A run keyed on (login, head, effort, focus, model, skill) is cached; an identical request reuses the earlier result.

## Per-PR state

`STATE_DIR/state/<pr>/` holds the shared run (`review.json`, `meta.json`, `status`, `effort`, `focus`, `skill`, `head`, `risk`, `pid`, logs, `history/`). Per-user markers live one level down in `users/<login>/` (`opened`, `posted.json`, `payload.json`, `approved`, `archived`). `queue.json` rows carry `requested: [logins]`, the union of everyone awaiting the PR, and the dashboard filters on it so one poller output serves every user.

`meta.json` exists because `queue.json` only holds PRs *currently* awaiting review; the moment you post, the PR leaves it, and without the cache the dashboard would lose the title of the review you just ran.

## Design decisions worth defending

- **Posting is always a plain `COMMENT` review.** Never `REQUEST_CHANGES`: these are review notes, not a merge block, and the human approves separately.
- **Approve posts a comment and then approves.** Pre-filled `LGTM` plus a checklist of blocker/should-fix findings, editable first.
- **`run-review.sh` never touches GitHub.** This is the property that makes the whole thing safe to run against a real review queue.
- **Slack dedup is per PR + login, not per head SHA.** Each reviewer is pinged once per PR; pushing new commits must not re-ping anyone. The dashboard reflects the live queue regardless.
- **One search per user per poll, not a page-through.** `review-requested:<login>` resolves server-side, so the poll costs one API call per user, and page loads never call GitHub.
- **Writes use the acting user's token.** The service token is read-only by permission, not by convention.
- **The dashboard reads `.env` once.** Deliberate: the process should not change behaviour under you because a file was edited; a restart is an explicit act.

## Subsystems

- **Learnings** (`prbot_learn.py`): on post, each original finding is scored dropped/edited/kept and appended to `learnings.jsonl` as a short gist. `render()` folds recent dropped/edited rows into the next prompt. Shared per repository, attributed per user.
- **Skills**: the team default is a file in a small git repo on the server; every save is a commit with the editor's login, and the page shows the log. `save_skill` refuses a blank; `restore_global_skill` needs a typed confirm. Quick-add tidies a plain-English rule into a managed `## Team rules` section kept last so appends are trivial. Each run records its skill id; learnings rows carry it; keep rate is per skill.
- **Agreement** (`prbot_agree.py`): findings from independent runs on the same head are matched; a finding is confirmed when raised by runs that differ in skill, model or effort.
- **Explain simply**: a one-turn Haiku call on the clicker's account, cached per finding content.
- **Stacked PRs**: walks the chain of open PRs whose base is the previous head, on demand.
- **Staleness**: the reviewed head SHA is recorded; the page flags a mismatch without re-running.
- **Suggestion blocks**: a finding's `suggestion` is appended to the body as a ```` ```suggestion ```` block on post.
- **Stop**: the run's pid is recorded; `POST /api/stop` kills the process group and writes `stopped`.
- **Handoff**: a short signed token lets a session move between alias hostnames of the same server without re-login. Only the server's own hosts are accepted.

## Repository layout

```
bin/            server, scripts, Python helpers
dashboard-ui/   React SPA (Vite, Vitest, Playwright)
skills/         built-in Claude Code skills (pr-review, pr-qa-guide) and the seeded team default
docs/           SETUP, ARCHITECTURE, SECURITY, OPERATIONS (source for this site)
website/        this site (Astro + Starlight)
docker-compose.yml, .env.example, bin/doctor.sh
```
