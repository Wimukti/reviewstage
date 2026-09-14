# ReviewStage — one-click staging verification (spec)

Purpose: after a QA plan is generated, let a reviewer **execute** it on the PR's own staging box
from ReviewStage — no local setup, no `staging-verify` skill on their machine — and see PASS/FAIL
with evidence on the PR page. This is sign-off-first: it stores AWS credentials and acts on shared
staging, so nothing here ships without an explicit OK.

Grounded in the current codebase: rebranded **ReviewStage** (`RS_*` env, `server.py`,
`rs_paths.py`), multi-repo (`$ROOT/repos/<owner>__<name>/`, `prdir <repo> <pr>`), detached
`run-*.sh` jobs (flock + worktree + `claude -p`, `notify_card` on completion), per-user encrypted
tokens (`claude_token_enc`, `pat_enc`), and the Connect-Claude PKCE flow
(`claude_connect_start/pending/code`, `user_claude_token`, `claude_connected`). ReviewStage today
has **no** staging-box integration — this adds it.

---

## Part A — the plan (already shipped, one tweak)

The QA guide **is** the plan: `run-qa.sh` + the `pr-qa-guide` skill produce risk-tiered P0/P1/P2
cases with the data needed, steps, and explicit Pass/Fail. To make it directly executable, add two
things to the guide's per-case format (a prompt tweak in `run-qa.sh`, no new feature):

