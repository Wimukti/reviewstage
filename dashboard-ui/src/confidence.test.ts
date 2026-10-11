// src/confidence.ts is a port of bin/rs_confidence.py for the server-less replay. It is held
// to the Python module's own output: src/stage/fixture.json carries `badge` as the Python CLI
// computed it for the e2e fixture (scripts/stage-fixture.mjs), and this test recomputes it
// here from the same evidence and verdicts. The rule table below mirrors
// bin/test_rs_confidence.py row for row.
import assert from "node:assert/strict";
import { test } from "node:test";
import stage from "./stage/fixture.json" with { type: "json" };
import type { Badge, Checked, Evidence } from "./api";
import { badge, CHECKED_RATE, evidenceState, isMaybe, MAYBE_RATE } from "./confidence";

const PASS: Evidence = { status: "pass", flags: [], line: "The cited lines are in this diff and mention `attempts`.", symbols: ["attempts"] };
const PASS_PLAIN: Evidence = { status: "pass", flags: [], line: "The cited lines are in this diff.", symbols: [] };
const WARN_LINES: Evidence = { status: "warn", flags: ["lines_not_in_diff"], line: "Lines 80 are not in this PR's changes to `Retry.php`.", symbols: [] };
const WARN_TWO: Evidence = { status: "warn", flags: ["path_not_in_diff", "no_contrast"], line: "`Nope.php` is not a file this PR changes. A blocker needs both Expected and Actual.", symbols: [] };
const OFF_DIFF: Evidence = { status: "warn", flags: ["path_not_in_diff"], line: "`src/javascripts/Badge.tsx` is not a file this PR changes.", symbols: [] };
const STANDS: Checked = { verdict: "stands", reason: "No reset of `attempts` after a 2xx anywhere.", at: 1 };
const WEAK: Checked = { verdict: "weakened", reason: "Only the 6th call is lost, not every retry.", at: 1 };
const REFUTED: Checked = { verdict: "refuted", reason: "`resetAttempts()` at retry.ts:71 runs after a 2xx.", at: 1 };
const GOOD = { keepRate: 85, n: 30, usable: true };
const MID = { keepRate: 55, n: 30, usable: true };
const BAD = { keepRate: 30, n: 30, usable: true };
const SMALL = { keepRate: 100, n: 5, usable: false };
const DONE = { status: "done" };

test("the port agrees with the Python module on the e2e fixture (badge level and reason)", () => {
  for (const [i, f] of stage.review.findings.entries()) {
    const ours = badge(f.evidence as Evidence | null, f.checked as Checked | null, null, stage.review.disproof);
    const theirs = f.badge as Badge;
    assert.equal(ours.level, theirs.level, `level[${i}]`);
    assert.equal(ours.label, theirs.label, `label[${i}]`);
    assert.equal(ours.reason, theirs.reason, `reason[${i}]`);
    assert.deepEqual(ours.inputs, theirs.inputs, `inputs[${i}]`);
  }
  assert.deepEqual(stage.review.findings.map((f) => f.badge.level), ["checked", "likely"]);
});

test("evidence state: pass, warn, not checked; a lone off-diff flag is not checked", () => {
  assert.equal(evidenceState(PASS), "pass");
  assert.equal(evidenceState(WARN_LINES), "warn");
  assert.equal(evidenceState(WARN_TWO), "warn");
  assert.equal(evidenceState(null), "none");
  assert.equal(evidenceState(OFF_DIFF), "none");
  assert.equal(badge(OFF_DIFF, STANDS).level, "likely");
});

test("rule table — Checked", () => {
  assert.equal(badge(PASS, STANDS).level, "checked");
  assert.equal(badge(PASS, STANDS, GOOD).level, "checked");
  assert.equal(badge(PASS, STANDS, { keepRate: CHECKED_RATE, n: 20, usable: true }).level, "checked");
  assert.equal(badge(PASS, STANDS, SMALL).level, "checked");
  assert.equal(badge(PASS, STANDS, { keepRate: 10, n: 50, usable: false }).level, "checked");
});

