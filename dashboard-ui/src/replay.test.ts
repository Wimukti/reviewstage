// The public replay (src/replay/): the server-mapping port agrees with the real server's output
// for the e2e fixture's PR (src/stage/fixture.json is generated from it), the in-memory store
// answers what the PR page asks and refuses everything else, the fetch shim never lets a
// non-/api request through, the counters survive a broken localStorage, and the production
// bundle (src/main.tsx) never imports any of it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import stage from "./stage/fixture.json" with { type: "json" };
import { FIXTURES, pickFixture } from "./replay/fixtures";
import { anchorable, defaultApproveMsg, fallbackTitle, linesInDiff, mapFindings, prData, reviewData } from "./replay/map";
import { ReplayStore } from "./replay/store";
import { replayFetch } from "./replay/shim";
import { bump, EVENT_NAMES, readEvents, resetEvents } from "./replay/events";
import type { FixtureComment } from "./replay/types";

// The e2e fixture's review.json for PR #38849, as dashboard-ui/e2e/fixture.ts writes it and
// the real server reads it. The stage fixture is the server's rendering of exactly this.
const E2E_COMMENTS: FixtureComment[] = [
  {
    path: "app/models/Product.php", line: 42, severity: "should-fix",
    title: "A product with no vendor can crash the lead-time badge",
    impact: "A shopper viewing such a product would see the card fail instead of loading.",
    body: "Guard against a null vendor before reading its lead time.",
    reply_to: null, suggestion: "if ($vendor === null) return null;",
  },
  {
    path: "src/javascripts/Badge.tsx", line: 10, severity: "nit",
    title: "Use const instead of let", impact: "Style only — no effect on behavior.",
    body: "Prefer `const` over `let` here.", reply_to: null, suggestion: "",
  },
];
const E2E_FILES = [{
  filename: "app/models/Product.php", status: "modified" as const,
  patch: "@@ -40,3 +40,4 @@\n ctx\n+$leadTime = $vendor->leadTime();\n ctx2\n ctx3\n",
}];

test("map.ts renders the e2e fixture exactly as the server did (src/stage/fixture.json)", () => {
  const ours = mapFindings(E2E_COMMENTS, (c) => anchorable(E2E_FILES, c));
  const keys = ["i", "severity", "path", "line", "title", "impact", "body", "suggestion", "anchorable"] as const;
  const pick = (f: Record<string, unknown>) => Object.fromEntries(keys.map((k) => [k, f[k]]));
  assert.deepEqual(ours.map((f) => pick(f as unknown as Record<string, unknown>)), stage.review.findings.map((f) => pick(f)));
  assert.equal(ours[0].sevLabel, "should fix");
  assert.equal(ours[0].structured, true);
  assert.equal(ours[0].preselect, true);
});

test("map.ts: severity sort is stable, titles fall back, low confidence is not pre-ticked", () => {
  const out = mapFindings(
    [
      { path: "a.ts", line: 1, severity: "nit", body: "**Second** nit\nmore" },
      { path: "b.ts", line: 2, severity: "blocker", body: "x".repeat(120), confidence: "low" },
      { path: "c.ts", line: 3, severity: "nit", body: "" },
    ],
    () => null,
  );
  assert.deepEqual(out.map((f) => f.path), ["b.ts", "a.ts", "c.ts"]);
  assert.equal(out[1].title, "Second nit");
  assert.equal(out[0].title, "x".repeat(90) + "…");
  assert.equal(out[2].title, "c.ts:3");
  assert.equal(out[0].low, true);
  assert.equal(out[0].preselect, false);
  assert.equal(out[0].anchorable, null);
  assert.equal(fallbackTitle({ path: "d.ts", line: 0, severity: "nit", body: "" }), "d.ts:0");
});

test("map.ts: diff hunks give the anchorable lines", () => {
  const lines = linesInDiff(E2E_FILES).get("app/models/Product.php")!;
  assert.deepEqual([...lines].sort((a, b) => a - b), [40, 41, 42, 43]);
  assert.equal(anchorable(E2E_FILES, E2E_COMMENTS[0]), true);
  assert.equal(anchorable(E2E_FILES, E2E_COMMENTS[1]), false);
});

test("map.ts: the approve message lists blockers and should-fixes", () => {
  assert.equal(defaultApproveMsg([{ path: "a", line: 1, severity: "nit", body: "b" }]), "LGTM 🚀");
  assert.match(defaultApproveMsg(E2E_COMMENTS), /^LGTM — just handle these before merge:\n\n- `app\/models\/Product.php:42` — Guard against/);
});

