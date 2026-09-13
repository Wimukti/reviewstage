# Operations

## Everyday commands

```bash
systemctl status reviewstage                        # endpoint health
journalctl -u reviewstage -f                        # endpoint log
tail -f ~/.reviewstage/watch.log            # poller log
cat ~/.reviewstage/state/<pr>/users/<login>/agent.log     # what the agent did on one PR
cat ~/.reviewstage/state/<pr>/users/<login>/review.json   # the raw agent output
cat ~/.reviewstage/state/<pr>/users/<login>/status        # fetching / reviewing / done / failed
~/.reviewstage/bin/run-review.sh <pr>       # run a review by hand (shared, no actor)
~/.reviewstage/bin/pr-watch.sh              # poll now instead of waiting for cron
curl -s localhost:8899/health                 # -> ok
```

## The endpoint caches `.env`

`server.py` reads `~/.reviewstage/.env` **once, at startup**. After editing any
secret — or flipping `DRY_RUN` — restart it or the change silently does nothing:

```bash
sudo systemctl restart reviewstage
```

This is the single most common "why isn't it working" cause. `pr-watch.sh` and
`run-review.sh` re-source `.env` on every run, so only the dashboard needs this. Re-running
`bootstrap.sh` restarts it for you.

The exception is `~/.reviewstage/settings.json`, written by the dashboard's **Settings**
page (poller on/off, poll interval, notification backends, PR filters): the poller and the
scripts re-read it every cycle and it wins over `.env`, so nothing needs a restart. Delete a
key from the file to fall back to `.env`.

## Re-notifying stale Slack cards

Slack dedup is keyed on `<pr>:<login>` in `~/.reviewstage/seen`. To re-announce PRs whose
cards went stale — after a link expiry, or a secret rotation — drop their lines. Keeping the
lines for PRs that already have a `review.json` avoids re-notifying work you already finished:

```bash
R=~/.reviewstage
while read -r l; do [ -f "$R/state/${l%%:*}/review.json" ] && echo "$l"; done < $R/seen > /tmp/s
mv /tmp/s $R/seen && $R/bin/pr-watch.sh
```

To re-announce one specific PR: `sed -i '/^1234:/d' ~/.reviewstage/seen`.

## A review is stuck on "reviewing"

Check the reviewer's `agent.log` (path above). Common causes:

- **Claude Code is not signed in** as the service user → an empty `review.json`.
- **`claude` not on PATH** — the native installer puts it in `~/.local/bin`, which is not on
  systemd's default PATH. The unit sets it explicitly; re-run `bootstrap.sh` if the unit is
  stale.
- **The timeout hit** (12 / 25 / 40 minutes by effort). Very large PRs do this. Re-run at a
  lower effort, or by hand and watch the log.
- **The server ran out of memory.** Reviews refuse to start below `MIN_FREE_MB` (default 800),
  but a review already in flight can still be OOM-killed if the machine is shared with other
  workloads.
- **You redeployed mid-review.** The systemd unit sets `KillMode=process` specifically so that
  stopping the service does not reap the detached `run-review.sh` it spawned — but a full
  reboot still will.

Clear a stuck one by re-running: `~/.reviewstage/bin/run-review.sh <pr>`. It takes a
`flock` per PR and reviewer, so a genuinely-running review will not be duplicated. The
dashboard's **Stop** button kills the run's process group and marks it `stopped`.

## When the server is rebuilt

If the machine is replaced, `$HOME` goes with it — the base clone, the state, the secrets, and
the Claude sign-in. Old Slack links keep pointing at a hostname that now resolves to a server
with nothing on it, so buttons 403 or hang.

To recover:

1. Sign in as the service user, re-clone this repo.
2. Sign Claude Code back in (`claude`, bare).
3. Re-run `bootstrap.sh`, paste the two secrets, re-run it again.
4. `RS_SECRET` is regenerated, so **every outstanding Slack link is now invalid**, and every
   stored user token is undecryptable — teammates sign in again. Clear `seen` (see above) to
   re-announce your open queue.

Everything else rebuilds itself. Nothing needs to be restored from a backup.

## Known limits

- **Slack replies thread only with a bot token.** Incoming webhooks are send-only and never
  return a message `ts`, so with a webhook alone the verdict arrives as a new message naming
  the PR. Set `SLACK_BOT_TOKEN` + `SLACK_CHANNEL` for threaded replies.
- **The `pr-review` skill is a copy.** The server runs `~/.claude/skills/pr-review/`, installed
  by bootstrap. Editing it on your laptop does not propagate — commit it here and re-run
  bootstrap on the server. (The *team default* is different: it is edited live from the
  dashboard and lives in `~/.reviewstage/skills/_global.md`.)
- **Team review requests are not polled.** `review-requested:<you>` matches direct requests
  only; a request routed through a team handle never fires.
- **Reviews cost tokens.** Roughly 10–15 minutes of agent time on a 25-file PR, against a
  Claude subscription. That is what click-to-run is for.
- **One repository per instance.** `REPO` is a single `owner/name`; run a second instance for
  a second repository.

## Changing the code

The scripts run from `~/.reviewstage/bin/`, which bootstrap populates. Editing the clone
does nothing until you re-run bootstrap:

```bash
cd ~/reviewstage && git pull && bin/bootstrap.sh
```

Bootstrap installs itself into `~/.reviewstage/bin/` too, and detects when it is running
from there so it does not try to install a file onto itself.

If you improve something, open a pull request — see [CONTRIBUTING.md](../CONTRIBUTING.md).
