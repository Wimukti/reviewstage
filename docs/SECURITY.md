# Security

Read this before you set `DRY_RUN=0`.

## The shape of the risk

The dashboard is served over the **public internet**, and you should assume there is no
authentication in front of it beyond what it does itself. Behind your reverse proxy sits a
process holding GitHub tokens that can comment on, review and approve pull requests **as the
people who signed in**.

So the security model is not "the network protects it". It is: every entry point is signed,
the dangerous ones are short-lived, and the process itself cannot be reached directly.

## Controls

- **Pages need a signed-in session.** Signing in means proving a GitHub token is real (`/user`)
  and can see the repo — either the token GitHub issues through **Sign in with GitHub**
  (the device flow by default, the redirect flow when `GH_CLIENT_ID` is set) or a pasted PAT — then receiving an HMAC-signed,
  HttpOnly, Secure, SameSite cookie valid for 30 days. Unauthenticated requests — including
  POSTs — bounce to the login page. Deleting a user from `users.json` invalidates their session
  and every device token on the next request.

- **Device tokens are the only other credential.** A phone, the CLI or a second browser may
  hold a bearer token instead of the cookie (`Authorization: Bearer …`, see
  [MOBILE.md](MOBILE.md)). Only its SHA-256 is stored; it expires 180 days after last use; each
  person can list and revoke theirs in Settings → Devices. See *Device tokens* below.

- **GitHub login tokens are GitHub's, not pasted.** The OAuth `state` is HMAC-signed with a
  10-minute expiry and carries only an in-app return path, so a forged or replayed callback is
  rejected and cannot redirect off-site. Tokens (and refresh tokens, for a GitHub App) are
  stored exactly like PATs below, and refreshed server-side a minute before expiry.

- **Stored tokens are encrypted at rest** (AES-256-CBC, PBKDF2) with a key *derived* from
  `RS_SECRET`, not stored beside them. Rotating the secret therefore also invalidates every
  stored token — the right outcome if the secret was rotated because it leaked. The shell
  scripts only ever read login + Slack ID; decryption happens in the server, at post time.

- **Writes use the acting user's own token.** The service token in `.env` does reads and the
  base clone only. Nothing can post or approve under a name other than the signed-in user's,
  and GitHub's own self-approval check runs against that user.

- **Every action is HMAC-signed** over `action:pr:expiry` with `RS_SECRET` — post, approve,
  mark-done, archive, start-review. Tokens are **minted at render time and last 30 minutes**,
  so a bookmarked or forwarded page cannot act later, and a cross-site form has nothing valid
  to present. Pages themselves are gated by the session, not a signature, so they are plain
  bookmarkable URLs.

- **Cross-host handoff is allow-listed.** When `RS_HOST_ALIASES` is set, a session may be
  carried between those hostnames only — the handoff token is short-lived and is never sent to
  a URL outside the list. With the list empty the feature is off.

- **Approve is gated** on the PR being open, not a draft, not authored by you, and having a
  `review.json` on this server. Deliberately *not* gated on "are you still a requested
  reviewer": GitHub clears the review request the moment any review is submitted, which made
  post-then-approve structurally impossible.

- **A failed GitHub call never degrades into a bad post.** `jq --slurp` wraps an API error so
  that it looks like a page of results; unchecked, every comment would appear un-anchorable
  and get dumped into the summary body. The fetch validates the response shape, retries once,
  and refuses on anything odd.

- **Diff-anchor validation** (`rs_diff.py`) checks every comment's `path:line` against the
  actual diff before posting, so GitHub cannot 422 the entire review because one finding
  pointed at a line that isn't in the diff.

- **The server binds `127.0.0.1`**, reachable only through your reverse proxy. Nothing is
  listening on a public port directly. Terminate TLS at the proxy; the session cookie is marked
  `Secure`, so plain HTTP will not carry it.

- **Secrets stay in `~/.reviewstage/.env`** (chmod 600), in `$HOME`, never in a git repo.
  `.gitignore` here blocks `.env` and `*.pem` as a second line of defence.

- **Nothing reaches GitHub without a human clicking.** `run-review.sh` has no write path to
  GitHub at all.

## Sign-in options

| Option | Who should use it | What the server ends up holding |
| --- | --- | --- |
| **Sign in with GitHub — device flow** (default; `GH_DEVICE_FLOW=0` turns it off) | Everyone — a short code at github.com/login/device, nothing registered | GitHub's user token, encrypted |
| **Sign in with GitHub — redirect** (OAuth App; `GH_CLIENT_ID` + `GH_CLIENT_SECRET`, preferred when set) | Teams wanting one click / their own app identity | GitHub's user token for the app, encrypted, refreshed server-side before expiry when *Expire user access tokens* is on |
| **Personal access token** (behind "Use a personal access token instead", or the only form when both flows are off) | Air-gapped or policy-restricted orgs; an org that has not yet approved the app | The PAT, encrypted |

**Device flow, plainly.** The shared client ID (`Ov23liHjtjxcPNwXC6Y5`, `bin/rs_device_flow.py`)
is public by design — device flow has no client secret and no callback URL. The browser only
ever sees the short user code; GitHub's `device_code` stays in server memory under an opaque
session id, and the token GitHub issues goes straight to *your* server: the ReviewStage project
never sees it. The server polls GitHub on the person's behalf, refuses polls faster than
GitHub's interval (429), caps pending sign-ins at 50 and purges expired ones.

