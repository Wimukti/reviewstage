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
    await expect(card.getByRole("link", { name: "Continue with GitHub" }).or(card.getByRole("button", { name: /Continue with GitHub|Sign in with token/ }))).toHaveCount(1);
    await expect(card.getByRole("link", { name: "Continue with GitHub" })).toBeVisible();
    // Five things and nothing else: mark, name, one line, the button, the link.
    await expect(card.getByRole("heading", { level: 1 })).toHaveText("ReviewStage");
    await expect(card.getByText("Stage your review. Post it as yourself.")).toBeVisible();
    await expect(card.getByText(/GH_[A-Z_]+/)).toHaveCount(0);
    await expect(card.getByText("Running this server?")).toHaveCount(0);
    const toggle = card.getByRole("button", { name: "Use a token instead" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByLabel("GitHub personal access token")).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByLabel("GitHub personal access token")).toBeVisible();
    // A secondary sign-in, not a second primary.
    await expect(card.getByRole("link", { name: "Continue with GitHub" })).toHaveCount(1);
    await expect(card.getByRole("button", { name: "Sign in with token" })).toHaveClass(/bg-secondary/);
  });

  test("with both flows off the token form is the sign-in and the team link is the only setup text", async ({ page }) => {
    await page.goto("/login");
    const card = page.locator(".authcard");
    await expect(page.getByLabel("GitHub personal access token")).toBeVisible();
    await expect(card.getByRole("link", { name: "Continue with GitHub" }).or(card.getByRole("button", { name: /Continue with GitHub|Sign in with token/ }))).toHaveCount(1);
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
    const side = await page.getByTestId("sidebar").boundingBox();
    expect(Math.round(side!.width)).toBe(216);
    const items = page.getByTestId("sidebar").getByRole("navigation", { name: "Main" }).getByRole("link");
    expect(await items.count()).toBe(7);
    // Repositories is a personal-mode entry (welcome.spec.ts); a team install's live in .env.
    await expect(page.getByTestId("nav-setup").getByRole("link", { name: "Repositories" })).toHaveCount(0);
    for (const it of await items.all()) expect(Math.round((await it.boundingBox())!.height)).toBe(36);
    // The two groups are separated by space, not by a label or a line.
    await expect(page.getByTestId("sidebar").getByRole("navigation", { name: "Main" }).getByText(/^(work|setup|configure)$/i)).toHaveCount(0);
    const gap = await page.evaluate(() => {
      const a = document.querySelector('[data-testid="nav-work"]')!;
      const b = document.querySelector('[data-testid="nav-setup"]')!;
      return b.getBoundingClientRect().top - a.getBoundingClientRect().bottom;
    });
    expect(gap).toBeGreaterThanOrEqual(12);
  });

  test("the account row is compact and is itself the account menu; the theme switch lives in Settings", async ({ page }) => {
    await page.goto("/");
    await settled(page);
    const acct = page.getByTestId("account-card");
    // Name over state: two tight lines, never more. A one-line row truncated the login to two
    // characters beside the badge in a 216px sidebar.
    expect(Math.round((await acct.boundingBox())!.height)).toBeLessThanOrEqual(48);
    await expect(acct.getByTitle(/./).first()).toHaveText(/\S{3,}/); // the login is legible
    await expect(acct.getByTestId("status-badge")).toHaveText(/^(Live|Dry run)$/);
    await expect(page.getByTestId("theme-control")).toHaveCount(0);
    // The row is the trigger (shadcn NavUser); the menu holds the account items and nothing else.
    await acct.click();
    const menu = page.getByTestId("account-menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem")).toHaveText(["Switch GitHub account", "Sign out"]);
    await expect(menu.getByTestId("theme-control")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await page.goto("/settings");
    await expect(page.getByTestId("theme-control")).toBeVisible();
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

  test("the queue's large title is the mark beside the name; the bar holds the search; You holds the theme", async ({ page }) => {
    await page.goto("/");
    await settled(page);
    const head = page.locator(".phone-head");
    // At the top the compact title is hidden (the large title is showing) and is not a heading.
    await expect(head.getByTestId("nav-title")).toHaveCSS("opacity", "0");
    await expect(head.getByRole("heading")).toHaveCount(0);
    await expect(head.getByRole("button", { name: "Review a PR" })).toBeVisible();
    const large = page.getByTestId("large-title");
    await expect(large.getByRole("heading", { level: 1 })).toHaveText("ReviewStage");
    await expect(large.locator("img:visible")).toHaveCount(1); // the mark, once, beside the word
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByTestId("running-bar")).toBeVisible();
    expect(Math.round((await page.getByTestId("running-bar").boundingBox())!.height)).toBe(2);
    await page.getByTestId("tab-bar").getByRole("link", { name: "You" }).click();
    const you = page.getByTestId("you-list");
    await expect(you.getByRole("link", { name: "How it works" })).toHaveAttribute("href", /#how-it-works$/);
    await expect(you.getByRole("button", { name: /switch github account/i })).toBeVisible();
    await expect(you.getByRole("button", { name: /sign out/i })).toBeVisible();
    await you.getByRole("link", { name: /^Appearance/ }).click();
    await expect(page.getByTestId("theme-control")).toBeVisible();
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
