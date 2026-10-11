// The PR page after the restructure (design.md §6, tasks.md Lane P): the commit bar is the one
// raised surface and stays at the bottom of the viewport; a post switches it in place; every
// condition is a word on one status line and the page never stacks banners; an unknown PR keeps
// its frame; the keyboard reaches the bar with the ring showing.
import { expect, test, type Page } from "@playwright/test";
import { PR, PR3, PR6, REPO, REPO2, USER, patchJson } from "./fixture";

const enc = (r: string) => encodeURIComponent(r);
const prPath = (repo: string, num: string) => `/pr?repo=${enc(repo)}&pr=${num}`;

async function settled(page: Page) {
  await expect(page.getByTestId("pr-loading")).toHaveCount(0, { timeout: 15_000 });
}

test.describe("the commit bar", () => {
  test.use({ viewport: { width: 1440, height: 560 } });

  test("stays at the bottom of the viewport while the findings run past it", async ({ page }) => {
    await page.goto(prPath(REPO, PR));
    await settled(page);
    const tall = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight);
    expect(tall, "the page is taller than the viewport").toBe(true);
    const bar = page.getByTestId("commit-bar");
    await expect(bar).toBeVisible();
    await expect(bar).not.toHaveClass(/is-entering/); // the first-stage slide has finished
    const before = (await bar.boundingBox())!;
    expect(Math.round(before.y + before.height)).toBeLessThanOrEqual(560);
    expect(before.y + before.height).toBeGreaterThan(560 - 4);
    // Scroll partway: still pinned to the bottom edge, not scrolled out.
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(100);
    const after = (await bar.boundingBox())!;
    expect(after.y + after.height).toBeGreaterThan(560 - 4);
    expect(Math.round(after.y + after.height)).toBeLessThanOrEqual(560);
    // It is the one raised surface: a shadow, no border.
    const shadow = await bar.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(shadow).not.toBe("none");
  });
});

test.describe("posting", () => {
  test("switches the commit bar to the posted state in place (fixture dry run)", async ({ page }) => {
    // The server's own dry-run receipt, byte for byte the shape _banner() emits. Stubbed rather
    // than posted for real: a real dry-run post records two learnings in the shared fixture and
    // the Learnings and Insights specs count those.
    await page.route("**/api/post", async (route) => {
      await route.fulfill({
        json: {
          bannerHtml:
            "<div class='banner warn'><span class='status is-amber' aria-hidden='true'><i></i></span>" +
            "<div><b>DRY RUN — nothing was sent to GitHub.</b><br>Your review would post as " +
            "<code>COMMENT</code> — 1 inline comment, 1 in the summary. Set <code>DRY_RUN=0</code> " +
            "and restart the <code>reviewstage</code> service to post for real.</div></div>",
        },
      });
    });
    await page.goto(prPath(REPO, PR));
    await settled(page);
    const bar = page.getByTestId("commit-bar");
    await expect(bar).toContainText("2 staged");
    await expect(page.getByTestId("step-done")).toHaveCount(1); // Reviewed
    let reloads = 0;
    page.on("framenavigated", () => reloads++);
    await bar.getByRole("button", { name: /post selected/i }).click();
    // No navigation: the bar itself changes.
    await expect(bar.getByTestId("commit-posted")).toContainText(`Posted as ${USER}`);
    await expect(bar.getByRole("button", { name: /^posted$/i })).toBeDisabled();
    await expect(bar.getByTestId("request-changes")).toHaveCount(0);
    expect(reloads).toBe(0);
    // The progress step ticks, and the server's receipt is the only other change on the page.
    await expect(page.getByTestId("step-done")).toHaveCount(2);
    await expect(page.getByTestId("step-done").filter({ hasText: "Comments posted" })).toBeVisible();
    await expect(page.locator(".banner.warn")).toContainText(/dry run/i);
    await expect(page.locator(".banner:visible")).toHaveCount(1);
    // Findings stay readable and their edges keep the staged fill.
    await expect(page.locator(".finding.is-staged")).toHaveCount(2);
  });
});

