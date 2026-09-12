# Setup

Budget 30 minutes. You end with a Slack card arriving for every PR that asks for your review,
and a dashboard that cannot yet write to GitHub — `DRY_RUN=1` ships as the default on purpose.

## 1. Prerequisites

### A Linux server you control

ReviewStage runs on any Linux box with `systemd`, `cron`, `python3`, `git`, `jq`, `curl` and
`openssl` — a small VM (2 GB RAM) is enough. It needs a **public hostname** with TLS in front
of it, because Slack buttons and the GitHub OAuth callback have to reach it. You provide the
reverse proxy (nginx, Caddy, Apache, a cloud load balancer); the server itself only ever binds
`127.0.0.1:8899`.

Decide the hostname now, e.g. `https://reviews.example.com`. You will be asked for it as
`PUBLIC_URL`, and every link is built from it.

> If the server is disposable (a cloud instance you may rebuild), note that `$HOME` goes with
> it. Re-running `bootstrap.sh` rebuilds everything except your secrets and the Claude
> sign-in. See [OPERATIONS.md](OPERATIONS.md#when-the-server-is-rebuilt).

### A GitHub PAT

A **classic** PAT with the `repo` scope, on your own account:
GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic).

Do **not** add `read:org`. The only call that ever needed it was
`gh pr view --json reviewRequests`, which resolves through GraphQL; the REST endpoints carry
the same data under `repo` alone.

This token acts as **you**. That is the point — it is what makes every comment the bot posts
attributable to a human rather than a bot account.

### A Slack incoming webhook

Create one pointed at a **private channel**. The cards carry PR titles, authors and diff
sizes, so it should not be a public channel.

Slack → your workspace apps → Incoming Webhooks → add to a channel → copy the URL.

Optional: leave `SLACK_WEBHOOK` empty and the bot runs fine, you just have to remember to
open the dashboard yourself.

## 2. Get the code onto the server

```bash
ssh <your-server>
git clone https://github.com/<you>/reviewstage.git ~/reviewstage
```

Clone it as the user that will run the service — the same user Claude Code will be signed in
as. It is a few thousand lines of bash, Python and TypeScript; the dashboard is built from
source by bootstrap.

> **Why `~/reviewstage` and not a deploy directory?** If you have a deploy tool or a sync job
> that runs `rsync --delete` into some path, anything under that path can vanish mid-review.
> Keep ReviewStage in `$HOME`.

## 3. Sign Claude Code in

```bash
claude    # with no arguments — shows who you are signed in as
```

If it is not installed, `bootstrap.sh` installs it in the next step and tells you to come
back here. There is no `claude login` subcommand; running `claude` bare walks you through it.

It must be signed in **as the service user**, because that is the account the systemd
service and cron jobs run as. Signing in as a different user puts the credentials in the wrong
`$HOME` and reviews fail with an empty `review.json`.

## 4. Bootstrap

```bash
~/reviewstage/bin/bootstrap.sh
```

It prompts for the **repository to review** (`owner/name`), your **GitHub login** and the
dashboard's **public URL**, then stops and tells you the two secrets are still empty. Paste
them:

```bash
read -rs PAT  && sed -i "s|^GITHUB_PAT=.*|GITHUB_PAT=$PAT|"    ~/.claude-pr-bot/.env && unset PAT
read -rs HOOK && sed -i "s|^SLACK_WEBHOOK=.*|SLACK_WEBHOOK=$HOOK|" ~/.claude-pr-bot/.env && unset HOOK
```

`read -rs` keeps the secret off your screen and out of shell history. Then re-run to finish:

```bash
~/reviewstage/bin/bootstrap.sh
```

Re-running is safe at any point. It only ever **adds** missing keys to `.env`, so your values
are never overwritten — including a `DRY_RUN` you have deliberately flipped to `0`.

What it does: installs `gh` and `claude` if missing, copies the scripts to
`~/.claude-pr-bot/bin/`, builds the dashboard, clones the repository as a blobless base clone,
installs the `pr-review` skill to `~/.claude/skills/`, seeds the editable team-default skill,
writes and starts the `prbot` systemd unit, and installs the cron entry.

