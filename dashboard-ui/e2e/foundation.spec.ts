// The redesign's proof (design.md §8): nothing scrolls sideways on a phone, every control on
// the PR page is reachable by Tab with the ring visible, the theme control switches and
// persists, and every phone-shell target is at least 44px.
import { expect, test, type Page } from "@playwright/test";
import { PR, PR3, REPO, REPO2 } from "./fixture";

const enc = (r: string) => encodeURIComponent(r);
const PAGES: [string, string][] = [
  ["queue", "/?tab=reviewed"],
  ["queue (to review)", "/"],
  ["qa", "/qa"],
  ["learnings", "/learnings"],
  ["insights", "/dashboard"],
  ["skills", "/skills"],
  ["integrations", "/integrations"],
  ["settings", "/settings"],
  ["pr", `/pr?repo=${enc(REPO)}&pr=${PR}`],
  ["pr with a blocker", `/pr?repo=${enc(REPO2)}&pr=${PR3}`],
  ["stack", `/stack?repo=${enc(REPO)}&pr=${PR}`],
];

async function settled(page: Page) {
  await expect(page.locator(".muted", { hasText: /^Loading…$/ })).toHaveCount(0, { timeout: 15_000 });
}

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  for (const [name, path] of PAGES) {
    test(`${name} does not scroll sideways at 390px`, async ({ page }) => {
      await page.goto(path);
      await settled(page);
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
    });
  }

  test("every shell control is labelled and at least 44px", async ({ page }) => {
    await page.goto("/");
    await settled(page);
    const controls = page.locator(".phone-head a, .phone-head button, .tabbar a, .tabbar button");
    const n = await controls.count();
    expect(n).toBeGreaterThanOrEqual(5);
    for (let i = 0; i < n; i++) {
      const c = controls.nth(i);
      const box = await c.boundingBox();
      expect(box, `control ${i} has a box`).not.toBeNull();
      expect(box!.height, `control ${i} height`).toBeGreaterThanOrEqual(44);
      expect(box!.width, `control ${i} width`).toBeGreaterThanOrEqual(44);
      const name = await c.evaluate((el) => (el.getAttribute("aria-label") || el.textContent || "").trim());
      expect(name, `control ${i} has a name`).not.toBe("");
    }
    // The header's Review a PR is findable by name — the old glyph-only button was not.
    await expect(page.getByRole("button", { name: "Review a PR" })).toBeVisible();

    // More opens a sheet with the rest of the navigation, the theme control and Sign out.
    await page.getByTestId("more-tab").click();
    const sheet = page.getByTestId("more-sheet");
    await expect(sheet).toBeVisible();
    for (const label of ["Learnings", "Insights", "Integrations", "Settings", "How it works"]) {
      await expect(sheet.getByRole("link", { name: label })).toBeVisible();
    }
    await expect(sheet.getByTestId("theme-control")).toBeVisible();
    const out = sheet.getByRole("button", { name: /sign out/i });
    expect((await out.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // Escape closes it and focus returns to the More tab.
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(page.getByTestId("more-tab")).toBeFocused();
  });

  test("a running job is a 2px bar at the very top of the viewport, not a strip of text", async ({ page }) => {
    await page.goto("/");
    const bar = page.getByTestId("running-bar");
    await expect(bar).toBeVisible();
    await expect(bar).toHaveClass(/runbar/);
    const box = await bar.boundingBox();
    expect(box!.y).toBe(0);
    expect(Math.round(box!.height)).toBe(2);
  });
});

