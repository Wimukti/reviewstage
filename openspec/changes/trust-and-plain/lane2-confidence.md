# Lane 2 — earned confidence: the disproof pass, the calibration readout, the three-level badge

Proposal, design decisions, what shipped and what is left, in one file. `design.md` Part 2
(§2.1–§2.4 and the badge table) is the brief; where this file differs from it, this file says
what is actually in the tree. Built on branch `tp2-confidence` (10/11/26), on top of Part 1
(`lane1-plain.md`, merged).

## Why

After Part 1 a card carried the model's own `high` / `medium` / `low confidence` beside the
severity. That is the one signal the maintainer asked us to stop leaning on: it is the model
grading itself. Part 1 added the first signal that is not — the deterministic evidence check.
This lane adds the other two and replaces the badge:

1. **The disproof pass** (§2.1): a second Claude run, same account, opposite brief — *find the
   strongest reason this finding is wrong, already handled, or harmless* — answering `stands`
   / `weakened` / `refuted` with one sentence per finding.
2. **The calibration readout** (§2.2): what reviewers actually kept, by the model's self-reported
   confidence and by the evidence result, from the learnings tally.
3. **The badge** (Part 2 table): **Checked / Likely / Maybe** with one reason line built from
   the three signals; the self-report moves under "More" and is never shown alone (§2.3).

## Non-negotiable properties touched

