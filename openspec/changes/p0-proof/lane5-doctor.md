# Lane 5 — `--doctor` extensions

Branch `p0-doctor`, 10/10/26. Design per `recon.md` §"Lane 5"; deviations are called out in §Design.

## Proposal

### What was wrong

- **A false FAIL on every desktop install.** `bin/doctor.sh` decided "personal mode" only from
  `RS_PERSONAL=1` in the environment or `.env`. Run by hand (`bash bin/doctor.sh`) against a
  desktop ROOT, or against an `.env` the launcher wrote before it stamped that key, the doctor
  reached `fail "GITHUB_PAT not set — nothing can read GitHub"` — a token that install is not
  meant to have (`rs_personal.py`, `review_env()`).
- **The port probe could not find the desktop app.** The desktop picks a random free port each
  launch (`desktop/main.js` → `server.js freePort()`), and the doctor probed `RS_PORT|8899`, with
  one hint from a loopback `PUBLIC_URL` — which stops being loopback the moment phone access
  publishes the tunnel address. A closed desktop app was a **FAIL**, when the doctor is run most
  often while the app is closed.
- **No `--json`, no exit-code policy beyond "1 on FAIL", no runtime checks** (node, Electron,
  OS, the tunnel binary), no permission check on the files that hold secrets, no per-user token
  expiry — the users section said only "N user(s) signed in" and "N connected Claude".
- Incidental, found while running it: macOS has no coreutils `timeout`, so `timeout 20 claude
  --version` failed and the doctor reported "claude is on PATH but --version printed nothing"
  on every Mac.

### Non-negotiable properties touched

**2 and 4** (tokens): the `--live` probes decrypt a stored user token to test it. The default
run never decrypts; `--live` passes the token to `gh` / `claude` through the child's environment
only — never argv, never a file, never stdout — and the report carries booleans and expiries
only. **3**: the Claude probe is `claude -p "Reply with exactly: OK"` (the existing
`verify_claude_token` call), not a review. Properties 1 and 5: not touched.

### How this is proven

Real-GitHub scenario: a desktop user whose GitHub device-flow token has expired (8-hour tokens
when the OAuth App has expiry on) runs `npx reviewstage --doctor`. Before: "GITHUB_PAT not
set" FAIL and "server not answering on port 8899" FAIL, nothing about the token. After:
`github.auth` says `ann: GitHub token expired 3 h ago — it refreshes on the next request` (WARN)
or, with the refresh token also expired, `… cannot be refreshed — sign in again` (FAIL); `--live`
runs `gh api user` with the stored token and reports the 401 as a FAIL; `port.free` reads the
port from `desktop.json` and says "app not running" (WARN) rather than FAIL. Unit level: the
fixtures in `bin/test_rs_doctor.py` and the `reviewstage --doctor --json` run in
`desktop/test/doctor.test.mjs`, plus the smoke test asserting the port write.

## Design

### Shape (recon 5.1, kept)

`bin/doctor.sh` stays the single report — `docker compose exec app doctor`, `bin/doctor.sh`,
`npx reviewstage --doctor` all reach it. Flags `--json` · `--live` · `--strict`; exit **0** all
pass · **1** any FAIL · **2** only WARNs with `--strict`. Every `pass/warn/fail/note` line is also
a `--json` row `{id, status, text}`; `check <id>` names the next row and `section <name>` is the
fallback id. `--json` output: `{"checks":[…],"fails":n,"warns":n}`.

**Deviation:** the recon put the runtime checks in a Node module `desktop/doctor.js` and merged
two lists. Shipped instead: one engine, **`bin/rs_doctor.py`**, runs every new check (users,
tokens, permissions, port, callbacks, runtime), and `desktop/doctor.js` only tells it what the
launcher knows — `RS_DOCTOR_NODE` (`process.versions.node`), `RS_DOCTOR_ELECTRON` (the resolved
binary, or unset when the package is broken), `RS_DOCTOR_DESKTOP=1` — and forwards the flags.
One list, one exit-code policy, one set of tests; the Docker install gets the same runtime
checks for free (node absent there is a note, not a failure).

### Extraction: `bin/rs_users.py`

`_users_key / _openssl / enc / dec / load_users / save_users / modify_users` moved out of
`server.py` into a side-effect-free module whose functions take `secret` and `path` explicitly.
`server.py` keeps its one-argument wrappers bound to its own `SECRET` / `USERS` (read at call
time, so the rotate-the-secret tests still see the new key) and the `_openssl` test that inspects
the source for the fd-pipe rule still passes. No behaviour change; `test_rs_server_auth.py`,
`test_rs_device_signin.py`, `test_rs_post.py` unchanged and green.

### Checks (recon 5.2 table, as shipped)

