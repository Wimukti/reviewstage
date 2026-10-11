// The Learnings page's calibration table (trust-and-plain §2.2): what reviewers kept by the
// model's self-reported confidence, with n and keep %, and the one plain sentence when the
// buckets do not separate or cannot be compared yet. Rendered with react-dom/server from the
// data shape /api/learnings sends, so no browser and no API.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CalibrationData } from "./api";
import { CalibrationTable } from "./Learnings";

const bucket = (n: number, keepRate: number | null, min = 20) => ({ n, keepRate, ratable: n >= min });
const base: CalibrationData = {
  minSample: 20,
  separationPoints: 10,
  byConfidence: [
    { skill: "global", repo: "acme/widgets", confidence: "high", ...bucket(24, 87.5) },
    { skill: "global", repo: "acme/widgets", confidence: "low", ...bucket(21, 23.8) },
    { skill: "global", repo: "acme/api", confidence: "medium", ...bucket(3, 66.7) },
  ],
  overall: [
    { confidence: "low", ...bucket(21, 23.8) },
    { confidence: "high", ...bucket(24, 87.5) },
    { confidence: "medium", ...bucket(3, 66.7) },
  ],
  byEvidence: [
    { status: "pass", ...bucket(40, 72.5) },
    { status: "warn", ...bucket(8, 25.0) },
    { status: "unknown", ...bucket(0, null) },
  ],
  decided: 48,
  separates: true,
  points: 63.7,
  note: "",
};
const render = (c?: CalibrationData, multi = true) => renderToStaticMarkup(createElement(CalibrationTable, { calibration: c, multi }));

test("rows in confidence order with n and keep %, small buckets marked, evidence line, separating sentence", () => {
  const html = render(base);
  assert.match(html, /What reviewers kept, by confidence/);
  const rows = [...html.matchAll(/data-testid="calibration-row" data-confidence="([a-z]+)" data-ratable="(\d)"/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(rows, [["high", "1"], ["medium", "0"], ["low", "1"]]);
  assert.match(html, /high confidence<\/td><td[^>]*>24<\/td><td[^>]*>87\.5%/);
  assert.match(html, /low confidence<\/td><td[^>]*>21<\/td><td[^>]*>23\.8%/);
  assert.match(html, /medium confidence<\/td><td[^>]*>3<\/td><td[^>]*>66\.7%<span[^>]*>\(under 20\)/);
  assert.match(html, /data-testid="calibration-evidence"[^>]*>By the evidence check: pass 72\.5% kept of 40 · warn 25\.0% kept of 8/);
  assert.doesNotMatch(html, /not checked/);
  // Per-bucket detail names the skill and, with several repos, the repository.
  assert.match(html, /data-testid="calibration-bucket"[^>]*>global · acme\/widgets · high: 24 decisions, 87\.5% kept/);
  assert.match(html, /data-testid="calibration-note"[^>]*>The model&#x27;s confidence separates here \(63\.7 points between high and low\)/);
});

test("when the buckets do not separate, or cannot be compared, the server's sentence is shown as is", () => {
  const flat = { ...base, separates: false, points: 4.2, note: "The model's confidence does not separate here: reviewers kept 75.0% of high-confidence findings and 70.8% of low-confidence ones, 4.2 points apart. The badge uses the evidence check and the second pass only." };
  assert.match(render(flat), /data-testid="calibration-note"[^>]*>The model&#x27;s confidence does not separate here: reviewers kept 75\.0% of high-confidence findings and 70\.8% of low-confidence ones, 4\.2 points apart\./);
  const small = { ...base, separates: null, points: null, note: "Not enough decisions yet to say whether the model's confidence means anything: each of its high and low buckets needs 20 posted decisions." };
  assert.match(render(small), /Not enough decisions yet to say whether the model&#x27;s confidence means anything/);
});

test("nothing renders with no data, an older server, or a single repository's bucket list", () => {
  assert.equal(render(undefined), "");
  assert.equal(render({ ...base, decided: 0, overall: [], byConfidence: [], byEvidence: [] }), "");
  const one = render({ ...base, byConfidence: base.byConfidence.slice(0, 1) }, false);
  assert.doesNotMatch(one, /data-testid="calibration-buckets"/, "one bucket needs no breakdown");
  assert.doesNotMatch(render(base, false), /acme\/widgets/, "a single-repo install does not name the repo");
});