- **Execution tag** per case: `B` backend-observable (PHP on the box), `T` needs a task/one-off
  fired, `U` needs the rendered UI (browser), `H` needs a human eye. (Same taxonomy as the
  `staging-verify` skill's Phase 1.)
- **Exact expected value** per case (a date, a count, a string) — "looks right" is not a verdict.

`run-verify.sh` reads the generated guide + the diff and executes every `B`/`T` case, leaves `U`
for v2 (browser) and `H` for a human.

---

## Precondition — the PR must have a live branch box with its code on it

ReviewStage must resolve and health-check the box before doing anything. This is a real gate: **not
every PR has a branch box** (one exists only if someone ran `staging:sync`, branch ending
`-staging`).

1. **Find it** by the branch name's tag: `aws ec2 describe-instances --region us-east-2 --filters
   "Name=tag:Name,Values=*<branch-prefix>*" "Name=instance-state-name,Values=running"` → instance id.
2. **Up?** `staging-exec … -- 'git rev-parse --short HEAD'` returns; and that HEAD matches the PR's
   head SHA (the branch box actually has this PR's code — branch boxes deploy via CircleCI→CodeDeploy
   with a manual hold, so the code may lag the PR).
3. **If absent / stale / down** → don't guess: return a clear banner — *"No staging box for this PR
   (or its code isn't deployed yet). Provision with `staging:sync`, then re-run verify."* Never try
   to provision or approve the CI hold automatically.

---

## Connect AWS — the SSO button (mirrors Connect Claude)

AWS SSO has a **device-authorization flow** — the same shape as ReviewStage's existing Connect-Claude
PKCE. Add a **Connect AWS** control on Integrations, parallel to Connect Claude:

1. `POST /api/aws/start` → `sso-oidc register-client` + `start-device-authorization`; return the
   `verificationUriComplete` + user code. Store the pending device code server-side (per user, like
   `claude_connect_pending`).
2. User approves in their browser (their normal SSO).
3. `POST /api/aws/code` polls `create-token`; on success store the SSO access token **encrypted
   per-user** in `users.json` (`aws_sso_token_enc`), exactly as `claude_token_enc`/`pat_enc` are
   stored. `aws_connected(login)` mirrors `claude_connected(login)`.
4. `run-verify.sh` uses that token to `get-role-credentials` for the non-prod role and drives SSM.
   Tokens are ~8h — on expiry the run fails with "reconnect AWS", same UX as an expired Claude token.

Why per-user (not a box instance role): verification then runs with **that reviewer's own AWS
access**, so it's attributable and scoped to what they can already reach — no standing box-wide
privilege. (An instance role is the simpler alternative if per-user attribution isn't wanted; call
that out at sign-off.)

---

## `run-verify.sh` — the executor (sibling of `run-qa.sh`)

Detached job spawned by `server.py` from a **Verify** button on the PR page. Signature
`run-verify.sh <owner/name> <pr>`; reads `RS_ACTOR` (the clicker), `RS_AWS_TOKEN`, and
`CLAUDE_CODE_OAUTH_TOKEN` (the actor's own) from the env the server sets — same as the review flow.

1. **Locks — this is the crucial safety property.** Take the per-PR/user verify lock (dedupe) AND a
   **box-wide `verify.lock`**, so only ONE verification runs at a time across all PRs. Reason: **all
   branch boxes share one staging RDS** — concurrent verifications flip the same shared flags and
   create colliding fixtures. Serialize until per-PR databases exist. (Reuse the `review.lock`
   discipline already in `run-qa.sh`.)
2. **Resolve + health-check the branch box** (precondition above). Abort cleanly if not ready.
3. **Orchestrate from the ReviewStage box, execute on the branch box.** The `claude -p` agent runs
   where the Claude token is (the ReviewStage box), loads the `staging-verify` skill, and for each
   `B`/`T` case ships PHP to the branch box over SSM (`staging-exec … -- 'echo <b64> | base64 -d >
   /tmp/x.php; php /tmp/x.php'`), fires tasks like "Run Locally"
   (`ScheduledTaskRunner::tryRunTask`), runs one-offs, and reads state back — evidence is the actual
   values + the app log. **No Chromium anywhere in v1.**
4. **Cleanup is mandatory (Phase 5).** Before releasing the lock, restore every shared thing it
   touched — flags flipped, fixtures created (soft-delete `QA …`-prefixed), cutoffs/holidays. A
   verification that can't guarantee cleanup must refuse to flip a shared flag. Announce shared-flag
   flips in the report.
5. **Report + notify.** Write `verify.md` (a PASS/FAIL table: case · result · evidence value +
   "verified by me / needs a human / found out-of-scope") to `prdir`, like `qa.md`; surface it on
   the PR page; `notify_card verify_ready` (Slack + Discord) to `RS_ACTOR`, mirroring `qa_ready`.

---

## Scope: v1 backend-only, v2 browser

- **v1 — backend/task cases (`B`/`T`) only.** No Chromium → fits the small boxes, no memory risk,
  and covers most scheduling/data/integration verification with real proof (values read back +
  log lines). `U` cases are listed in the report as "needs a human" with exact steps; `H` always is.
- **v2 — browser (`U`) cases.** Run Playwright **on the PR's branch box** against its own localhost
  (admin login-as via `e2e/.env`, screenshots as evidence), one at a time. Needs node + Playwright
  provisioned on branch boxes and is heavier — defer until v1 proves out.

---

## Hard constraints & sign-off checklist

Before building, these need an explicit decision — they're the reason this is spec-first:

1. **Storing AWS SSO tokens server-side.** Same class as the Claude/GitHub tokens ReviewStage already
   holds, but bigger blast radius (can act on staging, mutate the shared RDS). OK to store `aws_sso_token_enc` per user?
2. **Shared RDS.** v1 mitigates with box-wide serialization + mandatory cleanup + shared-flag
   announcements. Accept that verification is **one-at-a-time** until per-PR DBs exist?
3. **The rsync trap.** `run-verify.sh` must **never** call `sync-to-staging.sh` (its `--delete` wipes
   `public/js/dist`); it only reads/executes via SSM. Bake that in.
4. **Duplication vs. the org QA tool.** This is close to Rajitha's team QA tool, which the org wants
   to standardize. Decide: ReviewStage owns execution, or ReviewStage generates the plan and **hands
   off** to that tool (same one-click UX, no second AWS-credential store, no duplicated runner).

## Build order (once green-lit)
1. Part A tweak — execution tags + expected values in the QA guide (`run-qa.sh` prompt).
2. Connect AWS (device flow + `aws_sso_token_enc`, mirroring Connect Claude).
3. Box resolver + health-check + the "no box yet" banner.
4. `run-verify.sh` v1 (backend-only), box-wide serialized, mandatory cleanup, `verify.md` report,
   `notify_card verify_ready`, Verify button on the PR page.
5. Later: v2 browser cases on the branch box.
