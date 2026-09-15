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

### Run the doctor

```bash
docker compose exec app doctor      # or just: bin/doctor.sh
```

`bin/doctor.sh` is a diagnostic for the environment the **server** runs in: it reads
`ROOT/.env`, looks for `git`, `gh`, `claude`, `jq`, `flock`, `openssl` and `curl` on `PATH`,
checks the service token against each configured repository, checks free disk and free RAM,
probes `/health`, and lists the installed skills and signed-in users. On a Docker install
every one of those lives inside the `app` container — none of them are on the host.

So the script finds the container for you. Run from a directory holding this project's
`docker-compose.yml` with the `app` service up, it re-execs itself inside the container and
says so on its first line:

```
Compose project detected — running the checks inside the app container (docker compose exec app doctor).
```

Everything after that line is about the real install: the `.env` you filled in, the real
binaries, the real data volume. The two explicit forms still work and are unchanged —
`docker compose exec app doctor` runs the checks where it is, and
`docker compose run --rm app doctor` uses a throwaway container sharing the volume, which is
the one to reach for when `app` will not start.

When `app` is **not** running, the doctor says so and falls back to checking the host, with a
WARN naming what it is really looking at:

```
WARN  this is a ReviewStage Compose project but its 'app' service is not running, so the
      checks below are about THIS HOST, not the install.
```

Treat those results with that in mind — on a Docker install the host has no `.env`, no
`claude`, and on macOS no `/proc/meminfo`, so they will FAIL whatever state the install is in.

It never checks Docker itself — `docker compose ps` is that check.

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

The container's listen port is **pinned to 8899** in `docker-compose.yml`. It is part of the
image contract — `EXPOSE`, the healthcheck and the publish target all name it — so the compose
file sets `RS_PORT: "8899"` in the service environment and `.env` cannot move it.

The host side is `RS_HOST_PORT`, which does nothing else. It is safe in `.env`:

```bash
echo 'RS_HOST_PORT=9000' >> .env
docker compose up -d                     # host 127.0.0.1:9000 -> container 8899
```

Earlier versions used one key for both halves. Because Compose reads `./.env` twice — once to
interpolate `${...}` in the ports mapping and once as the container's `env_file` — an `RS_PORT`
there moved the server inside the container while the publish still targeted 8899, and nothing
listened. Splitting the two keys is what fixed it; an `RS_PORT` left over in an old `.env` is
now inert rather than fatal.

### Container logs are capped

Docker's default json-file driver is unbounded, so a container left running for months fills
the disk with its own stdout. Every service in `docker-compose.yml` caps it at **3 files of
10 MB**. `docker compose logs -f app` therefore shows at most the last 30 MB.

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

## What is on disk

Everything ReviewStage knows is a file under **ROOT**. This is the map, because deciding what
is safe to delete is the most common reason to need one.

### Top level

