// Unit tests for the typed API client. No network: global.fetch is stubbed per case.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  api,
  ApiError,
  errBanner,
  errMessage,
  escapeHtml,
  get,
  isExpiredToken,
  post,
  Unauthorized,
} from "./api";

type FetchArgs = { url: string; init?: RequestInit };
let calls: FetchArgs[] = [];

function stubFetch(status: number, body: unknown) {
  calls = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }) as typeof fetch;
}

afterEach(() => {
  calls = [];
});

test("get hits the /api base and returns parsed JSON", async () => {
  stubFetch(200, { authed: true, login: "me" });
  const r = await get<{ authed: boolean; login: string }>("/me");
  assert.equal(r.login, "me");
  assert.equal(calls[0].url, "/api/me");
  assert.equal(calls[0].init?.credentials, "same-origin");
});

test("post serializes the body as JSON with the right header and method", async () => {
  stubFetch(200, { ok: true });
  await post("/review", { pr: "42", effort: "deep" });
  const init = calls[0].init!;
  assert.equal(init.method, "POST");
  assert.equal((init.headers as Record<string, string>)["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(init.body as string), { pr: "42", effort: "deep" });
});

test("a 401 throws Unauthorized", async () => {
  stubFetch(401, {});
  await assert.rejects(() => get("/queue?tab=todo&sort=newest"), Unauthorized);
});

test("a non-ok response throws with the server error message", async () => {
  stubFetch(403, { error: "bad token" });
  await assert.rejects(() => post("/approve", {}), /bad token/);
});

test("api.queue encodes tab and sort into the query string", async () => {
  stubFetch(200, { rows: [] });
  await api.queue("to do", "oldest first");
  assert.equal(calls[0].url, "/api/queue?tab=to%20do&sort=oldest%20first");
});

test("api.pr encodes the repo, omits it when empty, and appends the version only when given", async () => {
  stubFetch(200, {});
  await api.pr({ repo: "", num: "42" });
  assert.equal(calls[0].url, "/api/pr?pr=42");
  await api.pr({ repo: "acme/widgets", num: "42" }, "3");
  assert.equal(calls[1].url, "/api/pr?repo=acme%2Fwidgets&pr=42&v=3");
});

test("PR-scoped posts carry repo and pr in the body", async () => {
  stubFetch(200, { ok: true });
  await api.archive({ repo: "acme/api", num: "7" }, { exp: "1", sig: "s" }, "archive");
  assert.equal(calls[0].url, "/api/archive");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    repo: "acme/api", pr: "7", exp: "1", sig: "s", action: "archive",
  });
});

test("api.rollup passes the repo filter only when given", async () => {
  stubFetch(200, {});
  await api.rollup();
  assert.equal(calls[0].url, "/api/rollup");
  await api.rollup("acme/api");
  assert.equal(calls[1].url, "/api/rollup?repo=acme%2Fapi");
});

test("api.skillAction posts to the step-scoped route", async () => {
  stubFetch(200, { bannerHtml: "<div/>" });
  await api.skillAction("save", { target: "global", skill: "x" });
  assert.equal(calls[0].url, "/api/skill/save");
});

test("an error reply carries its HTTP status, so callers can tell 403 from 500", async () => {
  stubFetch(403, { error: "This link has expired — reload the page for a fresh one." });
  await assert.rejects(
    () => get("/pr"),
    (e: unknown) => e instanceof ApiError && e.status === 403,
  );
});

test("isExpiredToken recognises only a recoverable 403", () => {
  const at = (status: number, msg: string) => new ApiError(msg, {}, status);
  assert.equal(isExpiredToken(at(403, "This link has expired — reload the page for a fresh one.")), true);
  assert.equal(isExpiredToken(at(403, "This link was signed with a different key — …")), true);
  // A refusal the reviewer has to act on, not one a fresh token fixes.
  assert.equal(isExpiredToken(at(403, "You are not a reviewer on this PR.")), false);
  assert.equal(isExpiredToken(at(500, "This link has expired")), false);
  assert.equal(isExpiredToken(new Error("has expired")), false);
});

test("errMessage prefers the server's words and never returns empty", () => {
  assert.equal(errMessage(new ApiError("GitHub said no.", {}, 422)), "GitHub said no.");
  assert.match(errMessage(new Unauthorized()), /session has expired/i);
  assert.equal(errMessage(null, "fallback"), "fallback");
  assert.equal(errMessage(new Error("")), "That didn't work — try again.");
});

test("errBanner escapes the server's message instead of injecting it", () => {
  assert.equal(escapeHtml('<img src=x onerror="a">'), "&lt;img src=x onerror=&quot;a&quot;&gt;");
  const html = errBanner(new ApiError("<script>x</script>", {}, 500));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("api.post carries the review identity so the server can refuse a stale selection", async () => {
  stubFetch(200, { bannerHtml: "" });
  await api.post({ repo: "acme/widgets", num: "1" }, { exp: "1", sig: "s" }, {
    selected: [0], bodies: {}, suggs: {}, request_changes: false, review_key: "fp:2:abc",
  });
  assert.equal(JSON.parse(String(calls[0].init?.body)).review_key, "fp:2:abc");
});

test("api.skillSuggestion sends the reviewer's edited rule on accept", async () => {
  stubFetch(200, {});
  await api.skillSuggestion({ exp: "1", sig: "s" }, "sig1", "accept", "My own wording.");
  assert.equal(JSON.parse(String(calls[0].init?.body)).rule, "My own wording.");
});
