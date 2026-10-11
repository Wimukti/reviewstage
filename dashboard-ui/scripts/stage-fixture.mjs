// Writes src/stage/fixture.json — the data the stage components (src/stage/*) render on the
// site and in tests — from the e2e fixture's PR #38849 review, so the two cannot drift
// (design.md §7). Run: pnpm stage:fixture. The e2e fixture is built into e2e/.fixture exactly
// as the Playwright run builds it, then read back: the review, the queue row, and the fake gh's
// answer for the PR's files, which decides which findings can be anchored inline.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

// Where, the evidence verdict and the inline snippet exactly as the server computes them
// (bin/rs_evidence.py, trust-and-plain §1.3–1.4), so src/evidence.test.ts can hold the
// TypeScript port used by the replay to the Python module's own output.
const tmp = mkdtempSync(join(tmpdir(), "rs-stage-"));
writeFileSync(join(tmp, "files.json"), JSON.stringify(files));
const evidence = JSON.parse(
  execFileSync("python3", [join(HERE, "..", "..", "bin", "rs_evidence.py"), join(FIXTURE, "state", slug, PR, "review.json"), join(tmp, "files.json")], {
    env: { ...process.env, PYTHONPATH: join(HERE, "..", "..", "bin") },
  }).toString(),
);
// The three-level badge exactly as the server computes it (bin/rs_confidence.py, Part 2) from
// that evidence output and the review's stored disproof verdicts; src/confidence.test.ts holds
// the TypeScript port to it.
writeFileSync(join(tmp, "evidence.json"), JSON.stringify(evidence));
const badges = JSON.parse(
  execFileSync("python3", [join(HERE, "..", "..", "bin", "rs_confidence.py"), join(tmp, "evidence.json"), join(FIXTURE, "state", slug, PR, "review.json")], {
    env: { ...process.env, PYTHONPATH: join(HERE, "..", "..", "bin") },
  }).toString(),
).badges;
rmSync(tmp, { recursive: true, force: true });

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
  impact: c.impact ?? c.why_it_matters ?? "",
  confidence: c.confidence ?? null,
  howToVerify: c.how_to_verify ?? "",
  where: evidence.findings[i].where,
  whatToCheck: c.what_to_check ?? "",
  expected: c.expected ?? "",
  actual: c.actual ?? "",
  snippet: evidence.findings[i].snippet,
  evidence: evidence.findings[i].evidence,
  checked: c.checked ?? null,
  badge: badges[i],
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
    // The reading guide in the server's wire shape (server.py _guide_data).
    guide: evidence.guide
      ? {
          does: evidence.guide.does ?? "",
          why: evidence.guide.why ?? "",
          risk: evidence.guide.risk ?? null,
          readPlan: evidence.guide.read_plan.map((r) => ({ path: r.path, lines: r.lines ?? null, why: r.why ?? "" })),
          notCovered: evidence.guide.not_covered,
        }
      : null,
    disproof: review.disproof
      ? { status: review.disproof.status, n: review.disproof.n, checked: review.disproof.checked, durationMs: review.disproof.duration_ms, mode: review.disproof.mode }
      : null,
    keyPoints: review.keyPoints ?? [],
    explainer: review.explainer ?? "",
    findings,
  },
};
writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${OUT}: ${findings.length} findings, ${phases.length} phases`);
