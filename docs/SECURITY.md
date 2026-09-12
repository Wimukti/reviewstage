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

- **Pages need a signed-in session.** Signing in means proving a GitHub PAT is real (`/user`)
  and can see the repo, then receiving an HMAC-signed, HttpOnly, Secure, SameSite cookie
  valid for 30 days. Unauthenticated requests — including POSTs — bounce to the login page.
  Deleting a user from `users.json` invalidates their session on the next request.

- **GitHub login tokens are GitHub's, not pasted.** The OAuth `state` is HMAC-signed with a
  10-minute expiry and carries only an in-app return path, so a forged or replayed callback is
  rejected and cannot redirect off-site. Tokens (and refresh tokens, for a GitHub App) are
  stored exactly like PATs below, and refreshed server-side a minute before expiry.

- **Stored tokens are encrypted at rest** (AES-256-CBC, PBKDF2) with a key *derived* from
  `PRBOT_SECRET`, not stored beside them. Rotating the secret therefore also invalidates every
  stored token — the right outcome if the secret was rotated because it leaked. The shell
  scripts only ever read login + Slack ID; decryption happens in the server, at post time.

- **Writes use the acting user's own token.** The service token in `.env` does reads and the
  base clone only. Nothing can post or approve under a name other than the signed-in user's,
  and GitHub's own self-approval check runs against that user.

- **Every action is HMAC-signed** over `action:pr:expiry` with `PRBOT_SECRET` — post, approve,
  mark-done, archive, start-review. Tokens are **minted at render time and last 30 minutes**,
  so a bookmarked or forwarded page cannot act later, and a cross-site form has nothing valid
  to present. Pages themselves are gated by the session, not a signature, so they are plain
  bookmarkable URLs.

- **Cross-host handoff is allow-listed.** When `PRBOT_HOST_ALIASES` is set, a session may be
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

- **Diff-anchor validation** (`prbot_diff.py`) checks every comment's `path:line` against the
  actual diff before posting, so GitHub cannot 422 the entire review because one finding
  pointed at a line that isn't in the diff.

- **The server binds `127.0.0.1`**, reachable only through your reverse proxy. Nothing is
  listening on a public port directly. Terminate TLS at the proxy; the session cookie is marked
  `Secure`, so plain HTTP will not carry it.

- **Secrets stay in `~/.claude-pr-bot/.env`** (chmod 600), in `$HOME`, never in a git repo.
  `.gitignore` here blocks `.env` and `*.pem` as a second line of defence.

- **Nothing reaches GitHub without a human clicking.** `run-review.sh` has no write path to
  GitHub at all.

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

## Rotating `PRBOT_SECRET`

If a signed link ever leaks somewhere it shouldn't — a shared channel, a screenshot, a
ticket — rotate it:

```bash
sed -i "s|^PRBOT_SECRET=.*|PRBOT_SECRET=$(openssl rand -hex 32)|" ~/.claude-pr-bot/.env
sudo systemctl restart prbot
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
