// Lane S3 of the system rebuild (openspec/changes/rebuild-on-a-system/design.md §2–§4): Skills,
// Insights, Learnings, QA guides, Integrations and Settings are built from the components, not
// from bespoke rules. No dot-and-word status on any of them, no sentence under a title, Radix
// tabs on Skills with the scores as a real table and the editor as a code surface, one row of
// tiles on Insights, badges and pills in the Learnings table, one primary on Integrations, the
// push panel above Devices on Settings, no monospace outside code, and nothing scrolling
// sideways on a phone.
import { expect, test, type Page } from "@playwright/test";
import { PR2, REPO, patchJson } from "./fixture";

const enc = (r: string) => encodeURIComponent(r);
const PAGES: [string, string][] = [
  ["skills", "/skills"],
  ["insights", "/dashboard"],
  ["learnings", "/learnings"],
  ["qa", "/qa"],
  ["qa guide", `/qa?repo=${enc(REPO)}&pr=${PR2}`],
  ["integrations", "/integrations"],
  ["settings", "/settings"],
];

// Loading is a Skeleton in the shape of the content; settled means none is left.
async function settled(page: Page) {
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0, { timeout: 15_000 });
  // A phone names the page in the navigation bar rather than repeating it in a page header.
  await expect(page.getByTestId("page-header").or(page.getByTestId("nav-title")).first()).toBeVisible();
}

// Monospace is permitted only inside code: <pre>, <code>, <kbd>, a textarea, the skill editor.
const CODE_SURFACES = 'pre, code, kbd, textarea, [data-testid="code-area"]';
async function monoOutsideCode(page: Page): Promise<string[]> {
  return page.evaluate((sel) => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(".main *")) {
      if (!el.textContent?.trim()) continue;
      if (!/mono/i.test(getComputedStyle(el).fontFamily)) continue;
      if (el.closest(sel)) continue;
      out.push(`${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 40)}: ${el.textContent.trim().slice(0, 30)}`);
    }
    return out;
  }, CODE_SURFACES);
}

const TEAM_SKILL = [
  "# Review skill",
  "",
  "Read the diff before the description.",
  "",
  "## Team rules",
  "",
  "- Do not raise const-over-let style nits.",
  "",
  "## Output",
  "",
  "One finding per comment.",
].join("\n");

