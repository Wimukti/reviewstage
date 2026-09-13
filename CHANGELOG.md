# Changelog

All notable changes to ReviewStage. Dates are MM/DD/YY.

## Unreleased

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
