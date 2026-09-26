// Lane Q of the redesign (tasks.md): the queue without its stat tiles, the archive control as an
// icon button that keyboard users can find, a command palette that announces the highlighted
// option, a QA title that never repeats its own number, and Learnings as a table.
import { expect, test } from "@playwright/test";
import { PR, PR3, REPO, REPO2 } from "./fixture";

const enc = (r: string) => encodeURIComponent(r);

test.describe("queue", () => {
  test("has no stat tiles and the tab counts still follow a repository filter", async ({ page }) => {
    await page.goto("/?tab=all");
    await expect(page.locator(".row").first()).toBeVisible();
    await expect(page.locator(".stats, .stat")).toHaveCount(0);
    const all = page.locator(".tab", { hasText: /^All/ }).locator(".cnt");
    const before = Number((await all.innerText()).replace(/,/g, ""));
    expect(before).toBeGreaterThan(1);

    const filtered = page.waitForRequest((r) => r.url().includes(`repo=${enc(REPO2)}`));
    await page.getByLabel("Filter by repository").selectOption(REPO2);
    await filtered;
    await expect(page.locator(".row .repochip", { hasText: REPO })).toHaveCount(0);
    const rows = await page.locator(".row").count();
    await expect.poll(async () => Number((await all.innerText()).replace(/,/g, ""))).toBe(rows);
    expect(rows).toBeLessThan(before);
    await page.getByLabel("Filter by repository").selectOption("");
  });

  test("rows are two lines: title, then the state as a dot and a phrase", async ({ page }) => {
    await page.goto("/?tab=reviewed");
    const row = page.locator(".row", { hasText: `#${PR}` });
    await expect(row.locator(".rowtop .ttl")).toBeVisible();
    await expect(row.locator(".rowsub .status").first()).toHaveText("Reviewed");
    await expect(row.locator(".rowsub .status i").first()).toBeVisible();
    await expect(row.locator(".rowby")).toContainText("teammate");
    // The sort options are one segmented control.
    await expect(page.getByRole("group", { name: "Sort" }).locator(".sortopt")).toHaveCount(4);
    // One field in the page header filters the queue and opens a pasted PR.
    await expect(page.locator(".pagehead .qsearch #qsearch")).toBeVisible();
    await expect(page.locator(".pagehead .qsearch button[type=submit]")).toHaveCount(0);
    await page.locator("#qsearch").fill(`#${PR}`);
    await expect(page.locator(".pagehead .qsearch button[type=submit]")).toHaveText(`Open #${PR}`);
  });

  test("the archive control is reachable by keyboard and visible on focus", async ({ page }) => {
    await page.goto("/?tab=reviewed");
    const row = page.locator(".row", { hasText: `#${PR}` });
    const archive = row.getByRole("button", { name: `Archive #${PR}` });
    await expect(archive).toHaveCount(1);
    // Hidden until the row is hovered or the control has focus — the mouse is parked at 0,0.
    await expect(archive).toHaveCSS("opacity", "0");
    await row.locator(".rowlink").focus();
    await page.keyboard.press("Tab");
    await expect(archive).toBeFocused();
    await expect(archive).toHaveCSS("opacity", "1");
    const ring = await archive.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(ring).not.toBe("none");
  });
});

test.describe("command palette", () => {
  test("is a listbox and the input points at the highlighted option", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /review queue/i })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+k");
    const input = page.locator(".cmdk-in");
    await expect(input).toHaveAttribute("role", "combobox");
    const list = page.locator(".cmdk-list");
    await expect(list).toHaveAttribute("role", "listbox");
    const options = list.getByRole("option");
    await expect(options.first()).toBeVisible();
    const activeId = async () => (await input.getAttribute("aria-activedescendant")) || "";
    const first = await activeId();
    expect(first).not.toBe("");
    await expect(page.locator(`#${first}`)).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(`#${first}`)).toHaveAttribute("role", "option");
    await input.press("ArrowDown");
    const second = await activeId();
    expect(second).not.toBe(first);
    await expect(page.locator(`#${second}`)).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('[role="option"][aria-selected="true"]')).toHaveCount(1);
    await expect(page.locator(".cmdk-list button")).toHaveCount(0);
  });
});

test.describe("QA guides", () => {
  test("the detail title carries the number once when the server has no title", async ({ page }) => {
    await page.goto(`/qa?repo=${enc(REPO2)}&pr=${PR3}`);
    const h1 = page.locator("h1.prtitle");
    await expect(h1).toContainText(`#${PR3}`);
    const text = (await h1.innerText()).trim();
    expect(text).not.toMatch(/#(\d+)\s*—\s*PR #\1/);
    expect(text.match(new RegExp(`#${PR3}\\b`, "g"))?.length).toBe(1);
  });

  test("index rows use the status vocabulary and the form sits in the header", async ({ page }) => {
    await page.goto("/qa");
    await expect(page.locator(".pagehead .qagen input")).toBeVisible();
    await expect(page.locator(".list .row .status").first()).toHaveText(/Guide ready|Building/);
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
    await expect(page.locator(".pagehead .qagen")).toHaveCount(0);
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
    const dropped = table.locator("tbody .status", { hasText: "Dropped" }).first();
    await expect(dropped).toHaveClass(/is-graphite/);
    await expect(table.locator("tbody .status.is-red", { hasText: "Dropped" })).toHaveCount(0);
    // Dry-run rows keep their marker as a graphite status.
    await expect(page.getByTestId("dry-mark").first()).toHaveClass(/is-graphite/);
    // The retention note lives behind the page's one `?`, closed by default.
    await expect(page.getByTestId("retention-note")).toHaveCount(0);
    await page.getByRole("button", { name: "About this page" }).click();
    await expect(page.getByTestId("retention-note")).toContainText(/one log for the whole install/i);
  });
});
