---
name: Setup problem
about: bootstrap.sh, the reverse proxy, sign-in or the first review will not come up
title: "setup: "
labels: setup
---

## Where you are stuck

Which step of [docs/SETUP.md](../../docs/SETUP.md) failed, and what you saw.

## bootstrap output

Paste the output of the failing `bootstrap.sh` run from the last `==>` heading onwards
(redact secrets — nothing in the output should contain one, but check).

```
paste here
```

## Your .env, keys only

`grep -o '^[A-Z_]*=' ~/.reviewstage/.env | sort` — this lists key names without values.

```
paste here
```

## Checks

- [ ] `curl -s localhost:8899/health` returns `ok`
- [ ] `curl -s <PUBLIC_URL>/health` returns `ok` (through your reverse proxy)
- [ ] `claude` (bare) shows the service user signed in
- [ ] `~/.reviewstage/bin/pr-watch.sh` runs without error
- [ ] `systemctl status reviewstage` is active

## Environment

- OS / distro and how the server is hosted:
- Reverse proxy in front (nginx / Caddy / Apache / cloud LB), and whether you used `SETUP_APACHE=1`:
- Python (`python3 --version`), Node (`node -v`), `gh --version`, `claude --version`:
- ReviewStage commit: `git -C ~/reviewstage rev-parse --short HEAD`
