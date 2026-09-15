---
title: Troubleshooting
description: Logs, restarts, stuck reviews, stale notifications, known limits.
sidebar:
  order: 2
---

Paths below use the per-repository state layout: `state/<owner>__<name>/<pr>/users/<login>/`. The repository is part of every path, because one install reviews many.

## Everyday commands — Docker

```bash
docker compose ps                              # container health
docker compose logs -f app                     # dashboard log
docker compose logs -f poller                  # poller log (team profile)
docker compose exec app doctor                 # full diagnostics
docker compose exec app curl -s localhost:8899/health   # -> ok

R=/home/reviewstage/.reviewstage/state/<owner>__<name>/<pr>/users/<login>
docker compose exec app cat $R/agent.log       # what the agent did
docker compose exec app cat $R/status          # fetching / reviewing / done / failed
docker compose exec app cat $R/review.json     # the raw agent output
```

The doctor checks the environment the **server** runs in — the `.env` it reads, `claude`, `gh`, the data volume — and on a Docker install all of that lives inside the container, not on the host. Run from a directory holding this project's `docker-compose.yml` with `app` up, `bin/doctor.sh` re-execs itself inside the container and says so on its first line, so the host form and the `docker compose exec app doctor` form reach the same place. When `app` is **not** up it warns that the checks below are about the host rather than the install, and those will FAIL whatever state the install is in (no `.env`, no `claude`, and on macOS no `/proc/meminfo`); use `docker compose run --rm app doctor` in that case. It does not check Docker itself; `docker compose ps` is that check.

## Everyday commands — from source

```bash
systemctl status reviewstage                   # endpoint health
journalctl -u reviewstage -f                   # endpoint log
tail -f ~/.reviewstage/watch.log               # poller log (the cron entry)
curl -s localhost:8899/health                  # -> ok
~/.reviewstage/bin/doctor.sh                   # full diagnostics
cat ~/.reviewstage/state/<owner>__<name>/<pr>/users/<login>/agent.log
```

## "I changed .env and nothing happened"

The dashboard reads `.env` **once, at startup**. `docker compose up -d` (or `sudo systemctl restart reviewstage`) after every edit, especially `DRY_RUN`. This is the single most common cause of "why isn't it working".

## A review is stuck on "reviewing"

Check `state/<owner>__<name>/<pr>/users/<login>/agent.log`. Common causes:

- **Claude is not connected** for the user who clicked. The run ends instantly with an empty result. Connect Claude in *Integrations*.
- **From source: Claude Code signed in as the wrong user.** It must be the user the service runs as.
- **The timeout hit.** Very large PRs do this at *Quick*. Re-run at *Deep*, or split the review with a focus note.
- **Out of memory.** Runs refuse to start below `MIN_FREE_MB`, but a run in flight can still be killed. Give the container more memory or lower the concurrency of whatever else is on the host.
- **You redeployed mid-run.** On Docker, `docker compose up -d --build` recreates the `app` container and takes the detached run with it — check `docker compose exec app pgrep -af run-review.sh` before rebuilding. From source, the unit's `KillMode=process` protects a run from `systemctl restart`, but not from a reboot.

A job whose process is gone is no longer left spinning: the status is resolved from the lock, a live pid, or a short startup grace, and a non-terminal status with nothing running behind it now reads `failed` with its log tail attached. QA guide builds go through the same check, and an existing guide is still shown beside the warning that the last rebuild failed.

**Stop** from the progress panel clears it. Re-running takes a per-PR lock, so a genuinely running review is never duplicated — and starting one takes the same lock across the check and the spawn, so two fast clicks can no longer both start an agent and leave Stop killing the wrong one.

## Empty or odd review output

- The agent wrote prose instead of `review.json`: usually a custom skill that ended early. Check the skill ends by writing the file; ReviewStage appends the output contract, but a skill that says "stop after the table" can override it.
- Findings are all in the summary body: every anchor pointed outside the diff. This is the demotion working as designed; the agent anchored to unchanged lines.

## What is on disk, and what is safe to delete

