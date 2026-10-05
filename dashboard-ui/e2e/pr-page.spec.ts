// The PR page after the restructure (design.md §6, tasks.md Lane P): the commit bar is the one
// raised surface and stays at the bottom of the viewport; a post switches it in place; every
// condition is a word on one status line and the page never stacks banners; an unknown PR keeps
// its frame; the keyboard reaches the bar with the ring showing.
import { expect, test, type Page } from "@playwright/test";
import { PR, PR3, REPO, REPO2, USER, patchJson } from "./fixture";

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

  test("the finding card: severity and path in the head, Explain as a disclosure, one verb for the comment", async ({ page }) => {
    await page.goto(prPath(REPO, PR));
    await settled(page);
    const card = page.locator(".finding").first();
    // Head row: checkbox, severity badge, the path — no placement chip on an inline finding.
    const head = card.locator(".fhead");
    await expect(head.getByTestId("status-badge")).toHaveCount(1);
    await expect(head.getByTestId("status-badge")).toHaveText("Should fix");
    await expect(head.getByTestId("placement")).toHaveCount(0);
    // The path is whole, in sans, and offers a copy.
    const path = head.getByTestId("finding-path");
    await expect(path).toHaveText("app/models/Product.php:42");
    expect(await path.evaluate((el) => getComputedStyle(el).fontFamily)).not.toMatch(/mono/i);
    await expect(card.getByRole("button", { name: /copy app\/models/i })).toBeVisible();
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
