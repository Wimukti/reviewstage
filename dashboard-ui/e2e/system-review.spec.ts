// Lane S2 of the system rebuild (openspec/changes/rebuild-on-a-system/design.md §2–§4): the PR
// page and the stack are built from the components, not from bespoke rules. No dot-and-word
// status anywhere on the PR page; the repository is a pill on the breadcrumb line, never in the
// title; every finding carries a severity badge and a sans path; the staged card's one border is
// the severity tone and its head is lit; the post button is [data-post] and glows only while
// something is staged; the sections are a Radix tab list with one panel; the Approve textarea
// and the Re-run select are shadcn; nothing scrolls sideways on a phone and the bar stays put.
import { expect, test, type Page } from "@playwright/test";
import { PR, PR3, REPO, REPO2, patchJson } from "./fixture";

const enc = (r: string) => encodeURIComponent(r);
const prPath = (repo: string, num: string) => `/pr?repo=${enc(repo)}&pr=${num}`;

// The browser fetches avatars from github.com; the suite is offline, so answer every one with a
// 1×1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
async function fakeAvatars(page: Page) {
  await page.route(/https:\/\/github\.com\/[^/]+\.png/, (route) => route.fulfill({ contentType: "image/png", body: PNG }));
}
// A token's rendered colour, read the way the browser resolves it, so the test never hard-codes a hex.
async function tokenColor(page: Page, token: string) {
  return page.evaluate((t) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${t})`;
    document.body.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }, token);
}

test.describe("the PR page on the system", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("no dot-and-word status, the repository as a pill beside the breadcrumb, not in the title", async ({ page }) => {
    await fakeAvatars(page);
    await page.goto(prPath(REPO, PR));
    await expect(page.locator(".finding").first()).toBeVisible();
    expect(await page.evaluate(() => document.querySelectorAll(".status").length)).toBe(0);
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toContainText(`#${PR}`);
    await expect(h1).toContainText(/lead-time badge/i);
    await expect(h1).not.toContainText(REPO);
    const pill = page.getByRole("navigation", { name: "Breadcrumb" }).getByTestId("repo-pill");
    await expect(pill).toHaveText(REPO);
    await expect(pill.locator("img[alt]")).toHaveCount(1);
    // The author is an avatar and a name on the status line; the size reads as metadata.
    await expect(page.getByTestId("status-line").getByTestId("user-avatar")).toHaveAttribute("data-login", "teammate");
    await expect(page.getByTestId("status-line")).toContainText("+42 −8 · 5 files");
    // The one Actions menu is a Radix menu.
    await page.getByTestId("pr-actions").click();
    await expect(page.getByRole("menu")).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /open on github/i })).toHaveAttribute("href", /github\.com/);
    await page.keyboard.press("Escape");
  });

  test("every finding carries a severity badge and a sans path; the staged card wears the tone", async ({ page }) => {
    await page.goto(prPath(REPO, PR));
    const cards = page.locator(".finding");
    await expect(cards).toHaveCount(2);
    for (const card of await cards.all()) {
      const sev = card.locator(".fhead").getByTestId("status-badge").first();
      await expect(sev).toHaveText(/^(Blocker|Should fix|Nit|Question)$/);
      await expect(sev.locator("svg")).toHaveCount(1);
      const path = card.getByTestId("finding-path");
      await expect(path).toHaveText(/\.(php|tsx):\d+$/);
      expect(await path.evaluate((el) => getComputedStyle(el).fontFamily)).not.toMatch(/mono/i);
    }
    // The should-fix card: a 3px left border in amber, no other border, and the head lit.
    const first = cards.first();
    await expect(first).toHaveClass(/is-staged/);
    const box = await first.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { left: cs.borderLeftWidth, leftColor: cs.borderLeftColor, top: cs.borderTopWidth, right: cs.borderRightWidth };
    });
    expect(box.left).toBe("3px");
    expect(box.leftColor).toBe(await tokenColor(page, "--amber"));
    expect(box.top).toBe("0px");
    expect(box.right).toBe("0px");
    expect(await first.locator(".fhead").evaluate((el) => getComputedStyle(el).backgroundImage)).toMatch(/gradient/);
    // Unticked: the light goes out, the tone stays (severity is not selection).
    await first.getByTestId("finding-select").uncheck();
    await expect(first).not.toHaveClass(/is-staged/);
    expect(await first.locator(".fhead").evaluate((el) => getComputedStyle(el).backgroundImage)).toBe("none");
    expect(await first.evaluate((el) => getComputedStyle(el).borderLeftColor)).toBe(await tokenColor(page, "--amber"));
  });

  test("the post button is [data-post] and glows only while the count is above zero", async ({ page }) => {
    await page.goto(prPath(REPO, PR));
    const bar = page.getByTestId("commit-bar");
    const post = bar.locator("[data-post]");
    await expect(post).toHaveText(/post selected/i);
    const shadow = () => post.evaluate((el) => getComputedStyle(el).boxShadow);
    await expect(bar).toHaveClass(/has-staged/);
    expect(await shadow()).not.toBe("none");
    const sel = page.locator(".finding").getByTestId("finding-select");
    await sel.nth(0).uncheck();
    await sel.nth(1).uncheck();
    await expect(bar).toContainText("0 staged");
    await expect.poll(shadow).toBe("none");
    await sel.nth(1).check();
    await expect.poll(shadow).not.toBe("none");
    // The count is display type, tabular, and reads as one phrase with its label.
    const count = bar.locator(".stage-count[data-stage-count]");
    expect(await count.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/Geist/);
    await expect(bar.getByTestId("commit-summary")).toContainText("1 staged");
  });

  test("the sections are a tab list with exactly one panel; Approve and Re-run are shadcn controls", async ({ page }) => {
    await patchJson(page, `**/api/pr?repo=${enc(REPO2)}&pr=${PR3}*`, { claudeConnected: true });
    await page.goto(prPath(REPO2, PR3));
    const list = page.getByTestId("section-row");
    await expect(list).toHaveRole("tablist");
    await expect(list.getByRole("tab")).toHaveCount(3); // no explainer on this review: summary, Approve, Re-run
    await expect(page.getByRole("tabpanel")).toHaveCount(1);
    await expect(page.getByRole("tabpanel")).toBeVisible();
    // No hand-rolled tablist, menu or dialog anywhere on the page: Radix owns the roles.
    const bespoke = await page.evaluate(() =>
      [...document.querySelectorAll('[role="tablist"], [role="tab"], [role="tabpanel"]')].filter((el) => !el.hasAttribute("data-slot")).length,
    );
    expect(bespoke).toBe(0);
    await page.getByTestId("sec-approve").click();
    const approve = page.getByTestId("approve-panel");
    await expect(approve.locator("textarea[data-slot=textarea]")).toBeVisible();
    await expect(approve.locator("[data-slot=checkbox]")).toBeVisible(); // the blocker's acknowledgement
    await page.getByTestId("sec-rerun").click();
    const form = page.getByTestId("run-form");
    await expect(form.locator("[data-slot=select-trigger]").first()).toBeVisible();
    await expect(form.locator("textarea[data-slot=textarea]")).toBeVisible();
    await expect(form.getByTestId("suggested-effort")).toContainText(/suggested/i);
    // The effort picker is a Radix listbox.
    await form.locator("[data-slot=select-trigger]").first().click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await expect(page.getByRole("option").first()).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("the stack page is a card of rows with pills, badges and the current PR on the accent", async ({ page }) => {
    await page.goto(`/stack?repo=${enc(REPO)}&pr=${PR}`);
    const rows = page.getByTestId("stack-row");
    await expect(rows).toHaveCount(2);
    for (const row of await rows.all()) {
      await expect(row.getByTestId("status-badge")).toHaveCount(1);
      await expect(row.getByTestId("stack-select")).toHaveAttribute("data-state", "checked");
      expect(await row.evaluate((el) => getComputedStyle(el).fontFamily)).not.toMatch(/mono/i);
    }
    const current = rows.filter({ hasText: `#${PR}` });
    await expect(current).toHaveAttribute("data-current", "true");
    const other = rows.filter({ hasText: "#38850" });
    expect(await current.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
      await other.evaluate((el) => getComputedStyle(el).backgroundColor),
    );
    expect(await page.evaluate(() => document.querySelectorAll(".status, .btn").length)).toBe(0);
  });
});

test.describe("the PR page on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("no horizontal scroll, the commit bar stays reachable above the tab bar", async ({ page }) => {
    await page.goto(prPath(REPO, PR));
    await expect(page.locator(".finding").first()).toBeVisible();
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
    const bar = page.getByTestId("commit-bar");
    await expect(bar).toBeInViewport();
    const barBox = (await bar.boundingBox())!;
    const tab = (await page.getByTestId("tab-bar").boundingBox())!;
    expect(Math.round(barBox.y + barBox.height)).toBeLessThanOrEqual(Math.round(tab.y) + 1);
    // Scrolled to the end, the last section tab still sits above the bar, and the bar is still there.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(bar).toBeInViewport();
    const row = (await page.getByTestId("section-row").boundingBox())!;
    expect(row.y + row.height).toBeLessThanOrEqual(barBox.y + 1);
    // The card's actions are always visible on a phone and at least 40px tall.
    const act = page.locator(".finding").first().getByTestId("finding-actions").getByRole("button").first();
    expect(await act.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
    expect((await act.boundingBox())!.height).toBeGreaterThanOrEqual(40);
  });
});
