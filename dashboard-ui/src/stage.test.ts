// The stage components (src/stage/*) are what the site renders inside its shadow-root islands
// (design.md §7). They must render without a DOM or an API, from fixture.json alone, and the
// fixture must still be the e2e fixture's PR #38849 review. Rendered with react-dom/server so
// the check needs no browser.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fixture from "./stage/fixture.json";
import { StageProgress } from "./stage/StageProgress";
import { StageQueueCard } from "./stage/StageQueueCard";
import { StageScene, type SceneState } from "./stage/StageScene";
import { PR, REPO, USER } from "../e2e/fixture";

const count = (html: string, needle: string) => html.split(needle).length - 1;

test("fixture.json is the e2e fixture's PR #38849 review", () => {
  assert.equal(fixture.pr, PR);
  assert.equal(fixture.repo, REPO);
  assert.equal(fixture.user, USER);
  assert.equal(fixture.review.findings.length, 2);
  assert.deepEqual(fixture.review.findings.map((f) => f.severity), ["should-fix", "nit"]);
  assert.deepEqual(fixture.review.findings.map((f) => f.anchorable), [true, false]);
  assert.equal(fixture.phases.length, 4);
});

test("StageScene staged: two .finding.is-staged and a commit bar reading 2 staged", () => {
  const html = renderToStaticMarkup(createElement(StageScene, { state: "staged" }));
  assert.equal(count(html, 'class="finding is-staged"'), 2);
  assert.match(html, /class="commit-bar has-staged"/);
  assert.match(html, /data-stage-count="2"/);
  assert.match(html, /Post selected to GitHub/);
  assert.match(html, /In summary/); // Badge.tsx is outside the diff
});

for (const state of ["requested", "drafting", "posted", "approved"] as SceneState[]) {
  test(`StageScene ${state} renders its still`, () => {
    const html = renderToStaticMarkup(createElement(StageScene, { state }));
    assert.match(html, new RegExp(`data-stage="${state}"`));
    if (state === "requested") assert.match(html, /Review this PR/);
    if (state === "drafting") assert.match(html, /Drafting review for/);
    if (state === "posted" || state === "approved") {
      assert.match(html, new RegExp(`Posted as ${USER}`));
      assert.equal(count(html, "is-staged"), 0, "nothing is staged once posted");
      assert.doesNotMatch(html, /has-staged/);
    }
  });
}

test("StageScene play starts at the drafting step on the server (no reduced-motion query there)", () => {
  const html = renderToStaticMarkup(createElement(StageScene, { state: "staged", play: true }));
  assert.match(html, /data-stage="drafting"/);
});

test("StageQueueCard and StageProgress render from the fixture", () => {
  const q = renderToStaticMarkup(createElement(StageQueueCard, { state: "reviewed" }));
  assert.match(q, /#38849/);
  assert.match(q, /1 should fix/);
  assert.match(q, /1 nit/);
  const p = renderToStaticMarkup(createElement(StageProgress, { cur: 2 }));
  assert.equal(count(p, 'class="done"'), 2);
  assert.equal(count(p, 'class="now"'), 1);
  assert.match(p, /Reviewing the diff/);
});
