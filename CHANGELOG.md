# Changelog

All notable changes to ReviewStage. Dates are MM/DD/YY.

## Unreleased

### Documentation remediation — 09/15/26

A six-part audit compared the documentation against the code and found the docs
were the least trustworthy part of the project. **Upgrade if you install, operate
or back up ReviewStage from these docs** — several of the corrections are the
difference between an install that works and one that does not, and one of them
is the difference between having a backup and not.

**Things the docs told you to do that do not work**

- The quick start said to run `bin/doctor.sh` on the host. On a Docker install
  the script reads the host's `~/.reviewstage/.env` instead of the `.env` you
  just filled in, finds no `claude` or `gh`, and prints FAILs against a healthy
  install; on macOS it can never pass. Everywhere it is now
  `docker compose exec app doctor`, with the reason given, and the description of
  what the doctor checks matches the script (it never checked Docker).
- `.env.example`, the README and the install page called `GITHUB_PAT` a
  **read-only** token and the install page asked for *Pull requests: read*. The
  install requires *Pull requests: **Read and write*** on the service token. The
  guarantee that actually holds — the review step has no GitHub write path, and
  every comment and approval uses the acting reviewer's own token — is now stated
  separately from the permission you have to grant.
- Setting `RS_PORT` in a Docker install's `.env` silently breaks it: Compose
  reads that file both to interpolate the published port and to build the
  container's environment, so the server moves and the publish does not. Warned
  in `.env.example`, `config.example`, the install page, Configuration,
  INSTALL-DOCKER and OPERATIONS. Use `RS_PORT=9000 docker compose up -d`.

**docs/OPERATIONS.md was wholesale stale and is rewritten**

- Every command in it was systemd/journalctl against `~/.reviewstage/bin/` — the
  from-source path only. It is now split into **Operations (Docker)** and
  **Operations (from source)**.
- State paths were the pre-multi-repo layout (`state/<pr>/users/<login>`). They
  are now `state/<owner>__<name>/<pr>/users/<login>` throughout, here and on the
  site's Troubleshooting page.
- It asserted "one repository per instance". `REPOS` has been a list since
  v1.0.0-rc.2. Removed here and in Troubleshooting's Known limits.
- It promised that `KillMode=process` keeps an in-flight review alive across a
  redeploy. That is true of the systemd unit only. On Docker,
  `docker compose up -d --build` recreates the container and **kills the running
  review**. Documented, with the `pgrep` check to run first.

**Back up your data volume — the old advice was to not bother**

OPERATIONS.md said "nothing needs to be restored from a backup". That was wrong
and dangerous. The volume holds every reviewer's encrypted GitHub and Claude
tokens, the `skills/` git repository with the team's hand-tuned review standard
and its full history, `learnings.jsonl` and the rule stores, and each
repository's profile with its human edits. None of it regenerates. There is now a
**Backup and restore** section with working commands for the named volume, the
`chown -R 1000:1000` a restore needs, the from-source equivalent, and how to
verify a backup — plus the warning that `RS_SECRET` and `users.json` must be
restored as a matching pair or every stored token is undecryptable. A short
version is on the site's Troubleshooting page.

**The `seen`-file recovery recipe destroyed data**

It filtered on `state/<pr>/review.json`, a path that has not existed since the
repository dimension landed, so on a multi-repository install every line failed
the test and the **whole file was rewritten empty**, re-announcing the entire
backlog to everyone. It also named the dedup key as `<pr>:<login>`; the real key
is `<repo>:<pr>:<login>`. Both fixed, with a replacement that is safe across
repositories and keeps legacy lines.

**Claims the interface made that the code does not deliver**

- The team default is seeded from `skills/global-review.md`, not from the
  built-in `pr-review` skill.
- Skill saves commit **best-effort**: a git failure is a silent no-op, so the
  Revision history panel can have gaps.
- There is **one** `learnings.jsonl` for the whole install, capped at the most
  recent 300 rows across all repositories — not a per-repository log. The prompt
  block prefers same-repo rows rather than being scoped to them.
- Repository profile: glob validation is skipped entirely when a dashboard edit
  is saved with no base clone at hand; `critical_paths` is **not** bounded
  (the other lists are); and a summary-only profile with every glob dropped is
  accepted, not refused.
- The QA guide page described eleven sections including a domain primer, an
  on-screen-changes section, continuous numbering and a branch-head footer. The
  prompt asks for five and none of those four. The page now marks exactly what is
  not guaranteed and why.

**Honest metric definitions**

Insights gained *How each number is defined* — formula, population and minimum
useful sample for each. In particular: **keep rate has two different formulas in
one product** (Insights uses `kept ÷ total`, the Skills page uses
`(kept + edited) ÷ total`) and both pages now say which they are; every
"all-time" figure is capped at the last 300 findings; agreement is an
**unweighted mean of per-PR rates**, so a three-finding PR counts as much as a
forty-finding one; and cycle time measures from GitHub's review **request**, so
most of it is a human not having got to it yet, and it excludes every review that
was never posted. Token totals exclude cache reads and writes.

