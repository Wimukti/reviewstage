// src/evidence.ts is a port of bin/rs_evidence.py for the server-less replay. It is held to the
// Python module's own output: src/stage/fixture.json carries `where`, `evidence` and `snippet`
// as the Python CLI computed them for the e2e fixture (scripts/stage-fixture.mjs), and this test
// recomputes them here from the same review and hunks. The matrix below mirrors
// bin/test_rs_evidence.py flag for flag.
import assert from "node:assert/strict";
import { test } from "node:test";
import stage from "./stage/fixture.json" with { type: "json" };
import { annotate, check, demoted, hunks, newLines, patchesOf, snippet, symbols, whereOf } from "./evidence";

// The e2e fixture's PR #38849 (dashboard-ui/e2e/fixture.ts): its one patch and the two findings.
const E2E_FILES = [{ filename: "app/models/Product.php", status: "modified", patch: "@@ -40,3 +40,4 @@\n ctx\n+$leadTime = $vendor->leadTime();\n ctx2\n ctx3\n" }];
const E2E_COMMENTS = [
  {
    path: "app/models/Product.php", line: 42, severity: "should-fix",
    title: "A product with no vendor can crash the lead-time badge",
    what_to_check: "Open Product.php line 42. Check that `$vendor` is null-guarded before `leadTime()`.",
    expected: "A product with no vendor shows no badge.", actual: "The badge throws on a null vendor.",
  },
  { path: "src/javascripts/Badge.tsx", line: 10, severity: "nit", title: "Use const instead of let" },
];

test("the port agrees with the Python module on the e2e fixture (where, evidence, snippet)", () => {
  const patches = patchesOf(E2E_FILES);
  for (const [i, c] of E2E_COMMENTS.entries()) {
    const ours = annotate({ ...c, where: whereOf(c) }, patches);
    const theirs = stage.review.findings[i];
    assert.deepEqual(whereOf(c), theirs.where, `where[${i}]`);
    assert.deepEqual(ours.evidence, theirs.evidence, `evidence[${i}]`);
    assert.deepEqual(ours.snippet, theirs.snippet, `snippet[${i}]`);
  }
});

const PATCH = [
  "@@ -14,9 +14,24 @@ import { backoffMs, MAX_ATTEMPTS } from \"./backoff\";",
  " import { DeliveryError } from \"./errors\";",
  " ",
  " export async function deliver(hook: Webhook, payload: Payload): Promise<void> {",
  "-  const res = await fetch(hook.url, { method: \"POST\" });",
  "-  if (!res.ok) throw new DeliveryError(res.status);",
  "+  let attempt = 0;",
  "+  while (true) {",
  "+    const res = await fetch(hook.url, {",
  "+      method: \"POST\",",
  "+      body: JSON.stringify(payload),",
  "+    });",
  "+    if (res.ok) return;",
  "+    attempt += 1;",
  "+    if (attempt >= MAX_ATTEMPTS) throw new DeliveryError(res.status, attempt);",
  "+    await sleep(backoffMs(attempt));",
  "+  }",
  " }",
  "+",
  "+const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));",
  "",
].join("\n");
const FILES = [{ filename: "src/webhooks/deliver.ts", status: "modified", patch: PATCH }, { filename: "src/webhooks/big.bin", status: "modified", patch: null }];
const PATCHES = patchesOf(FILES);

const finding = (over: Record<string, unknown> = {}) => {
  const c = {
    path: "src/webhooks/deliver.ts", line: 23, severity: "should-fix",
    title: "Every non-2xx is retried, even when `res.ok` can never become true",
    what_to_check: "Open deliver.ts line 23. Check which statuses return early.",
    expected: "A 404 stops after one request.", actual: "A 404 costs five requests.",
    ...over,
  } as Parameters<typeof check>[0];
  return { ...c, where: whereOf(c) };
};

test("hunks: new-side numbering, kinds, the trailing newline is not a line", () => {
  const lines = newLines(PATCH);
  assert.equal(lines.get(17), "  let attempt = 0;");
  assert.equal(lines.get(23), "    if (res.ok) return;");
  assert.equal(lines.get(30), "const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));");
  assert.equal(lines.has(31), false);
  const kinds = hunks(PATCH)[0].map((r) => r.kind);
  assert.equal(kinds.filter((k) => k === "del").length, 2);
  assert.equal(PATCHES.get("src/webhooks/big.bin"), null);
});

