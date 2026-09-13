import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePrRef, prLabel, prUrl, prnum } from "./pr";

const ONE = ["acme/widgets"];
const TWO = ["acme/widgets", "acme/api"];

test("bare number, one repo → that repo", () =>
  assert.deepEqual(parsePrRef("38849", ONE), { repo: "acme/widgets", number: "38849" }));
test("bare number, several repos → repo left empty for a picker", () =>
  assert.deepEqual(parsePrRef("38849", TWO), { repo: "", number: "38849" }));
test("hash prefix", () => assert.deepEqual(parsePrRef("#38849", ONE), { repo: "acme/widgets", number: "38849" }));
test("trims whitespace", () => assert.equal(parsePrRef("  123 ", TWO)?.number, "123"));
test("github pull URL derives the repo", () =>
  assert.deepEqual(parsePrRef("https://github.com/acme/api/pull/39190", TWO), { repo: "acme/api", number: "39190" }));
test("URL repo is canonicalised to the configured spelling", () =>
  assert.equal(parsePrRef("https://github.com/Acme/API/pull/1", TWO)?.repo, "acme/api"));
test("URL for an unconfigured repo is kept as typed (server decides via REPO_ALLOW_ORG)", () =>
  assert.deepEqual(parsePrRef("https://github.com/acme/other/pull/5", TWO), { repo: "acme/other", number: "5" }));
test("owner/name#123 shorthand", () =>
  assert.deepEqual(parsePrRef("acme/api#42", TWO), { repo: "acme/api", number: "42" }));
test("URL wins over trailing text", () =>
  assert.equal(parsePrRef("see https://github.com/acme/widgets/pull/42 please", TWO)?.number, "42"));
test("non-numeric is null", () => assert.equal(parsePrRef("hello", TWO), null));
test("empty string is null", () => assert.equal(parsePrRef("", TWO), null));
test("too long is null", () => assert.equal(parsePrRef("12345678", TWO), null));

test("prnum keeps the legacy contract", () => {
  assert.equal(prnum("#38849"), "38849");
  assert.equal(prnum("https://github.com/acme/widgets/pull/39190"), "39190");
  assert.equal(prnum("hello"), "");
});
test("prUrl encodes the repo and keeps the legacy form without one", () => {
  assert.equal(prUrl({ repo: "acme/widgets", num: "7" }), "/pr?repo=acme%2Fwidgets&pr=7");
  assert.equal(prUrl({ repo: "", num: "7" }), "/pr?pr=7");
  assert.equal(prUrl({ repo: "acme/api", num: "7" }, "/qa", "&v=1"), "/qa?repo=acme%2Fapi&pr=7&v=1");
});
test("prLabel", () => {
  assert.equal(prLabel({ repo: "acme/api", num: "7" }), "acme/api #7");
  assert.equal(prLabel({ repo: "", num: "7" }), "#7");
});
