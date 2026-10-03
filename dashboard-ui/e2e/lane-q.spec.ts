// Lane Q of the redesign (tasks.md): the queue without its stat tiles, the archive control as an
// icon button that keyboard users can find, a command palette that announces the highlighted
// option, a QA title that never repeats its own number, and Learnings as a table.
import { expect, test, type Page } from "@playwright/test";
import { PR, PR3, REPO, REPO2 } from "./fixture";

const enc = (r: string) => encodeURIComponent(r);

async function pickRepo(page: Page, label: string | RegExp) {
  await page.getByLabel("Filter by repository").click();
  await page.getByRole("option", { name: label }).click();
}
const tabCount = (page: Page, name: RegExp) => page.getByRole("tab", { name }).getByTestId("tab-count");

test.describe("queue", () => {
  test("has no stat tiles and the tab counts still follow a repository filter", async ({ page }) => {
    await page.goto("/?tab=all");
    await expect(page.getByTestId("queue-row").first()).toBeVisible();
    await expect(page.locator(".stats, .stat")).toHaveCount(0);
    const all = tabCount(page, /^All/);
    const before = Number((await all.innerText()).replace(/,/g, ""));
    expect(before).toBeGreaterThan(1);

    const filtered = page.waitForRequest((r) => r.url().includes(`repo=${enc(REPO2)}`));
    await pickRepo(page, REPO2);
    await filtered;
    await expect(page.getByTestId("queue-row").getByTestId("repo-pill").filter({ hasText: REPO })).toHaveCount(0);
    const rows = await page.getByTestId("queue-row").count();
    await expect.poll(async () => Number((await all.innerText()).replace(/,/g, ""))).toBe(rows);
    expect(rows).toBeLessThan(before);
    await pickRepo(page, "All repositories");
  });

  test("rows are two lines: title, then the state as a badge", async ({ page }) => {
    await page.goto("/?tab=reviewed");
    const row = page.getByTestId("queue-row").filter({ hasText: `#${PR}` });
    await expect(row.getByTestId("row-link")).toContainText("Add lead-time badge");
    const state = row.getByTestId("row-state").getByTestId("status-badge").first();
    await expect(state).toHaveText("Reviewed");
    await expect(state.locator("svg")).toBeVisible();
    await expect(row.getByTestId("row-by")).toContainText("teammate");
    // The sort options are one row of four.
    await expect(page.getByRole("group", { name: "Sort" }).getByRole("link")).toHaveCount(4);
    // One field in the page header filters the queue and opens a pasted PR.
    const search = page.getByTestId("page-header").getByRole("search");
    await expect(search.locator("#qsearch")).toBeVisible();
    await expect(search.locator("button[type=submit]")).toHaveCount(0);
    await page.locator("#qsearch").fill(`#${PR}`);
    await expect(search.locator("button[type=submit]")).toHaveText(`Open #${PR}`);
  });

  test("the archive control is reachable by keyboard and visible on focus", async ({ page }) => {
    await page.goto("/?tab=reviewed");
    const row = page.getByTestId("queue-row").filter({ hasText: `#${PR}` });
    const archive = row.getByRole("button", { name: `Archive #${PR}` });
    await expect(archive).toHaveCount(1);
    // Hidden until the row is hovered or the control has focus — the mouse is parked at 0,0.
    await expect(archive).toHaveCSS("opacity", "0");
    await row.getByTestId("row-link").focus();
    await page.keyboard.press("Tab");
    await expect(archive).toBeFocused();
    await expect(archive).toHaveCSS("opacity", "1");
    // The system's focus ring is a box-shadow, not an outline: at least one non-transparent layer.
    await expect.poll(async () => archive.evaluate((el) => getComputedStyle(el).boxShadow)).toMatch(/(?:rgba?|oklab)\((?!0, 0, 0, 0\))(?![^)]*\/ 0\))[^)]*\)/);
  });
});