| Path | What it is | Safe to delete? |
| --- | --- | --- |
| `.env`, `settings.json` | The install's configuration. `settings.json` is the Settings page's copy and wins over `.env`. | **No.** |
| `users.json` (+ `users.json.lock`) | Every reviewer's encrypted GitHub and Claude tokens, their Slack/Discord IDs, the admin flag, their device-token hashes and their credential epoch. | **No.** |
| `skills/` | A git repository: the team default `_global.md`, `<login>.md` personal skills, `repos/<owner>__<name>/SKILL.md` per-repository overrides, and the revision history. | **No.** |
| `learnings.jsonl` | The detail log of kept / reworded / dropped findings, capped at the **most recent 300 rows** across the whole install. Feeds the prompt block and the Learnings page. | No — it steers every future review. |
| `learnings_totals.json` | The never-truncated tally behind that capped log: outcomes by repository, by skill, by critical path and by UTC day. Every "all-time" number on Insights and Skills is read from here. | No. It self-heals by rebuilding from `learnings.jsonl`, but the rebuild is marked incomplete and anything older than the surviving 300 rows is gone for good. |
| `rule_proposals.json`, `rule_dismissals.json`, `rule_promotions.json` | Which repeated rejections were drafted as team rules, which the team dismissed, and which were accepted. | No — deleting the dismissals re-offers rules people already said no to. |
| `profiles/<owner>__<name>/` | `profile.json` (machine copy, with a schema version and generation metadata), `profile.md` (the human copy), `profile.<ts>.json` for the ten most recent earlier versions (older ones are deleted as each new version is written), and the `tree.*` fingerprints auto-reprofiling compares. | No — regenerating costs a model call and loses the hand edits. |
| `queue.json` (+ `.queue.lock`) | The live "who owes a review on what" queue, merged under a lock by the poller and the webhook. | Yes — the next poll rebuilds it. |
| `seen` | Notification dedup, one line per `<repo>:<pr>:<login>`. See below: a line here means a card was **sent**. | Yes, at the cost of re-announcing the backlog. Prune it with the recipe below instead. |
| `suppressed` | PR/reviewer pairs deliberately not pinged *yet* — draft, bot-authored with `SKIP_BOT_PRS=1`, or older than `RS_MAX_PR_AGE_DAYS` — with the reason and when. Re-evaluated every cycle. | Yes. Everything in it is re-derived on the next poll. |
| `deliveries` | A bounded list (500) of GitHub `X-GitHub-Delivery` ids already processed, so a redelivery cannot replay an event. | Yes, with a small window in which one redelivered event could be processed twice. |
| `notify-fails.json` | Consecutive failed notification attempts per `<repo>:<pr>:<login>`. After five the reviewer is marked `seen` anyway rather than retrying forever. | Yes — it resets the counters, giving a wedged endpoint five more tries. |
| `daily-done` | Today's date, written once the once-a-day housekeeping block has run. | Yes — housekeeping simply runs again on the next poll. |
| `webhooks.json` | Webhook health: `last_event_at`, `last_event`, `last_ping`, `count`, `last_error`. Drives the Settings card's amber/green light. | Yes; the light goes amber until the next delivery. |
| `poller.last` | Epoch of the last poll that actually ran — stamped only on a real pass, so "discovery is dead" no longer reads "just now". | Yes. |
| `known_logins` | Who has already been onboarded, so adding a user to an existing box does not ping them with the entire backlog. | **Be careful.** Deleting it can re-announce history to everyone. |
| `used-nonces`, `oauth-blocked.json`, `sig-v2-since` | Replay protection, the per-login "this account cannot see the repo" map, and the signed-link scheme cutover marker. | Yes. |
| `repos/`, `wt/` | Base clones and review worktrees. | Yes — re-cloned on demand. |
| `watch.log`, `clone.log`, `server.log` | Append-only logs. The first two are truncated by the daily sweep once either passes 8 MiB. | Yes. |
| `MIGRATED` | Marks that the one-time legacy single-repo layout migration ran. | **No** — deleting it can re-run a migration against an already-migrated tree. |

### Per pull request

`state/<owner>__<name>/<pr>/` holds `meta.json` (title, author, head SHA, draft/open/merged
state), `agreement/` (the cross-reviewer matching), `qa.md` and its siblings for the QA guide,
and `users/<login>/` per reviewer.

Inside `users/<login>/`:

