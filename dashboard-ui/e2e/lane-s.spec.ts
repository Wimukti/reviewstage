// Lane S (Skills, Insights, Settings, Integrations, Tour) — the redesign's proof
// for the pages that sit on the foundation. Behaviour is unchanged; these pin the new shape.
import { expect, test, type Page } from "@playwright/test";
import { REPO } from "./fixture";

async function settled(page: Page) {
  await expect(page.locator(".muted", { hasText: /^Loading…$/ })).toHaveCount(0, { timeout: 15_000 });
}

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
      if (hash === "profiles") await page.getByTestId("repo-profile").filter({ hasText: REPO }).first().locator("> summary").click();
      const n = await page.locator(".main .btn.primary:visible").count();
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
    const tiles = page.locator(".kpi");
    expect(await tiles.count()).toBeGreaterThanOrEqual(6);
    await expect(page.locator(".kpi p")).toHaveCount(0);
    for (const t of await tiles.all()) {
      const label = (await t.locator(".kpi-l").textContent())?.trim() ?? "";
      expect(label.split(/\s+/).length, `"${label}" is two words`).toBeLessThanOrEqual(2);
      await expect(t.locator(".kpi-l")).toHaveCount(1);
      await expect(t.locator(".kpi-v")).toHaveCount(1);
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
    // Too few to rate is a quiet line, not a headline.
    const thin = page.getByTestId("kpi-worth").locator(".kpi-v");
    await expect(thin).toHaveClass(/kpi-thin/);
    const size = await thin.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeLessThanOrEqual(14);
  });

  test.describe("phone", () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    test("the activity chart's axis labels are legible at 390", async ({ page }) => {
      await page.goto("/dashboard");
      await settled(page);
      const labels = page.locator(".axis-x span");
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
  test("one Save applies to every editable card and a Poller change goes through it", async ({ page }) => {
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
    await page.goto("/settings");
    await settled(page);
    const save = page.getByRole("button", { name: /save settings/i });
    await expect(save).toHaveCount(1);
    await expect(save).toBeDisabled();
    // The footer sits inside the editable group, after the last field, and names what it saves.
    const foot = page.getByTestId("settings-save");
    await expect(foot).toContainText(/poller, notifications and pr filters/i);
    const form = await page.getByTestId("settings-form").boundingBox();
    const footBox = await foot.boundingBox();
    expect(footBox!.y + footBox!.height).toBeLessThanOrEqual(form!.y + form!.height + 1);
    // Webhooks is read-only and says so, and it is not inside the saved group.
    await expect(page.getByTestId("webhooks-readonly")).toContainText(/nothing to save/i);
    await expect(page.getByTestId("settings-form").getByTestId("webhooks-card")).toHaveCount(0);

    const sw = page.getByRole("switch", { name: "Poller enabled" });
    await expect(sw).toBeChecked();
    await sw.click();
    await expect(page.getByTestId("settings-dirty")).toBeVisible();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.locator(".banner.ok")).toBeVisible();
    expect((sent as unknown as { settings: { poller_enabled: boolean } }).settings.poller_enabled).toBe(false);
    await expect(sw).not.toBeChecked();
    await expect(save).toBeDisabled();
    await expect(page.getByTestId("settings-dirty")).toHaveCount(0);
  });

  test.describe("phone", () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    test("Devices is one tap from More", async ({ page }) => {
      await page.goto("/");
      await settled(page);
      await page.getByTestId("more-tab").click();
      await page.getByTestId("more-sheet").getByRole("link", { name: "Devices" }).click();
      await expect(page).toHaveURL(/\/settings#devices$/);
      await settled(page);
      await expect(page.locator("#devices").getByRole("heading", { name: "Devices" })).toBeInViewport();
    });

    test("label rows do not wrap a word per line", async ({ page }) => {
      await page.goto("/settings");
      await settled(page);
      const hint = page.locator(".setrow .setlbl .hint").first();
      const box = await hint.boundingBox();
      expect(box!.width).toBeGreaterThan(300);
    });
  });
});

test.describe("integrations", () => {
  test("one panel of rows, states as status words, one primary", async ({ page }) => {
    await page.goto("/integrations");
    await settled(page);
    await expect(page.getByTestId("integrations-list")).toHaveClass(/list/);
    await expect(page.locator(".intglist .intg")).toHaveCount(5);
    await expect(page.locator(".intg .status")).toHaveCount(5);
    for (const s of await page.locator(".intg .iname .status").all()) {
      await expect(s).toHaveText(/^(Connected|Not connected|Required)$/);
    }
    const primaries = page.locator(".main .btn.primary:visible");
    await expect(primaries).toHaveCount(1);
    await expect(primaries).toHaveText(/connect with claude/i);
  });
});

test.describe("tour on the phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("step 4 never covers the list it points at", async ({ page }) => {
    await page.goto("/");
    await settled(page);
    await page.getByTestId("more-tab").click();
    await page.getByRole("button", { name: /take a tour/i }).click();
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
