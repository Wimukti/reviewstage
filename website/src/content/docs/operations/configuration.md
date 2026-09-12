---
title: Configuration
description: Every knob in .env, with its reasoning.
sidebar:
  order: 1
---

Everything lives in `.env` (Docker) or `~/.reviewstage/.env` (from source), chmod 600. `.env.example` documents each key. The dashboard reads the file **once at startup**; restart after any change. The poller and the review runner re-read it on every run.

## Required

| Key | What |
| --- | --- |
| `REPO` | `owner/name` of the repository to review. One repository per server. |
| `GITHUB_PAT` | Service token, **read-only** (Contents: read, Pull requests: read, Metadata: read). Used to poll review requests and clone the base repo. Never posts. |

## Safety

| Key | Default | What |
| --- | --- | --- |
| `DRY_RUN` | `1` | `1`: the dashboard works fully but refuses to write to GitHub, and saves the payload it would have sent. Flip to `0` only after a dry run you have compared by hand. |
| `SECRET` | generated | Signs sessions, action links and derives the key that encrypts stored tokens. Rotating it invalidates all three. |
| `MIN_FREE_MB` | `800` | Refuse to start a review below this much free memory. A run already in flight can still be killed by the OS. |

## Notifications

| Key | Default | What |
| --- | --- | --- |
| `SLACK_WEBHOOK` | empty | Incoming webhook URL. Send-only; replies are not threaded. |
| `SLACK_BOT_TOKEN` | empty | With `SLACK_CHANNEL`, posts via `chat.postMessage` and threads the review-ready reply. Takes precedence over the webhook. |
| `SLACK_CHANNEL` | empty | Channel ID for the bot token path. |

## Poller (team profile)

| Key | Default | What |
| --- | --- | --- |
| `SKIP_BOT_PRS` | `0` | `1` ignores PRs authored by bots. Default off: AI-written PRs are where a skeptical review pays off most. |
| `POLL_MINUTES` | `3` | How often to ask GitHub for review requests. One search per signed-in user per poll. |

## GitHub sign-in

Optional. Without it, the login page offers token sign-in only.

| Key | What |
| --- | --- |
| `GH_CLIENT_ID` / `GH_CLIENT_SECRET` | From an OAuth App (or GitHub App) whose callback URL is `<your-url>/oauth/callback`. |
| `GH_OAUTH_SCOPES` | OAuth App: the scope tokens should carry (`repo` for classic-style access; tick *Expire user access tokens* for 8-hour tokens refreshed server-side). GitHub App: leave **empty**; permissions come from the app. |

## Paths and hosting

| Key | Default | What |
| --- | --- | --- |
| `PUBLIC_URL` | `http://localhost:8899` | The URL users open. Used in Slack links and OAuth callbacks. |
| `PORT` | `8899` | Bind port. |
| `STATE_DIR` | `/data` (Docker) · `~/.reviewstage` (source) | Base clone, worktrees, per-PR state, users file, learnings, skills. Mount it as a volume. |
| `RISK_PATHS` | empty | Comma-separated path prefixes that raise the informational **risk** banner (for example `billing/,pricing/`). Never gates. |

## Runs

| Key | Default | What |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | empty | If set in the server's environment, `claude -p` uses it for anyone who has **not** connected their own Claude account. Otherwise such users cannot run reviews. |
| `REVIEW_TIMEOUTS` | `12,25,40` | Minutes for Quick, Standard, Deep. |

## Per-user data

Not in `.env`. The users file under `STATE_DIR` holds, per login: the encrypted GitHub token, the encrypted Claude token, the Slack member ID, display name and join date. It is written by the dashboard on sign-in. To remove a user, delete their key.

## Per-PR state

Under `STATE_DIR/state/<pr>/`:

| File | What |
| --- | --- |
| `review.json` | The agent's output: the artefact the dashboard renders. |
| `meta.json` | PR identity, cached so titles survive after the PR leaves the queue. |
| `status`, `effort`, `focus`, `skill`, `head`, `risk`, `pid` | Run metadata. |
| `agent.log`, `run.log` | What the agent did; the wrapper's log. |
| `history/<ts>/` | Earlier runs, complete. |
| `users/<login>/` | That person's `opened`, `posted.json`, `payload.json`, `approved`, `archived`. |
| `qa.md`, `qa.status`, `qa_meta.json` | The QA guide, if generated. |