The file-by-file map — every top-level store, every per-run artefact, which of them regenerate and which do not — is in [OPERATIONS.md → What is on disk](https://github.com/Wimukti/reviewstage/blob/main/docs/OPERATIONS.md#what-is-on-disk). The short version: `users.json`, `skills/`, `profiles/`, `learnings.jsonl` and `learnings_totals.json` and the `rule_*.json` stores never regenerate; `queue.json`, `suppressed`, `deliveries`, `notify-fails.json`, `daily-done`, the base clones and the worktrees all do.

The poller sweeps once a calendar day: per-run `*.log` files older than `RS_RETENTION_DAYS` (default 30) are deleted, and so are whole `history/<ts>` run snapshots older than that — except the **newest five per PR per reviewer**, which are kept however old they are so "view an earlier run" still has something to open. `watch.log` and `clone.log` are truncated to their last 4 MiB once either passes 8 MiB, closed PRs' `seen` lines are pruned and expired device tokens go. The live `review.json`, `posted.json` and `approved` are never swept. Profile versions are capped where they are written rather than here: the newest **ten** `profile.<ts>.json` per repository survive. On Docker the container's own stdout is capped separately at 3 × 10 MB per service.

## Re-notifying stale cards

A line in `seen` now means a card was **sent**: both the poller and the webhook notify first and write `seen` only on a confirmed send, retrying a failed one up to five times before giving up. Draft, bot-authored and over-age PRs are not marked `seen` at all — they go into `suppressed` with a reason and are re-evaluated every cycle, so a draft pings by itself the moment it is marked ready.

Dedup is one line per **repository, PR and login** — `<repo>:<pr>:<login>` — in the poller's `seen` file. To re-announce one PR, delete its lines, anchored on the repository (a bare `/^1234:/` would match that PR number in *every* repository):

```bash
docker compose exec app sed -i '\#^acme/widgets:1234:#d' /home/reviewstage/.reviewstage/seen
```

To re-announce everything not yet reviewed, keep the lines whose reviewer already has a `review.json` and drop the rest. The full, multi-repository-safe recipe is in [OPERATIONS.md](https://github.com/Wimukti/reviewstage/blob/main/docs/OPERATIONS.md#re-notifying-stale-cards) — do not filter on `state/<pr>/review.json`, which has not been the layout since the repository dimension landed and which empties the whole file.

## Card arrives, button 403s

The link expired (7 days) or `RS_SECRET` was rotated. Open the dashboard directly.

## Sign-in says the token cannot see the repository

The fine-grained token was not granted on that repository, or the organisation restricts personal tokens and an owner has to approve it. For OAuth sign-in, the organisation may have third-party application restrictions; an owner approves the app once.

## Known limits

- **The poller cannot discover a team review request.** `review-requested:<login>` matches direct requests only. Route them through GitHub webhooks, which expand `requested_team` into its members; a poll that cannot see those rows now leaves them alone instead of erasing them.
- **Slack replies are threaded only with a bot token.** Webhooks are send-only.
- **Reviews cost tokens.** A few minutes of agent time for a typical PR on Opus (longer for Deep), on the clicker's plan. That is what click-to-run is for.
- **Runs serialise.** One heavy job (review or QA guide) at a time per server.
- **Reviews need memory and disk.** `MIN_FREE_MB` defaults to 800 MB *available*, so a 1 GB host cannot start one; give it at least 2 GB. A job also refuses to start below `MIN_FREE_DISK_MB` (500 MB free), the same floor the doctor checks.
- **Skill revision history can have gaps, but not silent ones.** A save whose git commit fails still saves the skill — the failure is now reported in the banner and the server log rather than hidden.

## Backup and restore

The data volume is **not** disposable. `users.json` holds every reviewer's encrypted GitHub and Claude tokens; `skills/` is a git repository holding the team's review standard and its whole history; `learnings.jsonl`, `learnings_totals.json` (the never-truncated tally behind every all-time figure) and the `rule_*.json` stores steer every future review; `profiles/` holds each repository's critical paths and the human edits to them. None of that regenerates. `RS_SECRET`, in `.env`, is the key that makes `users.json` readable at all — restore the two together or nobody's stored token decrypts.

```bash
VOL=$(docker volume ls -q --filter name=reviewstage-data | head -1)
docker run --rm -v "$VOL":/data:ro -v "$PWD":/out alpine \
  tar czf /out/reviewstage-$(date +%Y%m%d-%H%M).tgz -C /data --exclude=./repos --exclude=./wt .
```

Restoring needs `chown -R 1000:1000` on the volume afterwards, because the container runs as uid 1000. Full commands, the from-source equivalent and how to verify a backup: [OPERATIONS.md](https://github.com/Wimukti/reviewstage/blob/main/docs/OPERATIONS.md#backup-and-restore).

The archive contains `.env` and the token store. Treat it as a secret.