It copies itself into `~/.claude-pr-bot/bin/` too, so later runs can use that stable path
rather than the clone.

### Reverse proxy

Bootstrap does **not** touch your web server by default. Point whatever terminates TLS for
`PUBLIC_URL` at `http://127.0.0.1:8899`, preserving the `Host` header. nginx:

```nginx
server {
    server_name reviews.example.com;
    # ... your TLS config ...
    location / {
        proxy_pass http://127.0.0.1:8899;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

If the server already runs Apache and you would like bootstrap to write the vhost for you,
re-run it with `SETUP_APACHE=1 ~/reviewstage/bin/bootstrap.sh`. It writes a name-based vhost
for the `PUBLIC_URL` hostname (plus any `PRBOT_HOST_ALIASES`), config-tests it, and disables it
again if anything is off, so an existing Apache is never left broken. TLS is still yours to
terminate in front of it.

## 5. Verify

```bash
curl -s localhost:8899/health                  # -> ok
curl -s https://reviews.example.com/health     # -> ok, through your proxy
~/.claude-pr-bot/bin/pr-watch.sh               # -> a Slack card per open review request
```

The last one prints `==> notifying #NNNN` for each PR it announces. If you have no open
review requests it prints nothing and that is correct — ask a teammate to add you as a
reviewer on something, or add yourself to any open PR to test.

Click **Open review** on the card. The first visit starts the review; the page reports
`reviewing` and Slack pings you again in 10–15 minutes when it is ready.

## Team pilot

One server, many reviewers. The owner does steps 1–5 above once; everyone else does this:

### GitHub login — one click instead of a token (recommended)

Create an app, paste two values into `.env`, restart. Teammates then see **Sign in with
GitHub** and never touch a token. Two kinds of app; start with the first:

**Option A — OAuth App (no org installation needed).** github.com → Settings → Developer
settings → OAuth Apps → *New OAuth App*:

| Field                      | Value                                                            |
| -------------------------- | ---------------------------------------------------------------- |
| Application name           | `ReviewStage`                                                    |
| Homepage URL               | `<PUBLIC_URL>/`                                                  |
| Authorization callback URL | `<PUBLIC_URL>/prbot/oauth/callback`                              |
| Enable Device Flow         | off                                                              |
| Expire user access tokens  | **on** — 8-hour tokens with refresh; the dashboard refreshes them itself |

Register, copy the **Client ID**, click *Generate a new client secret* (shown once), then on
the server:

```bash
sed -i "s|^GH_CLIENT_ID=.*|GH_CLIENT_ID=<client id>|; s|^GH_CLIENT_SECRET=.*|GH_CLIENT_SECRET=<secret>|; s|^GH_OAUTH_SCOPES=.*|GH_OAUTH_SCOPES=repo|" ~/.claude-pr-bot/.env
sudo systemctl restart prbot
```

Teammates click *Sign in with GitHub* → GitHub's *Authorize* screen → back to the dashboard,
landing on Settings the first time so they add their Slack member ID. The token GitHub issues
acts as them (comments carry their name), lasts 8 hours and is refreshed server-side before
it lapses, and they can revoke the app any time at github.com/settings/applications.

> If the sign-in comes back with **"the token cannot see `<owner/name>`"**, the org has
> *third-party OAuth application access restrictions* on. An org owner approves the app once
> (Org settings → Third-party access → the pending request) and it works for everyone from
> then on. Token sign-in keeps working meanwhile.

**Option B — GitHub App (narrower permissions, needs an org owner to install it).** Same
callback URL; permissions *Pull requests: Read & write*, *Contents: Read*; enable *Request user
authorization (OAuth) during installation*; leave `GH_OAUTH_SCOPES` **empty**. What it adds
over Option A is scope: app-level permissions instead of the user's full `repo`, and org-owner
revocation. Comments show the user's avatar with the app's badge. Ask an owner to install it on
your org — until then the sign-in fails with the same message as above. This is the end-state;
Option A is the way to be live today.

