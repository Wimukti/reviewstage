---
title: Team mode
description: The poller, Slack cards, and per-reviewer identity on one shared server.
sidebar:
  order: 4
---

One server serves the whole team, and one install reviews many repositories. Each person signs in once; from then on their queue, their runs, their posts and their approvals are theirs.

```bash
docker compose --profile team up -d
```

The `team` profile adds the **poller**: every 3 minutes (adjustable in *Settings*) it asks GitHub, for every repository in `REPOS`, for PRs where any signed-in user's review is requested, writes the queue, and sends a notification card to whoever is requested. Cards name the PR as `owner/name#123`.

## Many repositories

List them in `.env`:

```bash
REPOS=acme/widgets,acme/api
```

Every repository gets its own base clone and its own state directory; the queue shows a repository chip on each row and a repository filter (remembered per browser). PR pages are `/pr?repo=owner/name&pr=123`; pasting a GitHub PR URL derives the repository, and a bare number offers a picker.

To accept repositories you did not list, set `REPO_ALLOW_ORG=acme`: any repo under that org where a signed-in user gets a review request is discovered by the poller and cloned on its first review. This needs the **service token** to be able to see the org (a fine-grained token with *All repositories* under that owner, or a classic token with `repo`).

An existing single-repository install is migrated on the first start: the clone and per-PR state move into the per-repository layout once, a `MIGRATED` marker is written, and already-sent Slack links keep working for `PRBOT_SIGNATURE_GRACE_DAYS` (default 7). If several repositories are configured *and* legacy state is present, the server refuses to start and tells you to run once with exactly one `REPO` so the state can be attributed.

## What each person does

1. Open the server's URL and sign in with their own fine-grained GitHub token (or **Sign in with GitHub** if the owner configured an OAuth app; see [Configuration](/reviewstage/operations/configuration/#github-sign-in)).
2. On the welcome checklist, paste their **Slack member ID** (or Discord user ID) so cards mention them, and **Connect Claude** so their reviews bill to their own plan. Both live in *Integrations* and can be done later.

That is it. The next review request pings them within three minutes.

## Identity, precisely

| Action | Whose credentials |
| --- | --- |
| Poll review requests, discover org repos, clone the base repos | The **service token** in `.env`. Read-only. |
| Run a review or QA guide | The **clicker's Claude account**. |
| Post comments | The **clicker's GitHub token**. |
| Approve | The **clicker's GitHub token**. GitHub's self-approval rule applies to them. |

Nothing can post or approve under a name other than the signed-in user's.

## Independent reviews

Two reviewers on one PR get **independent runs**, each in its own git worktree, so they never collide. The run form tells you who already reviewed the current commit and with what configuration. Once both exist, findings raised by more than one reviewer are marked **confirmed**, weighted by independence: two runs with different skill, model or effort count; the same configuration twice does not. See [Insights](/reviewstage/guides/insights/).

## Notifications

Slack via an incoming webhook (simplest) or a bot token (threads the "review ready" reply under the request card), Discord via a channel webhook, or any JSON endpoint via a signed generic webhook. Details in [Notifications](/reviewstage/guides/notifications/).

Cards carry PR titles, authors and diff sizes, and the review-ready card carries the agent's summary, which can quote code. Point them at a **private channel** containing only people who can already read the repository.

### Webhooks or polling?

Two ways the queue learns about a review request:

- **GitHub webhooks** (recommended for teams): set `GITHUB_WEBHOOK_SECRET` and add a webhook on the repository or the organization pointing at `<PUBLIC_URL>/webhooks/github`. The card goes out within a second of the request; a push flags the review stale at once; a closed PR leaves the queue at once. GitHub must be able to reach that one path — see [Configuration](/reviewstage/operations/configuration/#github-webhooks) and the proxy notes in `deploy/README.md`.
- **Polling** (the default, and the right choice for firewalled installs): `pr-watch.sh` searches GitHub every few minutes with the service token. Nothing inbound is needed, so it works on a laptop, behind a corporate proxy or inside a tailnet with no public hostname.

With webhooks on, keep the poller running: it is the safety net for a missed delivery and it says so in its log (`webhooks active; poll is a safety net`). Settings → Webhooks shows which mode is in effect, and once webhooks are active you can lower the poll interval from the Poller card.

## What each person sees

| Tab | Scope |
| --- | --- |
| To review | PRs currently awaiting **your** review |
| Reviewed | Reviews you have opened but not posted |
| Posted | Posted by **you** (someone else posting the same PR is theirs) |
| Approved | Approved by **you** |
| PR page | The shared PR; your own tick/edit state and actions |

Any signed-in user can open any PR page on the server. That is by design (everyone signed in already has repo read access) and is listed under [what is not defended against](/reviewstage/security/#what-is-not-defended-against).

## Owner notes

- The dashboard reads `.env` once at startup. Restart after editing.
- To remove someone, delete their entry from the users file; their session dies on the next request.
- Reviews serialise server-wide, one at a time, and refuse to start below a free-memory floor (`MIN_FREE_MB`). Size the box for one agent plus the dashboard.
- Team review requests routed through a **GitHub team handle** are not polled; only direct requests to a login fire.
- A repository can have its own **team default skill** (Skills page → *Team default per repository*); it takes precedence over personal skills for reviews of that repository. `RISK_PATHS__<OWNER>__<NAME>` does the same for risk banners.
