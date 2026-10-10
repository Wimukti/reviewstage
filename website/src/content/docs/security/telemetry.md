---
title: "Telemetry: what is counted, what is never sent, and why nothing is sent today"
description: The exact event schema, where the counters live, retention and deletion, the three switches, and what the endpoint would log if one were operated. In 1.0.x no endpoint exists and nothing leaves the box.
sidebar:
  label: Telemetry
  order: 2
---

**Short version.** ReviewStage keeps a handful of counters about itself on your machine so you can see how it is used, and *can* send a daily summary of those counters to a first-party endpoint — but only if four things are all true, one of which is not true in any released build: **no endpoint is configured, so in 1.0.x nothing is sent, consent or not.** This page is the contract for the day that changes.

## What is counted

Counters, per UTC day, from a closed list. There are no per-event rows: a day is a set of `event → count` pairs. The list below is the schema the code enforces (`bin/rs_telemetry.py`, `SCHEMA`); the Settings page and the first-run card show the same table.

| Event | Dimensions (fixed vocabulary) | Counted when |
| --- | --- | --- |
| `install_completed` | — | the first sign-in of a personal-mode install |
| `connect_result` | `service`: `github`, `claude` · `error_category`: `ok`, `denied`, `expired_code`, `network`, `bad_token`, `other` | a GitHub sign-in or a Claude connect finishes |
| `review_started` | `effort`: `quick`, `standard`, `deep` | a review starts |
| `review_completed` | `outcome`: `done`, `failed`, `stopped`, `timeout` | a review ends |
| `run_duration_bucket` | `bucket`: `lt1m`, `1to3m`, `3to10m`, `gt10m` | a review ends |
| `findings_shown` | count | a review ends (how many findings it produced) |
| `findings_kept` · `findings_edited` · `findings_dropped` | count | a review is posted, or dry-run posted |
| `dismissal_reason` | `reason`: a short slug from the dismissal menu (`^[a-z][a-z0-9_-]{0,31}$`), never typed text | a finding is dropped with a reason |
| `post_attempted` · `post_succeeded` | `dry`: `0`, `1` | a post is attempted; a post lands (or completes as a dry run) |
| `return_7d` · `return_28d` | true/false | derived when a day is packaged: was there activity on another day within the previous 7 / 28 |

A packaged day — the only thing that could ever be sent — looks like this and nothing else:

```json
{
  "schema": 1,
  "install_id": "3f0c…(32 hex, random)",
  "day": "2026-10-10",
  "app_version": "",
  "platform": "darwin",
  "mode": "personal",
  "return_7d": true,
  "return_28d": true,
  "counters": {
    "review_started|effort=standard": 2,
    "review_completed|outcome=done": 2,
    "findings_shown": 7,
    "findings_kept": 4,
    "findings_dropped": 3,
    "post_attempted|dry=1": 1,
    "post_succeeded|dry=1": 1
  }
}
```

The sender walks every payload against that allowlist before it goes out and refuses one that carries any other key; a unit test asserts that a repository name, a login, a path, a PR number, a token or a free-text error is refused.

## What is never collected

Not "anonymised", not "hashed" — not present, because the schema has no field for it:

