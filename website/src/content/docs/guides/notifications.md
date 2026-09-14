---
title: Notifications
description: Slack, Discord, a generic signed webhook, or none — which events fire and how to verify them.
sidebar:
  order: 4
---

Notifications are optional. Without them the dashboard still works; you just have to remember to open it. With them, a card arrives when a review is requested of you, another when the review is ready, one if a run is stopped or fails, and one when a QA guide finishes.

One notifier serves every backend: the scripts call `notify_card <kind> <payload>` (in `bin/notify.sh`) and each enabled backend renders the same small payload in its own idiom. Enable any combination.

## Which backends fire

`NOTIFY_BACKENDS` in `.env` is a comma list of `slack`, `discord`, `generic`, `none`. Leave it empty and the set is **derived from whichever URLs are configured** — an existing Slack-only install changes nothing. The admin can also switch backends live on the dashboard's **Settings** page (stored in `settings.json`, which wins over `.env`; see [Configuration → Runtime settings](/reviewstage/operations/configuration/#runtime-settings)).

A backend that fails — a dead URL, a 4xx from the provider — logs a `WARN` line in the poller or review log and nothing else. It never aborts the review that triggered it.

## Events

| Kind | Fires when | Mentions |
| --- | --- | --- |
| `review_requested` | A new review request for a signed-in user — from a GitHub webhook the moment it happens, or from the poller on its next pass (once per PR per person; new commits never re-ping). Suppressed for PRs older than *max PR age* and, if enabled, for bot-authored PRs. | The requested reviewer |
| `review_ready` | A review run you started finished; the card carries the verdict, the finding count and the agent's summary. Nothing has been posted to GitHub yet. | Only the person who started the run |
| `review_stopped` | A run was force-stopped from the dashboard (with confirmation that the agent is gone), or failed to produce a review. | The person who stopped / started it |
| `qa_ready` | A QA guide finished building. | The person who asked for it |

### The verdict on a review-ready card

The colour bar and the header of a `review_ready` card come from the **verdict**, never from how the review would be posted (`COMMENT` / `REQUEST_CHANGES` is an implementation detail and is not shown). The thresholds are the ones the dashboard's verdict banner uses:

| Verdict | When | Colour | Header |
| --- | --- | --- | --- |
| `blocked` | at least one `blocker` finding, or the agent asked for changes | red | 🔴 Not LGTM — 1 blocker · 3 findings |
| `attention` | no blockers, at least one `should-fix` | amber | 🟡 Needs attention — 2 to fix · 2 findings |
| `minor` | only nits / questions | blue | 🔵 Minor notes — 1 · 1 finding |
| `lgtm` | no findings at all | green | 🟢 LGTM — nothing to fix · 0 findings |

`review_requested` and `qa_ready` cards are neutral (brand colour); `review_stopped` is red when the run failed and grey when someone stopped it. Slack paints the colour as the attachment bar, Discord as the embed's left border.

### From GitHub webhooks

