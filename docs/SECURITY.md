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

- **`RS_SECRET` is load-bearing, and the server will not start without it.** Session cookies,
  every signed action link, the OAuth `state` and the key stored tokens are encrypted under all
  derive from it. An empty one is not a weaker mode, it is no mode: `HMAC(b"", …)` is a
  signature anyone can compute, so a hand-written `rs_session=<anyone>:<exp>:<sig>` cookie
  would be accepted as that user, admin included. The server refuses to boot when `RS_SECRET`
  is missing or shorter than 32 characters — the same treatment `REPOS` gets — and
  `bin/doctor.sh` FAILs on it.

- **Pages need a signed-in session.** Signing in means proving a GitHub token is real (`/user`)
  and can see the repo — either the token GitHub issues through **Sign in with GitHub**
  (the device flow by default, the redirect flow when `GH_CLIENT_ID` is set) or a pasted PAT — then receiving an HMAC-signed,
  HttpOnly, Secure, SameSite cookie valid for 30 days. Deleting a user from `users.json`
  invalidates their session and every device token on the next request.

- **Five routes answer without a session**, and each is gated by something other than the
  cookie. Everything else redirects to the login page (pages) or returns `401` (`/api/*`):

  | Route | What gates it |
  | --- | --- |
  | `GET /health` | Nothing. Returns the four bytes `ok` and touches no state. |
  | `POST /api/login` | The pasted token itself, which must pass `/user` and see the repository. Rate-limited per source IP, and the token verification is bounded by a semaphore. |
  | `POST /api/auth/device/start` | Rate-limited per source IP; sets a nonce cookie that binds the flow to this browser; the pending table has reserved headroom so a flood cannot evict real sign-ins. |
  | `POST /api/auth/device/poll` | The opaque session id **and** the matching nonce cookie. Rate-limited; refuses polls faster than GitHub's interval (429). |
  | `POST /webhooks/github` | The HMAC-SHA256 over the raw body in `X-Hub-Signature-256`, against `GITHUB_WEBHOOK_SECRET`. No secret configured → `503`, never a bypass. |

  `GET /oauth/callback` is reachable without a session too, but it is not an entry point: it
  only accepts a `state` this server signed within the last ten minutes.

  Every `/api/*` POST and PUT must additionally be `application/json` (or carry a device
  token) and must not arrive with `Sec-Fetch-Site: cross-site`, so a cross-site form post
  cannot reach the JSON API at all. Bodies over 2 MiB are refused with `413` before a byte is
  read, and a malformed `Content-Length` is a `400`.

- **Device tokens are the only other credential.** A phone, the CLI or a second browser may
  hold a bearer token instead of the cookie (`Authorization: Bearer …`, see
  [MOBILE.md](MOBILE.md)). Only its SHA-256 is stored; it expires 180 days after last use; each
  person can list and revoke theirs in Settings → Devices. See *Device tokens* below.

- **GitHub login tokens are GitHub's, not pasted.** The OAuth `state` is HMAC-signed with a
  10-minute expiry and carries only an in-app return path, so a forged or replayed callback is
  rejected and cannot redirect off-site. Tokens (and refresh tokens, for a GitHub App) are
  stored exactly like PATs below, and refreshed server-side a minute before expiry.

