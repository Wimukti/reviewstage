---
title: Configuration
description: Every setting the code actually reads, one line each.
sidebar:
  order: 1
---

Settings live in `.env` (Docker; mirrored into the data volume on every start) or `~/.claude-pr-bot/.env` (from source; chmod 600). `config.example` lists the file's full shape, `.env.example` the Docker subset. The dashboard reads the file **once at startup**; restart after any change. The poller and the review runner re-read it on every run. The last five rows are read from the process environment only, not from `.env`.

A handful of operational knobs can also be changed **live** from the dashboard's Settings page; those are stored in `settings.json` and take precedence over `.env` — see [Runtime settings](#runtime-settings) below.

| Setting | Default | What it does |
| --- | --- | --- |
| `REPOS` | required (or `REPO`) | The GitHub repositories this instance reviews, as `owner/name`, comma-separated (quote the value if you separate with spaces — the file is sourced by bash). One install, many repositories. Each entry is validated as `owner/name` at startup. |
| `REPO` | empty | Single-entry alias for `REPOS`, kept for existing installs. If both are set the lists are unioned. |
| `REPO_ALLOW_ORG` | empty | An org (or user) whose repositories are accepted on demand in addition to `REPOS`: the poller discovers them by searching each signed-in user's open review requests under that owner, and the base clone is made on the first review. The service token must be able to see the org. |
| `GITHUB_PAT` | required | The service token: reads PR metadata and diffs, clones the repos, runs the poller's searches. Never posts; comments and approvals use each signed-in reviewer's own token. Fine-grained PAT scoped to the repos (or all repos under the owner when using `REPO_ALLOW_ORG`): Pull requests read/write, Contents read, Metadata read. |
| `PUBLIC_URL` | required (Docker: `http://localhost:8899`) | Where browsers reach the dashboard. Every Slack button and the OAuth callback are built from it. No trailing slash. |
| `REVIEWER` | Docker: derived from `GITHUB_PAT` | The GitHub login the service token belongs to. From source, set it yourself; the Docker entrypoint fills it in by asking GitHub who the token is. |
| `PRBOT_SECRET` | generated on first start | Signs every dashboard link and session, and derives the key that encrypts stored tokens. Rotating it signs everyone out and invalidates outstanding Slack links and stored tokens. |
| `DRY_RUN` | `1` | `1`: the dashboard renders and the buttons work, but nothing is ever written to GitHub. Flip to `0` only after a dry run you have compared by hand, then restart. |
| `SKIP_BOT_PRS` | `0` | `1` skips PRs opened by bots. Default off: AI-written PRs are where a skeptical review pays off most. Overridable in Settings. |
| `PRBOT_MAX_PR_AGE_DAYS` | `45` | The poller ignores review requests on PRs older than this many days. `0` disables the cutoff. Overridable in Settings. |
| `MIN_FREE_MB` | `800` | Refuse to start a review below this much available RAM, in MB. |
| `PRBOT_PORT` | `8899` | The port the server listens on. Docker maps `127.0.0.1:${PRBOT_PORT}` to the container. |
| `SLACK_WEBHOOK` | empty | A Slack incoming webhook for review-request cards and "review ready" pings. Send-only: a fresh message each time. Point it at a private channel; cards name PR titles and authors. |
| `SLACK_BOT_TOKEN` | empty | With `SLACK_CHANNEL`, posts via `chat.postMessage` so the review-ready message threads under the review-request card. Takes precedence over the webhook. |
| `SLACK_CHANNEL` | empty | Channel ID for the bot-token path. |
| `DISCORD_WEBHOOK` | empty | A Discord channel webhook. Cards arrive as an embed and mention the reviewer's saved Discord user ID. |
| `WEBHOOK_URL` | empty | Any JSON endpoint (Teams, Zapier, n8n, your own). Every event is one `POST` of the raw payload; see [Notifications](/reviewstage/guides/notifications/#generic-webhook). |
| `WEBHOOK_SECRET` | empty | With `WEBHOOK_URL`, signs each body: `X-ReviewStage-Signature: sha256=HMAC-SHA256(secret, body)`. |
| `GITHUB_WEBHOOK_SECRET` | empty | Enables `POST /webhooks/github`: every delivery's `X-Hub-Signature-256` is verified against it. Unset, the endpoint answers 503 and polling does all the work. See [GitHub webhooks](#github-webhooks). |
| `NOTIFY_BACKENDS` | derived | Comma list of `slack`, `discord`, `generic`, `none`. Empty = whichever of the URLs above are set. Overridable in Settings. |
| `GH_CLIENT_ID` | empty | Client ID of an OAuth App or GitHub App whose callback URL is `<PUBLIC_URL>/prbot/oauth/callback`. With it set, **Continue with GitHub** is the login page's primary action and the token form moves behind a disclosure; empty, the page offers token sign-in only plus a hint for the admin. Restart after changing. See [GitHub sign-in](#github-sign-in). |
| `GH_CLIENT_SECRET` | empty | The matching client secret. Both must be set for sign-in to be enabled. |
| `GH_OAUTH_SCOPES` | empty | OAuth App: `repo` — the smallest classic scope that can comment on and approve a PR in a private repository (`public_repo` if every repo is public). OAuth Apps cannot request fine-grained permissions. GitHub App: leave empty; permissions come from the app. Tick *Expire user access tokens* on either and tokens last 8 hours, refreshed here automatically. |
| `RISK_PATHS` | empty | Comma-separated `label:pattern` rules; a rule matches when a changed file path equals the glob or contains the substring, and the review then shows a "Touches *label* paths" banner. Context only, never a gate. Example: `billing:src/billing/,auth:*/auth/*`. |
| `RISK_PATHS__<OWNER>__<NAME>` | unset | Per-repository override of `RISK_PATHS`. The key is the repo upper-cased with `/` → `__` and any other character outside `A-Z0-9_` → `_`: `acme/widgets-web` → `RISK_PATHS__ACME__WIDGETS_WEB`. When set (even empty) it replaces the global list for that repo. |
| `PRBOT_SIGNATURE_GRACE_DAYS` | `7` | Signed links cover `action:owner/name#pr:expiry`. Links minted before the repository dimension existed (`action:pr:expiry`) keep verifying for this many days after the first start of the repo-aware server, so Slack cards already sent keep working. `0` rejects them at once. |
| `PRBOT_HOST_ALIASES` | empty | Comma-separated extra hostnames that point at this instance. A visit on one hostname without a session bounces through another to pick up an existing login. |
| `PRBOT_DOMAIN` | empty | A parent domain to scope the session cookie to, so one login covers every alias. Empty = host-only cookies. |
| `PRBOT_ENV` | empty | Legacy. With `PRBOT_DOMAIN`, an `.env` without `PUBLIC_URL` derives it as `https://prbot-<PRBOT_ENV>.<PRBOT_DOMAIN>`. New installs set `PUBLIC_URL` and leave this empty. |
| `PRBOT_HOST` | empty | Legacy. Overrides the hostname derived from `PRBOT_ENV` + `PRBOT_DOMAIN`. |
| `POLL_INTERVAL` | `180` | Process environment only. Seconds between poller passes when Settings has not set `poll_interval_seconds`. Prefer the Settings page: it applies without a restart. |
| `PRBOT_BIND` | `127.0.0.1` | Process environment only. Address the server binds. `0.0.0.0` inside a container; keep loopback with a reverse proxy in front otherwise. |
| `PRBOT_COOKIE_SECURE` | `1` | Process environment only. `0` drops the `Secure` flag from the session cookie for a plain-http install. The Docker entrypoint sets it to `0` when `PUBLIC_URL` starts with `http://`. |
| `ROOT` | `~/.claude-pr-bot` | Process environment only. Base directory for `.env`, the base clones (`repos/<owner>__<name>`), worktrees, per-PR state (`state/<owner>__<name>/<pr>`), `users.json`, learnings and skills. Docker mounts the data volume here. |

## GitHub sign-in

The three `GH_*` keys turn on **Sign in with GitHub**. The token GitHub returns is stored encrypted exactly like a pasted PAT and is the token used for that person's comments and approvals; an OAuth user never needs a PAT. Set-up is in [Install → GitHub sign-in](/reviewstage/start/install/#github-sign-in); what the token can do, and why the scope is `repo`, is in [Security → Signing in](/reviewstage/security/#signing-in).

Two kinds of app work:

| | OAuth App | GitHub App |
| --- | --- | --- |
| Needs an org owner | No (unless the org restricts third-party apps) | Yes — installed on the org |
| `GH_OAUTH_SCOPES` | `repo` | empty |
| Permissions | Classic scope: every repo the user can write to | *Pull requests: write*, *Contents: read* on the installed repos only |
| Revocation | The user, at github.com/settings/applications | The user, or the org owner centrally |
| Status | Supported today | Supported today; the roadmap default |

Device tokens for phones and the CLI have no `.env` knob: they are per-user, created and revoked in Settings → Devices, expire 180 days after last use, and are pruned by the poller nightly.

## Runtime settings

The dashboard's **Settings** page (Setup group; admin only — everyone else sees it read-only) writes `ROOT/settings.json`. The poller re-reads it every cycle and `pr-watch.sh` / `notify.sh` read it on every run, so a change applies within seconds and never needs a restart or an `.env` edit.

Precedence for every key it carries: **`settings.json` > `.env` > default**. Only keys present in the file override, so an install that never opened Settings behaves exactly as its `.env` says. Each row on the page shows where the current value comes from.

```json
{
  "poller_enabled": true,
  "poll_interval_seconds": 180,
  "notify_backends": ["slack", "discord"],
  "max_pr_age_days": 45,
  "skip_bot_prs": false,
  "auto_profile": { "acme__widgets": true },
  "updated_at": 1789265317
}
```

| Key | Type / range | Default | `.env` fallback | Effect |
| --- | --- | --- | --- | --- |
| `poller_enabled` | bool | `true` | — | `false` pauses `pr-watch.sh` (the poller service keeps running and logs that it is paused; a cron-driven `pr-watch.sh` exits at once). |
| `poll_interval_seconds` | int, 60–3,600 | `180` | `POLL_INTERVAL` | Seconds between polls; the loop notices a new value within 15 s. |
| `notify_backends` | list of `slack` / `discord` / `generic` / `none` | derived from configured URLs | `NOTIFY_BACKENDS` | Which backends `notify_card` posts to. `none` cannot be combined with others. |
| `max_pr_age_days` | int, 0–3,650 | `45` | `PRBOT_MAX_PR_AGE_DAYS` | Suppress cards for PRs opened more than this many days ago; `0` = no cutoff. |
| `skip_bot_prs` | bool | `false` | `SKIP_BOT_PRS` | Skip bot-authored PRs entirely. |
| `auto_profile` | object, repo slug (`owner__name`) → bool | `{}` | — | Re-profile that repository automatically when its file tree changes materially (checked by `pr-watch.sh` at most once a day; runs as the admin on the admin's connected Claude account, skipped with a log line otherwise). Set from the Skills page's **Repository profile** card, admin only. See [Repository profile](/reviewstage/guides/repo-profile/). |

`DRY_RUN` is deliberately **not** a runtime setting: flipping GitHub writes on stays an `.env` edit plus a restart.

The **admin** is the `REVIEWER` login from `.env`; if that is empty, the user flagged `"admin": true` in `users.json`; if nobody is flagged, the first user who signed in (flagged automatically at that point so the choice is stable). `/api/me` reports `is_admin`. The API is `GET /api/settings` (anyone signed in) and `PUT /api/settings` (admin, with the signed token from the GET); the file is written atomically. `poller.last` next to it holds the epoch of the last completed poll, shown on the page.

## GitHub webhooks

Polling finds a review request up to one interval late; a webhook delivers it within a second. Both write the same queue and share the same dedup key, so turning webhooks on changes latency, not behaviour.

1. `openssl rand -hex 32` → `GITHUB_WEBHOOK_SECRET=…` in `.env`, restart the dashboard.
2. GitHub → repository or organization → **Settings → Webhooks → Add webhook**: payload URL `<PUBLIC_URL>/webhooks/github`, content type `application/json`, the same secret, events **Pull requests** + **Pull request reviews**.
3. Watch **Settings → Webhooks** on the dashboard: *Last ping* fills in on save, the light turns from amber *polling only* to green *webhooks active* once a verified event has arrived within two poll intervals.

What the receiver does with each event is listed in [Notifications → From GitHub webhooks](/reviewstage/guides/notifications/#from-github-webhooks). It ignores repositories outside `REPOS` / `REPO_ALLOW_ORG`, never starts a review, and responds `202` before doing any work. State lives in `ROOT/webhooks.json` (`last_event_at`, `last_event`, `last_ping`, `count`, `last_error`), which `/api/settings` exposes.

Keep the poller on. When a webhook event arrived within `2 × poll_interval_seconds`, `pr-watch.sh` logs `webhooks active; poll is a safety net` and otherwise runs unchanged — it is the recovery path for a missed delivery. Once the light is green you can lower the interval or pause polling from the Poller card; nothing does that for you. GitHub must be able to reach the one path — `deploy/README.md` covers the Tailscale and Cloudflare Access cases.

## Things that are not settings

- **Poll frequency** is the `poll_interval_seconds` runtime setting above (or `POLL_INTERVAL` as a fallback); there is no minutes-based `.env` key.
- **Review timeouts** come from the effort level chosen when starting a run: Quick 12 minutes, Standard 25, Deep 40. They are fixed in `bin/run-review.sh`.
- **Request changes** is a checkbox on the post form, per review. The default review event is `COMMENT`; the agent never sets it.
- **Claude credentials** are per user: each reviewer connects their own Claude account in *Integrations*, and their runs use that token. There is no server-wide API key setting; a user who has not connected Claude cannot run reviews.
- **Per-user data** (encrypted GitHub and Claude tokens, Slack member ID, Discord user ID, the `admin` flag) lives in `ROOT/users.json`, written by the dashboard on sign-in. To remove a user, delete their key.
