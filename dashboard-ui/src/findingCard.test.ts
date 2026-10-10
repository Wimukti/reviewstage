// The verification contract on a finding card (openspec/changes/p0-proof/lane3-verify.md):
// claim · severity · confidence · path:line · why it matters · how to verify, in that order, and
// every row the run did not supply is omitted rather than labelled empty. Both cards — the desk
// FindingCard and the phone PhoneFindingCard — render with react-dom/server so the check needs no
// browser.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Finding } from "./api";
import { ConfidenceBadge, FindingCard, HowToVerify } from "./ReviewParts";
import { PhoneFindingCard } from "./PhoneReview";

const full: Finding = {
  i: 0,
  severity: "should-fix",
  sevLabel: "Should fix",
  path: "app/models/Product.php",
  line: 42,
  thread: null,
  body: "Guard against a null vendor before reading its lead time.",
  suggestion: "",
  low: false,
  title: "A product with no vendor can crash the lead-time badge",
  impact: "A shopper viewing such a product would see the card fail instead of loading.",
  structured: true,
  confidence: "high",
  howToVerify: "Open a product whose vendor is null; the badge throws instead of rendering.",
  anchorable: true,
};

// What an older server, or a review from before the contract, hands the page: no confidence,
// no verify line, and a body-only finding that is not even structured.
const old: Finding = {
  i: 1,
  severity: "nit",
  sevLabel: "Nit",
  path: "src/javascripts/Badge.tsx",
  line: 10,
  thread: null,
  body: "Prefer `const` over `let` here.",
  suggestion: "",
  low: false,
  title: "Prefer const over let here.",
  impact: "",
  structured: false,
  anchorable: false,
};

const noop = () => {};
const desk = (f: Finding) => renderToStaticMarkup(createElement(FindingCard, { f, checked: false, onToggle: noop }));
const phone = (f: Finding) =>
  renderToStaticMarkup(
    createElement(PhoneFindingCard, { f, kept: false, dropped: false, onToggle: noop, onKeep: noop, onDrop: noop, onRestore: noop }),
  );
const order = (html: string, needles: string[]) => needles.map((n) => html.indexOf(n));
const ascending = (xs: number[]) => xs.every((x, i) => x >= 0 && (i === 0 || x > xs[i - 1]));

test("desk card with every field: confidence by the severity, then claim, why it matters, how to verify", () => {
  const html = desk(full);
  assert.match(html, /data-testid="confidence"[^>]*data-confidence="high"/);
  assert.match(html, /high confidence/);
  assert.match(html, /data-testid="why-it-matters"/);
  assert.match(html, /data-testid="how-to-verify"/);
  assert.ok(
    ascending(order(html, ["Should fix", "high confidence", "app/models/Product.php:42", full.title, "Why it matters", "How to verify", full.howToVerify!])),
    "the rows read severity · confidence · path · claim · why · verify",
  );
});

test("desk card for an older finding: no confidence badge, no verify row, no empty label", () => {
  const html = desk(old);
  assert.doesNotMatch(html, /data-testid="confidence"/);
  assert.doesNotMatch(html, /confidence/);
  assert.doesNotMatch(html, /How to verify/);
  assert.doesNotMatch(html, /Why it matters/);
  assert.match(html, /src\/javascripts\/Badge.tsx:10/);
  assert.match(html, /In summary/); // off-diff placement still chips
});

test("a finding with confidence but no verify line shows the badge and omits only the row", () => {
  const html = desk({ ...full, howToVerify: "" });
  assert.match(html, /high confidence/);
  assert.match(html, /Why it matters/);
  assert.doesNotMatch(html, /How to verify/);
});

test("phone card: confidence in the head, impact and verify line under the claim before expanding", () => {
  const html = phone(full);
  assert.match(html, /data-testid="confidence"[^>]*data-confidence="high"/);
  assert.match(html, /data-testid="why-it-matters"/);
  assert.match(html, /data-testid="how-to-verify"/);
  assert.doesNotMatch(html, /data-testid="finding-detail"/, "the card is closed");
  assert.ok(ascending(order(html, [full.title, full.impact, "How to verify", "app/models/Product.php:42"])));
});

test("phone card for an older finding renders the body line as its claim and nothing else new", () => {
  const html = phone(old);
  assert.doesNotMatch(html, /confidence/);
  assert.doesNotMatch(html, /How to verify/);
  assert.doesNotMatch(html, /data-testid="why-it-matters"/);
  assert.match(html, /Prefer `const` over `let` here\./);
});

test("the two pieces render nothing at all for an absent value", () => {
  assert.equal(renderToStaticMarkup(createElement(ConfidenceBadge, { confidence: null })), "");
  assert.equal(renderToStaticMarkup(createElement(ConfidenceBadge, {})), "");
  assert.equal(renderToStaticMarkup(createElement(HowToVerify, { text: "" })), "");
  assert.equal(renderToStaticMarkup(createElement(HowToVerify, {})), "");
  assert.match(renderToStaticMarkup(createElement(ConfidenceBadge, { confidence: "low" })), /low confidence/);
});