With `GITHUB_WEBHOOK_SECRET` set and a hook on the repository ([Configuration → GitHub webhooks](/reviewstage/operations/configuration/#github-webhooks)), GitHub events map onto the queue like this. Only `review_requested` produces a card; everything else changes the dashboard silently.

| GitHub event | Effect | Card |
| --- | --- | --- |
| `pull_request` · `review_requested` | The PR joins the requested reviewer's *To review*; a **team** request is expanded and only signed-in members are added. | `review_requested`, unless that person was already told (same `seen` key as the poller) |
| `pull_request` · `review_request_removed` | That reviewer's row disappears. | none |
| `pull_request` · `synchronize` | The row's head SHA is refreshed, so an existing review shows the *stale* banner. | none — a push never re-pings |
| `pull_request` · `closed` (or merged) | The PR leaves the queue; a review that was never posted is archived. Posted / approved rows stay as history. | none |
| `pull_request_review` · `submitted` | A review the signed-in person submitted on GitHub itself moves their row to *Posted* (or *Approved*). | none |

Deliveries for repositories outside `REPOS` / `REPO_ALLOW_ORG` are acknowledged and ignored, so one org-level hook is fine.

## Slack

Two ways to connect. Set one in `.env` and restart the dashboard (the poller and the scripts pick it up on their next run).

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

A Slack app with `chat:write` in the channel. Posts use `chat.postMessage`, the request card's timestamp is stored per reviewer, and the review-ready / stopped / QA replies are threaded under it. Takes precedence over the webhook when both are set. Needs a Slack app, which some workspaces gate.

### Mentions

Cards `@mention` the reviewer using the Slack member ID they saved in *Integrations* (Slack → profile picture → Profile → ⋮ → *Copy member ID*). Without one, the request card shows a bare `@login` label that pings nobody, and the review-ready card carries no mention at all. One channel serves everyone; only the mentioned person is pinged.

## Discord

```bash
DISCORD_WEBHOOK=https://discord.com/api/webhooks/…
```

Channel settings → *Integrations* → *Webhooks* → *New Webhook* → copy the URL. Each event is one embed titled `owner/name #123 · PR title`, a description saying what happened, and a links line (Open review · Dashboard · Open PR) standing in for buttons, which Discord webhooks do not have.

Mentions use the **Discord user ID** each reviewer saves in *Integrations* (Discord → User Settings → Advanced → *Developer Mode* on, then right-click your name → *Copy User ID*; it is all digits). The mention goes in the message body as `<@id>` with `allowed_mentions` restricted to that one user, so nobody else in the channel is pinged.

## Generic webhook

```bash
WEBHOOK_URL=https://example.com/reviewstage
WEBHOOK_SECRET=a-long-random-string      # optional but recommended
```

For Microsoft Teams (via a workflow), Zapier, n8n, Make, or your own service. Every event is one `POST` with `Content-Type: application/json` and these headers:

| Header | Value |
| --- | --- |
| `X-ReviewStage-Event` | the `kind` |
| `X-ReviewStage-Signature` | `sha256=<hex HMAC-SHA256 of the raw body, keyed with WEBHOOK_SECRET>` — only when the secret is set |
| `User-Agent` | `ReviewStage-Webhook/1` |

### Payload

```json
{
  "kind": "review_ready",
  "ts": 1789265102,
  "repo": "acme/widgets",
  "pr": "38849",
  "title": "Add lead-time badge to product cards",
  "author": "teammate",
  "url": "https://github.com/acme/widgets/pull/38849",
  "login": "acme-dev",
  "slack_id": "U0TEST",
  "discord_id": "",
  "extra": {
    "verdict": "attention",
    "findings": 2,
    "blockers": 0,
    "should_fix": 1,
    "event": "COMMENT",
    "summary": "Adds a lead-time badge. Logic is sound; two small things.",
    "detail": "https://reviews.example.com/pr?pr=38849&exp=…&sig=…"
  }
}
```

`pr` is a string. `login` is the reviewer the card is for; `slack_id` / `discord_id` are whatever they saved, or `""`. `extra` depends on `kind`:

| Kind | `extra` |
| --- | --- |
| `review_requested` | `additions`, `deletions`, `files` (numbers), `detail` (dashboard PR link), `board` (dashboard index link) |
| `review_ready` | `verdict` (`lgtm`, `minor`, `attention` or `blocked` — see [the verdict](#the-verdict-on-a-review-ready-card)), `findings`, `blockers`, `should_fix` (numbers), `event` (`COMMENT` or `REQUEST_CHANGES` — how the review would be posted; kept for machines, not shown on cards), `summary`, `detail` |
| `review_stopped` | `status` (`stopped` or `failed`), `message` (failed only), `job` (`Review` or `QA guide`), `confirmed` (the agent is verifiably gone), `runner` (whose Claude account it ran on), `text` (the Slack-formatted line) |
| `qa_ready` | `detail` (dashboard QA link) |

The same schema is shown on the Integrations page under *Generic webhook → Show payload schema*.

### Verifying the signature

Compute HMAC-SHA256 over the **raw request body** with your secret and compare it, constant-time, to the header value after `sha256=`.

```bash
# shell — body saved to body.json, header value in $SIG
printf 'sha256=%s\n' "$(openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" -r < body.json | cut -d' ' -f1)"
[ "$SIG" = "sha256=…" ]   # compare
```

```python
# python
import hmac, hashlib
def verify(raw_body: bytes, header: str, secret: str) -> bool:
    want = "sha256=" + hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(want, header or "")
```

```js
// node
import { createHmac, timingSafeEqual } from "node:crypto";
export function verify(rawBody, header, secret) {
  const want = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  return header?.length === want.length && timingSafeEqual(Buffer.from(want), Buffer.from(header));
}
```

Parse the JSON only after the signature checks out, and sign over the bytes you received — re-serialising first will change the digest.

## None — the dashboard is the inbox

Set `NOTIFY_BACKENDS=none` (or tick *None* in Settings, or configure no URLs at all). The poller still keeps the queue fresh; you open the dashboard and work the *To review* tab. Everything else — per-reviewer runs, posting, approval — is identical.

## Dedup

Each reviewer is notified **once per PR** and never again for that PR: pushing new commits does not re-ping anyone, on any backend. The webhook receiver and the poller share the same `seen` file and the same `<repo>:<pr>:<login>` key, so a request that arrives by webhook and is then found by the next poll (or the other way round) still produces exactly one card. The dashboard always reflects the live queue regardless of what was announced; a card is a nudge, not the source of truth. To re-announce, see [Troubleshooting](/reviewstage/operations/troubleshooting/#re-notifying-stale-cards).

## Privacy

Cards carry PR titles, authors and diff sizes; the review-ready card carries the agent's summary, which can quote code. Use a **private channel** whose members can all already read the repository, and treat every webhook URL, bot token and `WEBHOOK_SECRET` as a secret. The generic payload includes each reviewer's Slack / Discord IDs — send it only to an endpoint you control or trust.

## Email and push

Not planned soon. Anything that accepts a webhook (Zapier → email, ntfy, Pushover) covers it via the generic backend.