test.describe("the status line", () => {
  test("carries every condition as a word, with at most one banner, on the worst pilot state", async ({ page }) => {
    // stale + head moved + Claude disconnected + dry run + placement unknown, all at once.
    await patchJson(page, `**/api/pr?repo=${enc(REPO2)}&pr=${PR3}*`, (body) => ({
      stale: true,
      claudeConnected: false,
      review: {
        ...body.review,
        anchorsUnknown: true,
        approve: {
          ...body.review.approve,
          reviewedHead: "0badf00dcafe",
          currentHead: "1111222233334444",
        },
      },
    }));
    await page.goto(prPath(REPO2, PR3));
    await settled(page);
    const line = page.getByTestId("status-line");
    await expect(line).toBeVisible();
    // Ordered by what the reviewer must act on: the moved branch first.
    const words = await line.locator("[data-slot=badge]").allInnerTexts();
    expect(words[0]).toBe("Branch moved");
    expect(words).toContain("New commits since review");
    expect(words).toContain("Claude not connected");
    expect(words).toContain("Placement unknown");
    expect(words).toContain("Dry run");
    expect(words).toContain("Reviewed");
    // Each carries its full sentence for the hover.
    await expect(line.getByTestId("status-stale")).toHaveAttribute("title", /pushed new commits/i);
    await expect(line.getByTestId("status-dry")).toHaveAttribute("title", /do not write to GitHub/i);
    // Nothing full-width above the verdict: banners are for errors only.
    await expect(page.locator(".banner:visible")).toHaveCount(0);
    // The verdict comes straight after the status line.
    const lineBox = (await line.boundingBox())!;
    const verdictBox = (await page.getByTestId("verdict").boundingBox())!;
    expect(verdictBox.y - (lineBox.y + lineBox.height)).toBeLessThan(80);
    // The moved-head warning still guards the approval, inside its section.
    await page.getByTestId("sec-approve").click();
    await expect(page.getByTestId("head-moved")).toBeVisible();
    await expect(page.locator(".banner:visible")).toHaveCount(1);
    await expect(page.getByTestId("approve-panel").getByRole("button", { name: /approve/i })).toBeDisabled();
  });

  test("the page reads breadcrumb, title, actions, status, verdict, findings, sections, bar", async ({ page }) => {
    await page.goto(prPath(REPO, PR));
    await settled(page);
    const y = async (sel: string) => (await page.locator(sel).first().boundingBox())!.y;
    const order = ["[data-testid=crumbs]", "h1", "[data-testid=status-line]", "[data-testid=verdict]", ".finding", "[data-testid=section-row]"];
    const ys = await Promise.all(order.map(y));
    for (let i = 1; i < ys.length; i++) expect(ys[i], `${order[i]} is below ${order[i - 1]}`).toBeGreaterThan(ys[i - 1]);
    // The bar is sticky, so its box says nothing about flow; it follows the sections in the DOM.
    const barLast = await page.evaluate(() => {
      const row = document.querySelector("[data-testid=section-row]")!;
      const bar = document.querySelector("[data-testid=commit-bar]")!;
      return !!(row.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(barLast).toBe(true);
    // One Actions menu in the header, on the title's line.
    const actions = page.getByTestId("pr-actions");
    expect(Math.abs((await actions.boundingBox())!.y - (await y("h1")))).toBeLessThan(12);
    await actions.click();
    const menu = page.getByTestId("pr-actions-menu");
    await expect(menu.getByRole("menuitem", { name: /open on github/i })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /qa guide/i })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /stacked review \(2 PRs\)/i })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    // Four sections as one tab list, the first open.
    const row = page.getByTestId("section-row");
    await expect(row).toHaveRole("tablist");
    const btns = row.getByRole("tab");
    await expect(btns).toHaveText(["Full summary", "What this PR does", "Approve", "Re-run"]);
    const tops = await Promise.all([0, 1, 2, 3].map(async (i) => (await btns.nth(i).boundingBox())!.y));
    expect(new Set(tops.map(Math.round)).size).toBe(1);
    await expect(page.getByTestId("approve-panel")).toHaveCount(0);
    await btns.nth(2).click();
    await expect(page.getByTestId("approve-panel")).toBeVisible();
    await expect(btns.nth(2)).toHaveAttribute("aria-selected", "true");
  });

  test("the finding card: severity in the head, the §1.3 rows in order, Explain as a disclosure, one verb for the comment", async ({ page }) => {
    await page.goto(prPath(REPO, PR));
    await settled(page);
    const card = page.locator(".finding").first();
    // Head row: checkbox, severity badge, confidence — no path (it is the Where row now), no
    // placement chip on an inline finding.
    const head = card.locator(".fhead");
    await expect(head.getByTestId("status-badge")).toHaveCount(1);
    await expect(head.getByTestId("status-badge")).toHaveText("Should fix");
    await expect(head.getByTestId("placement")).toHaveCount(0);
    await expect(head.getByTestId("finding-path")).toHaveCount(0);
    await expect(head.getByTestId("confidence")).toHaveText("high confidence");
    // The Where row: the path whole, in sans, with a copy button, and the cited diff lines
    // under it with the changed line highlighted and the cited line marked.
    const where = card.getByTestId("where");
    const path = where.getByTestId("finding-path");
    await expect(path).toHaveText("app/models/Product.php:42");
    expect(await path.evaluate((el) => getComputedStyle(el).fontFamily)).not.toMatch(/mono/i);
    await expect(card.getByRole("button", { name: /copy app\/models/i })).toBeVisible();
    const snippet = where.getByTestId("diff-snippet");
    await expect(snippet).toBeVisible();
    await expect(snippet.locator("[data-kind=add]")).toHaveCount(1);
    await expect(snippet.locator("[data-kind=add]")).toContainText("$leadTime = $vendor->leadTime();");
    await expect(snippet.locator("[data-cited]")).toHaveCount(1);
    expect(await snippet.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/mono/i);
    // trust-and-plain §1.3, top to bottom: title · where · what to check · expected/actual ·
    // why it matters · evidence. The older verify line sits under "Edit comment" when the run
    // also gave a what_to_check.
    await expect(card.getByTestId("what-to-check")).toContainText("What to check");
    await expect(card.getByTestId("what-to-check")).toContainText("Check that `$vendor` is null-guarded");
    await expect(card.getByTestId("expected")).toHaveText("A product with no vendor shows no badge.");
    await expect(card.getByTestId("actual")).toHaveText("The badge throws on a null vendor.");
    await expect(card.getByTestId("why-it-matters")).toContainText("A shopper viewing such a product");
    await expect(card.getByTestId("evidence")).toHaveAttribute("data-status", "pass");
    await expect(card.getByTestId("evidence")).toContainText("The cited lines are in this diff and mention `vendor`, `leadTime`.");
    await expect(card.getByTestId("how-to-verify")).toHaveCount(0);
    const ys = await Promise.all(
      ["finding-title", "where", "what-to-check", "contrast", "why-it-matters", "evidence"].map(async (id) => (await card.getByTestId(id).boundingBox())!.y),
    );
    for (let i = 1; i < ys.length; i++) expect(ys[i], `row ${i} is below row ${i - 1}`).toBeGreaterThan(ys[i - 1]);
    // The second card's run gave neither a what_to_check nor a verify line, so it has no such
    // row; its file is not in the diff, so the evidence line warns and no snippet is cut.
    const second = page.locator(".finding").nth(1);
    await expect(second.getByTestId("confidence")).toHaveText("medium confidence");
    await expect(second.getByTestId("how-to-verify")).toHaveCount(0);
    await expect(second.getByTestId("what-to-check")).toHaveCount(0);
    await expect(second).not.toContainText("How to verify");
    await expect(second.getByTestId("evidence")).toHaveAttribute("data-status", "warn");
    await expect(second.getByTestId("evidence")).toContainText("`src/javascripts/Badge.tsx` is not a file this PR changes.");
    await expect(second.getByTestId("diff-snippet")).toHaveCount(0);
    await expect(second.getByTestId("finding-select")).toBeChecked(); // one flag: still staged
    // Explain opens and closes again.
    const explain = card.getByTestId("explain");
    await expect(explain).toHaveText("Explain simply");
    await expect(explain).toHaveAttribute("aria-expanded", "false");
    await explain.click();
    await expect(explain).toHaveAttribute("aria-expanded", "true");
    await explain.click();
    await expect(explain).toHaveAttribute("aria-expanded", "false");
    // The comment toggle keeps one label whichever way it is.
    const toggle = card.getByRole("button", { name: "Edit comment" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toHaveText("Edit comment");
    await expect(card.getByTestId("finding-body")).toBeVisible();
    // The verify line lives under "More" (the comment disclosure) once a what_to_check exists.
    await expect(card.getByTestId("how-to-verify")).toContainText("Open a product whose vendor is null");
  });
});

// trust-and-plain Part 1: the Reading guide above the findings and the evidence check on each.
test.describe("the reading guide and the evidence check", () => {
  test.use({ viewport: { width: 1280, height: 640 } });

  test("the Reading guide sits above the findings, open by default, collapses to a header, and a row scrolls to the card that renders that hunk", async ({ page }) => {
    await page.goto(prPath(REPO, PR));
    await settled(page);
    const guide = page.getByTestId("reading-guide");
    await expect(guide).toBeVisible();
    await expect(guide).toHaveAttribute("data-open", "1");
    expect((await guide.boundingBox())!.y).toBeLessThan((await page.locator(".finding").first().boundingBox())!.y);
    expect((await guide.boundingBox())!.y).toBeGreaterThan((await page.getByTestId("verdict").boundingBox())!.y);
    await expect(guide.getByTestId("guide-risk")).toHaveText("can break");
    await expect(guide.getByTestId("guide-does")).toContainText("Shows a lead-time badge on every product card.");
    await expect(guide.getByTestId("guide-why")).toContainText("Shoppers asked how long a product takes to arrive.");
    const rows = guide.getByTestId("guide-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("app/models/Product.php:40-43");
    await expect(rows.nth(0)).toContainText("A null vendor is the risk.");
    await expect(guide.getByTestId("guide-not-covered")).toContainText("lockfile · generated snapshots");
    // Collapse: the header and the risk word stay, the body goes, a one-line peek appears.
    await guide.getByTestId("guide-toggle").click();
    await expect(guide).toHaveAttribute("data-open", "0");
    await expect(guide.getByTestId("guide-does")).toHaveCount(0);
    await expect(guide.getByTestId("guide-risk")).toBeVisible();
    await expect(guide.getByTestId("guide-peek")).toContainText("Shows a lead-time badge");
    await guide.getByTestId("guide-toggle").click();
    await expect(guide).toHaveAttribute("data-open", "1");
    // A row goes to the hunk: the card for that file is scrolled into view (its snippet is the
    // hunk). Scroll away first so the jump is observable.
    await page.evaluate(() => window.scrollTo(0, 0));
    await rows.nth(1).getByRole("button").click();
    const badge = page.locator(".finding").nth(1);
    await expect(badge).toHaveAttribute("data-finding", "1");
    await expect
      .poll(async () => {
        const b = (await badge.boundingBox())!;
        const vh = page.viewportSize()!.height;
        return b.y >= 0 && b.y + Math.min(b.height, 80) <= vh;
      })
      .toBe(true);
  });

  test("the evidence check: one plain line per card, a warning keeps a single-flag finding staged, two flags send it to the maybe tray", async ({ page }) => {
    await page.goto(prPath(REPO, PR6));
    await settled(page);
    // Five cards in the list — blockers, then should-fixes, then the nit — and one in the tray.
    const cards = page.locator("[data-testid=post-panel] .finding");
    await expect(cards).toHaveCount(5);
    const expectEvidence = async (i: number, status: string, flags: string | null, text: string) => {
      const ev = cards.nth(i).getByTestId("evidence");
      await expect(ev).toHaveAttribute("data-status", status);
      if (flags) await expect(ev).toHaveAttribute("data-flags", flags);
      else expect(await ev.getAttribute("data-flags")).toBeNull();
      await expect(ev).toContainText(text);
    };
    await expectEvidence(0, "pass", null, "The cited lines are in this diff and mention `sleep`.");
    await expectEvidence(1, "warn", "no_contrast", "A blocker needs both Expected and Actual.");
    await expectEvidence(2, "warn", "path_not_in_diff", "`app/sync/SyncJob.php` is not a file this PR changes.");
    await expectEvidence(3, "warn", "lines_not_in_diff", "Lines 80 are not in this PR's changes to `Retry.php`.");
    await expectEvidence(4, "warn", "symbol_not_found", "`maxAttempts` does not appear in the cited lines.");
    // One flag never unticks a finding: all five are staged.
    for (let i = 0; i < 5; i++) await expect(cards.nth(i).getByTestId("finding-select")).toBeChecked();
    await expect(page.getByTestId("commit-bar")).toContainText("5");
    // The clean card cites a range: the Where row reads path:start-end and the snippet marks
    // both cited lines, with the added lines highlighted.
    const clean = cards.nth(0);
    await expect(clean.getByTestId("finding-path")).toHaveText("app/sync/Retry.php:26-27");
    await expect(clean.getByTestId("diff-snippet").locator("[data-cited]")).toHaveCount(2);
    await expect(clean.getByTestId("diff-snippet").locator("[data-cited]").first()).toContainText("if ($attempts > 5) throw $e;");
    expect(await clean.getByTestId("diff-snippet").locator("[data-kind=add]").count()).toBeGreaterThanOrEqual(7);
    // Two flags: the finding is in the maybe tray, unticked, although the model said high.
    const maybe = page.getByTestId("maybe");
    await expect(maybe).toContainText("1 lower-confidence finding");
    await maybe.getByRole("button").first().click();
    const demoted = maybe.locator(".finding");
    await expect(demoted).toHaveCount(1);
    await expect(demoted.getByTestId("evidence")).toHaveAttribute("data-flags", "path_not_in_diff no_contrast");
    await expect(demoted.getByTestId("confidence")).toHaveText("high confidence");
    await expect(demoted.getByTestId("finding-select")).not.toBeChecked();
    // The guide on this PR names the risk word "breaks".
    await expect(page.getByTestId("guide-risk")).toHaveText("breaks");
  });
});

test.describe("an unknown PR", () => {
  test("keeps the breadcrumb and the typed reference, and offers a way back or on", async ({ page }) => {
    await page.goto(prPath(REPO, "999999"));
    await settled(page);
    const frame = page.getByTestId("pr-unknown");
    const crumbs = frame.getByRole("navigation", { name: "Breadcrumb" });
    await expect(crumbs).toContainText("Queue");
    await expect(crumbs.getByTestId("repo-pill")).toHaveText(REPO);
    await expect(frame.getByRole("heading", { level: 1 })).toContainText("#999999");
    await expect(frame.getByTestId("pr-error")).toBeVisible();
    const actions = frame.getByTestId("unknown-actions");
    await expect(actions.getByRole("link", { name: /back to queue/i })).toHaveAttribute("href", "/");
    await actions.getByRole("button", { name: /try another/i }).click();
    await expect(page.locator(".cmdk")).toBeVisible();
  });
});

test.describe("keyboard", () => {
  test("Tab reaches the commit bar's button with the ring visible", async ({ page }) => {
    await page.goto(prPath(REPO, PR));
    await settled(page);
    const target = page.getByTestId("commit-bar").getByRole("button", { name: /post selected/i });
    let reached = false;
    for (let i = 0; i < 80 && !reached; i++) {
      await page.keyboard.press("Tab");
      reached = await target.evaluate((el) => el === document.activeElement);
    }
    expect(reached, "Tab lands on the Post button").toBe(true);
    // The system's controls draw the ring as a box-shadow layer; the legacy 2px outline also passes.
    const ring = await target.evaluate((el) => {
      const cs = getComputedStyle(el);
      const shadowRing = /(?:rgba?|oklab)\((?!0, 0, 0, 0\))(?![^)]*\/ 0\))[^)]*\)/.test(cs.boxShadow);
      return (cs.outlineStyle === "solid" && cs.outlineWidth === "2px") || shadowRing;
    });
    expect(ring).toBe(true);
    await expect(target).toBeInViewport();
  });
});