**Prerequisites and configuration**

- Minimum **2 GB of RAM** is now stated: `MIN_FREE_MB` is 800 MB *available*, so
  a 1 GB VPS cannot run a single review. Disk and the doctor's
  `MIN_FREE_DISK_MB` are documented too.
- **Proxy support** for the image build (Debian packages, the `gh` apt repo,
  NodeSource, the Claude Code CLI from npm) and for the container at run time,
  with the `--build-arg` invocation and the `CLAUDE_CODE_VERSION` pin.
- A pointer to the **security model** from the README quick start, the install
  prerequisites and `.env.example`, so a newcomer meets it before pointing the
  tool at an external contributor's pull request.
- Every environment variable named in any document was re-checked against the
  code. Configuration gained `MIN_FREE_DISK_MB`, `RS_MODEL`, `RS_USER`,
  `SETUP_APACHE` and `CLAUDE_CODE_VERSION`, corrected the `POLL_INTERVAL` and
  "last five rows" claims, and records that `ANTHROPIC_API_KEY` is read nowhere.
  `scripts/icons.mjs` is `dashboard-ui/scripts/icons.mjs`.

**Marketing site**

The service token is no longer described as "read-only by permission" (it is
not; the guarantee is structural). "Discord is planned" is gone — Discord and
signed generic webhooks ship. The "10 to 15 minutes for a 25-file PR" figure, the
"GitHub can never reject the whole review" absolute, the one-repository Team
tier, and the doctor claim in the three-step install strip have all been brought
back to what the code supports.

Nothing in this round changes behaviour.

- **Repeated rejections become proposed team rules.** The learnings loop used to forget: a rolling 40-row prompt block is a preference, not a standard, so a finding the team had dropped six times still arrived on review seven. Dropped rows (and separately reworded ones) are now clustered by severity, the path's top two directory segments and gist vocabulary overlap — stopwords dropped, crude stemming, half of the shorter gist's significant words present in the other with a floor of two, no dependencies. A cluster of `RULE_SUGGEST_MIN` findings (default 3) from at least two different PRs, not already covered by a Team rule, becomes a **suggestion**.
- One `claude -p` call on the acting user's account drafts each suggestion as a single imperative sentence in the house style of the skill's existing rules, plus a rationale, cached by cluster signature and drafted on a background thread so the Skills page never waits on a model. With no Claude account connected the cluster still shows its evidence.
- New **Suggested rules** section on the Skills page: the sentence, the rationale, the count in words ("from 4 findings you dropped across 3 PRs"), an expandable list of the real findings each linking to its PR, and **Accept** / **Dismiss**. Accept goes through the existing quick-add path — a `## Team rules` bullet committed with the clicking user as author and the evidence count in the message. Single-repository evidence targets that repo's team default only when one already exists, so accepting can never mint an override that displaces the shared skill. Dismissals live in `$ROOT/rule_dismissals.json` behind a **Show dismissed** toggle with an Undo.
- A promoted cluster's rows leave the rolling prompt block, which now says so in its preamble, so the window is spent on new signal. Learnings lists each cluster as rolling or promoted and counts rules promoted; Insights gets the same number as a KPI.
- `GET /api/skills` gains `suggestions`; `POST /api/skills/suggestion` takes `accept` / `dismiss` / `undismiss` under the same signed settings token as the quick-add box.
- Tests: `bin/test_rs_learn.py` (23 cases — clustering paraphrases and separating different complaints, the threshold, the distinct-PR requirement, coverage by an existing rule, dismissal persistence and undismiss, promoted clusters leaving `render()`; the model is never called) and `dashboard-ui/e2e/rules.spec.ts` (renders, Accept lands the rule and the suggestion goes, Dismiss and Show dismissed).

