// The phone shell (openspec/changes/mobile-app-feel M1 + M4): the navigation bar with its large
// title that collapses on scroll, ‹ Back and the left-edge swipe on a pushed page, the three-tab
// bar with the To review badge, Activity's segmented views, the You list pushing a Settings
// section as its own page, Sign out from You, push/pop transitions, and the desktop untouched.
import { expect, test, type Page } from "@playwright/test";
import { PR, REPO } from "./fixture";

const PHONE = { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true } as const;
const enc = (r: string) => encodeURIComponent(r);
const tab = (page: Page, name: string) => page.getByTestId("tab-bar").getByRole("link", { name: new RegExp(`^${name}`) });

async function settled(page: Page) {
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0, { timeout: 15_000 });
}

// Every value html[data-nav] takes, as it is set.
async function recordNav(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __nav: string[] };
    w.__nav = [];
    new MutationObserver(() => {
      const v = document.documentElement.dataset.nav;
      if (v) w.__nav.push(v);
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-nav"] });
  });
}

// A one-finger pan through the DevTools protocol: Playwright's touchscreen only taps.
async function pan(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
  for (let i = 1; i <= 8; i++) {
    const x = from.x + ((to.x - from.x) * i) / 8;
    const y = from.y + ((to.y - from.y) * i) / 8;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

test.describe("phone shell", () => {
  test.use(PHONE);

  test("the large title collapses into the bar on scroll, and the hairline appears only then", async ({ page }) => {
    // A short screen, so the fixture's queue is long enough to scroll.
    await page.setViewportSize({ width: 393, height: 600 });
    await page.goto("/?tab=all");
    await expect(page.getByTestId("queue-row").first()).toBeVisible();
    const bar = page.getByTestId("nav-bar");
    const title = bar.getByTestId("nav-title");
    await expect(bar).toHaveAttribute("data-collapsed", "false");
    await expect(title).toHaveCSS("opacity", "0");
    await expect(bar).toHaveCSS("border-bottom-color", "rgba(0, 0, 0, 0)");
    // The bar: 44px under the safe area, translucent with a blur, pinned to the top.
    expect(Math.round((await bar.boundingBox())!.height)).toBe(44 + 1);
    expect(await bar.evaluate((el) => getComputedStyle(el).backdropFilter)).toMatch(/blur/);
    await page.mouse.wheel(0, 300);
    await expect(bar).toHaveAttribute("data-collapsed", "true");
    await expect(title).toHaveCSS("opacity", "1");
    await expect(title).toHaveText("ReviewStage");
    await expect(bar).not.toHaveCSS("border-bottom-color", "rgba(0, 0, 0, 0)");
    expect((await bar.boundingBox())!.y).toBe(0);
    // One h1 throughout: the large title, never the compact one.
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await page.mouse.wheel(0, -1000);
    await expect(bar).toHaveAttribute("data-collapsed", "false");
  });

  test("a PR page has ‹ Queue and its number in the bar; Back and a left-edge swipe both return", async ({ page }) => {
    await page.goto("/?tab=reviewed");
    await page.getByTestId("queue-row").filter({ hasText: `#${PR}` }).getByTestId("row-link").click();
    await expect(page).toHaveURL(/\/pr\?/);
    const back = page.getByTestId("nav-back");
    await expect(back).toHaveAccessibleName("Back to Queue");
    await expect(back).toHaveText("Queue");
    const box = (await back.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    await expect(page.getByTestId("nav-title")).toHaveText(`#${PR}`);
    // The PR's own title stays the page's h1; the bar's number is not a second one.
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Add lead-time badge");
    await expect(page.getByTestId("crumbs").getByRole("link", { name: "Queue" })).toBeHidden();
    await expect(tab(page, "Queue")).toHaveAttribute("aria-current", "page");
    await back.click();
    await expect(page).toHaveURL(/\/\?tab=reviewed$/);

    await page.getByTestId("queue-row").filter({ hasText: `#${PR}` }).getByTestId("row-link").click();
    await expect(page.getByTestId("nav-back")).toBeVisible();
    // A pan that starts away from the edge, or runs vertically, is the page's own.
    await pan(page, { x: 120, y: 420 }, { x: 320, y: 420 });
    await pan(page, { x: 6, y: 300 }, { x: 40, y: 700 });
    await expect(page).toHaveURL(/\/pr\?/);
    await pan(page, { x: 6, y: 420 }, { x: 240, y: 430 });
    await expect(page).toHaveURL(/\/\?tab=reviewed$/);
  });

  test("a PR opened straight from a link goes back to the queue (no history to pop)", async ({ page }) => {
    await page.goto(`/pr?repo=${enc(REPO)}&pr=${PR}`);
    await page.getByTestId("nav-back").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "ReviewStage" })).toBeVisible();
  });

  test("the tab bar: three tabs, the active one filled in the accent, Queue badged with To review", async ({ page, request }) => {
    const q = await (await request.get("/api/queue?tab=todo&sort=newest")).json();
    const todo = q.tabs.find((t: { key: string }) => t.key === "todo").count as number;
    expect(todo).toBeGreaterThan(0);
    await page.goto("/you");
    const bar = page.getByTestId("tab-bar");
    await expect(bar).toHaveAttribute("aria-label", "Main");
    expect(Math.round((await bar.boundingBox())!.height)).toBe(49);
    expect(await bar.evaluate((el) => getComputedStyle(el).backdropFilter)).toMatch(/blur/);
    await expect(bar.getByTestId("tab-badge")).toHaveText(todo.toLocaleString("en-US"));
    await expect(tab(page, "Queue")).toHaveAccessibleName(new RegExp(`${todo} to review`));
    await expect(tab(page, "You")).toHaveAttribute("aria-current", "page");
    await expect(tab(page, "You").locator("svg")).toHaveClass(/fill-primary/);
    await expect(tab(page, "Queue").locator("svg")).not.toHaveClass(/fill-primary/);
    const fs = await tab(page, "You").locator("span").last().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fs).toBeGreaterThanOrEqual(10);
    expect(fs).toBeLessThanOrEqual(11);
  });

  test("Activity is the queue's Reviewed · Posted · Approved under a segmented control, and keeps its tab lit", async ({ page }) => {
    await page.goto("/");
    await tab(page, "Activity").click();
    await expect(page).toHaveURL(/\/activity$/);
    await expect(page.getByRole("heading", { level: 1, name: "Activity" })).toBeVisible();
    const views = page.getByRole("tablist", { name: "Activity views" });
    await expect(views.getByRole("tab")).toHaveText([/^Reviewed/, /^Posted/, /^Approved/]);
    await expect(views.getByRole("tab", { name: /^Reviewed/ })).toHaveAttribute("aria-selected", "true");
    const tops = await views.getByRole("tab").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    await expect(page.getByTestId("queue-row").first()).toBeVisible();
    await views.getByRole("tab", { name: /^Posted/ }).click();
    await expect(page).toHaveURL(/\/activity\?tab=posted/);
    await expect(page.getByTestId("queue-row").first()).toBeVisible();
    // A PR opened from Activity keeps Activity lit and goes back there, view and all.
    await page.getByTestId("row-link").first().click();
    await expect(page).toHaveURL(/\/pr\?/);
    await expect(tab(page, "Activity")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("nav-back")).toHaveAccessibleName("Back to Activity");
    await page.getByTestId("nav-back").click();
    await expect(page).toHaveURL(/\/activity\?tab=posted/);
  });

  test("a You row pushes its Settings section as a page of its own, and Back returns to You", async ({ page }) => {
    await page.goto("/");
    await tab(page, "You").click();
    await page.getByTestId("you-list").getByRole("link", { name: /^Poller/ }).click();
    await expect(page).toHaveURL(/\/you\/poller$/);
    await settled(page);
    await expect(page.getByRole("heading", { level: 1, name: "Poller" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Poller", level: 2 })).toHaveCount(0); // not repeated
    await expect(page.getByTestId("settings-pills")).toHaveCount(0);
    await expect(page.getByTestId("page-header")).toHaveCount(0);
    await expect(page.getByRole("switch", { name: "Poller enabled" })).toBeVisible();
    await expect(tab(page, "You")).toHaveAttribute("aria-current", "page");
    await page.getByTestId("nav-back").click();
    await expect(page).toHaveURL(/\/you$/);
    await expect(page.getByTestId("you-list")).toBeVisible();
    // Opened from its own address it still knows its parent.
    await page.goto("/you/appearance");
    await expect(page.getByTestId("nav-back")).toHaveAccessibleName("Back to You");
    await expect(page.getByRole("radiogroup", { name: "Theme" }).getByRole("radio").first()).toHaveCSS("height", "44px");
  });

  test("desk pages on the phone: Insights two across, Skills one scrolling segmented row and score cards", async ({ page }) => {
    await page.goto("/dashboard");
    await settled(page);
    const lefts = await page.getByTestId("kpi").evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().left)))]);
    expect(lefts.length).toBe(2);
    await page.goto("/skills");
    await settled(page);
    const tabs = page.getByTestId("skill-tabs");
    const tops = await tabs.getByRole("tab").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(tops).size, "one row, no wrap").toBe(1);
    expect(await tabs.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await expect(page.getByTestId("skill-stats")).toHaveCount(0);
    await expect(page.getByTestId("skill-stat-card").first()).toBeVisible();
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
  });

  test("there is no More sheet anywhere on the phone", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("more-tab")).toHaveCount(0);
    for (const name of ["Activity", "You", "Queue"]) {
      await tab(page, name).click();
      await expect(tab(page, name)).toHaveAttribute("aria-current", "page");
      await expect(page.getByTestId("more-sheet")).toHaveCount(0);
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
  });

  test("inputs are at least 16px so iOS never zooms, and taps draw no highlight", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Search or open a PR" }).click();
    await expect(page.locator("#qsearch")).toBeFocused();
    const fs = await page.locator("#qsearch").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fs).toBeGreaterThanOrEqual(16);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("-webkit-tap-highlight-color"))).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    expect(await page.evaluate(() => getComputedStyle(document.body).overscrollBehaviorY)).toBe("contain");
  });

  test("pushing slides, a tab switch cross-fades, and a query change does not move at all", async ({ page }) => {
    await page.goto("/?tab=reviewed");
    await recordNav(page);
    await expect(page.getByTestId("queue-row").first()).toBeVisible();
    await page.getByTestId("row-link").first().click();
    await expect(page).toHaveURL(/\/pr\?/);
    await page.getByTestId("nav-back").click();
    await expect(page).toHaveURL(/\/\?tab=reviewed$/);
    await tab(page, "You").click();
    await expect(page.getByTestId("you-list")).toBeVisible();
    await tab(page, "Queue").click();
    await page.getByRole("tablist", { name: "Queue views" }).getByRole("tab", { name: /^In flight/ }).click();
    await expect(page).toHaveURL(/running=1/);
    const seen = await page.evaluate(() => (window as unknown as { __nav: string[] }).__nav);
    expect(seen).toEqual(["push", "pop", "fade", "fade"]);
  });
});