### Teammate — under two minutes

1. Open `<PUBLIC_URL>/login` (the owner sends you the link).
2. **Sign in with GitHub** if the button is there. Otherwise the token path is two clicks:
   *Create token on GitHub ↗* opens GitHub with the scope and name already filled in — pick
   an expiry, *Generate token*, copy — then paste it. The page tells you as you paste whether
   it looks right, and checks it with GitHub on submit. The token is stored encrypted and used
   only to post the comments and approvals *you* choose, as *you*.
3. You land on a **welcome checklist**: paste your **Slack member ID** (Slack → your profile
   picture → Profile → ⋮ → *Copy member ID*) so review requests ping you, and optionally
   connect your own Claude account. *Skip for now* is fine; both live in *Settings*.

Done. The next time someone requests your review, you get a card in the shared channel
within 3 minutes.

### Owner — one-time

- Create a **private Slack channel** (e.g. `#reviewstage`), invite the pilot group, and
  point `SLACK_WEBHOOK` at it. Cards `@mention` whoever is requested, so one channel serves
  everyone; only the mentioned person is pinged.
- Sign in yourself at `/login` like everyone else. Your pre-multi-user history
  (`state/<pr>/posted.json` etc.) is read as yours automatically.
- Reviews run on this server's Claude sign-in unless the person starting one has connected
  their own account (below), and **serialize** — one at a time, server-wide — so two agents
  never share a small machine. Queued reviews show as `queued — waiting…` on their page. To
  take yourself out of the billing path entirely, set `ANTHROPIC_API_KEY` in the systemd
  unit's environment; `claude -p` honours it for anyone who has not connected their own account.
- Optionally list the paths your team treats as high-stakes in `RISK_PATHS` (see
  [`config.example`](../config.example)) so reviews that touch them get a context banner.

### Connect your own Claude account (optional, per person)

By default every review runs on the server's shared Claude sign-in — the owner's subscription.
Anyone can move *their* reviews onto their own account from *Settings* → **Connect Claude
account**:

1. **Open Claude to authorize ↗** — sign in on claude.com with *your* Claude account and click
   Authorize. Claude shows you a code.
2. **Paste the code** → *Connect*. Verified with one tiny call, stored encrypted like your
   GitHub token. Needs a Pro, Max, Team or Enterprise plan.

From then on, reviews **you** click to start run with your token, billed to your plan and
subject to your plan's limits. Reviews other people start are unaffected; a review is shared
per PR, so whoever starts it pays for it and everyone requested reads it. The PR page says
which account it ran on. *Disconnect* in Settings reverts you to the shared runner.

**How this stays inside Anthropic's rules.** Anthropic prohibits Claude-account OAuth in
third-party applications (server-side enforcement since 01/09/26; policy made explicit
02/19/26): the "Connect Claude" buttons in unofficial tools that reuse Claude Code's OAuth
client are exactly what was banned. This dashboard does not do that. It runs the **genuine
`claude setup-token`** on the server — the command Anthropic documents for CI jobs and scripts
that wrap Claude Code — inside an isolated config directory, and only replaces its terminal
prompt with a web form: the authorize link is the one the CLI printed, the code goes to the
CLI, the CLI mints the token, and the token is only ever used by Claude Code (`claude -p`).
If you would rather not have the server involved in the sign-in at all, the fallback is the
same command run on your own laptop and the token pasted in — under *Or paste a token from
`claude setup-token` instead*.

### What each person sees

| Tab / page  | Scope                                                          |
| ----------- | -------------------------------------------------------------- |
| To review   | PRs currently awaiting **your** review                         |
| Reviewed    | Reviews you have opened that you have not posted yet           |
| Posted      | Posted by **you** (someone else posting the same PR is theirs) |
| Approved    | Approved by **you**                                            |
| PR detail   | The shared review; your own tick/edit state and actions        |

## 6. Configuration reference

