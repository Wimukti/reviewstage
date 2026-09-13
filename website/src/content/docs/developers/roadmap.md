---
title: Roadmap
description: What is done, what is next, and what is explicitly not planned soon.
sidebar:
  order: 3
---

Priorities, not promises. Open an issue to argue for reordering.

## P0 — done

- Human-gated posting: no GitHub write path in the review step; `COMMENT`-only; approval as a separate click.
- Per-reviewer identity: each person's own GitHub token for posts and approvals; read-only service token.
- Per-reviewer independent runs in separate worktrees.
- Run form: Quick / Standard / Deep effort, focus note, model choice; stop; re-run with full history; identical-run cache.
- Findings as a staging area: tick, inline edit with preview, suggestion blocks, reply-vs-new, Explain simply, stale flag.
- Diff-anchor validation and refusal on malformed GitHub responses.
- Learnings loop; skills page with team default vs personal skill; quick-add rule; versioned team default with revision history; per-skill keep rate.
- Independence-weighted agreement across reviewers; convergence on the PR page.
- Insights: reviews, tokens, keep rate, severity, by reviewer, by model, agreement, cycle time.
- QA guide generation.
- Stacked-PR review.
- Multiple repositories per server: `REPOS` list or `REPO_ALLOW_ORG`, per-repo skills and risk paths, repo chips/filter, Insights across repositories.
- Notifications: Slack via webhook or bot token, Discord embeds, generic signed webhook, or none; per-reviewer mentions; once-per-PR dedup.
- Runtime settings page (poller on/off, interval, backends, PR filters) — `settings.json`, no restart.
- Per-user Claude account via the genuine `claude setup-token` flow; encrypted at rest.
- GitHub OAuth App / GitHub App sign-in with server-side refresh; **Continue with GitHub** is the primary login when configured and the OAuth token is the working token.
- Device tokens: `POST /api/device-token` from a web session, bearer accepted on every `/api/*` route, Settings → Devices to list and revoke, 180-day sliding expiry, `/login?device=1` pairing page for mobile and CLI clients.
- Docker Compose install with `team` and `demo` profiles; `bin/doctor.sh`.
- Guided first-run tour; command palette.
- Repository profile: deterministic signals + one Sonnet call name each repo's critical paths (validated against the tree); Standard/Deep reviews walk the ones a PR touches; editable, versioned, optional auto re-profile; kept rate on critical paths in Insights.

## P1 — in flight

- **Settings page, continued.** Repositories and devices in the dashboard instead of `.env` edits (notifiers and the poller already live there).
- **Confidence per finding.** The agent states how sure it is; the card shows it; learnings record whether confidence predicted keep rate.
- **Reviewer handoff UI.** Explicitly pass a PR you have opened to a teammate, with your ticks and edits, instead of them starting cold.
- **Installable PWA.** Manifest, root-scoped service worker, offline page, phone-width layout. Shipped; see [Mobile](/reviewstage/developers/mobile/).
- **Public keep rate.** An opt-in badge for a repository: "N% of assistant findings were posted unchanged over the last 90 days."

## P2 — later

- **GitHub App as the default auth.** OAuth Apps can only ask for classic scopes, so today's sign-in token carries `repo`. A GitHub App is the path to **org-level install and narrower permissions**: user-to-server tokens with *Pull requests: write* and *Contents: read* on exactly the repositories an org owner installed it on, revocable by that owner. The server already accepts one (`GH_OAUTH_SCOPES` empty); what remains is the install flow, the per-installation repo list replacing `REPOS`, and docs that make it the first option rather than the second.
- **Email and push notifications** for teams that do not live in chat. Push is a `notify` backend that sends to registered devices (web push with VAPID, then FCM/APNs through the Capacitor wrapper).
- **Capacitor apps for the App Store and Play Store.** The same React build in a native shell: native push, biometric unlock for the stored device token, `reviewstage://` deep links. See [Mobile](/reviewstage/developers/mobile/).
- **Other agent adapters.** The run step is a script that must produce `review.json`; adapters for other coding agents are possible if they can honour the output contract and the no-write rule.

## Not planned soon

- **RBAC / SSO inside ReviewStage.** Put an identity-aware proxy (Tailscale, Cloudflare Access) in front instead.
- **GitLab, Bitbucket.** The GitHub review API shape (inline comments on a diff, a single review event) is assumed throughout.
- **A hosted SaaS.** The product is the property that your tokens and your team's review data stay on a server you control.
- **Auto-posting of any kind.** Not as an option, not behind a flag.
