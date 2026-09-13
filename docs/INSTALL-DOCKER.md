# Install with Docker

The quickest way to run ReviewStage: one image, one data volume, no systemd, cron or Apache.
Budget 10 minutes, most of it the first image build.

You need Docker 24+ with Compose v2 (`docker compose version`). Apple Silicon, Intel and
arm64 Linux all work — the image builds for the host's architecture.

## Quick start

```bash
git clone <this repo> reviewstage && cd reviewstage
cp .env.example .env            # set REPO and GITHUB_PAT (next section)
docker compose up -d            # builds the image the first time (~3–5 min)
```

Open **http://localhost:8899** (use `localhost`, not `127.0.0.1` — see *Cookies* below).

1. **Sign in** with a fine-grained GitHub PAT of your own (below). It is stored encrypted and
   used only for the comments and approvals *you* click.
2. **Connect Claude** — Settings → *Connect Claude account* → *Open Claude to authorize* →
   paste the code back. Reviews you start run on your subscription.
3. **Paste a PR URL** (or number): *Review a PR* in the sidebar, or `Cmd/Ctrl-K` anywhere.
   Pick an effort and go. Or wait for the queue: with the poller running (*Team mode*, below)
   every PR that requests your review shows up on its own.

`DRY_RUN=1` is the shipped default: everything works, nothing is written to GitHub. Run a few
reviews on PRs you already reviewed by hand, compare, and only then set `DRY_RUN=0` in `.env`
and `docker compose up -d`.

## The two values in `.env`

### `REPO`

`owner/name` of the repository to review. One repository per install.

### `GITHUB_PAT` — the service token

This token **reads**: PR metadata, diffs, the clone the reviews check out, and the poller's
"who is requested where" searches. It never posts anything — posting and approving use the
signed-in reviewer's own token, so every comment carries a human's name.

Create a **fine-grained** token: GitHub → Settings → Developer settings → Personal access
tokens → **Fine-grained tokens** → *Generate new token*.

| Setting               | Value                                                              |
| --------------------- | ------------------------------------------------------------------ |
| Resource owner        | the org (or user) that owns `REPO`                                 |
| Repository access     | **Only select repositories** → the repo in `REPO`                  |
| Repository permissions| **Pull requests: Read and write** · **Contents: Read** · **Metadata: Read** (added automatically) |
| Expiration            | your call; the container keeps working until it lapses             |

"Pull requests: Read and write" on the *service* token is what lets a reviewer without their
own token still read review threads; nothing in the service path ever writes with it. For an
org with *fine-grained token approval* enabled an org owner has to approve the token once.

The same fine-grained shape works for the token each **reviewer** pastes at sign-in. The login
page's *Create token on GitHub* link pre-fills a classic token with the `repo` scope instead;
either kind works — the fine-grained one is simply narrower.

Then:

```bash
docker compose exec app doctor
```

prints a PASS/WARN/FAIL line per check — the token can see the repo, `claude` and `gh` are on
the path, the server answers, and so on. It is safe to run any time; it changes nothing.

## Team mode: the poller

```bash
docker compose --profile team up -d
```

adds a second container that runs `pr-watch.sh` every 3 minutes: it finds PRs awaiting each
signed-in user's review, keeps the queue fresh, and — if `SLACK_WEBHOOK`, `DISCORD_WEBHOOK` or
`WEBHOOK_URL` is set — posts a card mentioning the person requested. Without it the dashboard
still works; you open it yourself and paste PR URLs.

The poller is controlled from the dashboard's **Settings** page (admin only): pause it, change
the interval (1–60 min) and pick the notification backends without restarting the container.

For more than one person to sign in you need a URL they can reach, over HTTPS:
[`../deploy/README.md`](../deploy/README.md) covers Caddy, Tailscale and Cloudflare Access.
Set `PUBLIC_URL` in `.env` to that URL.

## Demo mode: no credentials at all

```bash
docker compose up demo
```

starts the dashboard against an offline fixture — two reviewed PRs on disk, a fake `gh` that
answers nothing, its own volume — and prints a **sign-in link** to the console. Open it and
click around; nothing reaches GitHub or Claude. The login form does not work in demo mode
(there is no GitHub to check a token against); the printed link is the way in.

How it works: this is the same fixture the Playwright suite uses (`dashboard-ui/e2e/fixture.ts`,
ported to `bin/demo-fixture.py`). The fixture places a `gh` stub that exits 1 first on `PATH`,
so every GitHub call falls back to the on-disk state; the browser tests inject a session cookie,
the demo instead uses the server's own `/handoff/accept` route, which mints the cookie from an
HMAC-signed link. Stop with `Ctrl-C`; `docker compose down -v` also removes the demo volume.

## How `claude` authenticates inside the container

