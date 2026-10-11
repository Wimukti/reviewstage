# trust-and-plain — earned confidence, plain language, where/what to check

Maintainer's brief (10/11/26): "people use AI review because they can't actually read the diff,
and after the review they don't read much. Tell them the confidence in a maximum way, using extra
signals so the confidence is more likely right. For each issue show where to check, what to
check, and a really simple interpretation. The output is hard to read: use Simplified Technical
English (ASD-STE100) or similar everywhere — summary of the PR, the diffs, the findings. Easy to
use and trustworthy."

Non-negotiables (openspec/config.yaml) hold: private draft, human chooses, posted as the human,
approve is a separate click, the drafting agent cannot write to GitHub. Nothing new leaves the
machine: every signal below is computed locally or by the user's own Claude.

## Part 1 — plain language, reading plan, evidence check, the card (lane `tp1-plain`)

### 1.1 Writing rules (STE-derived), enforced in the prompt and linted in the normaliser

Apply to every string the review emits (`title`, `impact`, `how_to_verify`, `what_to_check`,
PR summary, reading-plan reasons):

- One sentence, one idea. Max **20 words** per sentence for instructions, **25** for descriptions.
- Active voice, present tense, imperative for instructions ("Open… Check that…").
- Name the thing, not the abstraction: "the `retry()` loop" not "the retry logic implementation".
- No noun strings longer than three words. No hedges ("might possibly"), no filler ("it should be
  noted"). No jargon the diff itself does not use.
- Severity words are fixed: *breaks*, *can break*, *wrong*, *slow*, *unclear*, *style*.
- The reader is a reviewer who has not read the diff: every `title` must be understandable alone.

Linter (`bin/rs_review_schema.py`): count words per sentence and flag > limits as `warnings`
(never reject); strip trailing hedges; collapse double spaces. Warnings go to agent.log and to a
`plain.warnings` counter (telemetry local counters) so we can see whether the prompt obeys.

### 1.2 New top-of-review fields (contract + normaliser + API + UI)

```json
"summary": {
  "does": "One sentence: what this PR changes, for a reader who has not opened it.",
  "why":  "One sentence from the PR body / linked issue, or null if the PR does not say.",
  "risk": "breaks | can break | safe-looking | unclear",
  "read_plan": [
    {"path": "src/billing/retry.ts", "lines": "40-72", "why": "The retry loop changed. Everything else depends on it."},
    {"path": "src/billing/retry.test.ts", "lines": "1-60", "why": "The tests show which cases the author thought about."}
  ],
  "not_covered": ["generated files", "lockfile"]
}
```

Render as a **Reading guide** card above the findings: *What this PR does · Why · Read in this
order (click a row → the hunk) · Not reviewed*. Collapsible; open by default on first view; the
phone shows it as the first card. This is Stage's "chapters" value, produced by the run we
already pay for.

### 1.3 Per-finding: where to check, what to check (contract + card)

Add to each finding:

```json
"where": {"path": "…", "start": 44, "end": 51},          // normalised from path:line
"what_to_check": "Open retry.ts lines 44–51. Check that `attempts` resets after a success.",
"expected": "attempts goes back to 0 after a 2xx.",
"actual":   "attempts keeps counting; the 6th call after a success is never made."
```

Card layout (desktop and phone), top to bottom, in this order and no other rows:
1. **Title** (plain, ≤ 20 words) + severity word + confidence badge (see Part 2)
2. **Where**: `path:start-end` → the 8–12 cited diff lines rendered inline with the changed lines
   highlighted (no need to open the diff)
3. **What to check**: the one imperative sentence
4. **Expected / Actual**: two short lines
5. **Why it matters**: one sentence (`impact`)
6. **Evidence check** line (1.4) and, in Part 2, the "Checked" line

Everything else (raw body, model explanation) lives under "More".

### 1.4 Deterministic evidence check (local, no model)

For every finding, before render:
- cited `path` exists in the PR's changed files → else flag `evidence: path_not_in_diff`
- cited lines fall inside a hunk of that file → else `evidence: lines_not_in_diff`
- at least one identifier quoted in backticks in `title`/`what_to_check` appears in the cited
  lines → else `evidence: symbol_not_found`
- severity *breaks* requires `expected` and `actual` both present → else `evidence: no_contrast`

Result on the card: "Evidence: the cited lines exist and mention `attempts`" (PASS) or a plain
reason (WARN). A finding with two or more WARNs is **not pre-selected** and is sorted to the
"maybe" tray, whatever the model's self-reported confidence says. This is the first "extra
signal" the maintainer asked for, and it costs nothing.

### 1.5 Tests and gates

Python: linter (limits, hedges), summary normalisation, evidence check matrix (each flag, pass
case, missing fields). Dashboard: Reading guide renders and collapses; card order; inline snippet;
phone first card. Playwright: PR page and mobile specs. Fixtures: one PR with a reading plan, one
finding with each evidence flag, old-shape review renders unchanged. Docs: `reviewing.mdx` gets a
"How to read a finding" section with a screenshot; the skill's SKILL.md carries the writing rules.

## Part 2 — earned confidence (lane `tp2-confidence`, after Part 1 merges)

The badge is **three levels with a reason line**, never a bare percentage until measured:

| Shown | Rule |
| --- | --- |
| **Checked** | evidence PASS **and** disproof pass says *stands* **and** (if ≥ 20 labelled findings for this skill+repo bucket) historical keep-rate ≥ 70% |
| **Likely** | evidence PASS and no disproof result (not run / low severity) **or** disproof *weakened* |
| **Maybe** | any evidence WARN, disproof *refuted*, or keep-rate < 40% |

Reason line examples: "Checked: the lines exist, a second pass could not disprove it, reviewers
kept 85% of findings like this here." · "Maybe: the cited lines are not in this diff."

### 2.1 Disproof pass

A second Claude run, same provider and account, opposite brief: *"Here is a finding and the
files it cites. Find the strongest reason it is wrong, already handled, or harmless. Answer
stands / weakened / refuted with one sentence."* Runs for *breaks* and *can break* findings by
default; a per-run toggle "Check all findings" runs it for every one. Output stored with the
review; the card shows "Checked: stands — the second pass found no handling of a 2xx reset."
Never posts anything. Cost: one more run on the user's plan; show the estimated time.

### 2.2 Calibration readout

From `rs_learn` tallies: keep-rate per (skill, repo, self-reported confidence) and per
(evidence result). Exposed in `/api/learnings` and shown (a) on the badge reason line when
n ≥ 20, (b) on Learnings as a small table "What reviewers kept, by confidence". When the buckets
do not separate (high ≈ low), the Learnings page says so plainly and the badge falls back to
evidence + disproof only. This is the data for the public benchmark.

### 2.3 Self-report stays an input, not the output

The model's `confidence` is still requested (it steers the "maybe" tray before other signals
exist) but it is never shown alone once Part 2 ships.

### 2.4 Tests

Rule table (every row), disproof result parsing, calibration bucketing with small n, reason-line
wording, Playwright for the badge states and the "Check all findings" toggle.

## Out of scope here
Any third-party judge model (Jev etc.): new destination for code; revisit only with ≥ 200
labelled findings and an opt-in path. Comparison page: later, per the maintainer.