test("rule table — Likely", () => {
  assert.equal(badge(PASS).level, "likely");
  assert.equal(badge(PASS, null, null, DONE).level, "likely");
  assert.equal(badge(PASS, WEAK).level, "likely");
  assert.equal(badge(PASS, WEAK, GOOD).level, "likely");
  assert.equal(badge(PASS, STANDS, MID).level, "likely");
  assert.equal(badge(PASS, STANDS, { keepRate: 69.9, n: 20, usable: true }).level, "likely");
  assert.equal(badge(null).level, "likely");
  assert.equal(badge(null, STANDS).level, "likely");
  assert.equal(badge(null, STANDS, GOOD).level, "likely");
});

test("rule table — Maybe", () => {
  for (const ev of [WARN_LINES, WARN_TWO]) {
    assert.equal(badge(ev).level, "maybe");
    assert.equal(badge(ev, STANDS, GOOD).level, "maybe");
  }
  assert.equal(badge(PASS, REFUTED).level, "maybe");
  assert.equal(badge(PASS, REFUTED, GOOD).level, "maybe");
  assert.equal(badge(null, REFUTED).level, "maybe");
  assert.equal(badge(PASS, STANDS, BAD).level, "maybe");
  assert.equal(badge(PASS, null, { keepRate: MAYBE_RATE - 0.1, n: 20, usable: true }).level, "maybe");
  assert.equal(badge(PASS, null, { keepRate: MAYBE_RATE, n: 20, usable: true }).level, "likely");
  assert.equal(isMaybe(badge(WARN_LINES)), true);
  assert.equal(isMaybe(badge(PASS)), false);
  assert.equal(isMaybe(null), false);
});

test("reason lines read as the Python module writes them: the one verdict row under Evidence", () => {
  assert.equal(badge(PASS, STANDS, GOOD).reason, "Checked: Stands. No reset of `attempts` after a 2xx anywhere. Reviewers kept 85.0% of findings like this here.");
  assert.equal(badge(PASS, STANDS).reason, "Checked: Stands. No reset of `attempts` after a 2xx anywhere.");
  assert.equal(badge(WARN_LINES).reason, "Maybe: Lines 80 are not in this PR's changes to `Retry.php`.");
  assert.equal(badge(WARN_TWO, null, null, DONE).reason, "Maybe: `Nope.php` is not a file this PR changes. A blocker needs both Expected and Actual.");
  assert.equal(badge(PASS, REFUTED).reason, "Maybe: Refuted. `resetAttempts()` at retry.ts:71 runs after a 2xx.");
  assert.equal(badge(PASS_PLAIN, WEAK).reason, "Likely: Weakened. Only the 6th call is lost, not every retry.");
  assert.equal(badge(PASS_PLAIN).reason, "Likely: No second pass ran.");
  assert.equal(badge(PASS_PLAIN, null, null, DONE).reason, "Likely: No second pass for this severity.");
  assert.equal(badge(PASS_PLAIN, null, null, { status: "failed" }).reason, "Likely: The second pass failed.");
  assert.equal(badge(null).reason, "Likely: The diff could not be checked. No second pass ran.");
  assert.equal(badge(OFF_DIFF, null, null, DONE).reason, "Likely: No second pass for this severity.");
  assert.equal(badge(PASS_PLAIN, null, MID, DONE).reason, "Likely: No second pass for this severity. Reviewers kept 55.0% of findings like this here.");
  // Never a restatement of the Evidence row.
  for (const ev of [PASS, PASS_PLAIN, OFF_DIFF]) for (const chk of [STANDS, WEAK, null]) {
    assert.doesNotMatch(badge(ev, chk, null, DONE).reason, /cited lines|outside this diff/);
  }
  assert.deepEqual(badge(PASS, STANDS, GOOD).inputs, { evidence: "pass", disproof: "stands", keepRate: 85, n: 30 });
});