- **Stored tokens are encrypted at rest**, with a key *derived* from `RS_SECRET`, not stored
  beside them. Stated plainly: this is **unauthenticated AES-256-CBC**, PBKDF2-SHA256 at
  600,000 iterations, done by forking `openssl enc` with the key passed down a pipe (not
  through the child's environment). Unauthenticated means the ciphertext is confidential but
  not tamper-evident: someone who can already write `users.json` can corrupt a stored token,
  though they cannot read one or forge a chosen value. The runtime image ships no
  `cryptography` package, and adding one to keep an AEAD would be a new dependency in the
  server's smallest, most load-bearing path — so the fork stays and the property is documented
  rather than overclaimed. Rotating the secret invalidates every stored token, which is the
  right outcome if it was rotated because it leaked. The shell scripts only ever read login +
  Slack ID; decryption happens in the server, at post time.

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

- **What actually keeps the process off the public internet is the compose port mapping, not
  the bind address.** `RS_BIND` defaults to `127.0.0.1`, but the Docker image sets
  `RS_BIND=0.0.0.0` — it has to, or nothing outside the container could reach it — so inside
  the container the server listens on every interface. The published port in
  `docker-compose.yml` is prefixed `127.0.0.1:`, and *that* prefix is the control: drop it and
  the dashboard is on the internet directly. Check it before you expose anything. Terminate TLS
  at the proxy; the session cookie is marked `Secure`, so plain HTTP will not carry it.

  `RS_COOKIE_SECURE=0` drops the `Secure` flag for a plain-http localhost install. The
  container entrypoint sets it for **any** `http://` `PUBLIC_URL`, including the
  `http://localhost:8899` default it writes when nobody configured one — so the server ignores
  the flag unless `PUBLIC_URL` genuinely points at localhost. An operator who later puts a real
  domain in front keeps getting `Secure` cookies whether or not they remembered to unset it.

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

**Device-code phishing — the class, and what stops it here.** A device flow has a structural
weakness: the thing the victim types at github.com is a short code, and a code is trivially
sent over chat. The generic attack is "here's a code, go authorise it" — the victim approves,
and the *attacker's* pending flow gets the token. ReviewStage's shape of it was worse, because
`start` and `poll` are both unauthenticated and used to have nothing in common: an attacker
could start a flow **on your server**, get a teammate to approve the code, poll, and be handed
a session cookie as that teammate — on the victim's own install.

Three things now stand between that and a session:

- **A nonce cookie.** `start` sets an HttpOnly nonce and remembers it with the pending session;
  `poll` refuses any session whose nonce does not match, reporting it exactly as an unknown
  session. Only the browser that began a sign-in can finish it, so the attacker's poll gets
  nothing even if the code is approved.
- **The warning on the card.** The waiting state says, in as many words, to continue only a
  sign-in you started yourself — because a code someone sent you is the attack.
- **Cancel really cancels.** The browser hands the pending slot back rather than parking it
  until GitHub's 15-minute expiry.

Nothing here can stop a victim from approving a code at github.com; what it stops is the
approval being worth anything to the person who sent it.

**Locking the team out.** `start` is unauthenticated and the pending table is capped, which
used to be a denial of service in one line of `curl`: the cap evicted the **oldest** pending
sign-in, i.e. exactly the one a real person was part-way through, so a flood locked everybody
out of GitHub sign-in. Now `start` is rate-limited per source IP, eviction takes the *newest*
never-polled session rather than the oldest, a sign-in someone has begun polling is never
evicted, and slots are reserved for those. A flood gets an error; your teammates keep signing
in.

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

  *Sign out everywhere* also bumps a per-user **epoch** that is inside the session cookie's
  HMAC, so it now revokes browser sessions as well as device tokens. It previously deleted
  device hashes only, which meant the lost laptop the person was worried about stayed signed in
  for the rest of its 30-day cookie. The browser you click it in is re-issued a cookie under
  the new epoch and stays signed in; everything else has to sign in again.

- **Rotation revokes them.** A device token's stored hash is keyed on `RS_SECRET` **and** that
  user's epoch, not a bare SHA-256 of the token. Before that, hashes in `users.json` survived
  a rotation untouched — so the incident response documented under *Rotating `RS_SECRET`* left
  an attacker holding a device token a persistent credential that regained its full power the
  moment a real secret existed. Rotating now invalidates every device token and every session
  cookie along with every stored GitHub token.
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

Every outstanding link is immediately invalid, including your own; every stored token must be
re-entered; and **every device token and session cookie stops working**, so phones and CLIs
pair again. See [OPERATIONS.md](OPERATIONS.md#re-notifying-stale-slack-cards) to
re-announce your queue.

## Slack

Point the webhook at a **private channel containing only the pilot group**. Cards `@mention`
the requested reviewer, so one channel serves everyone. The cards carry PR titles, authors and
diff sizes, and the review-ready card carries the agent's summary — which can quote code.
Everyone in the channel should already be able to read the repository; do not widen it beyond
that.

Treat the webhook URL itself as a secret: anyone holding it can post into that channel.

## The review agent's sandbox

This is the property the whole product rests on, so it is worth stating exactly.

**A review runs with no GitHub credential in its environment.** Before `claude` is launched,
`agent_env` (in `bin/lib-common.sh`) builds an `env -u …` prefix that removes every
credential-shaped variable:

```
GH_TOKEN  GITHUB_TOKEN  GITHUB_PAT  GH_ENTERPRISE_TOKEN  GITHUB_ENTERPRISE_TOKEN
GH_HOST  GH_REPO  GH_PATH  GH_CLIENT_ID  GH_CLIENT_SECRET  GITHUB_WEBHOOK_SECRET
GIT_ASKPASS  SSH_ASKPASS  GIT_CONFIG_PARAMETERS  SSH_AUTH_SOCK
RS_SECRET  SLACK_BOT_TOKEN  SLACK_WEBHOOK  SLACK_CHANNEL  DISCORD_WEBHOOK
WEBHOOK_URL  WEBHOOK_SECRET
```

It also points `GH_CONFIG_DIR` at an empty directory and sets `GIT_TERMINAL_PROMPT=0`, so a
`gh` call inside the agent finds neither a token in the environment nor the box owner's stored
login: it fails unauthenticated. The diff and the branch are already on disk before the agent
starts, so it has no reason to reach GitHub at all.

**One credential deliberately stays: `CLAUDE_CODE_OAUTH_TOKEN`.** The CLI takes it only from
the environment — there is no flag and no credentials file — so dropping it would run every
review on the box account instead of the clicking reviewer's. It authorises Claude, not
GitHub; it cannot post.

**A tool deny list is the second barrier.** The agent runs with
`--allowedTools "Bash Read Glob Grep Write"` and an explicit `--disallowedTools`:

```
Bash(gh:*)  Bash(git push:*)  Bash(git remote:*)  Bash(git config:*)
Bash(curl:*)  Bash(wget:*)  Bash(nc:*)  Bash(ssh:*)  Bash(scp:*)
Bash(env:*)  Bash(printenv:*)  WebFetch  WebSearch
```

**And the run is fingerprinted.** Immediately before and immediately after the agent,
`run-review.sh` takes one GraphQL count of the PR's reviews, comments and review threads —
using the service token, from outside the agent's environment. If the two differ, the run does
not become a review: it writes `security-violation` next to the log, prints
`SECURITY: the review agent wrote to GitHub` to the server log, and fails the job with that
message. A prompt-injected write attempt is a failed run and an incident, not a quiet success.

There is an end-to-end test for this. `bin/test_rs_job_scripts.py` runs the real job scripts
against a fake agent that calls `gh pr review --approve` before doing its work, asserts the
attempt happened and could not succeed, and captures the agent's whole environment to assert
no GitHub credential, Slack token or HMAC secret is in it while the Claude token still is. A
second case gives the fake agent a working token anyway and asserts the tripwire fires.

### What this does not cover

- **The agent can still run commands on the server.** `Bash` is allowed; the deny list names
  specific programs. Anything else on the box that can reach the network is not covered by
  name. Run ReviewStage on a machine that holds nothing else.
- **The fingerprint watches three counters on one pull request.** It would not see a write to
  a different PR or repository, an edit to an existing comment, a label or assignee change, or
  a push. It is a tripwire for the specific failure it is named after, not a proof of
  inaction.
- **It is skipped when it cannot run.** If either GraphQL call comes back empty — a network
  failure, a service token that lost access — the comparison is not made and the run
  continues.
- **The QA guide has no fingerprint.** `run-qa.sh` uses the same scrubbed environment and the
  same deny list, but takes no before/after count. A QA build is protected by the first two
  barriers only.
- **The deny list is enforced by the Claude Code CLI.** It is the CLI's permission layer that
  honours `--disallowedTools`; the environment scrub is the barrier that does not depend on
  anything the agent or the CLI decides.

## What is not defended against

Stated plainly, so nobody assumes otherwise:

- **Any signed-in user can open any PR page on the server** — they are not scoped to who was
  requested. Everyone signed in has repo access anyway, so this discloses nothing they could
  not `gh pr diff`. The isolation is finer than "the review is shared", though, and the
  previous wording understated it:

  - **Your draft is yours.** Selection, edits, suggestions, what you dropped and what you
    posted live under `state/<repo>/<pr>/users/<your login>/` and are never rendered to anyone
    else. Nobody sees the comment you rewrote before posting, or the one you decided not to
    make.
  - **A run is yours.** Reviews run on the clicking user's own Claude account, and each
    reviewer's `review.json`, effort, focus and skill are their own. Another reviewer's run on
    the same PR is visible only as *metadata* — that it happened, by whom, on which head, and
    how its findings compare in aggregate (the convergence panel) — not as their text.
  - **What is genuinely shared** is the PR page itself, the queue, and those aggregates.

  So the honest statement is: everyone signed in can see *that* you reviewed a PR and roughly
  how your findings lined up with theirs; only you see your draft.
- **Someone with root on the server has everything** — every stored GitHub and Claude token,
  the Slack webhook, the owner's Claude credentials. Run it on a machine that holds nothing
  else you would mind losing, so the blast radius is your GitHub accounts rather than
  production data — but that is not nothing.
- **The agent reads untrusted PR content and can run commands on the server.** It runs with
  `Bash` allowed, in a worktree of the PR's head. It has no GitHub credential and an explicit
  deny list, and a write to the PR fails the run — see
  [The review agent's sandbox](#the-review-agents-sandbox), including the four things that
  arrangement does not cover. What remains is command execution as the service user, which is
  the reason to keep the server single-purpose before pointing it at PRs from outside the
  team.

## Reporting a vulnerability

Please **open a private security advisory on GitHub** (Security → Advisories → Report a
vulnerability) rather than a public issue, so a fix can ship before the details do. Include
what you found, how to reproduce it, and what you think the impact is; you will get an
acknowledgement and a fix or a reasoned response.
