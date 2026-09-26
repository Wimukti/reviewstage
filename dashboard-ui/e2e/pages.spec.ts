// Lane A3 (stage light): Skills, Insights, Learnings, QA, Integrations, Settings, and the removal
// of How it works. Behaviour is unchanged; these pin the density and the words of design §3/§6.
import { expect, test, type Page } from "@playwright/test";
import { patchJson } from "./fixture";

const PAGES: [string, string][] = [
  ["skills", "/skills"],
  ["insights", "/dashboard"],
  ["learnings", "/learnings"],
  ["qa", "/qa"],
  ["integrations", "/integrations"],
  ["settings", "/settings"],
];

async function settled(page: Page) {
  await expect(page.locator(".muted", { hasText: /^Loading…$/ })).toHaveCount(0, { timeout: 15_000 });
}

const TEAM_SKILL = [
  "# Review skill",
  "",
  "Read the diff before the description.",
  "",
  "## Team rules",
  "",
  "- Do not raise const-over-let style nits.",
  "- Never ask for a Jira link in code comments.",
  "",
  "## Output",
  "",
  "One finding per comment.",
].join("\n");

test.describe("words (design §6)", () => {
  for (const [name, path] of PAGES) {
    test(`${name} has no sentence under its title`, async ({ page }) => {
      await page.goto(path);
      await settled(page);
      await expect(page.locator("h1").first()).toBeVisible();
      await expect(page.locator(".pagehead p")).toHaveCount(0);
      await expect(page.locator(".lead, .tabdesc")).toHaveCount(0);
      // At most one orientation disclosure, and it opens on demand only.
      const about = page.getByRole("button", { name: "About this page" });
      expect(await about.count()).toBeLessThanOrEqual(1);
      await expect(page.locator(".pagehead .explainbox")).toHaveCount(0);
      if ((await about.count()) === 1) {
        await about.click();
        await expect(about).toHaveAttribute("aria-expanded", "true");
        await expect(page.locator(".pagehead .explainbox")).toBeVisible();
      }
    });
  }

  test("/how is gone: the app answers with its not-found state", async ({ page }) => {
    await page.goto("/how");
    await settled(page);
    await expect(page.getByRole("heading", { name: /not found/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /how reviewstage works/i })).toHaveCount(0);
    await expect(page.locator(".flow")).toHaveCount(0);
  });
});

test.describe("skills", () => {
  test("scores are one compact table, a header row and one row per skill", async ({ page }) => {
    const stats = (await (await page.request.get("/api/skills")).json()).stats as unknown[];
    await page.goto("/skills#which");
    await settled(page);
    const table = page.getByTestId("skill-stats");
    await expect(table).toBeVisible();
    const heads = table.locator("thead th");
    await expect(heads).toHaveCount(6);
    await expect(heads.nth(0)).toHaveText("Skill");
    await expect(heads.nth(5)).toHaveText("Rating");
    await expect(table.locator("tbody tr")).toHaveCount(stats.length);
    expect(stats.length).toBeGreaterThan(0);
    const row = table.locator("tbody tr").first();
    const box = await row.boundingBox();
    expect(Math.round(box!.height)).toBe(44);
    // The old score cards are gone.
    await expect(page.locator(".panel-which .row, .ratebar + .muted")).toHaveCount(0);
  });

  test("the editor is a code surface: a line-number gutter and the Team rules band", async ({ page }) => {
    await patchJson(page, "**/api/skills", () => ({ teamSkill: TEAM_SKILL, globalEdited: true }));
    await page.goto("/skills#editors");
    await settled(page);
    const area = page.getByTestId("code-area").first();
    await expect(area).toBeVisible();
    // Still a plain textarea underneath, with the whole skill in it.
    const box = area.locator("textarea");
    await expect(box).toHaveValue(TEAM_SKILL);
    await expect(box).toHaveAttribute("aria-label", /team default/i);
    // One gutter number per line, in order.
    const lines = area.locator(".codearea-mirror .ln");
    await expect(lines).toHaveCount(TEAM_SKILL.split("\n").length);
    await expect(lines.first()).toHaveAttribute("data-n", "1");
    const gutter = await lines.first().evaluate((el) => getComputedStyle(el, "::before").content);
    expect(gutter).toBe('"1"');
    // The Team rules section — heading through its last bullet, not the next heading — is lit.
    const rules = area.locator(".ln.is-rules");
    await expect(rules).toHaveCount(5);
    await expect(area.locator(".ln.is-rules-h")).toHaveText("## Team rules");
    await expect(area.locator(".ln", { hasText: "## Output" })).not.toHaveClass(/is-rules/);
    const blue = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--blue").trim());
    const shadow = await area.locator(".ln.is-rules-h").evaluate((el) => getComputedStyle(el).boxShadow);
    expect(shadow).toContain("inset");
    expect(shadow.toLowerCase().replace(/\s/g, "")).toContain(hexToRgb(blue).replace(/\s/g, ""));
    // The mirror and the textarea share their metrics, so the caret lands on the mirrored glyph.
    const metrics = (sel: string) =>
      area.locator(sel).evaluate((el) => {
        const cs = getComputedStyle(el);
        return `${cs.fontFamily}|${cs.fontSize}|${cs.lineHeight}|${cs.whiteSpace}`;
      });
    expect(await metrics("textarea")).toBe(await metrics(".codearea-mirror"));
    // Typing goes to the textarea and the gutter follows.
    await box.focus();
    await page.keyboard.press("End");
    await page.keyboard.type("\nA new line");
    await expect(lines).toHaveCount(TEAM_SKILL.split("\n").length + 1);
  });

  test("every tab is dense: controls at --ctl, no paragraph under a heading", async ({ page }) => {
    for (const hash of ["which", "rules", "editors", "repos", "profiles", "depth"]) {
      await page.goto(`/skills#${hash}`);
      await settled(page);
      await expect(page.locator(".tabpanel:not([hidden]) > p")).toHaveCount(0);
      const tab = page.getByRole("tab", { selected: true });
      expect(Math.round((await tab.boundingBox())!.height)).toBe(32);
    }
  });
});

test.describe("insights", () => {
  test("the nine tiles sit in one row at 1440, charts have no panel border", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    await settled(page);
    const tiles = page.locator(".kpi");
    await expect(tiles).toHaveCount(9);
    const tops = await tiles.evaluateAll((els) => els.map((e) => (e as HTMLElement).offsetTop));
    expect(new Set(tops).size, `tile tops ${tops.join(",")}`).toBe(1);
    // Charts sit on the canvas: a title and the drawing, no border, no panel background.
    const charts = page.locator(".chartblock");
    expect(await charts.count()).toBeGreaterThanOrEqual(6);
    for (const c of await charts.all()) {
      const { border, bg } = await c.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { border: cs.borderTopWidth, bg: cs.backgroundColor };
      });
      expect(border).toBe("0px");
      expect(bg).toBe("rgba(0, 0, 0, 0)");
      await expect(c.locator(".chart-h")).toHaveCount(1);
    }
    await expect(page.locator(".panel")).toHaveCount(0);
  });

  test("the tiles wrap below 900", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto("/dashboard");
    await settled(page);
    const tops = await page.locator(".kpi").evaluateAll((els) => els.map((e) => (e as HTMLElement).offsetTop));
    expect(new Set(tops).size).toBeGreaterThan(1);
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  for (const [name, path] of PAGES) {
    test(`${name} does not scroll sideways at 390`, async ({ page }) => {
      await page.goto(path);
      await settled(page);
      if (name === "skills") {
        await page.getByRole("tab", { name: /editors/i }).click();
      }
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
    });
  }
});

function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
