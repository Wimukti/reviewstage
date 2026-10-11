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

test("desk card with the lane-3 fields: confidence by the severity, then claim, where, how to verify, why it matters", () => {
  const html = desk(full);
  assert.match(html, /data-testid="confidence"[^>]*data-confidence="high"/);
  assert.match(html, /high confidence/);
  assert.match(html, /data-testid="why-it-matters"/);
  assert.match(html, /data-testid="how-to-verify"/);
  // trust-and-plain §1.3: title · where · what to check (the verify line stands in for it on a
  // review without one) · why it matters. The path now lives in the Where row under the title.
  assert.ok(
    ascending(order(html, ["Should fix", "high confidence", full.title, "app/models/Product.php:42", "How to verify", full.howToVerify!, "Why it matters"])),
    "the rows read severity · confidence · claim · where · verify · why",
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

test("phone card: confidence in the head, where, verify line and impact under the claim before expanding", () => {
  const html = phone(full);
  assert.match(html, /data-testid="confidence"[^>]*data-confidence="high"/);
  assert.match(html, /data-testid="why-it-matters"/);
  assert.match(html, /data-testid="how-to-verify"/);
  assert.doesNotMatch(html, /data-testid="finding-detail"/, "the card is closed");
  assert.ok(ascending(order(html, [full.title, "app/models/Product.php:42", "How to verify", full.impact])));
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

// ---- dismissal reasons (openspec/changes/p0-proof/lane2-reasons.md) ---------------------------
// The drop is the tick: a card rendered unticked is unticked in the same render that opens the
// "Why?" row — nothing about the row gates the decision. Both cards render with react-dom/server.
import { REASONS, type Reason } from "./api";
import { ReasonChips } from "./ReviewParts";

const chips = (html: string) => (html.match(/data-testid="reason-chip"/g) || []).length;

test("the desk card is unticked and asking in one render; the row is a group under the head", () => {
  const html = renderToStaticMarkup(createElement(FindingCard, { f: full, checked: false, onToggle: noop, askReason: true, onReason: noop }));
  assert.doesNotMatch(html, /data-staged="1"/, "the drop has already landed");
  assert.match(html, /data-testid="reason-row"/);
  assert.match(html, /role="group"[^>]*aria-label="Why did you drop this finding\?"/);
  assert.equal(chips(html), REASONS.length, "one chip per reason in the taxonomy");
  assert.ok(ascending(order(html, ['class="fhead', 'data-testid="reason-row"', full.title])), "the row sits between the head and the claim");
  for (const r of REASONS) assert.match(html, new RegExp(`data-reason="${r}"`));
});

test("a card not being asked, or ticked, shows no row and no chips", () => {
  const quiet = renderToStaticMarkup(createElement(FindingCard, { f: full, checked: false, onToggle: noop, askReason: false, onReason: noop }));
  assert.doesNotMatch(quiet, /reason-row|reason-chip|Why\?/);
  const ticked = renderToStaticMarkup(createElement(FindingCard, { f: full, checked: true, onToggle: noop, askReason: true, onReason: noop }));
  assert.doesNotMatch(ticked, /reason-row|reason-chip/, "a ticked card is never asked why it was dropped");
  const legacy = desk(full);
  assert.doesNotMatch(legacy, /reason-row|reason-chip/, "a caller without onReason gets the card it always had");
});

test("a chosen reason collapses the row to one chip with a clear button, and outlives the question", () => {
  const html = renderToStaticMarkup(
    createElement(FindingCard, { f: full, checked: false, onToggle: noop, askReason: false, reason: "style_nit" as Reason, onReason: noop }),
  );
  assert.match(html, /data-testid="reason-picked"[^>]*data-reason="style_nit"/);
  assert.match(html, /Dropped · style nit/);
  assert.match(html, /data-testid="reason-clear"/);
  assert.doesNotMatch(html, /data-testid="reason-row"/);
  assert.equal(chips(html), 0);
});

test("the phone's dropped line carries the answer or a Why? chip, and stays one line", () => {
  const asking = renderToStaticMarkup(
    createElement(PhoneFindingCard, { f: full, kept: false, dropped: true, onToggle: noop, onKeep: noop, onDrop: noop, onRestore: noop, onAskReason: noop }),
  );
  assert.match(asking, /data-testid="reason-open"/);
  assert.match(asking, />Why\?</);
  assert.doesNotMatch(asking, /data-testid="reason-row"/, "the chips live in the bottom bar, not in the line");
  const answered = renderToStaticMarkup(
    createElement(PhoneFindingCard, { f: full, kept: false, dropped: true, onToggle: noop, onKeep: noop, onDrop: noop, onRestore: noop, onAskReason: noop, reason: "duplicate" as Reason }),
  );
  assert.match(answered, /data-testid="reason-picked"[^>]*data-reason="duplicate"/);
  assert.match(answered, />Duplicate</);
  const legacy = renderToStaticMarkup(
    createElement(PhoneFindingCard, { f: full, kept: false, dropped: true, onToggle: noop, onKeep: noop, onDrop: noop, onRestore: noop }),
  );
  assert.doesNotMatch(legacy, /reason-open|reason-picked/);
});

test("the chip row offers Skip only when it can close, and every chip is a real button", () => {
  const closable = renderToStaticMarkup(createElement(ReasonChips, { onPick: noop, onClose: noop }));
  assert.match(closable, /data-testid="reason-skip"/);
  assert.equal((closable.match(/<button /g) || []).length, REASONS.length + 1);
  const bare = renderToStaticMarkup(createElement(ReasonChips, { onPick: noop }));
  assert.doesNotMatch(bare, /reason-skip/);
  assert.equal((bare.match(/<button /g) || []).length, REASONS.length);
});


// ---- where / what to check / expected / actual / evidence / reading guide (trust-and-plain) --
import type { GuideData } from "./api";
import { Contrast, DiffSnippet, EvidenceLine, locOf, ReadingGuide, WhatToCheck } from "./ReviewParts";

const plain: Finding = {
  ...full,
  where: { path: "app/models/Product.php", start: 42, end: 43 },
  whatToCheck: "Open Product.php line 42. Check that `$vendor` is null-guarded before `leadTime()`.",
  expected: "A product with no vendor shows no badge.",
  actual: "The badge throws on a null vendor.",
  snippet: {
    start: 40,
    end: 43,
    lines: [
      { n: 40, text: "ctx", kind: "ctx", cited: false },
      { n: null, text: "old line", kind: "del", cited: false },
      { n: 41, text: "$leadTime = $vendor->leadTime();", kind: "add", cited: false },
      { n: 42, text: "ctx2", kind: "ctx", cited: true },
      { n: 43, text: "ctx3", kind: "ctx", cited: true },
    ],
  },
  evidence: { status: "pass", flags: [], line: "The cited lines are in this diff and mention `vendor`, `leadTime`.", symbols: ["vendor", "leadTime"] },
};

test("desk card rows are exactly the §1.3 order: title · where (+ snippet) · what to check · expected/actual · why · evidence", () => {
  const html = desk(plain);
  assert.ok(
    ascending(
      order(html, [
        'class="fhead',
        "Should fix",
        "high confidence",
        'data-testid="finding-title"',
        plain.title,
        'data-testid="where"',
        "app/models/Product.php:42-43",
        'data-testid="diff-snippet"',
        'data-testid="what-to-check"',
        "What to check",
        plain.whatToCheck!,
        'data-testid="contrast"',
        "Expected",
        plain.expected!,
        "Actual",
        plain.actual!,
        'data-testid="why-it-matters"',
        "Why it matters",
        'data-testid="evidence"',
        "mention `vendor`",
        'data-testid="finding-actions"',
      ]),
    ),
    "the rows read head · title · where · what to check · expected/actual · why · evidence · actions",
  );
  // The path is no longer in the head; it is the Where row.
  const head = html.slice(html.indexOf('class="fhead'), html.indexOf('data-testid="finding-title"'));
  assert.doesNotMatch(head, /finding-path/);
  // With a what_to_check the older verify line is not a visible row (it sits under More).
  assert.doesNotMatch(html, /data-testid="how-to-verify"/);
  assert.match(html, /data-finding="0"/, "the card carries its index so the reading guide can scroll to it");
});

test("the snippet highlights changed lines, marks cited ones and numbers the new side only", () => {
  const html = renderToStaticMarkup(createElement(DiffSnippet, { snippet: plain.snippet! }));
  assert.match(html, /data-testid="diff-snippet"[^>]*data-start="40"[^>]*data-end="43"/);
  assert.equal((html.match(/data-kind="add"/g) || []).length, 1);
  assert.equal((html.match(/data-kind="del"/g) || []).length, 1);
  assert.equal((html.match(/data-cited="1"/g) || []).length, 2);
  assert.match(html, /data-kind="add"[^>]*>[\s\S]*?bg-green/.test(html) ? /bg-green/ : /bg-green/);
  assert.match(html, /\$leadTime = \$vendor-&gt;leadTime\(\);/);
  // The removed line has no number and the added one has 41.
  assert.match(html, /tabular-nums">41</);
  assert.equal(renderToStaticMarkup(createElement(DiffSnippet, { snippet: null })), "");
  assert.equal(renderToStaticMarkup(createElement(DiffSnippet, { snippet: { start: 1, end: 1, lines: [] } })), "");
});

test("the evidence line reads PASS or WARN with the plain reason, and renders nothing without a verdict", () => {
  const pass = renderToStaticMarkup(createElement(EvidenceLine, { evidence: plain.evidence! }));
  assert.match(pass, /data-testid="evidence"[^>]*data-status="pass"/);
  assert.match(pass, />Evidence</);
  assert.match(pass, /mention <!-- -->`vendor`|mention `vendor`/);
  const warn = renderToStaticMarkup(
    createElement(EvidenceLine, { evidence: { status: "warn", flags: ["path_not_in_diff", "no_contrast"], line: "`x.php` is not a file this PR changes. A blocker needs both Expected and Actual." } }),
  );
  assert.match(warn, /data-status="warn"/);
  assert.match(warn, /data-flags="path_not_in_diff no_contrast"/);
  assert.match(warn, /Evidence<!-- --> · check|Evidence · check/);
  assert.match(warn, /A blocker needs both Expected and Actual/);
  assert.equal(renderToStaticMarkup(createElement(EvidenceLine, { evidence: null })), "");
  assert.equal(renderToStaticMarkup(createElement(EvidenceLine, {})), "");
});

test("what to check and the contrast render nothing when empty, and either half of the contrast alone", () => {
  assert.equal(renderToStaticMarkup(createElement(WhatToCheck, { text: "" })), "");
  assert.equal(renderToStaticMarkup(createElement(Contrast, {})), "");
  const onlyActual = renderToStaticMarkup(createElement(Contrast, { actual: "It throws." }));
  assert.match(onlyActual, /data-testid="actual"/);
  assert.doesNotMatch(onlyActual, /data-testid="expected"/);
  assert.equal(locOf({ path: "a.ts", line: 4, where: { path: "a.ts", start: 4, end: 9 } }), "a.ts:4-9");
  assert.equal(locOf({ path: "a.ts", line: 4, where: { path: "a.ts", start: 4, end: 4 } }), "a.ts:4");
  assert.equal(locOf({ path: "a.ts", line: "?" }), "a.ts:?");
});

test("an older finding still renders exactly its old rows: no where snippet, no what-to-check, no contrast, no evidence", () => {
  const html = desk(old);
  assert.doesNotMatch(html, /diff-snippet|what-to-check|data-testid="contrast"|data-testid="evidence"|What to check|Expected|Evidence/);
  assert.match(html, /data-testid="where"/); // the location row is always there
  assert.match(html, /src\/javascripts\/Badge.tsx:10/);
  const ph = phone(old);
  assert.doesNotMatch(ph, /diff-snippet|what-to-check|data-testid="contrast"|data-testid="evidence"/);
});

test("phone card carries the same rows in the same order in the closed card", () => {
  const html = phone(plain);
  assert.doesNotMatch(html, /data-testid="finding-detail"/);
  assert.ok(
    ascending(order(html, [plain.title, "app/models/Product.php:42-43", 'data-testid="diff-snippet"', "What to check", "Expected", "Actual", 'data-testid="why-it-matters"', 'data-testid="evidence"'])),
  );
  assert.doesNotMatch(html, /data-testid="how-to-verify"/);
});

const guide: GuideData = {
  does: "Shows a lead-time badge on every product card.",
  why: "Shoppers asked how long a product takes to arrive.",
  risk: "can break",
  readPlan: [
    { path: "app/models/Product.php", lines: "40-43", why: "The badge reads the vendor here." },
    { path: "src/javascripts/Badge.tsx", lines: null, why: "" },
  ],
  notCovered: ["lockfile", "generated snapshots"],
};

test("the reading guide renders what · why · read in this order · not reviewed, open by default, with the risk word in the header", () => {
  const html = renderToStaticMarkup(createElement(ReadingGuide, { guide, onJump: noop }));
  assert.match(html, /data-testid="reading-guide"[^>]*data-open="1"/);
  assert.match(html, /aria-expanded="true"[^>]*data-testid="guide-toggle"/);
  assert.match(html, /data-testid="guide-risk"[^>]*data-risk="can break"/);
  assert.ok(ascending(order(html, ["Reading guide", "What this PR does", guide.does, "Why", guide.why, "Read in this order", "app/models/Product.php:40-43", "The badge reads the vendor here.", "src/javascripts/Badge.tsx", "Not reviewed", "lockfile · generated snapshots"])));
  assert.equal((html.match(/data-testid="guide-row"/g) || []).length, 2);
  // Rows are buttons when a jump handler is given, plain text otherwise.
  assert.match(html, /<button[^>]*title="Go to this hunk"/);
  const noJump = renderToStaticMarkup(createElement(ReadingGuide, { guide }));
  assert.doesNotMatch(noJump, /Go to this hunk/);
  // A row without lines shows the path alone; one without a reason has no dash.
  assert.match(html, /data-testid="guide-row-loc">src\/javascripts\/Badge.tsx</);
});

test("the reading guide collapses to its header with a one-line peek, and renders nothing for an empty guide", () => {
  const closed = renderToStaticMarkup(createElement(ReadingGuide, { guide, defaultOpen: false }));
  assert.match(closed, /data-open="0"/);
  assert.match(closed, /aria-expanded="false"/);
  assert.match(closed, /data-testid="guide-peek"/);
  assert.doesNotMatch(closed, /Read in this order/);
  const empty: GuideData = { does: "", why: "", risk: null, readPlan: [], notCovered: [] };
  assert.equal(renderToStaticMarkup(createElement(ReadingGuide, { guide: empty })), "");
  // Risk words map to tones; an unknown word still renders in graphite rather than throwing.
  for (const [risk, tone] of [["breaks", "red"], ["can break", "amber"], ["safe-looking", "green"], ["unclear", "graphite"]] as const) {
    const html = renderToStaticMarkup(createElement(ReadingGuide, { guide: { ...guide, risk } }));
    assert.match(html, new RegExp(`data-testid="guide-risk"[^>]*data-tone="${tone}"|data-tone="${tone}"[^>]*data-testid="guide-risk"`), risk);
  }
});