test.describe("phone shell, reduced motion", () => {
  test.use({ ...PHONE, reducedMotion: "reduce" });

  test("nothing slides or fades", async ({ page }) => {
    await page.goto("/?tab=reviewed");
    await recordNav(page);
    await page.getByTestId("row-link").first().click();
    await expect(page).toHaveURL(/\/pr\?/);
    await expect(page.locator("#phone-page")).not.toHaveAttribute("data-anim", /./);
    await tab(page, "You").click();
    await expect(page.getByTestId("you-list")).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __nav: string[] }).__nav)).toEqual([]);
  });
});

test.describe("Sign out from You", () => {
  // Its own context: signing out clears this context's cookie and nobody else's.
  test.use({ ...PHONE, storageState: "./e2e/.auth.json" });

  test("signs out and lands on the sign-in page", async ({ page }) => {
    await page.goto("/you");
    const out = page.getByTestId("you-list").getByRole("button", { name: "Sign out" });
    await out.scrollIntoViewIfNeeded();
    await out.click();
    await expect(page.locator(".authcard")).toBeVisible();
    await expect(page.getByTestId("tab-bar")).toHaveCount(0);
    expect((await page.evaluate(() => fetch("/api/me").then((r) => r.json()))).authed).toBe(false);
  });
});

test.describe("desktop at 1440 is unchanged", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the sidebar shell, the page header, and none of the phone's chrome", async ({ page }) => {
    await page.goto("/");
    await settled(page);
    await expect(page.getByTestId("sidebar")).toBeVisible();
    await expect(page.getByTestId("sidebar").getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveCount(7);
    await expect(page.getByTestId("tab-bar")).toHaveCount(0);
    await expect(page.getByTestId("nav-bar")).toHaveCount(0);
    await expect(page.getByTestId("page-header").getByRole("heading", { level: 1 })).toHaveText("Your review queue");
    await expect(page.getByRole("tablist", { name: "Queue views" }).getByRole("tab")).toHaveCount(6);
    // A PR page keeps its full breadcrumb on the desktop.
    await page.goto(`/pr?repo=${enc(REPO)}&pr=${PR}`);
    await expect(page.getByTestId("crumbs").getByRole("link", { name: "Queue" })).toBeVisible();
    // Skills keeps its table, Insights its one row of nine.
    await page.goto("/skills");
    await expect(page.getByTestId("skill-stats")).toBeVisible();
    await expect(page.getByTestId("skill-tabs")).toHaveAttribute("data-variant", "line");
    // And no transition is wired: navigating never stamps html[data-nav].
    await page.goto("/");
    await page.getByTestId("sidebar").getByRole("link", { name: "Insights" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    expect(await page.evaluate(() => document.documentElement.dataset.nav ?? null)).toBeNull();
  });
});