test("every shipped fixture carries exactly the three teaching findings and matching decisions", () => {
  assert.equal(FIXTURES.length, 3);
  for (const fx of FIXTURES) {
    assert.deepEqual(fx.review.comments.map((c) => c.teach), ["keep", "drop", "edit"], fx.slug);
    assert.deepEqual(fx.decisions.map((d) => d.action), ["keep", "drop", "edit"], fx.slug);
    assert.ok(fx.decisions[2].edited_body && fx.decisions[2].edited_body !== fx.review.comments[2].body, `${fx.slug}: the edit changes the body`);
    for (const [i, c] of fx.review.comments.entries()) {
      assert.ok(fx.explain[String(i)], `${fx.slug}: explain[${i}]`);
      assert.ok(c.how_to_verify, `${fx.slug}: how_to_verify[${i}]`);
      assert.equal(anchorable(fx.files, c), true, `${fx.slug}: finding ${i} is on a diff line`);
    }
    const pr = prData(fx);
    assert.equal(pr.review?.count, 3);
    assert.equal(pr.dryRun, true);
    assert.ok(Object.keys(pr.tokens).includes("post"));
    assert.equal(reviewData(fx, true).postLabel, "Post selected (dry run)");
  }
  assert.equal(pickFixture("nope").slug, FIXTURES[0].slug);
  assert.equal(pickFixture("rate-limit-tenant").slug, "rate-limit-tenant");
});

test("store: answers what the PR page asks, refuses the rest, and records a post without sending", () => {
  const fx = FIXTURES[0];
  const store = new ReplayStore(fx);
  assert.equal(store.handle("GET", "/me", undefined).status, 200);
  assert.equal(store.handle("GET", `/pr?repo=${encodeURIComponent(fx.repo)}&pr=${fx.pr}`, undefined).status, 200);
  assert.equal(store.handle("GET", "/pr?pr=1", undefined).status, 404);
  assert.equal(store.handle("GET", "/queue?tab=todo&sort=newest", undefined).status, 200);
  assert.equal(store.handle("GET", "/settings", undefined).status, 404);
  assert.equal(store.handle("POST", "/teach", {}).status, 501);
  assert.equal(store.handle("POST", "/review", {}).status, 400);
  const ex = store.handle("POST", "/explain", { idx: 1 });
  assert.equal(ex.status, 200);
  assert.equal((ex.json as { md: string }).md, fx.explain["1"]);

  const edited = "Consider adding jitter.";
  const r = store.handle("POST", "/post", { selected: [0, 2], bodies: { 2: edited }, suggs: {}, request_changes: false, review_key: "x" });
  assert.equal(r.status, 200);
  const html = (r.json as { bannerHtml: string }).bannerHtml;
  assert.match(html, /class='banner warn'/);
  assert.match(html, /dry run/i);
  assert.match(html, /nothing was sent/i);
  assert.equal(store.posts.length, 1);
  assert.deepEqual(store.posts[0].comments.map((c) => c.i), [0, 2]);
  assert.equal(store.posts[0].comments[1].body, edited);
  assert.equal(store.posts[0].comments[0].body, fx.review.comments[0].body);
  assert.equal(store.posts[0].event, "COMMENT");
});

test("shim: same-origin /api goes to the store, anything else throws", async () => {
  const g = globalThis as unknown as { window?: unknown; localStorage?: unknown };
  const prevWindow = g.window;
  g.window = { location: { href: "https://reviewstage.dev/try/app/", origin: "https://reviewstage.dev" }, dispatchEvent: () => true };
  try {
    const f = replayFetch(new ReplayStore(FIXTURES[1]));
    const me = await f("/api/me");
    assert.equal(me.status, 200);
    assert.equal((await me.json()).login, "sam");
    const post = await f("/api/post", { method: "POST", body: JSON.stringify({ selected: [0] }) });
    assert.equal(post.status, 200);
    await assert.rejects(f("https://api.github.com/repos"), /network is disabled/);
    await assert.rejects(f("/static/app.js"), /network is disabled/);
  } finally {
    g.window = prevWindow;
  }
});

test("events: counters start at zero, count up, and survive a broken localStorage", () => {
  const g = globalThis as unknown as { localStorage?: unknown; window?: unknown };
  const prev = { ls: g.localStorage, w: g.window };
  const mem = new Map<string, string>();
  g.localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  };
  g.window = { dispatchEvent: () => true };
  try {
    resetEvents();
    assert.deepEqual(Object.values(readEvents()), EVENT_NAMES.map(() => 0));
    bump("replay_started");
    bump("first_decision");
    bump("first_decision");
    assert.equal(readEvents().replay_started, 1);
    assert.equal(readEvents().first_decision, 2);
    assert.equal(JSON.parse(mem.get("rs_replay_events")!).first_decision, 2);
    g.localStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => {} };
    assert.doesNotThrow(() => bump("install_copied"));
    assert.equal(readEvents().install_copied, 0);
  } finally {
    g.localStorage = prev.ls;
    g.window = prev.w;
  }
});

test("the production bundle never imports the replay", () => {
  const main = readFileSync(join(import.meta.dirname, "main.tsx"), "utf8");
  const app = readFileSync(join(import.meta.dirname, "App.tsx"), "utf8");
  assert.doesNotMatch(main + app, /replay\//);
  const api = readFileSync(join(import.meta.dirname, "api.ts"), "utf8");
  assert.doesNotMatch(api, /replay/);
});
