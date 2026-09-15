---
title: Configuration
description: Every setting the code actually reads, one line each.
sidebar:
  order: 1
---

Settings live in `.env` (Docker; mirrored into the data volume on every start) or `~/.reviewstage/.env` (from source; chmod 600). `config.example` lists the file's full shape, `.env.example` the Docker subset. The dashboard reads the file **once at startup**; restart after any change. The poller and the review runner re-read it on every run. The rows marked *process environment only* are not written to `.env` by either installer and are not read from it by the server.

A handful of operational knobs can also be changed **live** from the dashboard's Settings page; those are stored in `settings.json` and take precedence over `.env` — see [Runtime settings](#runtime-settings) below.

| Setting | Default | What it does |
| --- | --- | --- |
| `REPOS` | required (or `REPO`) | The GitHub repositories this instance reviews, as `owner/name`, comma-separated (quote the value if you separate with spaces — the file is sourced by bash). One install, many repositories. Each entry is validated as `owner/name` at startup. |
| `REPO` | empty | Single-entry alias for `REPOS`, kept for existing installs. If both are set the lists are unioned. |
| `REPO_ALLOW_ORG` | empty | An org (or user) whose repositories are accepted on demand in addition to `REPOS`: the poller discovers them by searching each signed-in user's open review requests under that owner, and the base clone is made on the first review. The service token must be able to see the org. |
| `GITHUB_PAT` | required | The service token: reads PR metadata and diffs, clones the repos, runs the poller's searches. Never posts; comments and approvals use each signed-in reviewer's own token. Fine-grained PAT scoped to the repos (or all repos under the owner when using `REPO_ALLOW_ORG`): Pull requests read/write, Contents read, Metadata read. |
| `PUBLIC_URL` | required (Docker: `http://localhost:8899`) | Where browsers reach the dashboard. Every Slack button and the OAuth callback are built from it. No trailing slash. |
| `REVIEWER` | Docker: derived from `GITHUB_PAT` | The GitHub login the service token belongs to. From source, set it yourself; the Docker entrypoint fills it in by asking GitHub who the token is. |
| `RS_SECRET` | generated on first start | Signs every dashboard link and session, and derives the key that encrypts stored tokens. Rotating it signs everyone out and invalidates outstanding Slack links and stored tokens. |
| `DRY_RUN` | `1` | `1`: the dashboard renders and the buttons work, but nothing is ever written to GitHub. Flip to `0` only after a dry run you have compared by hand, then restart. |
| `SKIP_BOT_PRS` | `0` | `1` skips PRs opened by bots. Default off: AI-written PRs are where a skeptical review pays off most. Overridable in Settings. |
| `RS_MAX_PR_AGE_DAYS` | `45` | The poller ignores review requests on PRs older than this many days. `0` disables the cutoff. Overridable in Settings. |
| `MIN_FREE_MB` | `800` | Refuse to start a review below this much **available** RAM, in MB (read from `/proc/meminfo`; the check is skipped where that does not exist). The default means a 1 GB host cannot start a single review — give the machine 2 GB rather than lowering this. |
| `MIN_FREE_DISK_MB` | `1024` | `bin/doctor.sh` only. FAIL the disk check below this much free space on `ROOT`. Nothing else reads it; it does not gate a review. |
| `RS_MODEL` | empty | Overrides the model for a review started outside the dashboard, and for `bin/profile-repo.sh` (which defaults to `sonnet`). The dashboard sets the model per run from the run form, so this is a from-the-shell knob. |
| `RS_PORT` | `8899` | The port the server binds. **Do not put this in a Docker install's `.env`.** Compose reads the same file twice — to interpolate the host side of `127.0.0.1:${RS_PORT}:8899`, *and* as `env_file` for the container — so setting it there moves the server inside the container while the publish still targets 8899, and the dashboard silently stops answering. To change the host port, set it in the shell for that one command: `RS_PORT=9000 docker compose up -d`. From source there is no second reader and `.env` is the right place. |
| `SLACK_WEBHOOK` | empty | A Slack incoming webhook for review-request cards and "review ready" pings. Send-only: a fresh message each time. Point it at a private channel; cards name PR titles and authors. |
| `SLACK_BOT_TOKEN` | empty | With `SLACK_CHANNEL`, posts via `chat.postMessage` so the review-ready message threads under the review-request card. Takes precedence over the webhook. |
| `SLACK_CHANNEL` | empty | Channel ID for the bot-token path. |
| `DISCORD_WEBHOOK` | empty | A Discord channel webhook. Cards arrive as an embed and mention the reviewer's saved Discord user ID. |
| `WEBHOOK_URL` | empty | Any JSON endpoint (Teams, Zapier, n8n, your own). Every event is one `POST` of the raw payload; see [Notifications](/reviewstage/guides/notifications/#generic-webhook). |
| `WEBHOOK_SECRET` | empty | With `WEBHOOK_URL`, signs each body: `X-ReviewStage-Signature: sha256=HMAC-SHA256(secret, body)`. |
| `GITHUB_WEBHOOK_SECRET` | empty | Enables `POST /webhooks/github`: every delivery's `X-Hub-Signature-256` is verified against it. Unset, the endpoint answers 503 and polling does all the work. See [GitHub webhooks](#github-webhooks). |
| `NOTIFY_BACKENDS` | derived | Comma list of `slack`, `discord`, `generic`, `none`. Empty = whichever of the URLs above are set. Overridable in Settings. |
| `GH_DEVICE_FLOW` | `1` | **Sign in with GitHub** via GitHub's device flow, on every install with nothing to register: the login page shows a short code to enter at github.com/login/device. `0` turns it off. See [GitHub sign-in](#github-sign-in). |
| `GH_DEVICE_CLIENT_ID` | `Ov23liHjtjxcPNwXC6Y5` | The OAuth App the device flow uses. The default is the project's shared **public** client ID (device flow has no secret and no callback; the token goes from GitHub straight to your server). Set your own app's ID to sign in under your identity — tick *Enable Device Flow* on it. |
| `GH_CLIENT_ID` | empty | Client ID of an OAuth App or GitHub App whose callback URL is `<PUBLIC_URL>/oauth/callback`. With it set, **Sign in with GitHub** goes through GitHub's redirect flow (one click, no code) instead of the device flow; empty, the device flow serves the same button. Restart after changing. See [GitHub sign-in](#github-sign-in). |
| `GH_CLIENT_SECRET` | empty | The matching client secret. Both must be set for the redirect flow to be enabled. |
| `GH_OAUTH_SCOPES` | empty | OAuth App: `repo` — the smallest classic scope that can comment on and approve a PR in a private repository (`public_repo` if every repo is public). OAuth Apps cannot request fine-grained permissions. GitHub App: leave empty; permissions come from the app. Tick *Expire user access tokens* on either and tokens last 8 hours, refreshed here automatically. |
| `RISK_PATHS` | empty | Comma-separated `label:pattern` rules; a rule matches when a changed file path equals the glob or contains the substring, and the review then shows a "Touches *label* paths" banner. Context only, never a gate. Example: `billing:src/billing/,auth:*/auth/*`. |
| `RISK_PATHS__<OWNER>__<NAME>` | unset | Per-repository override of `RISK_PATHS`. The key is the repo upper-cased with `/` → `__` and any other character outside `A-Z0-9_` → `_`: `acme/widgets-web` → `RISK_PATHS__ACME__WIDGETS_WEB`. When set (even empty) it replaces the global list for that repo. |
| `RULE_SUGGEST_MIN` | `3` | How many dropped (or reworded) findings of the same complaint, from at least two different PRs, before it is offered as a proposed Team rule on the Skills page. Minimum 2. Raise it on a noisy repository; nothing is ever added to a skill without someone clicking Accept. See [Skills and learnings](/reviewstage/guides/skills-and-learnings/#from-a-repeated-rejection-to-a-proposed-rule). |
| `RS_SIGNATURE_GRACE_DAYS` | `7` | Signed links cover `action:owner/name#pr:expiry`. Links minted before the repository dimension existed (`action:pr:expiry`) keep verifying for this many days after the first start of the repo-aware server, so Slack cards already sent keep working. `0` rejects them at once. |
| `RS_HOST_ALIASES` | empty | Comma-separated extra hostnames that point at this instance. A visit on one hostname without a session bounces through another to pick up an existing login. |
| `RS_DOMAIN` | empty | A parent domain to scope the session cookie to, so one login covers every alias. Empty = host-only cookies. |
| `RS_ENV` | empty | Legacy. With `RS_DOMAIN`, an `.env` without `PUBLIC_URL` derives it as `https://reviewstage-<RS_ENV>.<RS_DOMAIN>`. New installs set `PUBLIC_URL` and leave this empty. |
| `RS_HOST` | empty | Legacy. Overrides the hostname derived from `RS_ENV` + `RS_DOMAIN`. |
| `RS_USER` | the invoking user | `bin/bootstrap.sh` only (from source). The account the systemd unit runs as. |
| `SETUP_APACHE` | `0` | `bin/bootstrap.sh` only. `1` makes it write and enable an Apache vhost for `PUBLIC_URL`'s hostname; otherwise it prints what to configure and you bring your own proxy. |
| `CLAUDE_CODE_VERSION` | `latest` | Docker **build arg**, not a runtime setting. Pins `@anthropic-ai/claude-code` in the image: `docker compose build --build-arg CLAUDE_CODE_VERSION=1.2.3`. |
| `POLL_INTERVAL` | `180` | Seconds between poller passes when Settings has not set `poll_interval_seconds`. Read from the process environment by `poller-loop.sh` (the Docker poller's loop, which does not source `.env`) and from `.env` by `pr-watch.sh`; the dashboard shows the `.env` value on the Settings page. Prefer the Settings page — it applies without a restart and governs both. |
| `RS_BIND` | `127.0.0.1` | Process environment only (the image sets `0.0.0.0`). Address the server binds. `0.0.0.0` inside a container; keep loopback with a reverse proxy in front otherwise. |
| `RS_COOKIE_SECURE` | `1` | Process environment only. `0` drops the `Secure` flag from the session cookie for a plain-http install. The Docker entrypoint sets it to `0` when `PUBLIC_URL` starts with `http://`. |
| `ROOT` | `~/.reviewstage` | Process environment only. Base directory for `.env`, the base clones (`repos/<owner>__<name>`), worktrees, per-PR state (`state/<owner>__<name>/<pr>`), `users.json`, learnings and skills. Docker mounts the data volume here. |

## GitHub sign-in

**Sign in with GitHub works out of the box** through GitHub's device flow (`GH_DEVICE_FLOW=1`, the default) with the project's shared public client ID: a short code at github.com/login/device, nothing to register. Teams that want one-click redirect sign-in, or their own app identity on the consent screen, set the three `GH_*` keys below; when they are set the redirect flow is preferred. Either way the token GitHub returns is stored encrypted exactly like a pasted PAT and is the token used for that person's comments and approvals; a GitHub-sign-in user never needs a PAT. Set-up is in [Install → GitHub sign-in](/reviewstage/start/install/#github-sign-in); what the token can do, and why the scope is `repo`, is in [Security → Signing in](/reviewstage/security/#signing-in).

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
| `max_pr_age_days` | int, 0–3,650 | `45` | `RS_MAX_PR_AGE_DAYS` | Suppress cards for PRs opened more than this many days ago; `0` = no cutoff. |
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
- **`ANTHROPIC_API_KEY` is not read anywhere.** There is no server-wide API key and no fallback: a review runs on the clicking user's connected Claude account or it does not run.
- **`RS_ACTOR`, `RS_EFFORT`, `RS_FOCUS`, `RS_DEPTH`, `RS_SKILL_CHOICE`, `RS_STACK`, `RS_CACHE_KEY`, `RS_RUN_AS`** are set by the server when it spawns `run-review.sh`, per run. They are not configuration; setting them in `.env` does nothing useful.

## Keeping this page honest

Every key above was re-checked against the code for this release. If you add a setting, add the row in the same change — a key that is read by `bin/` and named nowhere here, or named here and read nowhere, is a bug in this page.
