// Lane A1 (stage-light): the login card, the sidebar geometry, the running bar, the phone
// header and the More sheet — design.md §1 (dark default), §3 (density), §5 (running sweep),
// §6 (words) and tasks.md A1.
import { expect, test, type Page } from "@playwright/test";
import { PR, REPO } from "./fixture";

const enc = (r: string) => encodeURIComponent(r);

async function settled(page: Page) {
  await expect(page.locator(".muted", { hasText: /^Loading…$/ })).toHaveCount(0, { timeout: 15_000 });
}

test.describe("theme", () => {
  test("with nothing stored the document is dark", async ({ page }) => {
    await page.goto("/");
    expect(await page.evaluate(() => localStorage.getItem("rs-theme"))).toBeNull();
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  });
});

test.describe("login", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("one primary button; the token form is hidden until Use a token instead", async ({ page }) => {
    await page.route("**/api/me", async (route) => {
      const r = await route.fetch();
      await route.fulfill({ response: r, json: { ...(await r.json()), oauth: true, oauth_blocked: false } });
    });
    await page.goto("/login");
    const card = page.locator(".authcard");
    await expect(card).toBeVisible();
    // The light sits behind the card.
    await expect(page.locator(".stage-login .authcard")).toHaveCount(1);
    await expect(card.locator(".btn.primary")).toHaveCount(1);
    await expect(card.getByRole("link", { name: "Continue with GitHub" })).toBeVisible();
    // Five things and nothing else: mark, name, one line, the button, the link.
    await expect(card.getByRole("heading", { level: 1 })).toHaveText("ReviewStage");
    await expect(card.locator(".authsub")).toHaveText("Stage your review. Post it as yourself.");
    await expect(card.getByText(/GH_[A-Z_]+/)).toHaveCount(0);
    await expect(card.getByText("Running this server?")).toHaveCount(0);
    const toggle = card.getByRole("button", { name: "Use a token instead" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByLabel("GitHub personal access token")).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByLabel("GitHub personal access token")).toBeVisible();
    // A secondary sign-in, not a second primary.
    await expect(card.locator(".btn.primary")).toHaveCount(1);
  });

  test("with both flows off the token form is the sign-in and the team link is the only setup text", async ({ page }) => {
    await page.goto("/login");
    const card = page.locator(".authcard");
    await expect(page.getByLabel("GitHub personal access token")).toBeVisible();
    await expect(card.locator(".btn.primary")).toHaveCount(1);
    await expect(card.getByRole("link", { name: "Setting up sign-in for a team" })).toHaveAttribute(
      "href",
      /start\/team-mode\/$/,
    );
    await expect(card.getByText(/GH_[A-Z_]+/)).toHaveCount(0);
  });
});

test.describe("desktop shell at 1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("sidebar is 216 wide with 36px items and no group labels", async ({ page }) => {
    await page.goto("/");
    await settled(page);
    const side = await page.locator(".side").boundingBox();
    expect(Math.round(side!.width)).toBe(216);
    const items = page.locator(".side nav.nav .ni");
    expect(await items.count()).toBe(7);
    for (const it of await items.all()) expect(Math.round((await it.boundingBox())!.height)).toBe(36);
    // The two groups are separated by space, not by a label or a line.
    await expect(page.locator(".side nav.nav").getByText(/^(work|setup|configure)$/i)).toHaveCount(0);
    const gap = await page.evaluate(() => {
      const [a, b] = document.querySelectorAll(".side .navgroup");
      return b.getBoundingClientRect().top - a.getBoundingClientRect().bottom;
    });
    expect(gap).toBeGreaterThanOrEqual(12);
  });

  test("the account card is one row and the theme switch lives in More", async ({ page }) => {
    await page.goto("/");
    await settled(page);
    const acct = page.getByTestId("account-card");
    expect(Math.round((await acct.boundingBox())!.height)).toBeLessThanOrEqual(40);
    await expect(acct.locator(".status")).toHaveText(/^(Live|Dry run)$/);
    await expect(page.getByTestId("theme-control")).toHaveCount(0);
    await page.getByTestId("account-more").click();
    await expect(page.getByTestId("more-menu").getByTestId("theme-control")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("more-menu")).toHaveCount(0);
  });

  test("the running bar is a 2px sweep at the top of the viewport while the fixture's review runs", async ({ page }) => {
    await page.goto("/");
    const bar = page.getByTestId("running-bar");
    await expect(bar).toBeVisible();
    const box = await bar.boundingBox();
    expect(box!.y).toBe(0);
    expect(box!.x).toBe(0);
    expect(Math.round(box!.width)).toBe(1440);
    expect(Math.round(box!.height)).toBe(2);
    await expect(bar).toHaveText(/1 review running/i);
    // The old pill and strip are gone.
    await expect(page.locator(".runlink, .runstrip")).toHaveCount(0);
  });

  test("/how is no longer an app page", async ({ page }) => {
    await page.goto("/how");
    await expect(page.getByRole("heading", { name: /not found/i })).toBeVisible();
  });
});

test.describe("phone shell at 390", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("the header is the mark and the search only; the More sheet holds the theme switch", async ({ page }) => {
    await page.goto("/");
    await settled(page);
    const head = page.locator(".phone-head");
    await expect(head.locator(".phone-title")).toHaveCount(0);
    expect((await head.innerText()).trim()).toBe("");
    await expect(head.getByRole("link", { name: "ReviewStage" })).toBeVisible();
    await expect(head.getByRole("button", { name: "Review a PR" })).toBeVisible();
    await expect(page.getByTestId("running-bar")).toBeVisible();
    expect(Math.round((await page.getByTestId("running-bar").boundingBox())!.height)).toBe(2);
    await page.getByTestId("more-tab").click();
    const sheet = page.getByTestId("more-sheet");
    await expect(sheet.getByTestId("theme-control")).toBeVisible();
    await expect(sheet.getByRole("link", { name: "How it works" })).toHaveAttribute("href", /#how-it-works$/);
    await expect(sheet.getByRole("button", { name: /sign out/i })).toBeVisible();
  });

  for (const [name, path] of [
    ["queue", "/"],
    ["pr", `/pr?repo=${enc(REPO)}&pr=${PR}`],
    ["integrations", "/integrations"],
  ] as const) {
    test(`${name} has no horizontal scroll`, async ({ page }) => {
      await page.goto(path);
      await settled(page);
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
    });
  }
});
