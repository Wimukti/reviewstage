---
name: Bug report
about: Something that used to work, or should work, does not
title: "fix: "
labels: bug
---

## What happened

A clear description of the wrong behaviour, and what you expected instead.

## Steps to reproduce

1.
2.
3.

## Where it went wrong

Tick what applies and paste the relevant log lines (redact tokens, hostnames and PR titles you
would not want public):

- [ ] Dashboard (browser) — `journalctl -u reviewstage -n 100`
- [ ] Review run — `~/.reviewstage/state/<pr>/users/<login>/agent.log` and `status`
- [ ] Poller / Slack — `~/.reviewstage/watch.log`
- [ ] Posting / approving on GitHub — the banner text shown in the dashboard

```
paste logs here
```

## Environment

- ReviewStage commit: `git -C ~/reviewstage rev-parse --short HEAD`
- OS / distro:
- Python (`python3 --version`), Node (`node -v`), `gh --version`, `claude --version`:
- `DRY_RUN` value:
- Browser (for dashboard issues):

## Anything else

Screenshots, a minimal `review.json` that triggers it, or the PR shape (file count, diff size).
