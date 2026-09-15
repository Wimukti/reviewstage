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

Run the doctor **inside the container**: it reads the server's `.env` and looks for `claude`, `gh` and the data volume, all of which live there. On the host it reads a different `.env`, finds none of the CLIs, and FAILs against a healthy install — on macOS it cannot pass at all. Use `docker compose run --rm app doctor` when `app` will not start. It does not check Docker itself; `docker compose ps` is that check. (A parallel change will teach `bin/doctor.sh` to detect Compose and re-exec itself; the `exec` form works either way.)

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

**Stop** from the progress panel clears it. Re-running takes a per-PR lock, so a genuinely running review is never duplicated.

## Empty or odd review output

- The agent wrote prose instead of `review.json`: usually a custom skill that ended early. Check the skill ends by writing the file; ReviewStage appends the output contract, but a skill that says "stop after the table" can override it.
- Findings are all in the summary body: every anchor pointed outside the diff. This is the demotion working as designed; the agent anchored to unchanged lines.

## Re-notifying stale cards

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

- **Team review requests are not polled.** `review-requested:<login>` matches direct requests only; a request routed through a team handle never fires.
- **Slack replies are threaded only with a bot token.** Webhooks are send-only.
- **Reviews cost tokens.** A few minutes of agent time for a typical PR on Opus (longer for Deep), on the clicker's plan. That is what click-to-run is for.
- **Runs serialise.** One heavy job (review or QA guide) at a time per server.
- **Reviews need memory.** `MIN_FREE_MB` defaults to 800 MB *available*, so a 1 GB host cannot start one. Give it at least 2 GB.
- **Skill revision history is best-effort.** A save whose git commit fails still succeeds, silently, so the panel can have gaps.

## Backup and restore

The data volume is **not** disposable. `users.json` holds every reviewer's encrypted GitHub and Claude tokens; `skills/` is a git repository holding the team's review standard and its whole history; `learnings.jsonl` and the `rule_*.json` stores steer every future review; `profiles/` holds each repository's critical paths and the human edits to them. None of that regenerates. `RS_SECRET`, in `.env`, is the key that makes `users.json` readable at all — restore the two together or nobody's stored token decrypts.

```bash
VOL=$(docker volume ls -q --filter name=reviewstage-data | head -1)
docker run --rm -v "$VOL":/data:ro -v "$PWD":/out alpine \
  tar czf /out/reviewstage-$(date +%Y%m%d-%H%M).tgz -C /data --exclude=./repos --exclude=./wt .
```

Restoring needs `chown -R 1000:1000` on the volume afterwards, because the container runs as uid 1000. Full commands, the from-source equivalent and how to verify a backup: [OPERATIONS.md](https://github.com/Wimukti/reviewstage/blob/main/docs/OPERATIONS.md#backup-and-restore).

The archive contains `.env` and the token store. Treat it as a secret.
