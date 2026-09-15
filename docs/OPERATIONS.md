# Operations

ReviewStage ships two installs, and almost every operational command differs between them:

- **Docker Compose** — the primary install ([INSTALL-DOCKER.md](INSTALL-DOCKER.md)). The
  dashboard is the `app` container, the poller is the `poller` container under the `team`
  profile, and all persistent state is the named volume `reviewstage-data` mounted at
  `/home/reviewstage/.reviewstage`.
- **From source on a Linux box** — `bin/bootstrap.sh` ([SETUP.md](SETUP.md)). The dashboard is
  the `reviewstage.service` systemd unit, the poller is a `*/3 * * * *` crontab entry, the
  scripts run from `~/.reviewstage/bin/`, and state is `~/.reviewstage/`.

Where this document says **ROOT** it means whichever of those two directories applies.

One install reviews **many repositories**. `REPOS` is a comma-separated list and
`REPO_ALLOW_ORG` accepts a whole owner on demand; `REPO=owner/name` survives only as a
single-entry alias. Every state path below therefore carries the repository as a slug,
`<owner>__<name>` — for example `state/acme__widgets/482/users/alice/`.

---

## Operations (Docker)

### Everyday commands

```bash
docker compose ps                                   # container health
docker compose logs -f app                          # dashboard log
docker compose logs -f poller                       # poller log (team profile)
docker compose exec app doctor                      # full diagnostics, PASS/WARN/FAIL
docker compose exec app curl -s localhost:8899/health        # -> ok
docker compose exec app bash                        # a shell; ~/.reviewstage is the volume
```

Per-PR state, for one reviewer on one PR:

```bash
R=/home/reviewstage/.reviewstage/state/<owner>__<name>/<pr>/users/<login>
docker compose exec app cat $R/agent.log            # what the agent did
docker compose exec app cat $R/review.json          # the raw agent output
docker compose exec app cat $R/status               # fetching / reviewing / done / failed
```

Running things by hand (a review also needs a connected reviewer's Claude token, which only
the dashboard can supply — prefer the dashboard's buttons):

```bash
docker compose exec app pr-watch.sh                 # poll now instead of waiting
docker compose exec app run-review.sh <owner/name> <pr>
```

### Run the doctor the way that works

```bash
docker compose exec app doctor
```

`bin/doctor.sh` is a diagnostic for the environment the **server** runs in: it reads
`ROOT/.env`, looks for `git`, `gh`, `claude`, `jq`, `flock`, `openssl` and `curl` on `PATH`,
checks the service token against each configured repository, checks free disk and free RAM,
probes `/health`, and lists the installed skills and signed-in users. On a Docker install
every one of those lives inside the `app` container, so running the script on the host checks
the wrong machine: it reads the host's `~/.reviewstage/.env` rather than the `.env` you just
filled in, finds no `claude`, and reports FAILs against a perfectly healthy install. On macOS
it can never pass, because the host has no `/proc/meminfo`.

`docker compose exec app doctor` runs the same script inside the container, against the real
config, the real binaries and the real data volume. `docker compose run --rm app doctor` does
the same in a throwaway container sharing the volume, which works when `app` will not start.

It never checks Docker itself — `docker compose ps` is that check.

> **Dependency:** `bin/doctor.sh` is being changed in a parallel lane to detect that it is
> running on a Compose host and re-exec itself inside the container. Once that lands, plain
> `bin/doctor.sh` becomes a correct front door too. The `docker compose exec app doctor` form
> above works either way, which is why the docs use it.

### `.env` is read once, at startup

`server.py` reads `ROOT/.env` **once, at startup**. After editing any secret — or flipping
`DRY_RUN` — recreate the container or the change silently does nothing:

```bash
docker compose up -d        # recreates the container with the new .env
```

This is the single most common "why isn't it working" cause. `pr-watch.sh` and `run-review.sh`
re-source `.env` on every run, so only the dashboard needs this.

The host `.env` is mirrored into the volume on every start: a key **set** in the host file
wins, a key left empty keeps whatever the volume already holds (which is how a generated
`RS_SECRET` survives a restart).

The exception is `ROOT/settings.json`, written by the dashboard's **Settings** page (poller
on/off, poll interval, notification backends, PR filters, auto-profile): the poller and the
scripts re-read it every cycle and it wins over `.env`, so nothing needs a restart. Delete a
key from the file to fall back to `.env`.