| File | What it is |
| --- | --- |
| `review.json` | The run's findings, as the dashboard renders them. |
| `head` | The commit this run actually reviewed. Approval compares it against the PR's current head. |
| `status`, `pid`, `.lock`, `started_at`, `run.log`, `agent.log` | The job's lifecycle and logs. |
| `usage.json`, `cached` | Model, tokens and cost — or, for a cache hit, the marker that zeroes them so a replay is not billed twice. |
| `posted.json` | The shared fact "this reviewer has a review on this PR". Read by the queue, the timeline and the webhook. It is **not** the posting gate. |
| `posted_runs.json` | The posting gate: one entry per post this dashboard actually made, each naming the head SHA and a content hash of the run. Capped at the last 20; an eviction is logged (`posting gate full`) because the run that drops off could in principle be posted a second time. A re-run clears the file, and the same run is refused twice, so entries only build up when the author keeps pushing and the reviewer keeps posting without re-running. |
| `approved` | The approval, with the head it was given against. |
| `requested_at` | When GitHub recorded the review request — the start of the cycle-time clock. |
| `archived`, `archived.auto` | Hidden from this person's tabs. The `.auto` sibling marks an archive *ReviewStage* made (the PR closed, or a new user's clean slate); a returning review request clears both and the `seen` line with them. An archive the person clicked has no `.auto` sibling and is never undone automatically. |
| `history/<ts>/` | Earlier runs, kept whole. Swept by age past the newest five (see [Retention](#retention)). |

Deleting a reviewer's `posted_runs.json` reopens the gate: clicking Post again would send the
same review to GitHub a second time. Deleting `archived.auto` while leaving `archived` makes an
automatic archive look like a deliberate one, so a returning request will no longer unhide it.
The rest of the per-run files are logs and artefacts.

### Retention

The poller runs a housekeeping block **once a calendar day** (guarded by `daily-done`):

- Prunes expired device-token hashes.
- Prunes `seen` lines for PRs that are now closed.
- Sweeps with `RS_RETENTION_DAYS` (default 30): every `*.log` under a PR or a reviewer
  directory older than that is deleted, and so is each whole `history/<ts>` run snapshot older
  than that — **except** the newest five per PR per reviewer, which are kept however old they
  are so the timeline can still open an earlier run. A run's age is its directory name, the
  time it finished, not its mtime.
- Truncates `watch.log` and `clone.log` to their last 4 MiB once either passes 8 MiB.

It never touches the live `review.json`, `posted.json` or `approved`. On Docker, the
container's own stdout is capped separately by the compose file (3 × 10 MB per service).

Profile versions are capped at their own write rather than by this sweep: `save_profile()`
keeps the newest **ten** `profile.<ts>.json` per repository and deletes the rest. That write
never moves the live file: the archive copy is written from the content already in hand and
`profile.json` and `profile.md` are each replaced with a single `os.replace` of a temp file in
the same directory, so a request reading a profile while one is being saved always sees a whole
one.

---

## Re-notifying stale cards

Notification dedup is keyed **`<repo>:<pr>:<login>`** — one line per person per PR — in
`ROOT/seen`. (Lines written before the repository dimension existed are `<pr>:<login>`, or a
bare `<pr>` from before multi-user; both still count, but only on an install with exactly one
repository configured.)

**A line in `seen` now means a card was sent.** The poller and the webhook both notify first
and write `seen` only on a confirmed send; a failed send is counted in `notify-fails.json` and
retried, and only after five consecutive failures is the pair marked `seen` to stop it
retrying for ever. Both paths behave identically — which they did not before, when the webhook
wrote `seen` first and whether a failed card was ever retried depended on which path won the
race.

**Draft, bot-authored and over-age pull requests are not marked `seen` at all.** They go into
`ROOT/suppressed` with the reason, and are re-evaluated on every cycle: a PR that was a draft
the first time anyone looked at it now pings the moment it is marked ready. Nothing needs to be
cleared by hand for that to happen.

To re-announce PRs whose cards went stale — after a link expiry, or a secret rotation — drop
their lines.

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
| `learnings.jsonl`, `learnings_totals.json`, `rule_proposals.json`, `rule_dismissals.json`, `rule_promotions.json` | The accept/reject record that steers every future review, the never-truncated tally behind every "all-time" figure, the drafted rule suggestions, and which ones the team accepted or dismissed. |
| `state/<owner>__<name>/<pr>/users/<login>/` | Each reviewer's own runs: `review.json`, the reviewed `head`, `posted.json`, `posted_runs.json` (the posting gate), `approved`, and `history/`. Losing it loses the record of what was reviewed and posted, and reopens the gate on anything not yet posted. |
| `profiles/<owner>__<name>/` | Each repository's critical-path profile, its earlier versions, and the human edits made to it. Regenerating costs a model call and loses the edits. |
| `.env`, `settings.json` | The install's configuration — including `RS_SECRET` itself. |

Genuinely disposable: `repos/` (base clones), `wt/` (worktrees), `queue.json`, `suppressed`,
`deliveries`, `notify-fails.json`, `daily-done`, `poller.last`, `used-nonces`, `clone.log`. See
[What is on disk](#what-is-on-disk) for the file-by-file version.

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
- **Skill history can still have gaps, but never silently.** Every save commits to the git
  repository in `ROOT/skills`. The save itself never fails on git — but the commit's exit code
  is checked now and a failure is reported in the save banner and the server log, and each
  commit names only the paths that edit touched, so two people saving at the same moment are
  two commits by two authors rather than one. A global `commit.gpgsign=true` used to empty the
  whole audit trail; signing is disabled inside this repository.
- **The poller cannot discover a team review request.** `review-requested:<you>` matches direct
  requests only. A request routed through a team handle arrives only if GitHub webhooks are
  configured, where `requested_team` is expanded into its members. Those rows now survive a
  poll that cannot see them — they used to be erased within three minutes while their `seen`
  line survived, so nobody was ever re-notified.
- **A poll that learns nothing publishes nothing.** A failed search is logged loudly and that
  reviewer gets no verdict for the cycle, rather than an empty result being written over a good
  queue and everyone being told they are all caught up.
- **Reviews cost tokens.** A few minutes of agent time for a typical PR on Opus (longer for
  Deep), against the clicking reviewer's Claude subscription. That is what click-to-run is for.
- **One heavy job at a time per server.** Reviews and QA guides share a box-wide lock.
- **Reviews need memory and disk.** `MIN_FREE_MB` defaults to 800 MB *available* (not total),
  read from the container's cgroup budget rather than the host, so a 1 GB VPS cannot run a
  single review. Give the host at least 2 GB. A job also refuses to start below
  `MIN_FREE_DISK_MB` (500 MB) free on the volume.
- **The QA guide has no write tripwire.** Both job scripts run the agent with every GitHub
  credential stripped and the same tool deny list, but only `run-review.sh` takes the
  before/after fingerprint that turns an actual write into a failed run. See
  [SECURITY.md](SECURITY.md#prompt-injection-from-hostile-diffs).

## Changing the code

If you improve something, open a pull request — see [CONTRIBUTING.md](../CONTRIBUTING.md).