Either way the stored token is **the working token**: `user_pat()` prefers the OAuth token and
falls back to a PAT, and post / approve / review-state reads all go through it. An OAuth user
never needs a PAT.

**Scopes.** An OAuth App can only ask for classic scopes, and the smallest one that can comment
on and approve a pull request in a private repository is `repo` — the same scope a PAT needs.
Fine-grained, per-repository permissions are **not available to OAuth Apps**; GitHub offers them
only to GitHub Apps. That is why `GH_OAUTH_SCOPES=repo` is the documented default and why a
**GitHub App** (user-to-server tokens, *Pull requests: write* + *Contents: read* on the
repositories it is installed on, org-owner revocation) is the roadmap path to narrower
permissions. The code already accepts a GitHub App: leave `GH_OAUTH_SCOPES` empty.

## Device tokens

A device token is what a mobile app, the CLI or a second browser holds instead of the session
cookie. It is created from a signed-in **web** session only (a bearer may not mint another
bearer), shown once, and stored as a SHA-256 hash under `users[login].devices`.

- **Threat.** A stolen device token is exactly as powerful as a stolen session cookie: it can
  read the queue and reviews, post and approve **as that user**, and nothing more. It cannot
  read the user's GitHub token or Claude token (those never leave the server, and no endpoint
  returns them), cannot create another device token, and is still subject to `DRY_RUN`.
- **Revocation.** Per device from Settings → Devices, or all at once with *Sign out
  everywhere*. Revoking deletes the hash; the next call gets `401`. Removing the user from
  `users.json` revokes everything they hold. `/logout` clears the cookie only.
- **Expiry.** 180 days since last use, sliding; `last_seen` is bumped at most once a minute.
  The poller prunes expired hashes nightly. Ten devices per person; the eleventh evicts the
  least recently used, and the response says so.
- **Pairing.** `/login?device=1` ends on an interstitial that shows the server URL and the
  GitHub login being bound and mints only when the person clicks *Open the app*, so a browser
  never silently hands a credential to a custom URL scheme.
- **Signed action links are unchanged.** A device token authenticates the request; the
  per-action HMAC tokens (post, approve, …) are still minted at render time and expire in
  30 minutes.

## Your token — and your teammates'

Every signed-in user's token sits on this server, encrypted, decryptable by anyone with root
and the `.env`. For a pilot among a trusted team on a machine that holds nothing else of
value, with each person able to revoke their own token at any time, that is an accepted
trade. It is **not** the end state: the GitHub App upgrade (user-to-server tokens, 8-hour
expiry, org-owner revocation, no paste) replaces this layer without touching the review or
dashboard logic. Tell pilots to give their PAT a 90-day expiry.

A classic PAT with `repo` scope is broad — it can write to every repository you can write to,
not just the one being reviewed. That is the cost of shipping without an org owner's approval;
it is not because human attribution needs it. A GitHub App's *user-to-server* token keeps the
human's name on every comment with an 8-hour lifetime and per-app scope.

Mitigations that are worth doing:

- **Give it an expiry.** 90 days. Re-pasting it in Settings twice a year is cheap.
- **Do not add scopes it does not need**, especially `read:org`. See
  [SETUP.md](SETUP.md#a-github-pat) for why it isn't needed.
- **Revoke it the moment the server is decommissioned**, not later. A disposable machine that
  gets torn down leaves a live token behind if you forget.

## Rotating `RS_SECRET`

If a signed link ever leaks somewhere it shouldn't — a shared channel, a screenshot, a
ticket — rotate it:

```bash
sed -i "s|^RS_SECRET=.*|RS_SECRET=$(openssl rand -hex 32)|" ~/.reviewstage/.env
sudo systemctl restart reviewstage
```

Every outstanding link is immediately invalid, including your own, and every stored token
must be re-entered. See [OPERATIONS.md](OPERATIONS.md#re-notifying-stale-slack-cards) to
re-announce your queue.

## Slack

Point the webhook at a **private channel containing only the pilot group**. Cards `@mention`
the requested reviewer, so one channel serves everyone. The cards carry PR titles, authors and
diff sizes, and the review-ready card carries the agent's summary — which can quote code.
Everyone in the channel should already be able to read the repository; do not widen it beyond
that.

Treat the webhook URL itself as a secret: anyone holding it can post into that channel.

## What is not defended against

Stated plainly, so nobody assumes otherwise:

- **Any signed-in user can read any review on the server.** The review is shared by design; PR
  detail pages are not scoped to who was requested. Everyone signed in has repo access
  anyway, so this discloses nothing they could not `gh pr diff`.
- **Someone with root on the server has everything** — every stored GitHub and Claude token,
  the Slack webhook, the owner's Claude credentials. Run it on a machine that holds nothing
  else you would mind losing, so the blast radius is your GitHub accounts rather than
  production data — but that is not nothing.
- **The agent reads untrusted PR content.** It runs with `Bash` allowed, in a worktree, on
  this server. A hostile PR could in principle try prompt injection to get the agent to do
  something with those tools. It cannot post to GitHub — `run-review.sh` has no write path —
  but it can run commands on the server. Worth knowing before you point this at PRs from
  outside the team, and a good reason to keep the server single-purpose.

## Reporting a vulnerability

Please **open a private security advisory on GitHub** (Security → Advisories → Report a
vulnerability) rather than a public issue, so a fix can ship before the details do. Include
what you found, how to reproduce it, and what you think the impact is; you will get an
acknowledgement and a fix or a reasoned response.
