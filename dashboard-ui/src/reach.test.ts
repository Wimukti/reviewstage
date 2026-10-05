import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, Unauthorized } from "./api";
import { isUnreachable, noteFailure, setUnreachable, UNREACHABLE } from "./reach";
import { whenText } from "./desktop";
import { readFileSync } from "node:fs";

// desktop-always-on F5: only "the server is not there" becomes the full-screen state.
test("gateway statuses and network failures are unreachable; real answers are not", () => {
  for (const s of [502, 503, 504, 530]) assert.equal(isUnreachable(new ApiError("x", {}, s)), true, String(s));
  for (const s of [400, 403, 404, 409, 429, 500]) assert.equal(isUnreachable(new ApiError("x", {}, s)), false, String(s));
  assert.equal(isUnreachable(new TypeError("Failed to fetch")), true);
  assert.equal(isUnreachable(new Unauthorized()), false);
  assert.equal(isUnreachable(new Error("boom")), false);
  setUnreachable(false);
  assert.equal(noteFailure(new ApiError("x", {}, 500)), false);
  assert.equal(noteFailure(new ApiError("x", {}, 530)), true);
  setUnreachable(false);
});

test("offline.html says exactly what the in-app state says", () => {
  const html = readFileSync(new URL("../public/offline.html", import.meta.url), "utf8");
  for (const line of [UNREACHABLE.title, UNREACHABLE.body, UNREACHABLE.moved]) {
    assert.ok(html.includes(line), `offline.html is missing: ${line}`);
  }
});

test("last-checked times are MM/DD/YY HH:MM", () => {
  assert.equal(whenText(new Date(2026, 9, 5, 9, 41).getTime()), "10/05/26 09:41");
  assert.equal(whenText(null), "not yet");
});
