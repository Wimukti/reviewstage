# Lane 1 — plain language, the reading guide, where/what to check, the evidence check

Proposal, design decisions, what shipped and what Part 2 needs, in one file. `design.md` Part 1
(§1.1–§1.5) is the brief; where this file differs from it, this file says what is actually in
the tree. Built on branch `tp1-plain` (10/11/26), on top of p0-proof lanes 2 and 3.

## Why

The maintainer's brief: people use AI review because they cannot read the diff, and after the
review they do not read much. A finding card after lane 3 told them *what* (title), *who it
hurts* (impact) and *how to verify* (one line), in prose the model chose. It did not show them
the lines, did not tell them exactly what to look for in those lines, and gave them no signal
about the finding that was not the model's own opinion of itself. The output was also hard to
read: long sentences, hedges, noun strings.

This lane adds four things, all computed locally or by the run the user already pays for:

1. **Writing rules** (Simplified Technical English, §1.1) in the prompt and a linter that counts
   how often the run breaks them.
2. A **Reading guide** (§1.2) above the findings: what the PR does, why, a fixed risk word, the
   hunks to read in order, what was not reviewed.
3. **Where / what to check / expected / actual** on each card (§1.3), with the cited diff lines
   rendered inline.
4. A **deterministic evidence check** (§1.4) on every finding against the PR's own diff, whose
   result is one line on the card and the first "extra signal" that overrides the model's
   self-reported confidence.

## Non-negotiable properties touched

**Property 1** (the review step has no GitHub write path): the linter runs inside
`run-review.sh` through `rs_review_schema.py`, which stays dependency-free (`json`, `os`, `re`,
`sys`; pinned by a test). `rs_evidence.py` is also stdlib-only and imports nothing that can
reach GitHub (pinned by a test); it runs in the server's render path and in a CLI used to build
fixtures. Nothing else is touched: nothing new posts, nothing runs unasked, the run still uses
the clicker's account, every reviewer's `review.json` is still their own.

## Design decisions

### Where the evidence check runs: the server

`_review_data` already asks `pr_anchors()` for the PR's files payload (`gh api pulls/N/files`,
with each file's `patch`) to decide anchorability. `rs_diff.Anchors` now keeps those patches
(`Anchors.patches`, including the ones recovered from `gh pr diff` for files GitHub withheld),
and `rs_evidence.annotate()` runs against them, once, in `_review_data`. So the verdict the
card shows is the one that decided the pre-selection — the "maybe" tray decision is made once,
server-side, as the brief asked. When GitHub would not give the diff at all (`anchors is None`)
the evidence is `null`, the card shows no line, and nothing is demoted: no evidence either way.

The one place without a server is the public replay (`/try`). `src/evidence.ts` is a pure
TypeScript port used only by `src/replay/map.ts`; `src/evidence.test.ts` and the parity test in
`src/replay.test.ts` hold it to the Python module's own output, because `scripts/stage-fixture.mjs`
now runs `python3 bin/rs_evidence.py` and writes its answer into `src/stage/fixture.json`.

### The guide block is `guide`, not `summary`

`design.md` §1.2 spells the block `"summary": {…}`. `summary` is already the verdict string —
the post body, the Slack card, the history view and `_as_markdown` all read it — so a dict there
would have reached GitHub as `{'does': …}`. The contract asks the model for `"guide"`; the
normaliser also accepts `reading_guide` and the design's spelling (an object in `summary`),
moving it to `guide` and deriving a one-line verdict (`does` + `Risk: …`) so `summary` stays a
string for every other reader. On the wire it is `ReviewData.guide`.

### `where` is derived, `path`/`line` stay authoritative

The post path anchors on `path` and `line`; `review_key` hashes them. `where = {path, start,
end}` is derived from them plus an optional `end_line` (also `end`, `line_end`, `lines:
"44-51"`, or a `where` object), never the other way round, so a run that emits a range cannot
move a comment. The card reads `path:start-end` from `where`.

### Evidence rules, as implemented

