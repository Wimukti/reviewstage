// Lane A2 of the stage light (design.md §4.2, §4.3, §5; tasks.md A2): the staged finding's head
// is lit and the light leaves when it is unticked; the post button glows only while something is
// staged; the count is a fresh element on every change and rolls; the four sections are one
// tab list with one panel open at a time, reachable by keyboard; under reduced motion
// nothing on the count animates; the queue's one field filters and opens a pasted PR.
import { expect, test, type Page } from "@playwright/test";
import { PR, PR3, REPO, REPO2 } from "./fixture";

const enc = (r: string) => encodeURIComponent(r);
const prPath = (repo: string, num: string) => `/pr?repo=${enc(repo)}&pr=${num}`;

async function settled(page: Page) {
  await expect(page.getByTestId("pr-loading")).toHaveCount(0, { timeout: 15_000 });
}

test.describe("the stage light on a finding", () => {
  test("ticking lights the card head, unticking puts it out", async ({ page }) => {
    await page.goto(prPath(REPO, PR));
    await settled(page);
    const card = page.locator(".finding").first();
    const head = card.locator(".fhead");
    const bg = () => head.evaluate((el) => getComputedStyle(el).backgroundImage);
    await expect(card).toHaveClass(/is-staged/);
    expect(await bg()).toMatch(/gradient/);
    await card.getByTestId("finding-select").uncheck();
    await expect(card).not.toHaveClass(/is-staged/);
    expect(await bg()).toBe("none");
    await card.getByTestId("finding-select").check();
    await expect(card).toHaveClass(/is-staged/);
    expect(await bg()).toMatch(/gradient/);
    // Light, not a colour: the head's text is unchanged by it.
    const ink = await card.locator(".fhead").getByTestId("status-badge").first().evaluate((el) => getComputedStyle(el).color);
    const body = await page.evaluate(() => getComputedStyle(document.body).color);
    expect(ink).toBe(body);
  });
});

test.describe("the commit bar", () => {
  test("the post button glows only while the count is above zero", async ({ page }) => {
    await page.goto(prPath(REPO, PR));
    await settled(page);
    const bar = page.getByTestId("commit-bar");
    const post = bar.getByRole("button", { name: /post selected/i });
    const shadow = () => post.evaluate((el) => getComputedStyle(el).boxShadow);
    await expect(bar).toHaveClass(/has-staged/);
    expect(await shadow()).not.toBe("none");
    const sel = page.locator(".finding").getByTestId("finding-select");
    await sel.nth(0).uncheck();
    await sel.nth(1).uncheck();
    await expect(bar).toContainText("0 staged");
    await expect(bar).not.toHaveClass(/has-staged/);
    await expect.poll(shadow).toBe("none");
    await sel.nth(0).check();
    await expect(bar).toHaveClass(/has-staged/);
    await expect.poll(shadow).not.toBe("none");
  });

  test("the count is display type and a fresh element on every change", async ({ page }) => {
    await page.goto(prPath(REPO, PR));
    await settled(page);
    const count = page.locator(".stage-count[data-stage-count]");
    await expect(count).toHaveAttribute("data-stage-count", "2");
    const font = await count.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(font).toMatch(/Geist/);
    // Tag the live node; after a change the node with the new value must not carry the tag.
    await count.evaluate((el) => ((el as HTMLElement).dataset.tagged = "1"));
    await page.locator(".finding").getByTestId("finding-select").first().uncheck();
    await expect(count).toHaveAttribute("data-stage-count", "1");
    await expect(count).not.toHaveAttribute("data-tagged", "1");
    // The bar still reads as one phrase once the outgoing digit has left.
    await expect(page.getByTestId("commit-bar")).toContainText("1 staged");
    await expect(page.locator(".stage-count.is-out")).toHaveCount(0, { timeout: 2000 });
  });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the count swaps without any transition or animation", async ({ page }) => {
    await page.goto(prPath(REPO, PR));
    await settled(page);
    await page.locator(".finding").getByTestId("finding-select").first().uncheck();
    const count = page.locator(".stage-count[data-stage-count]");
    await expect(count).toHaveAttribute("data-stage-count", "1");
    // No outgoing digit is rendered at all under reduced motion.
    await expect(page.locator(".stage-count.is-out")).toHaveCount(0);
    const motion = await count.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { t: cs.transitionDuration, a: cs.animationDuration };
    });
    for (const d of [...motion.t.split(","), ...motion.a.split(",")]) expect(parseFloat(d)).toBe(0);
    const post = page.getByTestId("commit-bar").getByRole("button", { name: /post selected/i });
    expect(parseFloat(await post.evaluate((el) => getComputedStyle(el).transitionDuration))).toBe(0);
  });
});