- your GitHub login, name or email;
- repository names or slugs, PR numbers or titles, branches;
- file paths, diffs, finding text or gists, suggestions;
- tokens of any kind, hostnames, your `PUBLIC_URL`;
- your IP address — the server never adds one to a payload (see [Endpoint](#endpoint) for what a receiver would see anyway);
- free-text error messages, or any timestamp finer than the day.

Counters are per install, not per user. A team install with five reviewers produces one set of counters that cannot tell them apart.

## Where it lives

`ROOT/telemetry/` (`~/.reviewstage/telemetry/` by default), mode 600, written atomically under a lock:

| File | Contents |
| --- | --- |
| `counters.json` | `{ "schema": 1, "days": { "YYYY-MM-DD": { "<event>": n } } }` |
| `consent.json` | `{ "schema": 1, "decided": bool, "consented": bool, "at": epoch, "install_id": "…" }` — the id exists **only while consented** and is deleted when consent is revoked |
| `outbox.json` | the packaged days waiting to be sent, each with `queued_at` and, once sent, `sent_at` — this is what **View queued** shows |

It is deliberately outside `state/`, so cleaning up a PR never touches it and one directory holds everything to delete.

## Retention and deletion

- **Counters** stay until you clear them (Settings → Privacy → **Clear**, or `rm -rf ~/.reviewstage/telemetry`).
- **The outbox** keeps at most 30 days; older queued days are dropped, sent or not.
- **Clear** deletes the counters and the queue and, if you are consented, replaces the install id, so days before the clear cannot be joined to days after it.
- **Revoking consent** deletes the install id and empties the queue. A later consent mints a new id: to a receiver, a new install.
- **Export** downloads the three files as one JSON document (`GET /api/telemetry/export`), exactly as they are on disk.

## The switches, in the order they are checked

Sending happens only when every gate agrees. The first match wins, and Settings → Privacy shows which one did and why:

1. **`RS_TELEMETRY=0`** in `.env` or the environment — the operator's kill switch. Nothing is sent and the consent switch is locked off with that reason. (`KEEPDROP_TELEMETRY=0` is read in the same place as a forward-compatible alias.)
2. **`telemetry_enabled: false`** in `settings.json` — the team admin's switch, on the same Privacy section, through the same save bar as the poller settings. Off disables telemetry for everyone on that server, whatever they consented to. The default is `true`, which means "allowed to ask", never "send".
3. **Consent** — `consent.json` says `consented: true`. **Off by default on every install.** Personal mode asks once, on the wizard's last card, with **Keep it local** as the default focus; team mode never prompts, and the admin opts in from Settings. Revocable any time.
4. **An endpoint** — `RS_TELEMETRY_ENDPOINT` is set and starts with `https://`. **The shipped default is unset**, so a build with consent and no endpoint still sends nothing; the queue simply shows what *would* have gone.

Only when all four hold is the state **active**: once a day (and on a clean shutdown) the server POSTs one JSON body per complete day to the endpoint with Python's `urllib`. No third-party SDK is involved and no library is added; a `2xx` marks the day sent, anything else leaves it queued.

## Endpoint

**There is no endpoint in 1.0.x.** The ReviewStage project does not operate one, no release sets `RS_TELEMETRY_ENDPOINT`, and the desktop app does not write it into `.env`. Consenting today changes a file on your disk and nothing else.

If an endpoint is operated later, this section is the commitment it will be held to, and it will be updated before the first release that sets the variable:

- **What it receives** is exactly the payload above — the receiver validates it against the same allowlist and discards anything else.
- **What it logs.** Any HTTPS receiver sees the client IP address and the request headers on the wire; that is a fact about TCP, not a choice. The commitment is that the receiver **does not store** the IP address, the `User-Agent` or any header — only the payload body, keyed by `install_id` and `day`. Said plainly: the body is anonymous; the connection is not, and the receiver is required to drop what the connection reveals before anything is written.
- **Retention at the receiver** will be stated here when one exists, along with a deletion path keyed by `install_id` (which Export shows you).

## What the browser does fetch from elsewhere

For completeness: the dashboard shows reviewer and repository avatars, and the browser loads those images from `github.com` / `avatars.githubusercontent.com` — the service you signed in with, which already knows you are looking at these pull requests. That is an image load by your browser, not a report by ReviewStage; the browser test that proves "nothing leaves" names exactly those two hosts, image resources only, and fails on anything else.

## Logging on your server

The server prints one line per flush — `telemetry: flushed N day(s), B bytes, state=…` — and never the body. Consent changes and Clear print one line each. Nothing about telemetry is written to `server.log` beyond that.

## The API behind the page

All cookie-authenticated, like every `/api/*` route: `GET /api/telemetry` (state, reason, counters, queue), `POST /api/telemetry/consent {"consented": bool}`, `POST /api/telemetry/clear`, `GET /api/telemetry/export`. `PUT /api/settings` learns `telemetry_enabled` (admin only).

## How this is proven

`bin/test_rs_telemetry.py` replaces `urllib.request.urlopen` with a function that raises, then flushes under each gate — `RS_TELEMETRY=0`, the admin switch, no consent, no endpoint — and asserts it was never called; with all four satisfied it asserts exactly one POST per complete day whose body passes the allowlist. `dashboard-ui/e2e/privacy.spec.ts` drives a real keep / drop / post flow and the Privacy controls in a browser while recording every request, and asserts none went to any origin but the test server. `desktop/test/outbound.test.mjs` names every file in the desktop app that makes a network call, so a new one has to be added there by hand.
