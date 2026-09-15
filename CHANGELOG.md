# Changelog

All notable changes to ReviewStage. Dates are MM/DD/YY.

## Unreleased

### Remediation gaps — 09/15/26

The documentation pass that followed the audit remediation verified 254 claims
against the code and surfaced seven things the remediation had left undone or
half-done. All seven are closed here.

- **`bin/doctor.sh` now finds the container.** It had no Compose detection and
  never invoked `docker`: run from the host on a Docker install it read the
  host's environment file and probed host tooling, so it reported failures
  against a healthy install, and on macOS it could never pass — which is a bad
  thing for the *second command in the quick start* to do. It now detects a
  ReviewStage Compose project in the working directory with the `app` service
  up, re-execs itself inside the container and says so on its first line. The
  direct in-container form and the from-source form are unchanged, and when
  `app` is not running the fallback is explicit: a WARN saying the checks below
  describe the host rather than the install.
- **A dry run is recorded, and is no longer a metric.** Posting under the
  shipped `DRY_RUN=1` writes nothing to GitHub, but the decision was logged as
  if it had: a two-week pilot on the default posted nothing at all while
  Insights reported a keep rate computed entirely from hypothetical posts. Those
  rows now carry a `dry` flag. They still feed the review prompt and the rule
  suggestions — unticking a finding is a real judgement — and they are out of
  every rate and total: the keep rate, the verbatim rate, the per-skill scores,
  the outcome counts and the per-day series. The count is published as
  `dryDecisions` (and `counts.dry` on the learnings API) so a surface can label
  them.
- **One free-disk floor.** `MIN_FREE_DISK_MB` defaulted to 500 in
  `bin/lib-common.sh` and 1024 in `bin/doctor.sh`, so the health check FAILed at
  a level every job was happy to start at. Both now read `bin/lib-limits.sh`;
  the surviving value is 500.
- **Retention reaches the run snapshots.** The sweep deleted aged `.log` files
  but removed a `history/<ts>` directory only when it was already empty — which
  it never is — so the run snapshots, the bulk of what grows, accumulated for
  ever. Whole directories older than `RS_RETENTION_DAYS` now go, keeping the
  newest **five** runs per PR per reviewer however old they are so *view an
  earlier run* still works.
- **Profile versions are capped.** `profile.<ts>.json` was never pruned; the
  newest **ten** per repository are kept.
- **The superseded `devices-pruned` marker is gone.** Nothing had read it since
  the daily housekeeping guard was renamed `daily-done`.
- **The posting gate says when it forgets.** `posted_runs.json` silently dropped
  its oldest entry at 20, and that entry is what stops a run being posted twice.
  The cap stays — a re-run clears the list and the same run is already refused,
  so entries only build up when the author keeps pushing and the reviewer keeps
  posting without re-running — but an eviction is now logged.

### Final stragglers — 09/15/26

Five loose ends, each found by one lane working in a file another lane owned,
closed before the release.

- **A concurrent read can no longer find no profile at all.**
  `rs_profile.save_profile` renamed `profile.json` away to archive it and then
  wrote the replacement, so for that instant a reader got nothing — the Skills
  page rendered a repository with no profile. The previous version is now
  archived from the bytes already in hand and the replacement lands with a
  single `os.replace`, so the live path is never moved out of the way.
- **The hatched marker for today's bar can render.** Insights compared the
  server's `%m/%d/%y` series date against an ISO date, so the comparison was
  never true, the hatch never drew and every chart ended on what looks like a
  slowdown and is in fact a part-day. It compares on the series point's `ts`
  now — the bucket key the server already sends.
- **A merged or closed PR says so on its own page.** `canApprove`, `prState`
  and `merged` reached the queue rows only, so the detail page offered a live
  Approve button on a shipped PR and the server's refusal arrived after the
  click. `/api/pr` carries the three fields now, from metadata it already had,
  and the page renders the state and disables Approve with the reason.