test("snippet: 8–12 lines around the cited range, cited rows marked, never across a hunk", () => {
  const s = snippet(PATCH, 23, 23)!;
  assert.ok(s.lines.length >= 8 && s.lines.length <= 12);
  assert.deepEqual(s.lines.filter((l) => l.cited).map((l) => l.n), [23]);
  const wide = snippet(PATCH, 17, 26)!;
  assert.deepEqual(wide.lines.filter((l) => l.cited).map((l) => l.n), [17, 18, 19, 20, 21, 22, 23, 24, 25, 26]);
  const two = "@@ -1,2 +1,2 @@\n a\n+b\n@@ -40,2 +40,3 @@\n c\n+d\n e\n";
  assert.deepEqual(snippet(two, 41, 41)!.lines.map((l) => l.text), ["c", "d", "e"]);
  assert.equal(snippet(PATCH, 200, 201), null);
  assert.equal(snippet(PATCH, null, null), null);
});

test("symbols: backticked identifiers in order, without repeats", () => {
  assert.deepEqual(symbols("The `retry()` loop never resets `attempts`", "Check `attempts` in `$vendor->leadTime()`"), ["retry", "attempts", "vendor", "leadTime"]);
  assert.deepEqual(symbols(null, "", "no ticks"), []);
});

test("the matrix: pass, each flag alone, two flags demote, missing data never flags", () => {
  const pass = check(finding(), PATCHES)!;
  assert.deepEqual(pass, { status: "pass", flags: [], line: "The cited lines are in this diff and mention `res`, `ok`.", symbols: ["res", "ok"] });
  assert.equal(demoted(pass), false);
  assert.deepEqual(check(finding({ title: "Every error is retried", what_to_check: "Open line 23." }), PATCHES), { status: "pass", flags: [], symbols: [], line: "The cited lines are in this diff." });

  const path = check(finding({ path: "src/other.ts" }), PATCHES)!;
  assert.deepEqual(path.flags, ["path_not_in_diff"]);
  assert.equal(path.line, "`src/other.ts` is not a file this PR changes.");
  assert.equal(demoted(path), false);

  const lines = check(finding({ line: 120, where: { path: "src/webhooks/deliver.ts", start: 120, end: 124 } }), PATCHES)!;
  assert.deepEqual(lines.flags, ["lines_not_in_diff"]);
  assert.equal(lines.line, "Lines 120 to 124 are not in this PR's changes to `deliver.ts`.");

  const sym = check(finding({ title: "The `jitter` is missing", what_to_check: "Check `MAX_JITTER`." }), PATCHES)!;
  assert.deepEqual(sym.flags, ["symbol_not_found"]);
  assert.equal(sym.line, "`jitter`, `MAX_JITTER` do not appear in the cited lines.");
  assert.deepEqual(check(finding({ title: "`attempts` never resets" }), PATCHES)!.flags, ["symbol_not_found"]);
  assert.deepEqual(check(finding({ title: "`attempt` never resets" }), PATCHES)!.flags, []);

  assert.deepEqual(check(finding({ severity: "blocker", expected: null }), PATCHES)!.flags, ["no_contrast"]);
  assert.deepEqual(check(finding({ severity: "blocker" }), PATCHES)!.flags, []);
  assert.deepEqual(check(finding({ severity: "blocker", what_to_check: null, expected: null, actual: null }), PATCHES)!.flags, [], "a pre-contract blocker is not flagged");
  assert.deepEqual(check(finding({ severity: "should-fix", expected: null, actual: null }), PATCHES)!.flags, []);

  const two = check(finding({ path: "src/other.ts", severity: "blocker", expected: null }), PATCHES)!;
  assert.deepEqual(two.flags, ["path_not_in_diff", "no_contrast"]);
  assert.equal(demoted(two), true);
  assert.equal(two.line, "`src/other.ts` is not a file this PR changes. A blocker needs both Expected and Actual.");

  const withheld = check(finding({ path: "src/webhooks/big.bin", title: "`x` is wrong" }), PATCHES)!;
  assert.deepEqual(withheld.flags, []);
  assert.equal(withheld.line, "The file is in this diff; its lines could not be checked.");

  assert.equal(check(finding(), null), null);
  assert.equal(demoted(null), false);
  const bare = check({ severity: "nit" }, PATCHES)!;
  assert.deepEqual(bare.flags, ["path_not_in_diff"]);
  assert.equal(bare.line, "The file is not a file this PR changes.");
});

test("annotate cuts the snippet only for a known patch", () => {
  const a = annotate(finding(), PATCHES);
  assert.equal(a.evidence!.status, "pass");
  assert.ok(a.snippet!.lines.some((l) => l.cited && l.n === 23));
  assert.equal(annotate(finding({ path: "src/other.ts" }), PATCHES).snippet, null);
  assert.equal(annotate(finding({ path: "src/webhooks/big.bin" }), PATCHES).snippet, null);
  assert.deepEqual(annotate(finding(), null), { evidence: null, snippet: null });
});
