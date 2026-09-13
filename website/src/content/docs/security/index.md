---
title: Security model
description: What is stored, how it is protected, what a token can do, and what is not defended against.
---

Read this before you set `DRY_RUN=0` on any server that is reachable from outside your own machine.

## The shape of the risk

The dashboard is a process holding GitHub tokens that can comment on, review and approve pull requests **as real people**, and Claude tokens that spend those people's subscriptions. The design assumes it may end up on a network you do not fully trust, so the model is not "the network protects it". It is: every entry point needs a session, every action is signed and short-lived, the writes use the acting user's own token, and the process itself is not on a public port.

## What is stored, and how

| Data | Where | Protection |
| --- | --- | --- |
| Service GitHub token (`GITHUB_PAT`) | `.env` (chmod 600) | Read-only permissions; never posts. |
| Each user's GitHub token | users file | **AES-256-CBC, PBKDF2**, key *derived* from `PRBOT_SECRET`, not stored beside it. Decrypted in the server only, at post time. |
| Each user's Claude token | users file | Same encryption. Used only by `claude -p` for that user's runs. |
| Slack webhook / bot token | `.env` | Treat as a secret; anyone holding it can post in the channel. |
| `GITHUB_WEBHOOK_SECRET` | `.env` | Authenticates inbound GitHub deliveries (HMAC over the body). Anyone holding it can add or remove queue rows and trigger a review-request card, nothing more. |
| Reviews, payloads, logs | per-PR state directory | Plain files. Contain diff excerpts and the agent's prose. |
| Sessions | HttpOnly, Secure, SameSite cookie | HMAC-signed with `PRBOT_SECRET`, 30-day expiry. |

Rotating `PRBOT_SECRET` invalidates every session, every signed link and every stored token at once. That is the right outcome if it was rotated because it leaked.

## Controls

- **Pages need a signed-in session.** Signing in proves a GitHub token is real and can see the repository. Unauthenticated requests, including POSTs, bounce to login. Deleting a user from the users file ends their session on the next request.
- **Every action is HMAC-signed** over `action:pr:expiry`: post, approve, mark done, archive, start review, stop, explain. Tokens are minted at render time and last **30 minutes**, so a bookmarked or forwarded page cannot act later and a cross-site form has nothing valid to present.
- **Writes use the acting user's own token.** The service token does reads and the base clone only. Nothing can post or approve under another name, and GitHub's self-approval check runs against the real user.
- **The review step has no GitHub write path.** The script that runs the agent produces a file; every write is a separate human click.
- **The agent never chooses the review event.** Posting defaults to `COMMENT`; a reviewer can tick *Request changes* on the post form for that one review. `APPROVE` is a separate click, never from the agent.
- **Approve is gated** on the PR being open, not a draft, not authored by you, and having a review on this server.
- **Diff-anchor validation** checks every `path:line` against the real diff before posting.
- **A failed GitHub call never degrades into a bad post.** Response shape is validated, retried once, refused on anything odd.
- **OAuth sign-in** (if configured) uses an HMAC-signed `state` with a 10-minute expiry carrying only an in-app return path; forged or replayed callbacks are rejected and cannot redirect off-site. Tokens are refreshed server-side before expiry.
- **The server binds `127.0.0.1`** (or the compose network). Put a reverse proxy in front for anything beyond localhost.
- **The GitHub webhook endpoint is signature-gated.** `POST /webhooks/github` needs no session — GitHub is the caller — so every delivery must carry `X-Hub-Signature-256 = HMAC-SHA256(GITHUB_WEBHOOK_SECRET, raw body)`, compared in constant time; a missing or wrong signature is a `401`, an unset secret a `503`. A valid delivery can only do what the poller already does: add or remove a queue row, refresh a head SHA, archive a closed PR's unposted review, record a review the person submitted on GitHub, and send the `review_requested` card. It cannot start a review, post, approve, read a token or touch any repository outside `REPOS` / `REPO_ALLOW_ORG`. The body is parsed as JSON and only the fields named in `prbot_webhook.py` are read; the requested reviewer must already be a signed-in user, so a forged payload cannot make the dashboard notify a stranger.

## GitHub token permissions

Use **fine-grained** personal access tokens, scoped to the one repository.

| Token | Permissions | Why |
| --- | --- | --- |
| **Service token** (`.env`) | Contents: **read** · Pull requests: **read** · Metadata: read | Poll review requests, clone the base repo. Cannot post. |
| **Each reviewer's token** | Contents: **read** · Pull requests: **read and write** · Metadata: read | Post comments and approve, as that person. |

Do not grant organisation-level scopes; nothing needs them. Give reviewer tokens an expiry (90 days) and revoke them when the server is decommissioned. If you use a GitHub OAuth App instead, the token acts as the user with the app's scopes and can be revoked by the user at github.com/settings/applications.

## Claude tokens

Connecting Claude runs the genuine `claude setup-token` flow inside an isolated config directory on the server, replacing only its terminal prompt with a web form: the authorise link is the one the CLI printed, the code goes to the CLI, the CLI mints the token, and the token is used only by Claude Code. If you would rather the server were not involved in the sign-in, run `claude setup-token` on your own machine and paste the result.

## Prompt injection from hostile diffs

The agent reads untrusted PR content with `Bash`, `Read`, `Glob`, `Grep` and `Write` allowed, inside a **git worktree** of the PR's head, under a timeout, on the account of the person who clicked Start. A hostile PR could try to get it to run commands on the server. It **cannot post to GitHub**, because the review step has no write path. It **can** run commands as the service user. Before pointing ReviewStage at PRs from outside your team, run it in a container with nothing else on it, and read the next section.

## Deploying behind a proxy

The server is meant to sit behind something that terminates TLS and, ideally, decides who can reach it at all.

- **Caddy**: `reverse_proxy 127.0.0.1:8899` with automatic HTTPS. Two lines.
- **Tailscale**: bind to the tailnet address, or use `tailscale serve`, and only your tailnet can reach it. Recommended for small teams.
- **Cloudflare Access** (or any identity-aware proxy): put an SSO gate in front. ReviewStage does not have SSO of its own and is not planning it soon.

Whatever you choose, the reverse proxy should forward only the dashboard's path and nothing else on the host. If you use webhooks, `/webhooks/github` is the one path GitHub itself must reach — with Cloudflare Access add a bypass rule for it, with Tailscale expose it separately (`deploy/README.md`); the signature check is what protects it, not the identity gate.

## What is not defended against

Stated plainly so nobody assumes otherwise.

- **Any signed-in user can read any review on the server.** Reviews are shared by design; PR pages are not scoped to who was requested. Everyone signed in already has repository read access, so this discloses nothing they could not `gh pr diff`.
- **Root on the server has everything**: every stored GitHub and Claude token, the Slack secret. Encryption at rest protects against a copied file, not against the host itself.
- **The agent can run commands on the server** (see prompt injection above).
- **No rate limiting** on the login endpoint beyond GitHub's own.
- **No RBAC.** Every signed-in user has the same capabilities, including editing the team default skill (versioned, so it can be reverted).

## Rotating the secret

```bash
# .env
PRBOT_SECRET=<openssl rand -hex 32>
```

Restart. Every session, link and stored token is now invalid; users sign in and reconnect Claude again.

## Reporting a problem

Open a [GitHub issue](https://github.com/Wimukti/reviewstage/issues) for anything that is not sensitive. For a vulnerability, use GitHub's private vulnerability reporting on the repository.