| Check | Flag | Note |
| --- | --- | --- |
| cited path is a changed file | `path_not_in_diff` | one flag alone never demotes: a finding about a test outside the diff is legitimate (the product's own docs call it the most valuable kind) and only *un-checkable* here |
| cited lines fall in a hunk | `lines_not_in_diff` | only when the path is in the diff and its patch is known; a withheld patch yields "its lines could not be checked" |
| a backticked identifier from `title` / `what_to_check` is in the cited lines | `symbol_not_found` | matched against the 8–12-line snippet window the card shows (word-bounded); a finding that quotes nothing is not flagged |
| a `blocker` has both `expected` and `actual` | `no_contrast` | **not applied to a pre-contract finding** (none of `what_to_check` / `expected` / `actual`): an older review must render exactly as it did, and the rule is in the prompt only for runs that know it |

Two or more flags → `low: true` (the maybe-tray signal older clients already read),
`preselect: false`. The model's `confidence` is still sent and still shown.

### Writing rules

The linter is warnings only (`plain:` marker): sentence over 20 words (instructions:
`how_to_verify`, `what_to_check`) or 25 (everything else, including `summary` and the guide),
hedges anywhere. It strips a *trailing* hedge (", I think" / "(perhaps)") and collapses double
spaces; it never shortens a sentence. `run-review.sh` greps the count into a new
`plain_warnings` telemetry counter (schema, Privacy page and telemetry.md updated). The prompt
carries a compact "Write like this" block with the limits, the fixed severity words and six
before → after pairs; `SKILL.md` Step 7 carries the same.

### The card

Rows top to bottom, both cards: title (+ severity, confidence in the head) · **Where**
(`path:start-end`, copyable, then the snippet with added lines highlighted, removed lines
struck, cited lines marked) · **What to check** · **Expected / Actual** · **Why it matters** ·
**Evidence**. The path left the head for the Where row. `how_to_verify` stands in for *What to
check* on a review without one; when a run gave both, the verify line moves under "Edit
comment" (the card's "More" — the raw body already lived there). Nothing was renamed.

### The Reading guide

`ReadingGuide` in `ReviewParts.tsx`: header (title, risk word as a badge), collapsible, open by
default, a one-line peek when closed. Rows are buttons: PrPage resolves a row to the first
finding on that path (overlapping the lines when the row names them), scrolls that card into
view and opens the maybe tray if that is where it lives; with no card on that path it opens the
PR's Files tab on GitHub. Sits inside `post-panel` (not above it): the commit bar is sticky to
that container, and a guide outside it pushed the container's top below a 560 px fold. On the
phone it is the first card.

## What shipped

| File | Change |
| --- | --- |
| `bin/rs_review_schema.py` | linter (`lint_text`, `plain`, hedges, limits), `normalize_where`, `normalize_guide`, `summary`-as-object handling, `what_to_check` / `expected` / `actual` |
| `bin/rs_evidence.py` | new — hunks, snippet, symbols, `check`, `demoted`, `annotate`, CLI |
| `bin/rs_diff.py` | `Anchors.patches`; `full_diff_patches()` |
| `bin/server.py` | `import rs_evidence`; `_review_data` runs the check, sends `where`, `whatToCheck`, `expected`, `actual`, `snippet`, `evidence`, `guide`; `low`/`preselect` fold the demotion; `_guide_data` |
| `bin/run-review.sh` | CONTRACT: `guide`, `end_line`, `what_to_check`, `expected`, `actual`, the WRITE LIKE THIS block; `plain_warnings` tally |
| `bin/rs_telemetry.py` | `plain_warnings` event |
| `skills/pr-review/SKILL.md` | Step 7 block and "Write like this" |
| `bin/demo-fixture.py` | guide and the new fields on the demo PR |
| `dashboard-ui/src/api.ts` | `Where`, `Snippet`, `Evidence`, `GuideData`, `ReadPlanRow`; `Finding` and `ReviewData` fields |
| `dashboard-ui/src/evidence.ts` | new — the TS port for the replay |
| `dashboard-ui/src/ReviewParts.tsx` | `locOf`, `DiffSnippet`, `WhereRow`, `WhatToCheck`, `Contrast`, `EvidenceLine`, `ReadingGuide`; card rows reordered; `data-finding` |
| `dashboard-ui/src/PhoneReview.tsx` | same rows in the closed card |
| `dashboard-ui/src/PrPage.tsx` | the guide in both layouts, `jumpTo` |
| `dashboard-ui/src/replay/{types,map}.ts` | fixture fields, `whereOf`, `guideOf`, evidence in `mapFindings` |
| `dashboard-ui/fixtures/replay/*.json` | a guide on each, `what_to_check` / `expected` / `actual` on every finding (cache-stale-read's first finding moved to line 18, the `cache.delete` line) |
| `dashboard-ui/e2e/fixture.ts` | guide + fields on #38849; **PR6 (#38853)** — the evidence matrix with its own fake-gh files answer |
| `dashboard-ui/scripts/stage-fixture.mjs`, `src/stage/fixture.json` | the Python CLI's reading of where / evidence / snippet / guide |
| `dashboard-ui/src/Privacy.tsx`, `website/…/security/telemetry.md` | the `plain_warnings` row |
| `website/…/guides/reviewing.mdx` | the Reading guide, the card rows, "How to read a finding" |
| `docs/ARCHITECTURE.md` | the field list and the evidence step |

Tests: `bin/test_rs_review_schema.py` (+23: limits, hedges, trailing strip, where, guide, the
`summary` object, idempotence), `bin/test_rs_evidence.py` (new, 21: hunks, snippet window,
symbols, every flag, pass, pre-contract blocker, withheld patch, missing fields, no diff, CLI,
import list), `bin/test_rs_post.py` (+5: payload fields, two-flag demotion, one-flag warning,
old review, no diff), `bin/test_rs_prompts.py` (+4), `bin/test_rs_job_scripts.py` (+1);
`dashboard-ui/src/findingCard.test.ts` (+8: §1.3 row order on both cards, snippet, evidence
line, contrast, old finding unchanged, guide render/collapse/tones), `src/evidence.test.ts`
(new, 6, incl. parity with the Python output), `src/replay.test.ts` and `src/stage.test.ts`
extended; Playwright: `pr-page.spec.ts` (card rows, the guide, the PR6 matrix),
`mobile-screens.spec.ts` (card rows, guide first card, 44 px targets, no sideways scroll),
`replay.spec.ts` (guide and rows with no server).

## How this is proven

The real-GitHub scenario this would have caught: a run names `src/billing/retry.ts:44` and a
symbol `attempts` that is not on those lines (the model read a sibling file), with
`confidence: high`. Before, the card showed a confident sentence and the finding was pre-ticked;
now the evidence line reads *`attempts` does not appear in the cited lines* under the actual
lines, and a second miss (a blocker with no expected/actual) un-ticks it. The reverse scenario —
a legitimate finding on a test file outside the diff — stays ticked with one warning. Both are
in PR6 of the e2e fixture, served by the real `bin/server.py` against the fake `gh`.

## What Part 2 needs (not renamed, not reshaped)

- `evidence: {status, flags, line, symbols}` is an object per finding; Part 2 adds `checked`
  beside it (the disproof result and the reason line) and reads `evidence.status` as one input
  to the three-level badge. `ConfidenceBadge` is the thing to replace; `EvidenceLine` stays.
- `low` is the tray signal; Part 2 should keep writing it from its own rule table so older
  clients still sort correctly.
- `rs_evidence.check()` returns `None` when there is no diff; Part 2's table must treat that as
  "evidence not run", not PASS.
- The guide's `risk` vocabulary is `RISKS` in `rs_review_schema.py`; the badge's reason line can
  quote it.
- Calibration (2.2) wants the evidence result on the learning row: `rs_learn.record` does not
  store it yet — Part 2 adds `row["evidence"]` next to `row["reason"]`.

## Out of scope, left open

- Screenshot for "How to read a finding" (text only shipped; the hero shot still shows the
  card from lane 3's layout).
- Linting noun-string length and the fixed severity words (the prompt carries them; the linter
  counts sentences and hedges only).
- Posting `what_to_check` / `expected` / `actual` to GitHub; they are for the human gate.
- A per-run toggle to turn the evidence demotion off.
