# Changelog

All notable changes to ReviewStage. Dates are MM/DD/YY.

## Unreleased

## v1.0.0-rc.9 — 09/14/26

Sign in with GitHub out of the box via device flow.

- **Sign in with GitHub works on every install with zero admin setup.** The login page's primary button now uses GitHub's OAuth device flow with a shared public client ID (`Ov23liHjtjxcPNwXC6Y5`): a short code to enter at github.com/login/device, a Copy button, a live "Waiting for GitHub…" status, and the page signs you in by itself. No OAuth App to register, no callback URL, no secret — the token goes from GitHub straight to your server. `GH_DEVICE_FLOW=0` turns it off; `GH_DEVICE_CLIENT_ID` uses your own device-flow-enabled app.
- New endpoints `POST /api/auth/device/start` and `POST /api/auth/device/poll` (`bin/rs_device_flow.py`); the browser never sees GitHub's `device_code`, polls faster than GitHub's interval get `429`, pending sign-ins are capped at 50 and purged. Device-flow users are `login_via: "oauth"` and post/approve through `user_pat()` unchanged. `/api/me` reports `device_flow`.
- The redirect flow (`GH_CLIENT_ID` / `GH_CLIENT_SECRET`) stays for teams that want one click or their own app identity, and is preferred when configured. Its button reads **Sign in with GitHub** (was *Continue with GitHub*). The "Running this server?" hint only shows when both GitHub flows are off. A sign-in completed on `/login` now lands on `?next=` (or the queue) instead of the SPA's Not found page.
- Docs: Install, Setup, Security, Configuration, First review and the README describe the device flow and why the scope is `repo`; the demo fixture sets `GH_DEVICE_FLOW=0` so it stays offline.
- Tests: `bin/test_rs_device_flow.py` (fake GitHub: pending, slow_down, expired, denied, ok, interval guard, cap/purge) and Playwright `e2e/device-flow.spec.ts` (code shown, poll resolves, app loads; denied; expired; device pairing).

## v1.0.0-rc.5 — 09/14/26

First-run fixes from live testing (Docker install, one repo, one reviewer).

- The PR page no longer flashes "The review stopped before it finished" while a review is starting: liveness comes from the per-PR flock **or** a live pid **or** a status written in the last 90 s (`bin/rs_state.py`, tested in `bin/test_rs_state.py`); every stalled verdict logs one diagnosable line. The banner offers Stop when the run's process group is still alive.
- The guided tour actually appears on a first sign-in: it waits for the queue card (empty state included) instead of checking once at mount.
- Connect (Claude) and Sign in with token show a spinner and disabled inputs while verifying; a failed Claude code is reported inline.
- Login recommends a fine-grained PAT (Pull requests r/w, Contents r, Metadata r) and still accepts a classic `repo` token; docs and the install page agree.

- **Breaking:** internal identifiers renamed (`PRBOT_*` → `RS_*`, `~/.claude-pr-bot` → `~/.reviewstage`, `/prbot` prefix removed, OAuth callback now `/oauth/callback`, cookie `rs_session`). No migration; delete old state or move the directory by hand. The server file is `bin/server.py`, the helpers `bin/rs_*.py`, the systemd unit `reviewstage.service`, the Apache vhost `reviewstage.conf`, and the Docker volume mounts at `/home/reviewstage/.reviewstage`.

## v1.0.0-rc.3 — 09/13/26

- GitHub webhooks (`POST /webhooks/github`) deliver review-request cards within a second; the poller stays as the fallback.
- GitHub-first login (OAuth App or GitHub App) with token sign-in behind a disclosure.
- Bearer device tokens with hashing, sliding expiry and a per-user cap; `/device` pairing page and a Devices card on Integrations.
- Repository profile: deterministic signals plus one model call name each repo's critical paths; Standard/Deep reviews walk the ones a PR touches.
- Webhook end-to-end test (curl + openssl against a real server) and profile/auth unit tests run in CI.

## v1.0.0-rc.2 — 09/13/26

- One install, many repositories: the repository is a first-class dimension in the queue, the state layout and the dashboard filters.
- Multi-backend notifier (Slack, Discord, generic webhook) with a runtime Settings page and an admin role.
- Installable PWA usable at phone width.
- Solo / Team / Company tiers documented on the public site.

## v1.0.0-rc.1 — 09/13/26

- Dockerfile, compose profiles (including `demo`) and entrypoint.
- `bin/doctor.sh` environment diagnostics.
- Astro + Starlight public site deployed to GitHub Pages.
