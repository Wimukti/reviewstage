---
title: Configuration
description: Every setting the code actually reads, one line each.
sidebar:
  order: 1
---

Settings live in `.env` (Docker; mirrored into the data volume on every start) or `~/.claude-pr-bot/.env` (from source; chmod 600). `config.example` lists the file's full shape, `.env.example` the Docker subset. The dashboard reads the file **once at startup**; restart after any change. The poller and the review runner re-read it on every run. The last five rows are read from the process environment only, not from `.env`.

| Setting | Default | What it does |
| --- | --- | --- |
| `REPO` | required | The GitHub repository this instance reviews, as `owner/name`. One repository per server. |
| `GITHUB_PAT` | required | The service token: reads PR metadata and diffs, clones the repo, runs the poller's searches. Never posts; comments and approvals use each signed-in reviewer's own token. Fine-grained PAT scoped to the repo: Pull requests read/write, Contents read, Metadata read. |
| `PUBLIC_URL` | required (Docker: `http://localhost:8899`) | Where browsers reach the dashboard. Every Slack button and the OAuth callback are built from it. No trailing slash. |
| `REVIEWER` | Docker: derived from `GITHUB_PAT` | The GitHub login the service token belongs to. From source, set it yourself; the Docker entrypoint fills it in by asking GitHub who the token is. |
| `PRBOT_SECRET` | generated on first start | Signs every dashboard link and session, and derives the key that encrypts stored tokens. Rotating it signs everyone out and invalidates outstanding Slack links and stored tokens. |
| `DRY_RUN` | `1` | `1`: the dashboard renders and the buttons work, but nothing is ever written to GitHub. Flip to `0` only after a dry run you have compared by hand, then restart. |
| `SKIP_BOT_PRS` | `0` | `1` skips PRs opened by bots. Default off: AI-written PRs are where a skeptical review pays off most. |
| `PRBOT_MAX_PR_AGE_DAYS` | `45` | The poller ignores review requests on PRs older than this many days. `0` disables the cutoff. |
| `MIN_FREE_MB` | `800` | Refuse to start a review below this much available RAM, in MB. |
| `PRBOT_PORT` | `8899` | The port the server listens on. Docker maps `127.0.0.1:${PRBOT_PORT}` to the container. |
| `SLACK_WEBHOOK` | empty | A Slack incoming webhook for review-request cards and "review ready" pings. Send-only: a fresh message each time. Point it at a private channel; cards name PR titles and authors. |
| `SLACK_BOT_TOKEN` | empty | With `SLACK_CHANNEL`, posts via `chat.postMessage` so the review-ready message threads under the review-request card. Takes precedence over the webhook. |
| `SLACK_CHANNEL` | empty | Channel ID for the bot-token path. |
| `GH_CLIENT_ID` | empty | Client ID of an OAuth App or GitHub App whose callback URL is `<PUBLIC_URL>/prbot/oauth/callback`. Leave empty and the login page offers token sign-in only. Restart after changing. |
| `GH_CLIENT_SECRET` | empty | The matching client secret. |
| `GH_OAUTH_SCOPES` | empty | OAuth App: set to `repo` (tick *Expire user access tokens* when creating the app and tokens last 8 hours, refreshed here automatically). GitHub App: leave empty; permissions come from the app. |
| `RISK_PATHS` | empty | Comma-separated `label:pattern` rules; a rule matches when a changed file path equals the glob or contains the substring, and the review then shows a "Touches *label* paths" banner. Context only, never a gate. Example: `billing:src/billing/,auth:*/auth/*`. |
| `PRBOT_HOST_ALIASES` | empty | Comma-separated extra hostnames that point at this instance. A visit on one hostname without a session bounces through another to pick up an existing login. |
| `PRBOT_DOMAIN` | empty | A parent domain to scope the session cookie to, so one login covers every alias. Empty = host-only cookies. |
| `PRBOT_ENV` | empty | Legacy. With `PRBOT_DOMAIN`, an `.env` without `PUBLIC_URL` derives it as `https://prbot-<PRBOT_ENV>.<PRBOT_DOMAIN>`. New installs set `PUBLIC_URL` and leave this empty. |
| `PRBOT_HOST` | empty | Legacy. Overrides the hostname derived from `PRBOT_ENV` + `PRBOT_DOMAIN`. |
| `POLL_INTERVAL` | `180` | Process environment only. Seconds between poller passes. In Docker, put it in `.env` and compose passes it through; from source, export it before starting the poller. |
| `PRBOT_BIND` | `127.0.0.1` | Process environment only. Address the server binds. `0.0.0.0` inside a container; keep loopback with a reverse proxy in front otherwise. |
| `PRBOT_COOKIE_SECURE` | `1` | Process environment only. `0` drops the `Secure` flag from the session cookie for a plain-http install. The Docker entrypoint sets it to `0` when `PUBLIC_URL` starts with `http://`. |
| `ROOT` | `~/.claude-pr-bot` | Process environment only. Base directory for `.env`, the base clone, worktrees, per-PR state, `users.json`, learnings and skills. Docker mounts the data volume here. |

## Things that are not settings

- **Poll frequency** is `POLL_INTERVAL` above; there is no minutes-based key.
- **Review timeouts** come from the effort level chosen when starting a run: Quick 12 minutes, Standard 25, Deep 40. They are fixed in `bin/run-review.sh`.
- **Request changes** is a checkbox on the post form, per review. The default review event is `COMMENT`; the agent never sets it.
- **Claude credentials** are per user: each reviewer connects their own Claude account in *Integrations*, and their runs use that token. There is no server-wide API key setting; a user who has not connected Claude cannot run reviews.
- **Per-user data** (encrypted GitHub and Claude tokens, Slack member ID) lives in `ROOT/users.json`, written by the dashboard on sign-in. To remove a user, delete their key.