test.describe("the six pages at 1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const [name, path] of PAGES) {
    test(`${name}: no dot-and-word status, no sentence under the title, no monospace outside code`, async ({ page }) => {
      await page.goto(path);
      await settled(page);
      expect(await page.evaluate(() => document.querySelectorAll(".status").length)).toBe(0);
      await expect(page.getByTestId("page-header").locator("p")).toHaveCount(0);
      expect(await monoOutsideCode(page)).toEqual([]);
    });
  }

  test("skills: six Radix tabs, the scores as a table with a header row, the editor as a code surface", async ({ page }) => {
    await patchJson(page, "**/api/skills", () => ({ teamSkill: TEAM_SKILL, globalEdited: true }));
    await page.goto("/skills#which");
    await settled(page);
    const list = page.getByRole("tablist", { name: "Skills" });
    await expect(list.getByRole("tab")).toHaveCount(6);
    await expect(list).toHaveAttribute("data-slot", "tabs-list");
    const table = page.getByTestId("skill-stats");
    await expect(table.locator("thead tr")).toHaveCount(1);
    await expect(table.locator("thead th")).toHaveCount(6);
    await expect(table.locator("tbody tr").first().getByTestId("status-badge")).toHaveCount(1);
    // The two choices are selectable cards with a check on the active one.
    const group = page.getByRole("radiogroup", { name: "Which skill" });
    await expect(group.getByRole("radio")).toHaveCount(2);
    await expect(group.getByRole("radio", { checked: true })).toHaveCount(1);
    await expect(group.getByRole("radio", { checked: true }).locator("svg")).toHaveCount(1);

    await list.getByRole("tab", { name: /editors/i }).click();
    await expect(page).toHaveURL(/#editors$/);
    const area = page.getByTestId("code-area").first();
    await expect(area).toBeVisible();
    const first = area.locator(".ln").first();
    expect(await first.evaluate((el) => getComputedStyle(el, "::before").content)).toBe('"1"');
    const marker = area.locator(".ln.is-rules-h");
    await expect(marker).toHaveText("## Team rules");
    expect(await marker.evaluate((el) => getComputedStyle(el).borderLeftWidth)).toBe("2px");
    expect(await area.locator(".ln.is-rules").count()).toBeGreaterThanOrEqual(2);
    // The textarea is the only monospace, and it is the code surface.
    expect(await monoOutsideCode(page)).toEqual([]);
    await expect(page.getByRole("button", { name: "Save skill" })).toHaveAttribute("data-variant", "default");
    await expect(page.getByRole("button", { name: /restore built-in/i })).toHaveAttribute("data-variant", "ghost");
  });

  test("insights: nine tile cards share one top edge, the range is a tab list in the header", async ({ page }) => {
    await page.goto("/dashboard");
    await settled(page);
    const tiles = page.getByTestId("kpi");
    await expect(tiles).toHaveCount(9);
    for (const t of await tiles.all()) await expect(t).toHaveAttribute("data-slot", "card");
    const tops = await tiles.evaluateAll((els) => els.map((e) => (e as HTMLElement).offsetTop));
    expect(new Set(tops).size, `tile tops ${tops.join(",")}`).toBe(1);
    const range = page.getByTestId("page-header").getByRole("tablist", { name: "Range" });
    await expect(range.getByRole("tab")).toHaveCount(3);
    await expect(range.getByRole("tab", { name: "30 days" })).toHaveAttribute("aria-selected", "true");
  });

  test("learnings: a table with a header row, the repository as a pill and the path as a badge", async ({ page }) => {
    await page.goto("/learnings");
    await settled(page);
    const table = page.getByTestId("learning-rows").locator("table");
    await expect(table.locator("thead tr")).toHaveCount(1);
    const row = table.locator("tbody tr").first();
    await expect(row.getByTestId("status-badge").first()).toBeVisible();
    await expect(row.getByTestId("repo-pill")).toHaveCount(1);
    await expect(row.locator('[data-slot="badge"][data-variant="outline"]')).toHaveCount(1);
  });

  test("qa: every index row carries a status badge; the guide's actions are the system's buttons", async ({ page }) => {
    await page.goto("/qa");
    await settled(page);
    const rows = page.getByTestId("qa-row");
    expect(await rows.count()).toBeGreaterThan(0);
    for (const r of await rows.all()) await expect(r.getByTestId("status-badge")).toHaveCount(1);
    await page.goto(`/qa?repo=${enc(REPO)}&pr=${PR2}`);
    await settled(page);
    await expect(page.getByRole("button", { name: /copy guide/i })).toHaveAttribute("data-variant", "default");
    await expect(page.getByTestId("qa-download")).toHaveAttribute("data-variant", "secondary");
    await expect(page.getByTestId("qa-last-run")).toBeVisible();
  });

  test("integrations: one card of rows, exactly one primary button, and it connects Claude", async ({ page }) => {
    await page.goto("/integrations");
    await settled(page);
    await expect(page.getByTestId("integrations-list")).toHaveAttribute("data-slot", "card");
    const primaries = page.locator('.main [data-slot="button"][data-variant="default"]');
    await expect(primaries).toHaveCount(1);
    await expect(primaries).toHaveText(/connect with claude/i);
    await expect(primaries).toHaveClass(/bg-primary/);
    expect(await page.locator('.main [data-slot="button"].bg-primary').count()).toBe(1);
  });

  test("settings: one section at a time, the push rows live in Notifications, and the save bar wakes only when a field changes", async ({ page }) => {
    await page.goto("/settings#notifications");
    await settled(page);
    // One section in the DOM; the others are reached through the section nav.
    await expect(page.getByTestId("settings-section")).toHaveCount(1);
    await expect(page.locator("#notifications")).toHaveCount(1);
    await expect(page.locator("#notifications").locator('[data-slot="card"]')).toHaveCount(1);
    const push = page.locator("#notifications").getByTestId("push-devices");
    await expect(push).toBeVisible();
    await expect(push.getByRole("switch", { name: "Notifications on this device" })).toBeVisible();
    await expect(page.locator("#devices")).toHaveCount(0);

    await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "PR filters" }).click();
    await expect(page.locator("#filters")).toBeVisible();
    await expect(page.locator("#notifications")).toHaveCount(0);
    const bar = page.getByTestId("settings-save");
    await expect(bar).toBeHidden();
    await expect(page.getByTestId("settings-dirty")).toBeHidden();
    const age = page.getByLabel("Max PR age in days");
    const before = await age.inputValue();
    await age.fill(String(Number(before) + 1));
    await expect(bar).toBeVisible();
    await expect(page.getByTestId("settings-dirty")).toBeVisible();
    await expect(bar.getByRole("button", { name: "Save" })).toBeEnabled();
    await bar.getByRole("button", { name: "Discard" }).click();
    await expect(bar).toBeHidden();
    await expect(age).toHaveValue(before);
  });
});

test.describe("the six pages at 390", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  for (const [name, path] of PAGES) {
    test(`${name} does not scroll sideways`, async ({ page }) => {
      await page.goto(path);
      await settled(page);
      if (name === "skills") {
        await page.getByRole("tab", { name: /editors/i }).click();
        await expect(page.getByTestId("code-area").first()).toBeVisible();
      }
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: Math.round(window.visualViewport?.width ?? window.innerWidth),
      }));
      expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
    });
  }
});
