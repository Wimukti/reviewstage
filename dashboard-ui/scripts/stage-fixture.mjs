// Writes src/stage/fixture.json — the data the stage components (src/stage/*) render on the
// site and in tests — from the e2e fixture's PR #38849 review, so the two cannot drift
// (design.md §7). Run: pnpm stage:fixture. The e2e fixture is built into e2e/.fixture exactly
// as the Playwright run builds it, then read back: the review, the queue row, and the fake gh's
// answer for the PR's files, which decides which findings can be anchored inline.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFixture, FIXTURE, PR, REPO, USER } from "../e2e/fixture.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "src", "stage", "fixture.json");
const slug = REPO.replace("/", "__");

buildFixture();

const review = JSON.parse(readFileSync(join(FIXTURE, "state", slug, PR, "review.json"), "utf8"));
const row = JSON.parse(readFileSync(join(FIXTURE, "queue.json"), "utf8"))
  .find((r) => r.repo === REPO && r.number === Number(PR));
if (!row) throw new Error(`queue.json has no row for ${REPO}#${PR}`);
const files = JSON.parse(
  execFileSync(join(FIXTURE, "fakebin", "gh"), ["api", `repos/${REPO}/pulls/${PR}/files`]).toString(),
).flat();
const inDiff = new Set(files.map((f) => f.filename));

// The review phases the server reports while a run is in flight (bin/server.py, api_pr).
const server = readFileSync(join(HERE, "..", "..", "bin", "server.py"), "utf8");
const m = server.match(/out\["reviewing"\] = \{\s*"phases": \[([^\]]+)\]/);
if (!m) throw new Error("bin/server.py: could not find the review phases");
const phases = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);

const findings = review.comments.map((c, i) => ({
  i,
  severity: c.severity,
  path: c.path,
  line: c.line,
  title: c.title,
  impact: c.impact,
  body: c.body,
  suggestion: c.suggestion || "",
  anchorable: inDiff.has(c.path),
}));

const out = {
  source: "dashboard-ui/e2e/fixture.ts — written by scripts/stage-fixture.mjs; do not edit",
  repo: REPO,
  pr: PR,
  title: row.title,
  author: row.author,
  additions: row.additions,
  deletions: row.deletions,
  changedFiles: row.changedFiles,
  user: USER,
  phases,
  review: {
    summary: review.summary,
    keyPoints: review.keyPoints ?? [],
    explainer: review.explainer ?? "",
    findings,
  },
};
writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${OUT}: ${findings.length} findings, ${phases.length} phases`);
