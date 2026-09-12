---
title: Contributing
description: Conventional commits, tests, and how changes reach a running server.
sidebar:
  order: 2
---

Issues and pull requests are welcome at [github.com/Wimukti/reviewstage](https://github.com/Wimukti/reviewstage).

## Ground rules

- **Keep the gate.** Nothing may add a GitHub write path to the review or QA steps, post under any identity other than the signed-in user's, or emit a review event other than `COMMENT` (and `APPROVE` only from the approve button). PRs that weaken these are declined regardless of convenience.
- **No new runtime dependencies on the backend** without a discussion. Python standard library plus bash, `gh`, `jq`, `git`, `openssl` and `claude` is the whole toolchain on purpose; it has to run on a small box.
- **No company or customer references.** Domain heuristics (for example the risk banner) are configuration, not code.

## Commits

Conventional commits with a prose body:

```
feat(dashboard): show token usage per run

The PR page now reads usage.json written by run-review.sh and shows the
model and real token count next to the effort badge. Cached re-runs show
0 tokens, which is the point of the cache.
```

Types in use: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`. Scope is the piece: `server`, `dashboard`, `poller`, `review`, `qa`, `skills`, `website`, `compose`.

## Tests

```bash
# dashboard
cd dashboard-ui && pnpm install && pnpm test          # Vitest unit tests (api.ts, pr.ts)
pnpm exec playwright test                              # e2e against a running server

# python helpers
python3 -m unittest discover -s bin -p 'test_*.py'

# website
cd website && pnpm install && pnpm build && pnpm check
```

The shell scripts have no test harness; keep them small and run `shellcheck`.

When you change the output contract appended to skills, update the built-in skill's automation-mode section and the dashboard's finding renderer together.

## Docs

The four source documents in `docs/` are the canonical prose; the site under `website/` is generated from Astro content that mirrors them. When you change behaviour, change both, or open an issue saying which one lags.

## Getting a change onto a server

- **Docker**: `git pull && docker compose build && docker compose up -d`.
- **From source**: `git pull && bin/bootstrap.sh`. Bootstrap copies scripts into place and restarts the service; editing the clone alone does nothing.

## Releasing

Tag `vX.Y.Z` on `main`. The website deploys from `main` on every push via GitHub Pages.
