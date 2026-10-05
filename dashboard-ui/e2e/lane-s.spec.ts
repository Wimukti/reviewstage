// Lane S (Skills, Insights, Settings, Integrations, Tour) — the redesign's proof
// for the pages that sit on the foundation. Behaviour is unchanged; these pin the new shape.
import { expect, test, type Page } from "@playwright/test";
import { REPO } from "./fixture";

// Loading is a Skeleton in the shape of the content; settled means none is left.
async function settled(page: Page) {
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0, { timeout: 15_000 });
}
// The one primary action on a surface is the Button's default variant.
const PRIMARY = '.main [data-slot="button"][data-variant="default"]:visible';

const TABS: [string, RegExp][] = [
  ["which", /which skill/i],
  ["rules", /suggested rules/i],
  ["editors", /^editors/i],
  ["repos", /per repository/i],
  ["profiles", /^profiles/i],
  ["depth", /^depth/i],
];

test.describe("skills tabs", () => {
  for (const [hash, name] of TABS) {
    test(`#${hash} lands on the ${hash} tab`, async ({ page }) => {
      await page.goto(`/skills#${hash}`);
      await settled(page);
      await expect(page.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByTestId(`panel-${hash}`)).toBeVisible();
      // One screen: only this panel is in the DOM.
      await expect(page.locator('[role="tabpanel"]:not([hidden])')).toHaveCount(1);
    });
  }

  test("every tab is reachable by keyboard and the hash follows", async ({ page }) => {
    await page.goto("/skills");
    await settled(page);
    await page.getByRole("tab", { name: /which skill/i }).focus();
    for (const [hash, name] of TABS.slice(1)) {
      await page.keyboard.press("ArrowRight");
      await expect(page.getByRole("tab", { name })).toBeFocused();
      await expect(page.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
      await expect(page).toHaveURL(new RegExp(`#${hash}$`));
    }
    await page.keyboard.press("Home");
    await expect(page.getByRole("tab", { name: /which skill/i })).toBeFocused();
    await expect(page).toHaveURL(/#which$/);
    // Tab leaves the list for the panel's first control, not the next tab.
    await page.keyboard.press("Tab");
    const inPanel = await page.evaluate(() => !!document.activeElement?.closest('[role="tabpanel"]'));
    expect(inPanel).toBe(true);
  });

  test("each tab carries at most one primary action", async ({ page }) => {
    for (const [hash] of TABS) {
      await page.goto(`/skills#${hash}`);
      await settled(page);
      await expect(page.getByTestId(`panel-${hash}`)).toBeVisible();
      if (hash === "profiles") await page.getByTestId("repo-profile").filter({ hasText: REPO }).first().getByTestId("profile-toggle").click();
      const n = await page.locator(PRIMARY).count();
      expect(n, `${hash} has ${n} primaries`).toBeLessThanOrEqual(1);
    }
  });

  test("the per-repository tab edits one repository at a time", async ({ page }) => {
    await page.goto("/skills#repos");
    await settled(page);
    await expect(page.getByTestId("repo-skill")).toHaveCount(3);
    await expect(page.getByTestId("repo-skill-editor")).toContainText(REPO);
    await page.getByTestId("repo-skill").nth(1).getByRole("button", { name: "Edit" }).click();
    await expect(page.getByTestId("repo-skill-editor")).toContainText("acme/api");
    await expect(page.getByRole("button", { name: "Save skill" })).toHaveCount(1);
  });
});

test.describe("insights", () => {
  test("tiles are a number and a label; the method lives in one disclosure", async ({ page }) => {
    await page.goto("/dashboard");
    await settled(page);
    const tiles = page.getByTestId("kpi");
    await expect(tiles.first()).toBeVisible();
    expect(await tiles.count()).toBeGreaterThanOrEqual(6);
    await expect(tiles.locator("p")).toHaveCount(0);
    for (const t of await tiles.all()) {
      const label = (await t.getByTestId("kpi-label").textContent())?.trim() ?? "";
      expect(label.split(/\s+/).length, `"${label}" is two words`).toBeLessThanOrEqual(2);
      await expect(t.getByTestId("kpi-label")).toHaveCount(1);
      await expect(t.getByTestId("kpi-value")).toHaveCount(1);
    }
    // The method lives behind the page's one `?` (design §6), closed by default.
    await expect(page.getByTestId("methodology")).toHaveCount(0);
    const about = page.getByRole("button", { name: "About this page" });
    await expect(about).toHaveCount(1);
    await expect(about).toHaveAttribute("aria-expanded", "false");
    await about.click();
    await expect(page.getByTestId("methodology")).toBeVisible();
    await expect(page.getByTestId("methodology")).toContainText(/kept as-is/i);
    // The dry-run notice is one sentence.
    const banner = (await page.getByTestId("dry-banner").textContent())?.trim() ?? "";
    expect(banner.split(/(?<=[.!?])\s+(?=[A-Z0-9])/).length).toBe(1);
    // Too few to rate is a quiet line and a graphite badge, not a headline.
    const thin = page.locator('[data-testid="kpi"][data-key="worth"]').getByTestId("kpi-value");
    await expect(thin).toHaveAttribute("data-thin", "true");
    await expect(thin.getByTestId("status-badge")).toHaveAttribute("data-tone", "graphite");
    const size = await thin.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeLessThanOrEqual(14);
  });

  test.describe("phone", () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    test("the activity chart's axis labels are legible at 390", async ({ page }) => {
      await page.goto("/dashboard");
      await settled(page);
      const labels = page.getByTestId("axis-x").locator("span");
      expect(await labels.count()).toBeGreaterThan(0);
      for (const l of await labels.all()) {
        const size = await l.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
        expect(size).toBeGreaterThanOrEqual(12);
        const box = await l.boundingBox();
        expect(box!.width).toBeGreaterThan(40);
      }
    });
  });
});

test.describe("settings", () => {
  test("one save bar applies to every editable section and a Poller change goes through it", async ({ page }) => {
    // The PUT is answered from the real GET so the suite's other settings test (which writes
    // the interval through the real server) is not raced for settings.json.
    let sent: Record<string, unknown> | null = null;
    let real: Record<string, unknown> = {};
    await page.route("**/api/settings", async (route) => {
      if (route.request().method() !== "PUT") {
        // Remember the server's real answer; the PUT below is answered from it.
        const r = await route.fetch();
        real = await r.json();
        return route.fulfill({ response: r, json: real });
      }
      sent = route.request().postDataJSON();
      const settings = (sent as { settings: Record<string, unknown> }).settings;
      await route.fulfill({
        json: {
          ...real,
          settings,
          sources: { ...(real.sources as Record<string, string>), poller_enabled: "settings" },
          bannerHtml: "<div class='banner ok'><div>Saved.</div></div>",
        },
      });
    });
    // Webhooks is read-only and says so; it has no fields, so the bar never appears there.
    await page.goto("/settings#webhooks");
    await settled(page);
    await expect(page.getByTestId("webhooks-readonly")).toContainText(/nothing to save/i);
    const bar = page.getByTestId("settings-save");
    await expect(bar).toHaveAttribute("data-state", "hidden");
    await expect(bar).toBeHidden();

    await page.goto("/settings#poller");
    await settled(page);
    await expect(bar).toBeHidden();
    const sw = page.getByRole("switch", { name: "Poller enabled" });
    await expect(sw).toBeChecked();
    await sw.click();
    // The bar is pinned to the foot of the viewport, Discard (ghost) then Save (primary).
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute("data-state", "dirty");
    await expect(page.getByTestId("settings-dirty")).toHaveText("Unsaved changes");
    await expect(page.getByTestId("settings-dirty-count")).toContainText("1 field");
    const box = (await bar.boundingBox())!;
    expect(Math.round(box.y + box.height)).toBe(page.viewportSize()!.height);
    const buttons = bar.getByRole("button");
    await expect(buttons).toHaveText(["Discard", "Save"]);
    await expect(buttons.nth(0)).toHaveAttribute("data-variant", "ghost");
    await expect(buttons.nth(1)).toHaveAttribute("data-variant", "default");
    await buttons.nth(1).click();
    expect((sent as unknown as { settings: { poller_enabled: boolean } }).settings.poller_enabled).toBe(false);
    await expect(sw).not.toBeChecked();
    // Saved: a check in the bar's place for two seconds, then nothing.
    await expect(bar).toHaveAttribute("data-state", "saved");
    await expect(page.getByTestId("settings-saved")).toContainText(/saved/i);
    await expect(bar).toBeHidden({ timeout: 5_000 });
    await expect(bar).toHaveAttribute("data-state", "hidden");
  });

  test.describe("phone", () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    test("Devices is one row of the You tab, pushed as a page of its own", async ({ page }) => {
      await page.goto("/");
      await settled(page);
      await page.getByTestId("tab-bar").getByRole("link", { name: "You" }).click();
      await page.getByTestId("you-list").getByRole("link", { name: /^Devices/ }).click();
      await expect(page).toHaveURL(/\/you\/devices$/);
      await settled(page);
      await expect(page.getByRole("heading", { level: 1, name: "Devices" })).toBeInViewport();
      await expect(page.locator("#devices")).toBeInViewport();
      await expect(page.getByTestId("settings-pills")).toHaveCount(0);
    });

    test("label rows do not wrap a word per line", async ({ page }) => {
      await page.goto("/settings#poller");
      await settled(page);
      const hint = page.getByTestId("setting-hint").first();
      const box = await hint.boundingBox();
      expect(box!.width).toBeGreaterThan(300);
    });

    test("the section pills are one row that scrolls on its own, and the save bar sits above the tab bar with 44px targets", async ({ page }) => {
      await page.goto("/settings#poller");
      await settled(page);
      const pills = page.getByTestId("settings-pills");
      await expect(pills).toBeVisible();
      await expect(page.getByTestId("settings-nav")).toBeHidden();
      const links = pills.getByRole("link");
      expect(await links.count()).toBeGreaterThanOrEqual(7);
      // One row: every pill shares the first one's top. The row overflows (that is what it scrolls
      // for) but the page itself does not.
      const tops = await links.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
      expect(new Set(tops).size, `pill tops ${tops.join(",")}`).toBe(1);
      const m = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: Math.round(window.visualViewport?.width ?? window.innerWidth),
        rowOverflows: (() => {
          const el = document.querySelector('[data-testid="settings-pills"]')!;
          return el.scrollWidth > el.clientWidth;
        })(),
      }));
      expect(m.scrollWidth).toBeLessThanOrEqual(m.innerWidth);
      expect(m.rowOverflows).toBe(true);
      await expect(pills.getByRole("link", { name: "Poller" })).toHaveAttribute("aria-current", "page");
      await expect(pills.getByRole("link", { name: "Poller" })).toBeInViewport();

      await page.getByRole("switch", { name: "Poller enabled" }).click();
      const bar = page.getByTestId("settings-save");
      await expect(bar).toBeVisible();
      const barBox = (await bar.boundingBox())!;
      const tabBox = (await page.getByTestId("tab-bar").boundingBox())!;
      expect(barBox.y + barBox.height).toBeLessThanOrEqual(tabBox.y + 1);
      for (const b of await bar.getByRole("button").all()) {
        const box = (await b.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
      }
      await bar.getByRole("button", { name: "Discard" }).click();
      await expect(bar).toBeHidden();
    });
  });

  test("the section nav is three quiet groups with the active item on the accent surface", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/settings#filters");
    await settled(page);
    const nav = page.getByTestId("settings-nav");
    await expect(nav).toBeVisible();
    await expect(page.getByTestId("settings-pills")).toBeHidden();
    // The browser install: no Your phone; the three groups in order.
    expect((await nav.innerText()).replace(/\s+/g, " ").trim()).toBe(
      "This device Appearance Reviewing Repositories Poller PR filters Notifications Notifications Webhooks Devices",
    );
    const active = nav.locator('a[aria-current="page"]');
    await expect(active).toHaveText("PR filters");
    await expect(active).toHaveClass(/(^|\s)bg-accent(\s|$)/);
    await expect(nav.getByRole("link", { name: "Poller" })).not.toHaveClass(/(^|\s)bg-accent(\s|$)/);
    // Ghost buttons, not links in the body ink.
    for (const l of await nav.getByRole("link").all()) await expect(l).toHaveAttribute("data-variant", "ghost");
  });
});