- **Dry-run decisions are labelled.** `counts.dry`, the per-row `dry` flag and
  `dryDecisions` existed and nothing rendered them, so a pilot on the shipped
  `DRY_RUN=1` saw a Learnings page whose totals ignored a week of judgements
  and an Insights page that read like an empty install. Both pages now say how
  many decisions were made in dry run, that they are in no rate, and that they
  still teach the reviewer; the affected rows carry a **dry run** pill.

The `posted_runs.json` eviction added above stays a log line and is
deliberately not surfaced in the dashboard: reaching the cap needs twenty-one
distinct posts of distinct runs on one pull request by one reviewer without a
re-run, nothing an operator could act on follows from it, and the only honest
placement would be a banner nothing ever clears.

### Audit remediation — 09/15/26

A six-part audit of the whole project ran in seven lanes and all of them have
landed. **Upgrade.** Several of these are the difference between a feature
working and quietly not working, two of them are data loss, and one is the
central safety property finally being enforced rather than asserted.

#### Read this before you upgrade

Four things change behaviour on the way in.

- **`RS_PORT` in a Docker `.env` is now inert; use `RS_HOST_PORT`.** The
  container's listen port is pinned to 8899 in `docker-compose.yml`, because
  `EXPOSE`, the healthcheck and the publish target all name it. The host side
  of the publish is `RS_HOST_PORT` (default 8899) and nothing else reads it. If
  you were working around the old breakage by passing `RS_PORT=9000` on the
  command line, that no longer moves anything — set `RS_HOST_PORT=9000` in
  `.env` instead.
- **The server refuses to start without a real `RS_SECRET`.** Empty, or shorter
  than 32 characters, is now a `FATAL` line and exit 1 rather than a weaker
  mode. It was never a weaker mode: `HMAC(b"", …)` is a signature anyone can
  compute, and an audit forged a session cookie as an admin and minted a device
  token from it. Generate one with `openssl rand -hex 32` before you restart.
- **Rotating `RS_SECRET` now revokes everything, including device tokens.** Their
  hashes are keyed to the secret and a per-user epoch, so the incident-response
  runbook finally does what it said. The same epoch is inside the session
  cookie's HMAC, so *Sign out everywhere* invalidates cookies as well as
  devices. Everyone signs in again after a rotation; phones and CLIs pair again.
- **Stored tokens re-encrypt at a higher cost silently, but check your
  personal skill if you ever saved a per-repository one.** PBKDF2 goes from
  10,000 to 600,000 iterations and old ciphertext still reads, so nothing is
  needed from you. The skill tier is the one place where the old bug destroyed
  data: saving a repository override wrote over the editor's *personal* skill,
  behind a success banner. If you tried that, look at your own skill in
  *Integrations* before trusting it.

Two smaller behaviour changes worth knowing: the `Secure` cookie flag is now
dropped only for a genuinely loopback `PUBLIC_URL`, so an install that put a
real hostname in front of a `http://` URL starts issuing secure cookies (and
says so in the log); and container logs are capped at 3 × 10 MB per service,
so `docker compose logs` no longer reaches back to the beginning of time.

#### The gate

