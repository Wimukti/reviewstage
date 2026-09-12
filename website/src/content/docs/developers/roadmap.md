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
- Slack via webhook or bot token; per-reviewer mentions; once-per-PR dedup.
- Per-user Claude account via the genuine `claude setup-token` flow; encrypted at rest.
- GitHub OAuth App / GitHub App sign-in with server-side refresh.
- Docker Compose install with `team` and `demo` profiles; `bin/doctor.sh`.
- Guided first-run tour; command palette.

## P1 — next

- **Discord notifier.** Same card shape via a Discord webhook; the notifier is one function.
- **Confidence per finding.** The agent states how sure it is; the card shows it; learnings record whether confidence predicted keep rate.
- **Reviewer handoff UI.** Explicitly pass a PR you have opened to a teammate, with your ticks and edits, instead of them starting cold.
- **Public keep rate.** An opt-in badge for a repository: "N% of assistant findings were posted unchanged over the last 90 days."

## P2 — later

- **GitHub App as the default auth**, so no one pastes a token and an org owner can revoke centrally.
- **Email and push notifications** for teams that do not live in chat.
- **Other agent adapters.** The run step is a script that must produce `review.json`; adapters for other coding agents are possible if they can honour the output contract and the no-write rule.
- Multiple repositories per server.

## Not planned soon

- **RBAC / SSO inside ReviewStage.** Put an identity-aware proxy (Tailscale, Cloudflare Access) in front instead.
- **GitLab, Bitbucket.** The GitHub review API shape (inline comments on a diff, a single review event) is assumed throughout.
- **A hosted SaaS.** The product is the property that your tokens and your team's review data stay on a server you control.
- **Auto-posting of any kind.** Not as an option, not behind a flag.