| id | where | PASS / WARN / FAIL |
| --- | --- | --- |
| `mode` | rs_doctor | note: personal (desktop) or team, and why GITHUB_PAT is or is not expected |
| `env.node` | rs_doctor | ≥ 20 PASS · older FAIL · absent: FAIL on a desktop run, note otherwise |
| `env.electron` | rs_doctor | binary exists PASS · reported but missing, or unresolved on a desktop run, FAIL with the reinstall line |
| `env.os` | rs_doctor | darwin/linux PASS · others WARN "unsupported, best effort" |
| `env.chromium_sandbox` | rs_doctor (linux + electron) | root-owned setuid PASS · else WARN "runs with --no-sandbox" |
| `tools.cloudflared` / `tools.tailscale` | rs_doctor | only when `desktop.json.phone`: binary on PATH, in `ROOT/bin`, or the Mac Tailscale app PASS · else FAIL; phone off → note |
| `perms.root` / `perms.file` | rs_doctor | ROOT 700 PASS · looser WARN; `.env users.json settings.json desktop.json push_vapid.json` 600 PASS · else WARN naming each file |
| `github.auth` | rs_doctor | ≥ 1 user with `gh_token_enc`/`pat_enc` PASS (none: WARN personal, note team); per user: `gh_exp` 0/future PASS · < 24 h WARN · past + usable refresh WARN · past + none FAIL "sign in again"; `gh_refresh_exp` past WARN; `gh_client` in the text and the JSON row. `--live`: decrypt, `gh api user` |
| `claude.auth` | rs_doctor | ≥ 1 `claude_token_enc` PASS · none WARN; `claude_exp` past + no refresh FAIL · past + refresh WARN · < 24 h + no refresh WARN. `--live`: decrypt, `claude -p` |
| `port.free` | rs_doctor | port = `desktop.json.port` > `RS_PORT` > loopback `PUBLIC_URL` > 8899; `/health` ok PASS · nothing listens: WARN personal, FAIL team · something else answers FAIL. Inside a container also tries host `app` |
| `callback.public_url` | rs_doctor | phone on + app running + `PUBLIC_URL` loopback WARN (only while the app runs — the launcher resets it on quit) |
| `callback.device` / `callback.claude` | rs_doctor `--live` | HEAD on `https://github.com/login/device` and the `CLAUDE_OAUTH_AUTHORIZE` host (a test pins the constant to server.py's); < 500 PASS · else FAIL "proxy or firewall" |
| `claude.cli` | doctor.sh | `claude --version` (now bounded by `with_timeout`, which falls back when coreutils `timeout` is absent) + FAIL when `~/.claude` (or `$HOME`, when it does not exist yet) is unwritable |
| GitHub service token | doctor.sh | unchanged for team installs; personal → note. Personal is `RS_PERSONAL=1` (env or `.env`) **or** `RS_DOCTOR_DESKTOP=1` **or** `ROOT/desktop.json` exists |

Dropped from doctor.sh as duplicates: the inline `.env` mode check (→ `perms.file`), the
`/health` curl (→ `port.free`), and the "N users / N connected Claude" tally (→ `github.auth` /
`claude.auth`). A loopback `PUBLIC_URL` on a personal install is a note, not a curl.

### Desktop

- `desktop/main.js`: `writeDesktopState(ROOT, { port })` right after `spawnServer` resolves.
  `desktop/lifecycle.js` documents the key.
- `desktop/doctor.js` (new, in `package.json` `files`): `doctorArgs`, `electronPath`,
  `doctorEnv`, `runDoctor`. `desktop/bin/reviewstage.js --doctor` is now three lines.
- Header in personal mode: `ReviewStage doctor — desktop install at <ROOT>`; the launcher sets
  `RS_DOCTOR_DESKTOP=1`, which also skips the Compose-project re-exec.

## Shipped

Files: `bin/rs_users.py` (new) · `bin/rs_doctor.py` (new) · `bin/server.py` · `bin/doctor.sh` ·
`bin/test_rs_users.py` (new) · `bin/test_rs_doctor.py` (new) · `desktop/doctor.js` (new) ·
`desktop/bin/reviewstage.js` · `desktop/main.js` · `desktop/lifecycle.js` · `desktop/package.json` ·
`desktop/test/doctor.test.mjs` (new) · `desktop/test/smoke.test.mjs` ·
`website/src/content/docs/operations/{troubleshooting,configuration,faq}.md` · this file.
Not touched: `dashboard-ui/`, `ReviewParts`, `PrPage`, `PhoneReview`.

Gates (10/10/26): `python3 -m unittest discover -s bin -p 'test_*.py'` 608 tests OK (565 + 43
new); `cd desktop && RS_SKIP_UI_BUILD=1 node scripts/prepack.mjs && node --test test/*.test.mjs`
38 tests, 37 pass, 1 skipped (the live tunnel), 0 fail — the three Electron smoke tests ran for
real and the first asserts the `desktop.json` port; `bash -n bin/doctor.sh` clean.

Against this machine's real install (`node desktop/bin/reviewstage.js --doctor`): 0 FAIL,
9 WARN (ROOT 755, settings.json 644, both tokens expired-but-refreshable, app not running,
no base clone, no `/proc/meminfo`, no team skill, no notification backend), exit 0; `--json`
35 rows, same counts. Before this lane the same install reported the port FAIL and "claude …
printed nothing".

Not done / follow-ups: the recon's `test_rs_job_scripts.py` addition landed in
`test_rs_doctor.py` instead (same fixture idea, no shared-file edit); `env.electron` on a
non-launcher run (`bash bin/doctor.sh` by hand) is skipped rather than resolved — only the
launcher knows where Electron is; a Windows run is reported as unsupported, not tested.