- **The review agent runs with no GitHub credential in its environment.** Until
  now "the review step has no GitHub write path" was a sentence in a prompt:
  every agent was launched with the reviewer's write-scoped token in
  `GH_TOKEN`, so anything it read — a PR description, a `CLAUDE.md`, a test
  fixture — could talk it into `gh pr review --approve`, and the approval would
  land under a human's name. The environment is now scrubbed of every GitHub,
  Slack, Discord, webhook and HMAC credential, `GH_CONFIG_DIR` points at an
  empty directory so `gh` cannot fall back to a stored login, an explicit tool
  deny list is the second barrier, and the script counts the PR's reviews,
  comments and threads before and after the run. A difference is a failed job
  and a recorded incident, not a review. The Claude token stays, because the
  CLI reads it only from the environment and dropping it would run every review
  on the box account.
  What this does not cover is in
  [SECURITY.md](docs/SECURITY.md#the-review-agents-sandbox): the agent can still
  run commands as the service user, the fingerprint watches three counters on
  one pull request, and the QA job has the scrub and the deny list but no
  fingerprint.
- **Posting is scoped to the run, not the pull request.** Review, post, the
  author pushes, review again, post again was structurally impossible: one
  permanent marker per (PR, reviewer) was set by the first post and cleared by
  nothing, so the second post was refused and the post bar disappeared. Worse,
  a review the reviewer left on GitHub's own Files tab wrote that marker and
  stranded their staged draft. The gate is now one entry per post this
  dashboard made, naming the head and a content hash of the run.
- **Approval knows which commit was reviewed.** A branch that moved since the
  review needs a typed confirmation, with both short SHAs named; approving the
  same head twice is refused outright.
- **A stale tab cannot post the wrong text.** Findings were matched to the
  reviewer's edits by array index, so a re-run from another device reordered
  them and an open tab posted old text against a new finding's file and line —
  a comment about the wrong code, under a human's name. The client echoes the
  run's hash and a mismatch is a `409`.
- **No silent fall back to the service token.** A user whose stored token could
  not be decrypted would have had their comment or approval posted by the
  service identity. An empty token now raises.

#### Discovery and notifications

- **The poller merges instead of replacing.** It rebuilt `queue.json` wholesale
  from a search that returns only *direct* review requests, so every row the
  webhook had created by expanding a `requested_team` was erased within three
  minutes — while its `seen` line survived, so nobody was re-notified. Team
  review workflows were silently broken. Rows now carry how each requested
  login was learned and are merged under the shared lock.
- **A failed search no longer publishes an empty queue.** An expired token or a
  rate limit used to show everyone "You're all caught up" while real requests
  sat on GitHub. A login whose search failed gets no verdict, failures are
  logged loudly, and a cycle where nothing succeeded publishes nothing.
- **`seen` means a card was sent.** Both the poller and the webhook notify
  first and write `seen` only on a confirmed send, with a bounded retry;
  previously they disagreed, and whether a failed card was retried depended on
  which won the race.
- **Draft, bot and over-age pull requests go to `suppressed`.** They were
  marked seen, permanently, so a PR that was a draft when anyone first looked
  at it could never ping again. They are now re-evaluated every cycle.
- **Redelivered webhooks cannot rewrite history.** A replayed
  `review_request_removed` could un-queue a live PR at any later time; delivery
  ids are now remembered in a bounded list. A `closed` event persists the
  closed/merged state, and a review request that comes back after ReviewStage
  auto-archived the PR clears its own archive marker — an archive a person
  clicked is still left alone.
- **A blackholed endpoint cannot wedge discovery.** Cards are sent under a
  watchdog and every `curl` carries a timeout; the Slack bot token goes in on
  stdin instead of argv; Discord titles are truncated by character so a long PR
  title no longer loses the whole card; and Slack's empty-section rejection no
  longer eats a review with no summary.
- **New knobs:** `RS_WEBHOOK_WORKERS` (4) bounds the webhook pool, which sheds
  with `503` rather than spawning a thread per delivery; `RS_SEARCH_LIMIT`
  (200) and `RS_ORG_SEARCH_LIMIT` (300) raise the search ceilings and warn on a
  result that equals them; `RS_RETENTION_DAYS` (30) drives a once-a-day sweep
  of per-run logs, which nothing had ever cleaned up.

#### Numbers that were wrong

- **One keep-rate definition.** Two formulas shipped under one name. There is
  now one — kept or reworded, over all scored decisions — with the stricter
  kept-verbatim measure renamed `verbatimRate`. Below **20** decisions no rate
  is shown at all, on any surface.
- **"All-time" is all-time again.** Every count came from a detail log capped
  at 300 rows, so totals froze and could go *down*. A never-truncated tally in
  `learnings_totals.json` now carries them; installs that predate it seed from
  what survives and are flagged incomplete.
- **The keep rate counted findings that never reached GitHub.** Outcomes were
  recorded before the POST, so three retries through an outage logged every
  finding four times and a click with nothing ticked logged a full set of
  drops. Recording happens after the post succeeds, keyed by the run so a retry
  replaces.
- **Agreement is pooled.** It was an unweighted mean of per-PR rates over only
  each PR's newest head, so a two-finding PR counted as much as a twenty-finding
  one and two heads out of three were thrown away.
- **Day buckets are UTC on both sides.** Every daylight-saving change used to
  knock the generated keys an hour off the stored ones and empty the chart.
- **Token, model and severity panels read every run.** They read only the
  current run per PR and reviewer, so the "all-time" severity chart went down
  over time and switching model zeroed the old one. A cached re-run is no
  longer re-billed on the day it was replayed.
- **Cycle time says what it measures** — from GitHub's review request to the
  post — and reports how many posts fell outside that population instead of
  quietly shrinking `n`.

#### Learnings, skills and profiles

- **A promoted rule now leaves the rolling prompt window.** It never did: the
  filter re-clustered dropped and reworded rows together, so the merged cluster
  hashed differently from the one the rule was promoted from and nothing was
  ever skipped. Promotions record the row ids they were made over.
- **Dismissals stick to what you dismissed.** They were anchored to a gist that
  drifts as a cluster grows, which both suppressed complaints nobody had
  dismissed and resurrected the one that had been.
- **Agreement stopped over- and under-confirming.** A body too thin to judge
  used to confirm anything structurally nearby — a one-word typo nit confirmed
  a null-check six lines away — and two byte-identical file-level findings could
  never confirm each other. Both fixed.
- **The per-repository skill tier works.** See the upgrade note above.
- **Skill history is no longer a silent no-op.** No return code was checked, and
  a global `commit.gpgsign=true` was enough to leave every edit uncommitted
  while the UI hid the history panel. Failures are surfaced, signing is
  disabled locally, and each commit names only the paths it changed.
- **Opening the Skills page stopped spending your Claude quota.** Up to two rule
  drafts per page load, failures uncached, so a bad token meant a fresh
  90-second subprocess every time. Drafting is an explicit action now.
- **Profiles: globs, sections, caps and staleness.** `fnmatch`'s `*` crossed
  `/`, so `src/*.ts` matched four thousand files and every review was told the
  critical path was touched. The markdown round trip lost whole sections
  silently — deleting the risk-paths heading saved cleanly and every risk rule
  vanished from future reviews. Nothing capped what was stored while the render
  cap truncated in model-emission order. And staleness was stored, returned,
  typed, and never compared to anything. All four are fixed; `profile.json`
  carries a schema version, earlier versions can be read and restored, and an
  edit saved with no clone to check against reports `validated: false` instead
  of presenting unchecked globs as ground truth.

#### QA guides

- **The skill was never inlined.** `run-qa.sh` named it in the prompt while
  `--allowedTools` did not include `Skill`, so the agent never saw a word of the
  method and improvised a guide — and the skill itself told it to publish an
  Artifact the product cannot render. The body is inlined, the skill is
  rewritten around the markdown deliverable, and the prompt states one output
  contract.
- **The evidence claim is now true.** The UI said the guide was built from the
  diff, review threads and history. Only five metadata fields were fetched and
  the agent has no network. The script gathers the PR body, the review
  conversation, the inline threads and the commit history into
  `.rs-pr-context.md` before the agent starts.
- **A truncated guide is no longer announced as ready.** The exit code was
  thrown away and non-emptiness was the only gate, so a run killed at 60%
  arrived as "Guide ready — hand it to QA". The completeness gate now checks the
  end marker, the three tiers, a test case and the known-non-defects section.
- **A QA build reports what it cost** — model, tokens, duration — written before
  the completeness gate so a timed-out run still accounts for its spend. The
  budget is sized from the diff (25 / 40 / 60 minutes) and `RS_QA_TIMEOUT`
  overrides it; `RS_QA_SKILL` overrides the skill path.

#### Jobs, HTTP and sign-in

- **A full disk looked like a successful review.** Unchecked writes under
  `set -uo pipefail` produced an empty `review.json`, a status of
  `done ( findings)` and a Slack card announcing a ready review. Every write is
  checked, and a free-disk guard (`MIN_FREE_DISK_MB`, 500) runs first.
- **The memory guard read the wrong memory.** `/proc/meminfo` inside Docker is
  the *host's*, so on any machine larger than the container limit the guard
  could never fire and the agent was OOM-killed instead of asked to wait. It
  reads the cgroup budget now.
- **`review.json` is validated as a review.** `jq -e .` accepts a bare array and
  invalid UTF-8; the dashboard then threw on every page load of that PR, for
  ever, because the file is what it re-reads.
- **Worktrees and branches stopped leaking** on failure paths, where the leftover
  branch blocked the next run.
- **Every request body is bounded.** `Content-Length` went straight into memory
  before any authentication, so an anonymous request could ask a small box for a
  gigabyte. 2 MiB cap, 413 before reading a byte, 400 on a malformed header.
- **Query strings are redacted from the access log.** `/handoff?…&sig=…` and
  `/oauth/callback?code=…` carry single-use credentials and `docker logs` is
  neither encrypted nor access-controlled.
- **`/api/login` required no `Content-Type`.** A cross-site `text/plain` form,
  which needs no preflight, could sign a victim's browser in as the *attacker's*
  GitHub identity — and a Claude connect on that page would then attach the
  victim's Claude token to the attacker's record. Every `/api/*` write must be
  `application/json` or carry a bearer, and `Sec-Fetch-Site: cross-site` is
  refused.
- **Device-code phishing.** `start` and `poll` were unauthenticated and shared
  nothing, so an attacker could start a flow on your server, talk a teammate
  into approving the code at github.com, and receive a session as them. The
  flow is bound to the browser by a nonce cookie, and the waiting card says to
  continue only a sign-in you started.
- **A flood of `start` locked the team out** by evicting the oldest pending
  entry — precisely the sign-in a real person was part-way through. Eviction is
  most-recent-first, never touches a polled session, and keeps headroom back.
- **Sign-in forked one `gh` per configured repository** per anonymous request,
  each with a 20-second timeout. It probes one repository, behind a semaphore
  and a per-IP rate limit.
- **The "org has not approved this app" flag was global**, so one person whose
  account could not see the repository told everybody the org had blocked it.
- **`?welcome=1&next=…` was minted and never read**, so a teammate following a
  Slack link to a PR signed in and was stranded on Integrations.
- **A dead job reads `failed`.** Every job — review, QA guide, profile — now
  goes through the same lock-or-pid-or-grace probe, so a crashed run stops
  spinning on `reviewing` and its log tail is exposed. Two fast clicks can no
  longer both spawn an agent and leave **Stop** killing the wrong one.
- **Rendering the queue stopped firing a `gh pr view` per row.** After a quarter
  of pings that was dozens of sequential subprocesses on every page load.

#### Documentation

Every page was re-read against the code as it now is. The four notes the last
pass had to leave open are resolved: the QA skill and prompt are aligned, the
host port is a separate variable, critical paths are capped — and the doctor's
re-exec into the container did **not** land in that pass, so the pages said
plainly that `docker compose exec app doctor` is the form to use. (It landed in
*Remediation gaps* above, and the pages were updated again.)
OPERATIONS gains a file-by-file map of the data directory and what the daily
sweep removes; SECURITY gains the agent sandbox with the four things it does not
cover; Insights, Skills and learnings, Reviewing, Repository profile and QA
guides are rewritten against the new behaviour.

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
  INSTALL-DOCKER and OPERATIONS. (Superseded by the remediation above, which
  split the two keys: the host port is now `RS_HOST_PORT` and `RS_PORT` in a
  Docker `.env` is inert.)

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

Nothing in that documentation round changed behaviour. The audit remediation
above does — see *Read this before you upgrade*.

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
