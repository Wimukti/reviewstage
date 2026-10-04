// Lane S1 of the system rebuild (openspec/changes/rebuild-on-a-system/design.md §2–§4): the
// shell and the queue are built from the components, not from bespoke rules. No dot-and-word
// status anywhere on the queue, a glyph on every nav item, the theme switch inside the account
// menu, avatars and a repository pill on every row, no monospace outside code, a Radix dialog
// around a cmdk list, 44px tab bar targets and no sideways scroll on a phone.
import { expect, test, type Page } from "@playwright/test";
import { PR, REPO, USER } from "./fixture";

// The browser fetches avatars from github.com; the suite is offline, so answer every one with a
// 1×1 PNG. Radix renders the <img> only once it has loaded.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
async function fakeAvatars(page: Page) {
  await page.route(/https:\/\/github\.com\/[^/]+\.png/, (route) => route.fulfill({ contentType: "image/png", body: PNG }));
}

test.describe("desktop shell at 1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("no dot-and-word status survives on the queue, and every nav item carries a glyph", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("queue-row").first()).toBeVisible();
    expect(await page.evaluate(() => document.querySelectorAll(".status").length)).toBe(0);
    const items = page.getByTestId("sidebar").getByRole("navigation", { name: "Main" }).getByRole("link");
    expect(await items.count()).toBe(7);
    for (const it of await items.all()) await expect(it.locator("svg")).toHaveCount(1);
    // The one primary surface is the sidebar's canvas, parted from the page by a single seam.
    const side = page.getByTestId("sidebar");
    expect(await side.evaluate((el) => getComputedStyle(el).borderRightWidth)).toBe("1px");
    expect(await side.evaluate((el) => getComputedStyle(el).borderLeftWidth)).toBe("0px");
  });

  test("the account row opens the account menu: a header, Switch GitHub account, Sign out — nothing else", async ({ page }) => {
    await page.goto("/");
    const row = page.getByTestId("account-card");
    await expect(row).toHaveRole("button");
    await expect(row.locator("svg.lucide-chevrons-up-down")).toHaveCount(1);
    await row.click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByTestId("account-profile")).toHaveAttribute("href", `https://github.com/${USER}`);
    await expect(menu.getByRole("menuitem")).toHaveText(["Switch GitHub account", "Sign out"]);
    await expect(menu.getByRole("menuitemradio")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  });

  test("the Queue header's ? holds the Help items: How it works (the site) and Take a tour", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("page-header").getByRole("button", { name: "About this page" }).click();
    const help = page.getByTestId("help-menu");
    await expect(help.getByRole("link", { name: /how it works/i })).toHaveAttribute("href", /#how-it-works$/);
    await expect(help.getByRole("button", { name: /take a tour/i })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(help).toHaveCount(0);
  });

  test("rows carry the author's avatar and a repository pill, both in sans", async ({ page }) => {
    await fakeAvatars(page);
    await page.goto("/?tab=reviewed");
    const row = page.getByTestId("queue-row").filter({ hasText: `#${PR}` });
    await expect(row).toBeVisible();
    await expect(row.getByTestId("user-avatar").locator("img[alt]")).toHaveAttribute("alt", "teammate");
    const pill = row.getByTestId("repo-pill");
    await expect(pill).toHaveText(REPO);
    await expect(pill.locator("img[alt]")).toHaveCount(1);
    const fonts = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="repo-pill"], [data-testid="row-link"], [data-testid="row-by"], [data-testid="status-badge"]')].map(
        (el) => getComputedStyle(el).fontFamily,
      ),
    );
    expect(fonts.length).toBeGreaterThan(0);
    for (const f of fonts) expect(f).not.toMatch(/mono/i);
    // State and severity are badges with a glyph; the number is sans too.
    const badges = row.getByTestId("row-state").getByTestId("status-badge");
    expect(await badges.count()).toBeGreaterThanOrEqual(2);
    for (const b of await badges.all()) await expect(b.locator("svg")).toHaveCount(1);
    expect(await row.getByText(`#${PR}`).evaluate((el) => getComputedStyle(el).fontFamily)).not.toMatch(/mono/i);
  });

  test("the palette is a dialog around a cmdk list and ⌘K toggles it", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /review queue/i })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+k");
    const dialog = page.getByRole("dialog", { name: "Command palette" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("[cmdk-root]")).toHaveCount(1);
    await expect(dialog.locator("[cmdk-list]")).toHaveAttribute("role", "listbox");
    await expect(dialog.getByRole("option").first()).toBeVisible();
    await expect(dialog.getByRole("group", { name: "Pull requests" })).toBeVisible();
    await expect(dialog.getByRole("group", { name: "Pages" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("the empty state is a glyph, a display title and one line inside a card", async ({ page }) => {
    await page.goto("/?tab=approved");
    const empty = page.getByTestId("empty-state");
    await expect(empty).toBeVisible();
    await expect(empty.locator("svg")).toHaveCount(1);
    await expect(empty.getByRole("heading")).toHaveText("Nothing approved yet");
    await expect(empty.locator('[data-slot="card"]')).toHaveCount(0); // inside the card, not wrapping one
    await expect(page.locator('[data-slot="card"]').filter({ has: empty })).toHaveCount(1);
  });

  test("the orientation sentence lives behind the header's ? popover", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("about-box")).toHaveCount(0);
    await page.getByTestId("page-header").getByRole("button", { name: "About this page" }).click();
    await expect(page.getByTestId("about-box")).toContainText(/nothing reaches GitHub without your click/i);
  });
});

test.describe("phone shell at 390", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("tab bar targets are at least 44px, with a glyph and a label each", async ({ page }) => {
    await page.goto("/");
    const bar = page.getByTestId("tab-bar");
    const items = bar.locator("a, button");
    expect(await items.count()).toBe(4);
    for (const it of await items.all()) {
      const box = (await it.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
      await expect(it.locator("svg")).toHaveCount(1);
      expect((await it.innerText()).trim()).not.toBe("");
    }
  });

  test("the More sheet is a bottom dialog with the nav, the theme radios, the account and Sign out", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("more-tab").click();
    const sheet = page.getByRole("dialog", { name: "More" });
    await expect(sheet).toBeVisible();
    const box = (await sheet.boundingBox())!;
    expect(Math.round(box.y + box.height)).toBeGreaterThanOrEqual(844 - 1); // sits on the bottom edge
    await expect(sheet.getByRole("radiogroup", { name: "Theme" }).getByRole("radio")).toHaveCount(3);
    await expect(sheet.getByTestId("account-card")).toBeVisible();
    await expect(sheet.getByRole("button", { name: /switch github account/i })).toBeVisible();
    await expect(sheet.getByRole("button", { name: /sign out/i })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(page.getByTestId("more-tab")).toBeFocused();
  });

  test("the queue does not scroll sideways and the archive control is always shown", async ({ page }) => {
    await page.goto("/?tab=reviewed");
    await expect(page.getByTestId("queue-row").first()).toBeVisible();
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: Math.round(window.visualViewport?.width ?? window.innerWidth),
    }));
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
    const archive = page.getByRole("button", { name: `Archive #${PR}` });
    await expect(archive).toHaveCSS("opacity", "1");
    const box = (await archive.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  });
});