- **Findings outside the diff are now the headline, not a footnote.** The repository profile sends a review past the diff — callers, consumers, tests — so on a small PR the best findings often point at lines it never changed, where GitHub accepts no inline comment. Those used to be folded into a collapsed `<details>` titled "could not be anchored", which hid blockers, and the banner opened with "Posted 0 comment(s)". Now they render expanded under `## Findings outside the diff`, ordered blocker → should-fix → nit → question, each heading linking at the exact line on the reviewed head SHA (`blob/<sha>/<path>#L<line>`, which works for unchanged files). Only a tail of more than three nits/questions collapses; a blocker never does.
- A **suggestion** on an off-diff finding renders as a plain `Suggested change:` block instead of a ```` ```suggestion ```` fence, since GitHub's Apply cannot work there.
- Result banners lead with what succeeded: *"Posted your review as `you` — 2 inline, 3 in the summary."*, or *"…— all 3 findings are in the summary, because they point at lines this PR does not change (GitHub only allows inline comments on changed lines)."* Never "Posted 0".
- The PR page warns **before** you post: an **in summary** chip on each affected finding card, and a post bar that reads `3 selected · 1 inline · 2 in the summary`. `/api/pr` findings carry `anchorable`, computed at render time with the same diff logic the post path uses and cached per (repo, PR, head).
- Anchoring got cheaper: a finding whose path is not in the PR's file list at all is off-diff for free — the full `gh pr diff` fetch now happens only for a file that IS in the PR but arrived without a patch.
- Tests: new `bin/test_rs_review_body.py` (heading, permalink shape, ordering, no-`<details>`-for-a-blocker, `Suggested change:`, the banner strings), extra `bin/test_rs_diff.py` coverage for the not-in-the-PR case and suggestion routing, and a Playwright case for the chip and the post-bar split.

## v1.0.0-rc.9 — 09/14/26

Sign in with GitHub out of the box via device flow.

- **Sign in with GitHub works on every install with zero admin setup.** The login page's primary button now uses GitHub's OAuth device flow with a shared public client ID (`Ov23liHjtjxcPNwXC6Y5`): a short code to enter at github.com/login/device, a Copy button, a live "Waiting for GitHub…" status, and the page signs you in by itself. No OAuth App to register, no callback URL, no secret — the token goes from GitHub straight to your server. `GH_DEVICE_FLOW=0` turns it off; `GH_DEVICE_CLIENT_ID` uses your own device-flow-enabled app.
- New endpoints `POST /api/auth/device/start` and `POST /api/auth/device/poll` (`bin/rs_device_flow.py`); the browser never sees GitHub's `device_code`, polls faster than GitHub's interval get `429`, pending sign-ins are capped at 50 and purged. Device-flow users are `login_via: "oauth"` and post/approve through `user_pat()` unchanged. `/api/me` reports `device_flow`.
- The redirect flow (`GH_CLIENT_ID` / `GH_CLIENT_SECRET`) stays for teams that want one click or their own app identity, and is preferred when configured. Its button reads **Sign in with GitHub** (was *Continue with GitHub*). The "Running this server?" hint only shows when both GitHub flows are off. A sign-in completed on `/login` now lands on `?next=` (or the queue) instead of the SPA's Not found page.
- Docs: Install, Setup, Security, Configuration, First review and the README describe the device flow and why the scope is `repo`; the demo fixture sets `GH_DEVICE_FLOW=0` so it stays offline.
- Tests: `bin/test_rs_device_flow.py` (fake GitHub: pending, slow_down, expired, denied, ok, interval guard, cap/purge) and Playwright `e2e/device-flow.spec.ts` (code shown, poll resolves, app loads; denied; expired; device pairing).

## v1.0.0-rc.5 — 09/14/26

First-run fixes from live testing (Docker install, one repo, one reviewer).

- The PR page no longer flashes "The review stopped before it finished" while a review is starting: liveness comes from the per-PR flock **or** a live pid **or** a status written in the last 90 s (`bin/rs_state.py`, tested in `bin/test_rs_state.py`); every stalled verdict logs one diagnosable line. The banner offers Stop when the run's process group is still alive.
- The guided tour actually appears on a first sign-in: it waits for the queue card (empty state included) instead of checking once at mount.
- Connect (Claude) and Sign in with token show a spinner and disabled inputs while verifying; a failed Claude code is reported inline.
- Login recommends a fine-grained PAT (Pull requests r/w, Contents r, Metadata r) and still accepts a classic `repo` token; docs and the install page agree.

- **Breaking:** internal identifiers renamed (`PRBOT_*` → `RS_*`, `~/.claude-pr-bot` → `~/.reviewstage`, `/prbot` prefix removed, OAuth callback now `/oauth/callback`, cookie `rs_session`). No migration; delete old state or move the directory by hand. The server file is `bin/server.py`, the helpers `bin/rs_*.py`, the systemd unit `reviewstage.service`, the Apache vhost `reviewstage.conf`, and the Docker volume mounts at `/home/reviewstage/.reviewstage`.

## v1.0.0-rc.3 — 09/13/26

- GitHub webhooks (`POST /webhooks/github`) deliver review-request cards within a second; the poller stays as the fallback.
- GitHub-first login (OAuth App or GitHub App) with token sign-in behind a disclosure.
- Bearer device tokens with hashing, sliding expiry and a per-user cap; `/device` pairing page and a Devices card on Integrations.
- Repository profile: deterministic signals plus one model call name each repo's critical paths; Standard/Deep reviews walk the ones a PR touches.
- Webhook end-to-end test (curl + openssl against a real server) and profile/auth unit tests run in CI.

## v1.0.0-rc.2 — 09/13/26

- One install, many repositories: the repository is a first-class dimension in the queue, the state layout and the dashboard filters.
- Multi-backend notifier (Slack, Discord, generic webhook) with a runtime Settings page and an admin role.
- Installable PWA usable at phone width.
- Solo / Team / Company tiers documented on the public site.

## v1.0.0-rc.1 — 09/13/26

- Dockerfile, compose profiles (including `demo`) and entrypoint.
- `bin/doctor.sh` environment diagnostics.
- Astro + Starlight public site deployed to GitHub Pages.