### Rebuilding kills in-flight reviews

```bash
docker compose up -d --build        # after pulling new code
```

This recreates the `app` container. A review is a detached `run-review.sh` **inside that
container**, so recreating it takes the review with it: the run dies mid-flight and the PR is
left reading `reviewing` until its status goes stale. There is no `KillMode=process` equivalent
here — that setting exists only in the systemd unit the from-source install writes, and it does
not apply to Docker.

Before a rebuild, check nothing is running:

```bash
docker compose exec app pgrep -af 'run-review.sh|run-qa.sh'
```

A review killed this way is recovered by clicking **Start review** again; nothing is corrupted,
the tokens are simply spent.

### Ports

`RS_PORT` is the port the **server binds inside the container**. Compose also interpolates it
into the host side of the published port. Because Compose reads the very same `./.env` for
interpolation *and* passes it into the container as an environment variable, putting `RS_PORT`
in `.env` moves the two halves apart and silently breaks the install — the publish still
targets container port 8899 while the server has moved somewhere else. Change the host port
from the shell instead, where only the interpolation sees it:

```bash
RS_PORT=9000 docker compose up -d        # host 127.0.0.1:9000 -> container 8899
```

See [Configuration](https://wimukti.github.io/reviewstage/operations/configuration/) for the
current state of this key.

---

## Operations (from source)

### Everyday commands

```bash
systemctl status reviewstage                        # endpoint health
journalctl -u reviewstage -f                        # endpoint log
tail -f ~/.reviewstage/watch.log                    # poller log (the cron entry)
curl -s localhost:8899/health                       # -> ok
~/.reviewstage/bin/doctor.sh                        # full diagnostics
~/.reviewstage/bin/pr-watch.sh                      # poll now instead of waiting for cron
~/.reviewstage/bin/run-review.sh <owner/name> <pr>  # run a review by hand
```

Per-PR state:

```bash
R=~/.reviewstage/state/<owner>__<name>/<pr>/users/<login>
cat $R/agent.log        # what the agent did
cat $R/review.json      # the raw agent output
cat $R/status           # fetching / reviewing / done / failed
```

### `.env` is read once, at startup

```bash
sudo systemctl restart reviewstage
```

Re-running `bootstrap.sh` restarts it for you. As on Docker, `settings.json` is the exception
and needs no restart.

### Changing the code

The scripts run from `~/.reviewstage/bin/`, which bootstrap populates. Editing the clone does
nothing until you re-run bootstrap:

```bash
cd ~/reviewstage && git pull && bin/bootstrap.sh
```

Bootstrap installs itself into `~/.reviewstage/bin/` too, and detects when it is running from
there so it does not try to install a file onto itself.

The unit sets `KillMode=process` specifically so that stopping or restarting the service does
not reap the detached `run-review.sh` it spawned — a redeploy mid-review survives. A full
reboot still does not.

---

## Re-notifying stale cards

Notification dedup is keyed **`<repo>:<pr>:<login>`** — one line per person per PR — in
`ROOT/seen`. (Lines written before the repository dimension existed are `<pr>:<login>`, or a
bare `<pr>` from before multi-user; both still count, but only on an install with exactly one
repository configured.) To re-announce PRs whose cards went stale — after a link expiry, or a
secret rotation — drop their lines.

The recipe below keeps the line for any PR that already has a `review.json` for that reviewer,
so work you already finished is not re-announced. It splits the repository out of each line, so
it is safe on a multi-repository install, and it leaves legacy lines alone rather than
discarding them:

```bash
R=~/.reviewstage        # Docker: /home/reviewstage/.reviewstage, inside the app container
while IFS= read -r l; do
  case "$l" in
    */*:*:*)
      repo=${l%%:*}; rest=${l#*:}; pr=${rest%%:*}; who=${rest#*:}
      slug=$(printf '%s' "$repo" | sed 's#/#__#')
      [ -f "$R/state/$slug/$pr/users/$who/review.json" ] && printf '%s\n' "$l"
      ;;
    *) printf '%s\n' "$l" ;;     # legacy line without a repo: keep it
  esac
done < "$R/seen" > "$R/seen.new" && mv "$R/seen.new" "$R/seen"
```

Then poll: `~/.reviewstage/bin/pr-watch.sh` (Docker: `docker compose exec poller pr-watch.sh`).

To re-announce **one** PR, delete just its lines — always anchor on the repository, or the
`sed` wipes the same PR number in every repository:

```bash
sed -i '\#^acme/widgets:1234:#d' ~/.reviewstage/seen
```

> The recipe this replaces rewrote `seen` from `state/<pr>/review.json`, a path that no longer
> exists, and described the key as `<pr>:<login>`. On a multi-repository install every line
> failed the test and the whole file was emptied, re-announcing the entire backlog to everyone.

---

## A review is stuck on "reviewing"

Check the reviewer's `agent.log` (path above). Common causes:

- **The clicking user has not connected a Claude account.** `run-review.sh` refuses to start
  without `CLAUDE_CODE_OAUTH_TOKEN`; the run ends at once with an empty result. Connect Claude
  in *Integrations*.
- **From source: `claude` not on PATH** — the native installer puts it in `~/.local/bin`, which
  is not on systemd's default PATH. The unit sets it explicitly; re-run `bootstrap.sh` if the
  unit is stale. In Docker the CLI is in the image and this cannot happen.
- **The timeout hit** (the per-effort ceiling in `run-review.sh`: Quick 12 minutes, Standard 25,
  Deep 40). Very large PRs do this. Re-run at a lower effort, or by hand and watch the log.
- **The machine ran out of memory.** Reviews refuse to start below `MIN_FREE_MB` (default 800),
  but a review already in flight can still be OOM-killed if the box is shared.
- **You redeployed mid-review.** On Docker, `docker compose up -d --build` kills it (above). On
  systemd, `KillMode=process` protects it from a restart but not from a reboot.

Clear a stuck one by re-running from the dashboard. `run-review.sh` takes a `flock` per PR and
reviewer, so a genuinely-running review will not be duplicated. The dashboard's **Stop** button
kills the run's process group and marks it `stopped`.

---

## Backup and restore

**The data volume is not disposable.** Most of it rebuilds itself, but several things in it
exist nowhere else and cannot be regenerated:

| Path under ROOT | What is lost without a backup |
| --- | --- |
| `users.json` | Every reviewer's GitHub and Claude tokens, encrypted with a key derived from `RS_SECRET`, plus their Slack/Discord IDs and the admin flag. |
| `skills/` | A **git repository**: the team default `_global.md`, per-user and per-repo skills, and the full revision history of who changed the team's review standard and why. This is hand-tuned prose the team wrote. |
| `learnings.jsonl`, `rule_proposals.json`, `rule_dismissals.json`, `rule_promotions.json` | The accept/reject record that steers every future review, the drafted rule suggestions, and which ones the team accepted or dismissed. |
| `profiles/<owner>__<name>/` | Each repository's critical-path profile, its earlier versions, and the human edits made to it. Regenerating costs a model call and loses the edits. |
| `.env`, `settings.json` | The install's configuration — including `RS_SECRET` itself. |

Genuinely disposable: `repos/` (base clones), `wt/` (worktrees), `state/` (per-PR runs — losing
it loses history, not function), `queue.json`, `used-nonces`, `clone.log`.

`RS_SECRET` is the keystone. Lose it and `users.json` is undecryptable even if you still have
the file: everyone signs in again and reconnects Claude, and every outstanding signed link
(notification buttons included) 403s.

### Back up (Docker)

The volume is `reviewstage-data`, which Compose names `<project>_reviewstage-data` — confirm
with `docker volume ls`. Back it up by streaming a tar out of a throwaway container, so nothing
has to be stopped:

```bash
VOL=$(docker volume ls -q --filter name=reviewstage-data | head -1)
docker run --rm -v "$VOL":/data:ro -v "$PWD":/out alpine \
  tar czf /out/reviewstage-$(date +%Y%m%d-%H%M).tgz -C /data .
```

Smaller backup, skipping the clones and worktrees:

```bash
docker run --rm -v "$VOL":/data:ro -v "$PWD":/out alpine \
  tar czf /out/reviewstage-$(date +%Y%m%d-%H%M).tgz -C /data \
      --exclude=./repos --exclude=./wt .
```

The archive contains `.env` and the encrypted token store. Treat it as a secret: `chmod 600`,
off shared storage, encrypted at rest.

### Restore (Docker)

```bash
docker compose down
VOL=$(docker volume ls -q --filter name=reviewstage-data | head -1)
docker run --rm -v "$VOL":/data -v "$PWD":/in alpine \
  sh -c 'rm -rf /data/* /data/.[!.]* 2>/dev/null; tar xzf /in/reviewstage-YYYYMMDD-HHMM.tgz -C /data'
docker run --rm -v "$VOL":/data alpine chown -R 1000:1000 /data
docker compose up -d
docker compose exec app doctor
```

On a brand-new host create the volume first: `docker volume create <project>_reviewstage-data`,
where `<project>` is the Compose project name (the directory name unless you set one).

The `chown` matters: the container runs as uid 1000 (`reviewstage`), and a tar restored as root
leaves the volume unwritable.

### Back up and restore (from source)

```bash
tar czf reviewstage-$(date +%Y%m%d-%H%M).tgz \
    -C "$HOME" --exclude=.reviewstage/repos --exclude=.reviewstage/wt .reviewstage
```

Restore by stopping the service, untarring into `$HOME` as the service user, and starting it
again:

```bash
sudo systemctl stop reviewstage
tar xzf reviewstage-YYYYMMDD-HHMM.tgz -C "$HOME"
chmod 700 ~/.reviewstage && chmod 600 ~/.reviewstage/.env ~/.reviewstage/users.json
sudo systemctl start reviewstage
~/.reviewstage/bin/doctor.sh
```

### Verify a backup

A backup you have not restored is a hypothesis. Restore it into a scratch install and check
that `doctor` reports the signed-in users, that the Skills page shows the revision history, and
that an existing reviewer can open the dashboard without signing in again — that last one is
the real test that `RS_SECRET` and `users.json` came back as a matching pair.

---

## When the server is rebuilt

If the machine is replaced without a backup, everything in the table above goes with it, plus
the base clones. Old notification links point at a hostname that now resolves to a server with
nothing on it, so buttons 403 or hang.

To recover **from a backup**: bring the new host up, install Docker (or re-run `bootstrap.sh`),
restore the volume as above, and start. Nobody signs in again and no history is lost.

To recover **without one**:

1. Re-clone and bring the install up (`docker compose up -d`, or `bootstrap.sh` twice with the
   secrets pasted in between).
2. From source only: sign Claude Code in as the service user if you want the bare CLI usable;
   reviews themselves run on each reviewer's own connected account either way.
3. `RS_SECRET` is regenerated, so **every outstanding signed link is invalid**, every stored
   user token is undecryptable, and **every device token and session cookie stops working** —
   teammates sign in again and reconnect Claude, and phones and CLIs pair again.
4. The team's review standard, its learnings and the repository profiles are gone. The team
   default re-seeds from `skills/global-review.md` in this repo, which is the starting point,
   not what your team had evolved.
5. Clear `seen` (above) to re-announce the open queue.

Step 4 is the one that hurts, and it is why the previous version of this document — which said
"nothing needs to be restored from a backup" — was wrong.

---

## Known limits

- **Slack replies thread only with a bot token.** Incoming webhooks are send-only and never
  return a message `ts`, so with a webhook alone the verdict arrives as a new message naming
  the PR. Set `SLACK_BOT_TOKEN` + `SLACK_CHANNEL` for threaded replies.
- **The built-in `pr-review` skill is a copy.** The agent runs `~/.claude/skills/pr-review/`,
  installed from this repo's `skills/` on every container start (Docker) or by bootstrap (from
  source). Editing it on your laptop does not propagate — commit it here and redeploy. The
  *team default* is a different document: it is seeded from `skills/global-review.md`, edited
  live from the dashboard, and lives at `ROOT/skills/_global.md`.
- **Skill history is best-effort.** Every save tries to commit to the git repository in
  `ROOT/skills`. If git is missing or the repository is wedged the save still succeeds and the
  commit is silently skipped, so the Revision history panel can have gaps.
- **Team review requests are not polled.** `review-requested:<you>` matches direct requests
  only; a request routed through a team handle never fires.
- **Reviews cost tokens.** A few minutes of agent time for a typical PR on Opus (longer for
  Deep), against the clicking reviewer's Claude subscription. That is what click-to-run is for.
- **One heavy job at a time per server.** Reviews and QA guides share a box-wide lock.
- **Reviews need memory.** `MIN_FREE_MB` defaults to 800 MB *available* (not total), so a 1 GB
  VPS cannot run a single review. Give the host at least 2 GB.

## Changing the code

If you improve something, open a pull request — see [CONTRIBUTING.md](../CONTRIBUTING.md).
