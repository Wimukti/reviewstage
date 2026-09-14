---
title: Troubleshooting
description: Logs, restarts, stuck reviews, stale notifications, known limits.
sidebar:
  order: 2
---

## Everyday commands

```bash
docker compose ps                              # service health
docker compose logs -f app                     # dashboard log
docker compose logs -f poller                  # poller log (team profile)
docker compose exec app cat /home/reviewstage/.reviewstage/state/<pr>/agent.log   # what the agent did
docker compose exec app cat /home/reviewstage/.reviewstage/state/<pr>/status      # fetching / reviewing / done / failed
curl -s localhost:8899/health                  # -> ok
bin/doctor.sh                                  # environment check
```

From source: `systemctl status reviewstage`, `journalctl -u reviewstage -f`, and the same files under `~/.reviewstage/`.

## "I changed .env and nothing happened"

The dashboard reads `.env` **once, at startup**. `docker compose up -d` (or `sudo systemctl restart reviewstage`) after every edit, especially `DRY_RUN`. This is the single most common cause of "why isn't it working".

## A review is stuck on "reviewing"

Check `state/<pr>/agent.log`. Common causes:

- **Claude is not connected** for the user who clicked. The run ends instantly with an empty result. Connect Claude in *Integrations*.
- **From source: Claude Code signed in as the wrong user.** It must be the user the service runs as.
- **The timeout hit.** Very large PRs do this at *Quick*. Re-run at *Deep*, or split the review with a focus note.
- **Out of memory.** Runs refuse to start below `MIN_FREE_MB`, but a run in flight can still be killed. Give the container more memory or lower the concurrency of whatever else is on the host.
- **The service restarted mid-run.** A detached run survives a dashboard restart but not a host reboot.

**Stop** from the progress panel clears it. Re-running takes a per-PR lock, so a genuinely running review is never duplicated.

## Empty or odd review output

- The agent wrote prose instead of `review.json`: usually a custom skill that ended early. Check the skill ends by writing the file; ReviewStage appends the output contract, but a skill that says "stop after the table" can override it.
- Findings are all in the summary body: every anchor pointed outside the diff. This is the demotion working as designed; the agent anchored to unchanged lines.

## Re-notifying stale cards

Dedup is per PR and login in the poller's `seen` file. To re-announce a PR, drop its line:

```bash
docker compose exec poller sed -i '/^1234:/d' /home/reviewstage/.reviewstage/seen
```

To re-announce everything that has *not* been reviewed yet, keep the lines for PRs that already have a `review.json` and delete the rest.

## Card arrives, button 403s

The link expired (7 days) or `RS_SECRET` was rotated. Open the dashboard directly.

## Sign-in says the token cannot see the repository

The fine-grained token was not granted on that repository, or the organisation restricts personal tokens and an owner has to approve it. For OAuth sign-in, the organisation may have third-party application restrictions; an owner approves the app once.

## Known limits

- **Team review requests are not polled.** `review-requested:<login>` matches direct requests only; a request routed through a team handle never fires.
- **Slack replies are threaded only with a bot token.** Webhooks are send-only.
- **One repository per server.**
- **Reviews cost tokens.** A few minutes of agent time for a typical PR on Opus (longer for Deep), on the clicker's plan. That is what click-to-run is for.
- **Runs serialise.** One heavy job (review or QA guide) at a time per server.
