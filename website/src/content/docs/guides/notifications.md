---
title: Notifications
description: Slack via webhook or bot token; Discord is planned.
sidebar:
  order: 4
---

Notifications are optional. Without them the dashboard still works; you just have to remember to open it. With them, a card arrives when a review is requested of you, and another when the review is ready.

## Slack

Two ways to connect. Set one in `.env` and restart.

### Incoming webhook (simplest)

```bash
SLACK_WEBHOOK=https://hooks.slack.com/services/…
```

Slack → your workspace apps → *Incoming Webhooks* → add to a channel → copy the URL. Send-only: the "review ready" message arrives as a new message naming the PR rather than a thread reply, because webhooks never return a message timestamp.

### Bot token (threads replies)

```bash
SLACK_BOT_TOKEN=xoxb-…
SLACK_CHANNEL=C0123456789
```

A Slack app with `chat:write` in the channel. Posts use `chat.postMessage`, the request card's timestamp is stored, and the review-ready reply is threaded under it. Needs a Slack app, which some workspaces gate.

### Mentions

Cards `@mention` the requested reviewer using the Slack member ID they saved in *Integrations* (Slack → profile picture → Profile → ⋮ → *Copy member ID*). One channel serves everyone; only the mentioned person is pinged.

### Dedup

Each reviewer is notified **once per PR** and never again for that PR: pushing new commits does not re-ping anyone. The dashboard always reflects the live queue regardless of what was announced; Slack is a nudge, not the source of truth. To re-announce, see [Troubleshooting](/reviewstage/operations/troubleshooting/#re-notifying-stale-cards).

### Privacy

Cards carry PR titles, authors and diff sizes; the review-ready card carries the agent's summary, which can quote code. Use a **private channel** whose members can all already read the repository, and treat the webhook URL or bot token as a secret.

## Discord

Planned. The notifier is a single function in the shared shell library, so a Discord webhook adapter is small; see the [roadmap](/reviewstage/developers/roadmap/).

## Email and push

Not planned soon. The Slack card is most of the value because it arrives where engineers already are.