Everything lives in `~/.claude-pr-bot/.env` (chmod 600).
[`config.example`](../config.example) documents every key with its reasoning.

| Key                  | Set by      | Notes                                                          |
| -------------------- | ----------- | -------------------------------------------------------------- |
| `GITHUB_PAT`         | you         | Classic PAT, `repo` scope. Acts as **you**                     |
| `SLACK_WEBHOOK`      | you         | Private channel. Optional                                      |
| `REPO`               | prompt      | The repository to review, `owner/name`. **Required**           |
| `REVIEWER`           | prompt      | Your GitHub login. Must match the PAT's account                |
| `PUBLIC_URL`         | prompt      | Where browsers reach the dashboard. **Required**               |
| `PRBOT_SECRET`       | generated   | Signs every dashboard link                                     |
| `DRY_RUN`            | default 1   | `1` = dashboard works fully but refuses to write to GitHub     |
| `SKIP_BOT_PRS`       | default 0   | `1` ignores PRs authored by bots                               |
| `MIN_FREE_MB`        | default 800 | Refuse to start a review below this much free RAM              |
| `RISK_PATHS`         | default ""  | `label:pattern` rules for the risk-area banner. Empty = off    |
| `PRBOT_HOST_ALIASES` | default ""  | Extra hostnames that are this instance (cross-host SSO)        |
| `PRBOT_DOMAIN`       | default ""  | Parent domain to scope the session cookie to. Empty = host-only |

Per-person data is not in `.env`. It lives in `~/.claude-pr-bot/users.json` (chmod 600):
`{login: {pat_enc, slack_id, name, added}}`, written by the dashboard on sign-in. Tokens are
AES-256 encrypted with a key derived from `PRBOT_SECRET`. To remove someone, delete their
key from that file — their session dies on the next request.

> **Gotcha:** `prbot-server.py` reads `.env` **once, at startup**. After editing any value —
> especially `DRY_RUN` — run `sudo systemctl restart prbot` or the change silently does
> nothing. `pr-watch.sh` and `run-review.sh` re-source it every run, so only the dashboard
> needs this. Re-running `bootstrap.sh` restarts it for you.

## 7. Rollout — do not skip the dry run

`DRY_RUN=1` is the shipped default. The dashboard renders and every button works; they just
report what *would* have happened.

1. **Dry run.** Point it at PRs you have already reviewed by hand and compare. This is where
   you find out whether the output is good enough to carry your name. Do several.
2. **Your own PRs.** Set `DRY_RUN=0`, `sudo systemctl restart prbot`, and post on a PR you
   authored. Low stakes, real end-to-end.
3. **Live.**

Read [SECURITY.md](SECURITY.md) before step 2. The endpoint is on the public internet.

## Troubleshooting the install

| Symptom                                          | Cause                                                          |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| `Run as <user>, not <other>`                     | You set `PRBOT_USER` and ran bootstrap from a different account. `sudo su - <user>` first |
| `REPO is empty` / `PUBLIC_URL is empty`          | First bootstrap ran without a terminal, so the prompts were skipped. Edit `.env` and re-run |
| `REVIEWER not set`                               | Same — edit `.env` and re-run                                    |
| `apache configtest FAILED`                       | Only with `SETUP_APACHE=1`. The vhost is auto-disabled and nothing else is touched. Check `sudo apache2ctl configtest` |
| `/health` unreachable through the proxy          | Your reverse proxy is not forwarding to `127.0.0.1:8899`, or is not preserving `Host` |
| Review finishes instantly, empty `review.json`   | Claude Code is not signed in as the service user. `claude` bare, as that user |
| `command not found: claude` in `agent.log`       | The systemd unit sets `PATH` to include `~/.local/bin`. Re-run bootstrap to rewrite the unit |
| Slack card never arrives                         | `~/.claude-pr-bot/watch.log`. Then check the cron entry with `crontab -l` |
| Card arrives, button 403s                        | Link expired (7 days) or `PRBOT_SECRET` was rotated. Open the dashboard link instead |