test.describe("keyboard", () => {
  test("Tab walks the PR page with the ring visible on every stop", async ({ page }) => {
    await page.goto(`/pr?repo=${enc(REPO)}&pr=${PR}`);
    await settled(page);
    await expect(page.locator("h1.prtitle")).toBeVisible();
    const seen = new Set<string>();
    let stops = 0;
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        // Hidden radios inside an .eff card hand their ring to the card.
        const ring = el.closest(".eff") ?? el;
        const cs = getComputedStyle(ring);
        const r = el.getBoundingClientRect();
        return {
          key: `${el.tagName}#${el.id}.${el.className}:${el.textContent?.slice(0, 20)}`,
          outlineStyle: cs.outlineStyle,
          outlineWidth: cs.outlineWidth,
          visible: r.width > 0 && r.height > 0 && cs.visibility !== "hidden",
          ariaHidden: !!el.closest("[aria-hidden='true']"),
        };
      });
      if (!info) break;
      if (seen.has(info.key)) break; // cycled back around
      seen.add(info.key);
      stops++;
      expect(info.ariaHidden, `${info.key} is not aria-hidden`).toBe(false);
      expect(info.visible, `${info.key} is visible`).toBe(true);
      expect(info.outlineStyle, `${info.key} shows the ring`).toBe("solid");
      expect(info.outlineWidth, `${info.key} ring is 2px`).toBe("2px");
    }
    // The page has far more than a handful of stops: sidebar, actions, findings, approve, re-run.
    expect(stops).toBeGreaterThan(15);
  });

  test("the guided tour traps focus, closes on Escape, and ends where it started", async ({ page }) => {
    await page.goto("/?tab=reviewed");
    await settled(page);
    const help = page.getByRole("button", { name: /help/i });
    await help.click();
    await page.getByRole("button", { name: /take a tour/i }).click();
    const tour = page.getByTestId("tour");
    await expect(tour).toBeVisible();
    await expect(tour.getByRole("button", { name: "Next" })).toBeFocused();
    // Tab never leaves the dialog.
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() => !!document.activeElement?.closest('[data-testid="tour"]'));
      expect(inside).toBe(true);
    }
    // Walk to the last step: its primary action ends the tour without navigating.
    for (let i = 0; i < 4; i++) await tour.getByRole("button", { name: "Next" }).click();
    await expect(tour.getByRole("button", { name: "Done" })).toBeVisible();
    await tour.getByRole("button", { name: "Done" }).click();
    await expect(tour).toHaveCount(0);
    await expect(page).toHaveURL(/tab=reviewed/);
    // Escape closes it too, and focus goes back to the trigger.
    await help.click();
    await page.getByRole("button", { name: /take a tour/i }).click();
    await expect(tour).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tour).toHaveCount(0);
  });
});

// The theme switch lives in the account row's More menu on the desktop (stage-light A1).
async function openTheme(page: Page) {
  await page.getByTestId("account-more").click();
  await expect(page.getByTestId("theme-control")).toBeVisible();
}

test.describe("theme", () => {
  test("dark is the default, the control switches data-theme and the choice survives a reload", async ({ page }) => {
    await page.goto("/");
    await settled(page);
    await openTheme(page);
    const html = page.locator("html");
    // Nothing stored: the shell stamps dark before the bundle runs, and the dark paper renders.
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("meta[name=color-scheme]")).toHaveAttribute("content", "dark");
    await expect(page.locator("meta[name=theme-color]")).toHaveAttribute("content", "#0B0C10");
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(11, 12, 16)");
    await expect(page.locator("[data-theme-choice=dark]")).toHaveAttribute("aria-checked", "true");

    await page.locator("[data-theme-choice=light]").click();
    await expect(html).toHaveAttribute("data-theme", "light");
    await expect(page.locator("meta[name=color-scheme]")).toHaveAttribute("content", "light");
    await expect(page.locator("meta[name=theme-color]")).toHaveAttribute("content", "#F6F6F9");
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(246, 246, 249)");

    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "light");
    await openTheme(page);
    await expect(page.locator("[data-theme-choice=light]")).toHaveAttribute("aria-checked", "true");

    // System is a stored choice of its own, stamped as an attribute so the media query can see it.
    await page.locator("[data-theme-choice=system]").click();
    await expect(html).toHaveAttribute("data-theme", "system");
    await expect(page.locator("meta[name=color-scheme]")).toHaveAttribute("content", "light dark");
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "system");

    await openTheme(page);
    await page.locator("[data-theme-choice=dark]").click();
    await expect(html).toHaveAttribute("data-theme", "dark");
  });

  test("system follows the preference: light on a light machine, dark on a dark one", async ({ page }) => {
    await page.goto("/");
    await settled(page);
    await openTheme(page);
    await page.locator("[data-theme-choice=system]").click();
    await page.emulateMedia({ colorScheme: "light" });
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(246, 246, 249)");
    await expect(page.locator("meta[name=theme-color]")).toHaveAttribute("content", "#F6F6F9");
    await page.emulateMedia({ colorScheme: "dark" });
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(11, 12, 16)");
    await expect(page.locator("meta[name=theme-color]")).toHaveAttribute("content", "#0B0C10");
  });

  test("a light system preference does not override the dark default", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await settled(page);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(11, 12, 16)");
    await expect(page.locator("meta[name=theme-color]")).toHaveAttribute("content", "#0B0C10");
  });
});

test.describe("the staging area", () => {
  test("ticking a finding fills its edge and the commit bar counts it", async ({ page }) => {
    await page.goto(`/pr?repo=${enc(REPO)}&pr=${PR}`);
    const first = page.locator(".finding").first();
    await expect(first).toHaveClass(/is-staged/);
    await expect(page.getByTestId("commit-bar")).toBeVisible();
    await expect(page.getByTestId("commit-bar")).toContainText("2 staged");
    await first.locator("input.fsel").uncheck();
    await expect(first).not.toHaveClass(/is-staged/);
    await expect(page.getByTestId("commit-bar")).toContainText("1 staged");
    // No filled pills anywhere: severities are dot + word.
    await expect(first.locator(".status").first()).toHaveText(/^(Blocker|Should fix|Nit|Question)$/);
  });
});