// iOS home-screen apps (iOS 26) lay out a cold launch with the layout viewport short by the
// status-bar inset — 62pt on the maintainer's iPhone — so the tab bar floated 62pt above the
// bottom until the first scroll (screenshots 10/05/26). Recreated here: a viewport 62px shorter
// than the screen, an iPhone user agent and navigator.standalone.
test.describe("iOS cold launch: the layout viewport is short of the screen", () => {
  test.use({
    viewport: { width: 440, height: 894 },
    isMobile: true,
    hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1",
  });

  test("the tab bar is drawn at the screen's bottom, not the short viewport's", async ({ page }) => {
    // The project's device settings win over test.use({ screen }), so the screen is set here.
    await page.addInitScript("Object.defineProperty(navigator, 'standalone', { get: () => true });" +
      "Object.defineProperty(Screen.prototype, 'height', { get: () => 956 });" +
      "Object.defineProperty(Screen.prototype, 'width', { get: () => 440 });");
    await page.goto("/");
    const bar = page.getByTestId("tab-bar");
    await expect(bar).toBeVisible();
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ios-gap").trim())).toBe("62px");
    const box = await bar.boundingBox();
    expect(Math.round(box!.y + box!.height)).toBe(956);
  });

  test("a browser tab is left alone", async ({ page }) => {
    await page.goto("/");
    const box = await page.getByTestId("tab-bar").boundingBox();
    expect(Math.round(box!.y + box!.height)).toBe(894);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ios-gap").trim())).toBe("");
  });
});
