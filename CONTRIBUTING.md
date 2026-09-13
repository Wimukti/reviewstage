# Contributing

Thanks for helping. ReviewStage is small on purpose — a Python stdlib server, a few bash
scripts and a React dashboard — so most changes are a single afternoon. This page is what you
need to make one land.

## Run it locally

You do not need a server, Slack or a GitHub token to work on the dashboard. The Playwright
suite boots the real Python server against an offline fixture (a fake `gh` on `PATH`, a fixed
test secret, a canned queue and review), so the same thing works for hacking:

```bash
cd dashboard-ui
pnpm install --frozen-lockfile
npx tsx e2e/fixture.ts                       # builds e2e/.fixture + a session cookie
PATH="$PWD/e2e/.fixture/fakebin:$PATH" ROOT="$PWD/e2e/.fixture" \
  PRBOT_SECRET=e2e-fixed-test-secret-not-for-production PRBOT_SPA=1 PRBOT_PORT=8988 \
  python3 ../bin/server.py &           # http://127.0.0.1:8988
pnpm dev                                     # esbuild --watch into ../bin/static
```

Sign in by adding the cookie from `e2e/.auth.json` in your browser's devtools, or use
`node e2e/shot.mjs` to screenshot an authed page. Requirements: Node 20+ (CI uses 24),
pnpm, Python 3.10+.

To exercise the review pipeline for real you need a Linux box with Claude Code signed in —
follow [docs/SETUP.md](docs/SETUP.md) with `DRY_RUN=1`, which never writes to GitHub.

## Tests

```bash
cd dashboard-ui && pnpm test && pnpm test:browser
```

- `pnpm test` — Node's built-in runner over `src/*.test.ts` (pure functions).
- `pnpm test:browser` — Playwright against the fixture server. Needs browsers once:
  `npx playwright install chromium`.
- `python3 -m unittest discover -s bin -p 'test_*.py'` — every Python suite under `bin/`:
  `test_rs_webhook.py` (the GitHub webhook receiver and the shared queue module
  `rs_queue.py`, including a parity check against `pr-watch.sh`'s jq program so the poller
  and the webhook keep writing identical `queue.json` rows), `test_rs_auth.py` (device
  tokens: hashing, sliding expiry, the per-user cap) and `test_rs_profile.py` (repository
  profiles: glob validation, risk merging, prompt assembly, markdown round-trip).
- `bash bin/test-webhook-e2e.sh` — boots the real server on a scratch `ROOT` and drives
  `POST /webhooks/github` with curl + openssl: 401 on a bad signature, 202 + queue row + `seen`
  key on a signed `review_requested`, no duplicate on redelivery, stale on `synchronize`.
- Otherwise shell has no unit suite; keep everything passing `bash -n bin/*.sh`,
  `python3 -m py_compile bin/*.py` and `shellcheck bin/*.sh` if you have it. CI runs all of these.

Add a browser test when you add a page or change a flow; add a unit test when you add a pure
helper. Fixtures live in `dashboard-ui/e2e/fixture.ts` and use `acme/widgets` placeholders —
never a real repository, login or token.

## Commits

Conventional commits, one logical change per commit:

```
type(scope): imperative subject

Prose body: what was wrong, what changed, and why this shape. Wrap at ~72.
```

- `type` is one of `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `ci`, `perf`.
- `scope` is optional and names the area: `server`, `ui`, `bootstrap`, `skills`, `config`.
- The subject is imperative and lower-case, no trailing period, under 72 characters.
- The body is prose, not bullets. Say what was broken or missing, what you changed, and the
  reasoning a reviewer cannot get from the diff. A one-line commit is fine for a typo fix;
  anything behavioural gets a body.

## Pull requests

- **Reference an issue.** Every PR links the issue it closes or advances (`Closes #12`). If
  there is no issue yet, open one first — even a one-liner — so the discussion has a home.
- Keep PRs focused; a rename and a behaviour change are two PRs.
- Fill in the template: what changed, why, how you tested it, and anything a reviewer should
  look at first.
- CI must be green: dashboard tests and build, `py_compile`, the webhook unit + e2e tests,
  `bash -n`, shellcheck.
- No company names, hostnames, logins or tokens in code, fixtures, comments or docs. The
  examples folder under `skills/examples/` is the one place domain-specific material lives,
  and it uses italic placeholders.

## Code notes

- **Python**: stdlib only. No new runtime dependencies without an issue discussing it.
- **Bash**: `set -euo pipefail` (or `-uo` where a step may legitimately fail), quote
  everything, shellcheck-clean.
- **Dashboard**: TypeScript, React 19, no router or state library — the hand-rolled router in
  `src/router.tsx` is deliberate. Styles live in `src/styles.css`.
- **Comments** explain *why*, sparingly. The code says what.
- Internal identifiers still say `prbot` (env vars, file names, the `/prbot` URL prefix,
  cookie names, the systemd unit). That rename is tracked separately; do not do it piecemeal.

## Reporting a security problem

Do not open a public issue. Use GitHub's private security advisory — see
[docs/SECURITY.md](docs/SECURITY.md#reporting-a-vulnerability).

By contributing you agree your work is released under the [MIT License](LICENSE).