test.describe("the sections", () => {
  test("are one tab list that opens one panel at a time, by mouse or keyboard", async ({ page }) => {
    await page.goto(prPath(REPO, PR));
    await settled(page);
    const seg = page.getByTestId("section-row");
    await expect(seg).toHaveRole("tablist");
    const btns = seg.getByRole("tab");
    await expect(btns).toHaveText(["Full summary", "What this PR does", "Approve", "Re-run"]);
    // Exactly one panel at a time, the first open on arrival.
    const panels = page.getByRole("tabpanel");
    await expect(panels).toHaveCount(1);
    await expect(btns.nth(0)).toHaveAttribute("aria-selected", "true");
    await btns.nth(1).click();
    await expect(panels).toHaveCount(1);
    await expect(panels.first()).toContainText(/COMMENT review/i);
    await btns.nth(2).click();
    await expect(panels).toHaveCount(1);
    await expect(page.getByTestId("approve-panel")).toBeVisible();
    await expect(btns.nth(1)).toHaveAttribute("aria-selected", "false");
    await expect(btns.nth(2)).toHaveAttribute("aria-selected", "true");
    // Keyboard (Radix, automatic activation): arrows move and select, Home/End jump, it wraps.
    await btns.nth(2).focus();
    await page.keyboard.press("ArrowRight");
    await expect(btns.nth(3)).toBeFocused();
    await expect(btns.nth(3)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowRight");
    await expect(btns.nth(0)).toBeFocused();
    await expect(btns.nth(0)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await expect(btns.nth(3)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(btns.nth(0)).toBeFocused();
    await expect(panels).toHaveCount(1);
    await expect(panels.first()).toContainText(/lead-time badge/i);
  });

  test("the sentence under the verdict is behind the ? button", async ({ page }) => {
    await page.goto(prPath(REPO, PR));
    await settled(page);
    await expect(page.locator(".verdict-sub")).toHaveCount(0);
    const about = page.getByTestId("verdict").getByRole("button", { name: "About this page" });
    await expect(page.getByTestId("about-box")).toHaveCount(0);
    await about.click();
    await expect(page.getByTestId("about-box")).toContainText(/plain review/i);
    await expect(about).toHaveAttribute("aria-expanded", "true");
  });
});

test.describe("the queue's one field", () => {
  test("filters as you type and opens a pasted PR reference on Enter", async ({ page }) => {
    await page.goto("/?tab=all");
    await expect(page.getByTestId("queue-row").first()).toBeVisible();
    // Two fields became one: no paste-a-PR form, no sentence under the tabs.
    await expect(page.locator(".reviewany, .tabdesc")).toHaveCount(0);
    const field = page.locator("#qsearch");
    const sent = page.waitForRequest((r) => r.url().includes("q=rate-limit"));
    await field.fill("rate-limit");
    await sent;
    await expect(page.getByTestId("queue-row")).toHaveCount(1);
    await expect(page.getByTestId("open-pr")).toHaveCount(0);
    // A reference offers to open, and Enter goes there.
    await field.fill(`${REPO2}#${PR3}`);
    await expect(page.getByTestId("open-pr")).toHaveText(`Open #${PR3}`);
    await field.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/pr\\?repo=${enc(REPO2)}&pr=${PR3}`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText(`#${PR3}`);
  });

  test("rows sit at the density token and the empty state is a title and one line", async ({ page }) => {
    await page.goto("/?tab=reviewed");
    const row = page.getByTestId("queue-row").first();
    await expect(row).toBeVisible();
    const rowVar = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--row").trim());
    expect(rowVar).toBe("44px");
    expect(await row.evaluate((el) => getComputedStyle(el).minHeight)).toBe("44px");
    await page.goto("/?tab=approved");
    const empty = page.getByTestId("empty-state");
    await expect(empty.getByRole("heading")).toHaveText("Nothing approved yet");
    expect(await empty.getByRole("heading").evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/Geist/);
    await expect(empty).toContainText("PRs you approve will be listed here.");
    // No light here: only the three §4 placements carry it.
    expect(await empty.evaluate((el) => getComputedStyle(el).backgroundImage)).toBe("none");
  });
});