Short version: **it does not need to be logged in.** Nothing in the container runs on a shared
Claude login.

- Reviews and QA guides run **on the account of the person who clicked**. When you connect
  Claude in Settings, the dashboard runs the same OAuth + PKCE exchange `claude setup-token`
  performs, stores the resulting token encrypted in `users.json` (key derived from
  `PRBOT_SECRET`), refreshes it before it expires, and passes it to the review process as
  `CLAUDE_CODE_OAUTH_TOKEN`. `run-review.sh` refuses to start without that variable, and the
  server refuses to spawn a review for anyone who has not connected — so the container's own
  `claude` has no login and never needs one. The one-line "Reply with OK" call that verifies a
  token at connect time, and the quick-add-a-rule helper on the Skills page, use the same
  per-user token.
- What the image provides is only the **CLI binary** (`@anthropic-ai/claude-code` via npm, on
  Node 24) and a writable `$HOME/.claude` for its own state. The review skills are copied into
  `~/.claude/skills` at every start.
- Consequence: a fresh install shows *Connect Claude* as a required step; `doctor` warns until
  at least one user has connected. There is no `ANTHROPIC_API_KEY` fallback in the review path.

Plans: connecting needs a Claude Pro, Max, Team or Enterprise subscription. Each review is a
real agent run (10–15 minutes on a 25-file PR) against that person's usage limits.

## Where things live

| In the container                         | What                                               |
| ---------------------------------------- | -------------------------------------------------- |
| `/home/reviewstage/.claude-pr-bot`       | **The data volume** (`reviewstage-data`): `.env`, `users.json`, `state/<pr>/…`, `queue.json`, `skills/`, the base clone `repo/`, worktrees `wt/` |
| `/app/bin`                               | the server and scripts (`prbot-server.py`, `run-review.sh`, `pr-watch.sh`, `doctor.sh`) |
| `/app/bin/static`                        | the dashboard bundle built in the image's first stage |
| `/app/skills`                            | the review skills shipped with the repo            |

The base clone is made in the background on first start (blobless, so it is small). Until it
finishes a review fails with "could not fetch"; `docker compose logs app` and
`~/.claude-pr-bot/clone.log` (inside the volume) show progress.

The host `.env` is mirrored into the volume on every start. A key **set** in the host file wins;
a key left empty keeps whatever the volume already has (so `PRBOT_SECRET` is generated once and
survives restarts). `REVIEWER` is derived from the service token's login if you do not set it.

## Everyday commands

```bash
docker compose logs -f app                 # server log (sign-ins, spawns)
docker compose logs -f poller              # poller log
docker compose exec app doctor             # diagnostics
docker compose exec app bash              # a shell; ~/.claude-pr-bot is the volume
docker compose exec app run-review.sh 123  # run one review by hand (needs a connected user's token — use the dashboard)
docker compose exec app pr-watch.sh        # poll now
docker compose up -d --build               # after pulling new code
docker compose down                        # stop; data stays
docker compose down -v                     # stop and delete the data volume
```

The server reads `.env` once at startup — after any change, `docker compose up -d` (which
recreates the container) is required, exactly as `systemctl restart prbot` is on a box.

## Cookies and `localhost`

Session cookies are marked `Secure`. Browsers treat `http://localhost` as a secure context, so
the quick start works over plain http in Chrome, Firefox and Edge; `http://127.0.0.1` does not
get the same treatment everywhere, and Safari is stricter still. When `PUBLIC_URL` starts with
`http://` the container drops the `Secure` flag (`PRBOT_COOKIE_SECURE=0`) so a plain-http
install on a LAN also works — do not do that for anything reachable from outside; use TLS
([`../deploy/README.md`](../deploy/README.md)).

## Troubleshooting

| Symptom                                          | Cause / fix                                                     |
| ------------------------------------------------ | --------------------------------------------------------------- |
| `doctor` FAILs `gh repo view`                    | The token's *Repository access* does not include `REPO`, or the org has not approved it |
| Review fails at once: "connect your Claude account" | The clicking user has not connected Claude (Settings)        |
| Review fails: "could not fetch <branch>"         | Base clone not finished or failed — see `clone.log` in the volume |
| Review fails: "not enough free memory"           | `MIN_FREE_MB` (default 800) — give Docker more RAM or lower it in `.env` |
| Signed in, then straight back to the login page  | Cookie rejected: open `http://localhost:8899`, not `127.0.0.1`; behind a proxy, `PUBLIC_URL` must be `https://` and the proxy must forward `Host` |
| Slack/Discord card never arrives                 | Poller not running (`--profile team`) or paused in Settings, or no webhook URL in `.env` — `docker compose logs poller` |
| Port 8899 in use                                 | `PRBOT_PORT=9000 docker compose up -d` (host side only)         |