test.describe("command palette", () => {
  test("is a listbox and the input points at the highlighted option", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /review queue/i })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+k");
    const input = page.getByTestId("palette-input");
    await expect(input).toHaveAttribute("role", "combobox");
    const list = page.locator("[cmdk-list]");
    await expect(list).toHaveAttribute("role", "listbox");
    const options = list.getByRole("option");
    await expect(options.first()).toBeVisible();
    const activeId = async () => (await input.getAttribute("aria-activedescendant")) || "";
    await expect.poll(activeId).not.toBe("");
    const first = await activeId();
    const byId = (id: string) => page.locator(`[id="${id}"]`);
    await expect(byId(first)).toHaveAttribute("aria-selected", "true");
    await expect(byId(first)).toHaveAttribute("role", "option");
    await input.press("ArrowDown");
    await expect.poll(activeId).not.toBe(first);
    const second = await activeId();
    await expect(byId(second)).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('[role="option"][aria-selected="true"]')).toHaveCount(1);
    await expect(list.locator("button")).toHaveCount(0);
  });
});

test.describe("QA guides", () => {
  test("the detail title carries the number once when the server has no title", async ({ page }) => {
    await page.goto(`/qa?repo=${enc(REPO2)}&pr=${PR3}`);
    const h1 = page.getByTestId("page-header").locator("h1");
    await expect(h1).toContainText(`#${PR3}`);
    const text = (await h1.innerText()).trim();
    expect(text).not.toMatch(/#(\d+)\s*—\s*PR #\1/);
    expect(text.match(new RegExp(`#${PR3}\\b`, "g"))?.length).toBe(1);
  });

  test("index rows use the status vocabulary and the form sits in the header", async ({ page }) => {
    await page.goto("/qa");
    await expect(page.getByTestId("page-header").getByLabel("PR to build a QA guide for")).toBeVisible();
    await expect(page.getByTestId("qa-row").first().getByTestId("status-badge").first()).toHaveText(/Guide ready|Building/);
  });

  test("with no guides the empty state carries the form", async ({ page }) => {
    await page.route("**/api/qa", async (route) => {
      const r = await route.fetch();
      const body = await r.json();
      await route.fulfill({ response: r, json: { ...body, guides: [] } });
    });
    await page.goto("/qa");
    const empty = page.getByTestId("qa-empty");
    await expect(empty).toBeVisible();
    await expect(empty.locator("form input")).toBeVisible();
    await expect(empty.getByRole("button", { name: "Open" })).toBeVisible();
    await expect(page.getByTestId("page-header").locator("form")).toHaveCount(0);
  });
});

test.describe("learnings", () => {
  test("recent decisions render as a table with a header row", async ({ page }) => {
    await page.goto("/learnings");
    const table = page.getByTestId("learning-rows").locator("table");
    await expect(table).toBeVisible();
    const heads = table.locator("thead th");
    await expect(heads.first()).toHaveText("Decision");
    expect(await heads.count()).toBeGreaterThanOrEqual(4);
    await expect(heads.filter({ hasText: "Severity" })).toHaveCount(1);
    await expect(heads.filter({ hasText: "Path" })).toHaveCount(1);
    await expect(table.locator("tbody tr").first()).toBeVisible();
    // "Dropped" is a neutral outcome — graphite, never red.
    const dropped = table.locator('tbody [data-testid="status-badge"]', { hasText: "Dropped" }).first();
    await expect(dropped).toHaveAttribute("data-tone", "graphite");
    await expect(table.locator('tbody [data-testid="status-badge"][data-tone="red"]', { hasText: "Dropped" })).toHaveCount(0);
    // Dry-run rows keep their marker as a graphite badge.
    await expect(page.getByTestId("dry-mark").first()).toHaveAttribute("data-tone", "graphite");
    // The retention note lives behind the page's one `?`, closed by default.
    await expect(page.getByTestId("retention-note")).toHaveCount(0);
    await page.getByRole("button", { name: "About this page" }).click();
    await expect(page.getByTestId("retention-note")).toContainText(/one log for the whole install/i);
  });
});