**Property 1** (the review step has no GitHub write path) and **property 4** (reviews run on the
clicker's own account). The disproof pass is one more `claude -p` call inside `run-review.sh`,
launched through the same `agent_env` (every GitHub, Slack, webhook and HMAC credential
stripped, `GH_CONFIG_DIR` empty) and the same `--disallowedTools` list as the main pass, with
`CLAUDE_CODE_OAUTH_TOKEN` from the clicker. It writes exactly one file, `disproof.json`, in the
worktree; `rs_disproof.py merge` copies the verdicts into `review.json`. `run-review.sh`
fingerprints the PR (reviews, comments, threads) before the main pass and again after the
disproof pass; a difference writes `security-violation` and fails the job, naming the pass.
`rs_disproof.py` and `rs_confidence.py` are stdlib-only (pinned by tests) and import nothing
that could reach GitHub. Nothing new posts; nothing runs unasked (the pass runs only inside a
clicked review); every reviewer's `review.json` is still their own.

## Design decisions

### The pass runs inside `run-review.sh`, before the cache write

Not a separate job the server spawns on completion: the disproof needs the cited files, and the
worktree is removed when `run-review.sh` exits. So the pass runs after the normaliser has written
`$DIR/review.json` and before `cleanup`; the status reads `second pass: checking the findings`
(a new phase, *Checking the findings*, between *Reviewing the diff* and *Writing the findings*)
and the cache entry written afterwards carries the verdicts, so a reuse shows them. The pass
**never fails the review**: a timeout, a bad answer or a missing file records
`disproof.status ∈ {timeout, failed, partial}` and leaves the findings unchecked;
`run-disproof.sh` always exits 0. Its timeout is `max(300 s, min(900 s, 40 s × n + 60 s))`.

### What the pass is handed

The plain rows only — `id`, severity as the fixed word (*breaks* / *can break* / …), `where`,
`title`, `what_to_check`, `expected`, `actual`, `impact` — plus the list of cited files to read
first. Never the GitHub `body`: the second reviewer should not be anchored by the first one's
argument. The skill (`skills/pr-disproof/SKILL.md`) is prepended through `skill_body` like any
other; the brief and the output contract come from `rs_disproof.brief()`.

### Mode and selection

`RS_DISPROOF` is `default` (findings whose severity is `blocker` → *breaks* or `should-fix` →
*can break*), `all` (the per-run **Check all findings** toggle on the run form; `checkAll` on
`/api/review`), or `off`. `all` also changes the review cache key (a default run keeps the key
it always had), so a check-all re-run on the same commit is not served the default run's result.
The helper text states the cost from `runForm.disproof.secPerFinding` (40 s per finding).

### Parsing the answer

`rs_disproof.parse()` accepts the object the contract asks for, a bare list, JSON wrapped in
prose or a fence, string ids, verdicts in any case; it skips (with a warning in `disproof.log`)
anything else — a non-object row, a non-numeric or unasked id, a verdict outside the three — and
never raises. A reason is cut to its first sentence and 20 words. A finding asked about with no
usable answer is `checked: null` and counted as `failed`; the pass is `partial` when some answered
and `failed` when none did. `rs_review_schema.normalize_checked` drops a malformed `checked` at
load, so a hand-edited or older file still renders.

### The badge rule, as implemented (`rs_confidence.badge`, `src/confidence.ts`)

| Level | Rule |
| --- | --- |
| **Checked** | evidence `pass` **and** verdict `stands` **and** (calibration usable → keep-rate ≥ 70%) |
| **Likely** | evidence `pass` with no verdict or `weakened`; or evidence not checked (`None`, or only `path_not_in_diff`) with no `refuted`; or `stands` with a usable keep-rate in [40, 70) |
| **Maybe** | evidence `warn`, or verdict `refuted`, or a usable keep-rate < 40% |

Evaluation order is Maybe → Checked → Likely, so a Maybe condition always wins. **Evidence
states:** `rs_evidence.check()` returning `None` (GitHub gave no diff) is *not checked*, not PASS
(lane 1's note). **Deviation from the table's "any evidence WARN":** a lone `path_not_in_diff`
flag is also *not checked* rather than WARN. Lane 1 defined that case as legitimate and
un-checkable (a test outside the diff that now asserts the wrong thing), and it pre-selects; a
reading where it is Maybe would have un-ticked the product's most-cited kind of finding and
moved the shipped PR fixture's nit into the tray, churning every spec that uses it. Such a
finding cannot earn *Checked* (there is nothing to check it against) and reads *Likely: the
file is outside this diff, so its lines could not be checked*. Every other single flag
(`lines_not_in_diff`, `symbol_not_found`, `no_contrast`) and any two flags are WARN → Maybe —
which is **stricter** than lane 1 for those single flags (lane 1 demoted at two). The two-flag
demotion stays as it was; `low` is written from `confidence == low or demoted(evidence) or
is_maybe(badge)`, so older clients still sort the tray correctly and `preselect` follows it.

The self-report is **not an input**: `badge()` has no parameter for it (pinned by a test). It
still steers the tray (`confidence == low`) and sits under "More" as *The run's own estimate ·
high confidence*; with no badge at all (an older server) the head shows it as before.

**Reason line** (one sentence, parts joined by commas): evidence — *the cited lines exist [and
mention `x`, `y`]* / the evidence note lower-cased / *the file is outside this diff, so its
lines could not be checked* / *the diff could not be checked*; disproof — *a second pass could
not disprove it* / *a second pass weakened it: …* / *a second pass refuted it: …* / *no second
pass for this severity* (the pass ran, not on this one) / *the second pass failed*; calibration
— *reviewers kept 85.0% of findings like this here* (one decimal, only when usable).

### Calibration (`rs_learn`)

`record()` writes `confidence`, `evidence` (the status the render computed; `_learn` recomputes
it with `rs_evidence.check` against the cached anchors) and `checked` (the verdict) on each
row, only when known. `_apply_row` adds two additive tally keys under `calibration`:
`confidence["<skill>|<repo>|<high|medium|low|unknown>"]` and `evidence["pass|warn|unknown"]`,
each a kept/edited/dropped slot. `TOTALS_VERSION` stays 1: an old tally lacks the key until the
next decision, `rebuild_totals` seeds it, old rows land in `unknown`, dry decisions are in no
bucket, and a retry under the same key moves its rows. `calibration()` (exposed as
`/api/learnings.calibration`) lists every bucket with `n`, `keepRate` and `ratable` (n ≥ 20),
the install-wide buckets per confidence, the evidence buckets, and `separates` — `True`/`False`
when both high and low are ratable and `|high − low| ≥ 10` points, `None` otherwise — with the
one sentence the Learnings page shows when it is not `True`. `calibration_for(skill, repo,
confidence)` is the badge's input: `usable` iff the bucket is ratable and the pair's separation
is not known to be `False` (when it cannot be judged yet the bucket still counts — the design
falls back only when the buckets *do not* separate).

### The Learnings table

`CalibrationTable` (exported from `Learnings.tsx`): *What reviewers kept, by confidence* —
one row per confidence with decisions and kept %, buckets under 20 marked *(under 20)*, a
collapsed per-skill (and per-repo, on a multi-repo install) breakdown, the evidence-check line,
and under it either the server's sentence (*The model's confidence does not separate here:
reviewers kept 75.0% of high-confidence findings and 70.8% of low-confidence ones, 4.2 points
apart. The badge uses the evidence check and the second pass only.* / *Not enough decisions
yet …*) or one saying it separates. Renders nothing with no decisions or on an older server.

## What shipped

| File | Change |
| --- | --- |
| `bin/rs_disproof.py` | new — modes, selection, the brief, `parse`, `merge`, the `select` / `merge` CLI |
| `bin/rs_confidence.py` | new — `evidence_state`, `badge`, `is_maybe`, the fixture CLI |
| `bin/run-disproof.sh` | new — the second pass: same `agent_env`, deny list, model; `disproof.log`; the `disproof_run` tallies; exits 0 always |
| `bin/run-review.sh` | calls it after the normaliser, re-fingerprints the PR, `second pass:` status |
| `skills/pr-disproof/SKILL.md` | new — the opposite brief and its writing rules |
| `bin/rs_review_schema.py` | `CHECK_VERDICTS`, `normalize_checked`, `normalize_disproof` |
| `bin/rs_learn.py` | signals on the row, the `calibration` tally, `calibration()`, `calibration_for()` |
| `bin/rs_telemetry.py` | `disproof_run{verdict ∈ stands, weakened, refuted, failed}` |
| `bin/server.py` | imports; `RS_DISPROOF` from `checkAll`; cache key; `runForm.disproof`; the fifth phase; `checked` + `badge` per finding and `disproof` on the review; the Maybe fold into `low` / `preselect`; `_learn` passes evidence; `api_learnings.calibration` |
| `dashboard-ui/src/api.ts` | `Checked`, `Badge`, `DisproofData`, `CalibrationData`; `api.review(…, checkAll)` |
| `dashboard-ui/src/confidence.ts` | new — the TS port for the replay |
| `dashboard-ui/src/ReviewParts.tsx` | `TrustBadge`, `TrustLine`, `CheckedLine`, `SelfReport`; the head and rows on the desk card |
| `dashboard-ui/src/PhoneReview.tsx` | the same on the phone card |
| `dashboard-ui/src/PrPage.tsx` | the **Check all findings** switch and helper text; the second-pass note on the progress panel |
| `dashboard-ui/src/Learnings.tsx` | `CalibrationTable` |
| `dashboard-ui/src/replay/{types,map}.ts` | `checked` on fixture comments, `disproof` on the review, the badge in `mapFindings` |
| `dashboard-ui/fixtures/replay/*.json` | `checked` on findings 0 (`stands`) and 1 (`weakened`), none on the nit; a `disproof` record |
| `dashboard-ui/scripts/stage-fixture.mjs`, `src/stage/fixture.json` | `checked`, `badge`, `disproof`, five phases from the Python CLIs |
| `dashboard-ui/e2e/fixture.ts` | PR #38849: `stands` on the should-fix, a `disproof` record; PR6: `stands` / `weakened` / `refuted` and a record |
| `dashboard-ui/src/Privacy.tsx`, `website/…/security/telemetry.md` | the `disproof_run` row |
| `website/…/guides/reviewing.mdx` | the run-form row, the status phase, the card rows 7–8, **What the badge means** |
| `website/…/operations/configuration.md` | `RS_DISPROOF`; the toggle is not a setting |
| `website/…/developers/architecture.md`, `docs/ARCHITECTURE.md` | the pass and the badge |

Tests: `bin/test_rs_confidence.py` (new, 20: evidence states, every row of the table and the
gaps between rows, reason lines, no self-report parameter, stdlib-only), `bin/test_rs_disproof.py`
(new, 17: selection by mode, the brief, clean / tolerant / malformed answers, the 20-word cut,
merge statuses, the normaliser, the CLI round trip, stdlib-only), `bin/test_rs_learn.py`
`Calibration` (+9: signals on rows, additive keys and `unknown`, dry rows, small n, separating,
not separating, exactly ten points, the evidence readout, retry), `bin/test_rs_telemetry.py`
`DisproofCounter` (+1), `bin/test_rs_job_scripts.py` `DisproofPass` (+5: the verdict lands and
the pass has no GitHub credential, `all`, `off`, a bad answer never fails the review, a write
during the pass is a security failure), `bin/test_rs_post.py` `ConfidenceBadgeInThePayload`
(+5: the three levels and the tray fold, calibration from 20 decisions, the learning row's
signals and `/api/learnings`, the run form's estimate, the cache key) and the updated older
review test; dashboard `src/confidence.test.ts` (new, 6, incl. parity with the Python output),
`src/learnings.test.ts` (new, 3), `src/findingCard.test.ts` (+4), `src/replay.test.ts`,
`src/stage.test.ts`, `src/api.test.ts`, `src/telemetry.test.ts` updated; Playwright
`pr-page.spec.ts` (the head badge, the reason and Checked lines, the self-report under More, the
PR6 rule-table matrix with the tray, the **Check all findings** toggle end to end against the
real server), `mobile-screens.spec.ts`, `replay.spec.ts`.

## How this is proven

The real-GitHub scenario this would have caught: a run reports `confidence: high` on *"the
`retry()` loop never resets `attempts`"*, the cited lines exist and mention `attempts`, and the
reviewer posts it — but `resetAttempts()` runs two functions up, after every 2xx. Part 1 passes
it (the evidence is in the diff). The second pass opens `retry.ts`, finds the reset, answers
`refuted: "resetAttempts() at retry.ts:71 runs after a 2xx."`, and the card reads **Maybe: the
cited lines exist and mention `attempts`, a second pass refuted it: …**, un-ticked, in the
tray. The reverse — a real finding the first pass nailed — reads **Checked** with the reason,
and after 20 decisions on that skill and repository the line adds what reviewers actually kept.
PR6 of the e2e fixture carries both, served by the real `bin/server.py` against the fake `gh`;
`test_rs_job_scripts.DisproofPass` runs the real `run-review.sh` with a fake `claude` that
answers the second brief and a fake `gh` that would record any write.

## Gates (10/11/26)

See the branch report; counts are recorded in the commit message of the gate commit.

## Out of scope, left open

- The badge's calibration input is per (skill, repo, confidence) only; the per-evidence buckets
  are a readout, not a badge input yet.
- No measured median for the second pass's duration — the estimate is the fixed 40 s per
  finding; `rs_rollup` could learn it from `disproof.duration_ms` as it does for efforts.
- The pass does not run on the stacked-review route (`/api/stack/run`), which always runs
  `default`; there is no toggle there.
- A review reused from the cache before this lane shows no badge reason beyond the evidence;
  re-run to get the second pass.
- The public benchmark the calibration data is for (design §2.2) — later.