test.describe("integrations", () => {
  test("one panel of rows, states as status words, one primary", async ({ page }) => {
    await page.goto("/integrations");
    await settled(page);
    const list = page.getByTestId("integrations-list");
    await expect(list).toHaveAttribute("data-slot", "card");
    await expect(list.getByTestId("integration")).toHaveCount(5);
    await expect(list.getByTestId("integration-state")).toHaveCount(5);
    for (const s of await list.getByTestId("integration-state").all()) {
      await expect(s).toHaveText(/^(Connected|Not connected|Required)$/);
    }
    const primaries = page.locator(PRIMARY);
    await expect(primaries).toHaveCount(1);
    await expect(primaries).toHaveText(/connect with claude/i);
  });
});

test.describe("tour on the phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("step 4 never covers the list it points at", async ({ page }) => {
    await page.goto("/");
    await settled(page);
    await page.getByTestId("tab-bar").getByRole("link", { name: "You" }).click();
    await page.getByRole("button", { name: /take a tour/i }).click();
    await expect(page).toHaveURL(/\/$/); // the tour walks the queue, so it starts there
    const tour = page.getByTestId("tour");
    await expect(tour).toBeVisible();
    await expect(tour).toHaveAttribute("aria-modal", "true");
    for (let i = 0; i < 3; i++) await tour.getByRole("button", { name: "Next" }).click();
    await expect(tour).toContainText(/your review queue/i);
    const card = await tour.locator(".tourcard").boundingBox();
    const target = page.locator('[data-tour="queuelist"], [data-tour="queue"]').first();
    const list = await target.boundingBox();
    expect(card).not.toBeNull();
    expect(list).not.toBeNull();
    const disjoint =
      card!.y + card!.height <= list!.y ||
      list!.y + list!.height <= card!.y ||
      card!.x + card!.width <= list!.x ||
      list!.x + list!.width <= card!.x;
    expect(disjoint, `card ${JSON.stringify(card)} vs list ${JSON.stringify(list)}`).toBe(true);
    // And the list is actually on screen next to the card, not scrolled away.
    expect(list!.y).toBeLessThan(844);
    expect(list!.y + list!.height).toBeGreaterThan(0);
  });
});
