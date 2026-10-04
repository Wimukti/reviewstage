# npx-desktop — review and proof (10/04/26)

Three lanes merged into `main` with `--no-ff`: `npx-d2` (phone access, fd09f99), `npx-d1`
(personal mode + wizard, e919fc2), then the publish lane as one commit (018b334). Tag:
`v1.0.0-rc.23`.

## The five properties, re-checked against the new code

| Property | Where it is held in personal mode |
| --- | --- |
| Review step has no GitHub write path | unchanged: `run-review.sh` strips every GitHub credential from the agent; `review_env()` adds the clicker's token for the *scripts* (diff read, clone) only, as before for the service token |
| Every post uses the acting user's own token | unchanged: the post path reads `user_pat(login)`; the in-process poller never posts |
| Click-to-run only | the poller adds queue rows and notifies; it never starts a run (`test_rs_personal.py::PollerCycle`) |
| Runs on the clicker's Claude account | unchanged (`CLAUDE_CODE_OAUTH_TOKEN` from the clicker's connection) |
| Reviewers independent | unchanged (per-login worktrees and runs) |

Token on disk: `test_the_poller_leaves_no_token_in_root` asserts the user token appears in no
file under ROOT and not in stdout. `.env` written by the launcher carries `RS_SECRET`,
`RS_PERSONAL=1`, `GH_DEVICE_FLOW=1`, `DRY_RUN=1`, `PUBLIC_URL` — never a GitHub token.

## Gates (final tree, this Mac)

- `python3 -m unittest discover -s bin -p 'test_*.py'` → **549 OK**; `bash -n bin/*.sh` OK
- dashboard: `pnpm typecheck` clean · `pnpm test` **79/79** · `pnpm build` `app-c45f0338184b` ·
  `pnpm test:browser` **240 passed** (232 + 8 `welcome.spec.ts`), 0 flaky
- desktop: `node --test test/*.test.mjs` **12 pass, 1 live-skipped** (real Electron launch ×2,
  tools ×4, tunnel ×7; the live tunnel ran 7/7 in lane D2)
- `docker build` exit 0; image booted with `RS_SECRET` + `RS_PERSONAL=1` and **no REPOS** →
  `WARN … personal mode boots anyway` then `listening … personal=True`; `/health` → `ok`
- website: `pnpm build` 20 pages, `pnpm check` 0 errors 0 hints
- `pnpm pack` → `reviewstage-0.0.0-dev.tgz` **740,905 bytes**, 74 files, **0** forbidden paths
  (`node_modules/`, `e2e/`, `test_*.py`, `test-*.sh`); contains `README.md`,
  `server/bin/server.py`, `server/bin/doctor.sh`, `server/bin/static/app-*.js`,
  `server/skills/pr-review/SKILL.md`
- **The real thing**: empty npm cache, empty ROOT,
  `npx -y --package=./reviewstage-0.0.0-dev.tgz reviewstage` with `RS_SMOKE=1` →
  `Downloading Electron binary…` → `RS_SMOKE_OK port=51352 title=ReviewStage`; ROOT gained
  `.env` (`RS_PERSONAL=1`, `PUBLIC_URL=http://127.0.0.1:51352`), `bin/flock`, `server.log`
- `npx reviewstage --doctor` against a personal ROOT: WARN (not FAIL) on zero repositories, a
  note instead of a FAIL for the absent service token, port read from the loopback `PUBLIC_URL`

## Screenshots looked at

`after/d1/welcome-{1-github,2-claude,3-repos}-{dark,light}-{1440,390}.png` (12) and
`after/d2/phone-window.png`. Stepper reads as the PR-page chips; the repository picker shows
owner avatar, lock for private, "pushed Nd ago", sticky "Start reviewing (n)"; nothing scrolls
sideways at 390.

## Deviations recorded from the design

1. `review_env()` also sets `GITHUB_PAT`/`REVIEWER` and `RS_REPOS_EXTRA` in the job's
   environment (not in §3): without them `require_env` and `repo_allowed` would refuse every
   review in personal mode. `lib-common.sh` unions `RS_REPOS_EXTRA` with `REPOS`, so a `.env`
   that sets `REPOS` no longer shadows the wizard's choice.
2. `claude_connected` (existing, snake_case) kept; no `claudeConnected` alias.
3. The poller uses `gh pr list --search review-requested:` to keep the row shape identical to
   `pr-watch.sh`, and mirrors its clean-slate first run.
4. `GET /api/public-url` is open to any session (read-only); only the POST is loopback-gated.
5. Pre-releases publish under npm's `latest` tag while the project is in beta — there is no
   stable version for `npx reviewstage` to fall back to.

## Left for the maintainer

- Add the repository secret **`NPM_TOKEN`** (npm granular token, publish, package
  `reviewstage`) — the workflow fails on its first step without it, with that sentence — then
  re-run `release-npm` on the tag (`workflow_dispatch`, input `v1.0.0-rc.23`).
- Run `npx reviewstage` for real: GitHub device code, Claude connect, pick repositories, Enable
  phone access…, scan, Add to Home Screen, turn on push, have someone request your review.
- Windows (bash job scripts) is documented as not supported; a WSL-hosted server is the
  intended shape.