test.describe("the stack page", () => {
  test("uses the PR page's title pattern and status badges on its rows", async ({ page }) => {
    await page.goto(`/stack?repo=${enc(REPO)}&pr=${PR}`);
    await settled(page);
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toContainText(`#${PR} Stacked review`);
    await expect(h1).not.toContainText(REPO);
    await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByTestId("repo-pill")).toHaveText(REPO);
    const rows = page.getByTestId("stack-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.first().getByTestId("status-badge")).toHaveText("Reviewed");
    await expect(rows.first()).toHaveAttribute("data-current", "true");
  });
});

// Dismissal reasons (openspec/changes/p0-proof/lane2-reasons.md). The drop is the untick and
// is instant; the "Why?" chip row appears under the card for ~6 s or until the next decision;
// a chosen reason rides the post body as `reasons[i]` for dropped indices only.
test.describe("dismissal reasons", () => {
  const DRY =
    "<div class='banner warn'><span class='status is-amber' aria-hidden='true'><i></i></span>" +
    "<div><b>DRY RUN — nothing was sent to GitHub.</b></div></div>";

  test("an untick drops at once and asks why; the chosen reason collapses to one chip and travels with the post", async ({ page }) => {
    const posts: Array<Record<string, unknown>> = [];
    await page.route("**/api/post", async (route) => {
      posts.push(route.request().postDataJSON());
      await route.fulfill({ json: { bannerHtml: DRY } });
    });
    await page.goto(prPath(REPO, PR));
    await settled(page);
    const cards = page.getByTestId("finding");
    const nit = cards.nth(1);
    await expect(page.getByTestId("reason-row")).toHaveCount(0);
    await nit.getByTestId("finding-select").uncheck();
    // The decision landed before anything was asked.
    await expect(nit.getByTestId("finding-select")).not.toBeChecked();
    await expect(nit).not.toHaveAttribute("data-staged", "1");
    await expect(page.getByTestId("commit-bar")).toContainText("1 staged");
    // The row: a group of seven chips and a skip, under this card only, below the head.
    const row = nit.getByTestId("reason-row");
    await expect(row).toBeVisible();
    await expect(row).toHaveRole("group");
    await expect(row.getByTestId("reason-chip")).toHaveCount(7);
    await expect(cards.nth(0).getByTestId("reason-row")).toHaveCount(0);
    const head = (await nit.locator(".fhead").boundingBox())!;
    const rowBox = (await row.boundingBox())!;
    expect(rowBox.y).toBeGreaterThanOrEqual(head.y + head.height - 1);
    await row.getByRole("button", { name: "Style nit" }).click();
    await expect(nit.getByTestId("reason-row")).toHaveCount(0);
    const picked = nit.getByTestId("reason-picked");
    await expect(picked).toHaveAttribute("data-reason", "style_nit");
    await expect(picked).toContainText("Dropped · style nit");
    // Post: the reason goes with the dropped index, and only that one.
    await page.getByTestId("commit-bar").getByRole("button", { name: /post selected/i }).click();
    await expect(page.getByTestId("commit-posted")).toBeVisible();
    expect(posts).toHaveLength(1);
    expect(posts[0].reasons).toEqual({ "1": "style_nit" });
    expect(posts[0].selected).toEqual([0]);
  });

  test("the row leaves by itself after six seconds, or on the next decision, and a re-tick clears the answer", async ({ page }) => {
    await page.goto(prPath(REPO, PR));
    await settled(page);
    await page.clock.install();
    const cards = page.getByTestId("finding");
    const [first, second] = [cards.nth(0), cards.nth(1)];
    await second.getByTestId("finding-select").uncheck();
    await expect(second.getByTestId("reason-row")).toBeVisible();
    await page.clock.fastForward(5_900);
    await expect(second.getByTestId("reason-row")).toBeVisible();
    await page.clock.fastForward(200);
    await expect(second.getByTestId("reason-row")).toHaveCount(0);
    await expect(second.getByTestId("reason-picked")).toHaveCount(0);
    await expect(second.getByTestId("finding-select")).not.toBeChecked();
    // Another card's decision ends an open question at once.
    await second.getByTestId("finding-select").check();
    await second.getByTestId("finding-select").uncheck();
    await expect(second.getByTestId("reason-row")).toBeVisible();
    await first.getByTestId("finding-select").uncheck();
    await expect(second.getByTestId("reason-row")).toHaveCount(0);
    await expect(first.getByTestId("reason-row")).toBeVisible();
    // A chosen reason outlives the row, and a re-tick forgets it.
    await first.getByRole("button", { name: "Incorrect" }).click();
    await expect(first.getByTestId("reason-picked")).toHaveAttribute("data-reason", "incorrect");
    await page.clock.fastForward(10_000);
    await expect(first.getByTestId("reason-picked")).toBeVisible();
    await first.getByTestId("reason-clear").click();
    await expect(first.getByTestId("reason-picked")).toHaveCount(0);
    await expect(first.getByTestId("finding-select")).not.toBeChecked();
    await first.getByTestId("finding-select").check();
    await first.getByTestId("finding-select").uncheck();
    await first.getByRole("button", { name: "Irrelevant" }).click();
    await expect(first.getByTestId("reason-picked")).toHaveAttribute("data-reason", "irrelevant");
    await first.getByTestId("finding-select").check();
    await expect(first.getByTestId("reason-picked")).toHaveCount(0);
    await expect(first.getByTestId("reason-row")).toHaveCount(0);
  });

  test("the chips are reachable from the keyboard, and Escape dismisses the row", async ({ page }) => {
    await page.goto(prPath(REPO, PR));
    await settled(page);
    const nit = page.getByTestId("finding").nth(1);
    const box = nit.getByTestId("finding-select");
    await box.focus();
    await page.keyboard.press("Space");
    await expect(box).not.toBeChecked();
    const row = nit.getByTestId("reason-row");
    await expect(row).toBeVisible();
    // Tab order: checkbox → the chips, left to right (the copy-path button now sits in the
    // Where row under the title, after the chip row).
    await page.keyboard.press("Tab");
    await expect(row.getByTestId("reason-chip").first()).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(row.getByTestId("reason-chip").nth(1)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(nit.getByTestId("reason-row")).toHaveCount(0);
    await expect(box).not.toBeChecked();
    // The skip button closes it too.
    await box.check();
    await box.uncheck();
    await nit.getByTestId("reason-skip").click();
    await expect(nit.getByTestId("reason-row")).toHaveCount(0);
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  // The phone has no commit bar: a floating Post pill above the tab bar (mobile-screens.spec).
  test("the Post pill floats above the tab bar and the last finding is reachable above it", async ({ page }) => {
    await page.goto(prPath(REPO, PR));
    await settled(page);
    await expect(page.getByTestId("commit-bar")).toHaveCount(0);
    const pill = page.getByTestId("post-pill");
    await expect(pill).toBeVisible();
    expect(await pill.evaluate((el) => getComputedStyle(el.parentElement!).position)).toBe("fixed");
    const pillBox = (await pill.boundingBox())!;
    const tab = (await page.locator(".tabbar").boundingBox())!;
    expect(Math.round(pillBox.y + pillBox.height)).toBeLessThanOrEqual(Math.round(tab.y) + 1);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const last = (await page.getByTestId("finding").last().boundingBox())!;
    expect(last.y + last.height).toBeLessThanOrEqual(pillBox.y + 1);
  });
});
