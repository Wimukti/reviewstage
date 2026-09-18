// A review in flight has to be visible from everywhere, and the "Stacked review" action has to
// appear only when there is a stack. Both are read off the fixture: PR4 has a permanently
// in-flight run, and REPO's fake `gh pr list` answers a two-PR chain (PR is PR2's parent) while
// REPO2 answers nothing at all.
import { expect, test } from "@playwright/test";
import { PR, PR3, PR4, REPO, REPO2 } from "./fixture";

const prUrl = (repo: string, num: string) => `/pr?repo=${encodeURIComponent(repo)}&pr=${num}`;

test.describe("a running review stays visible", () => {
  test("shows on the PR page, in the queue, in the sidebar, and again on return", async ({ page }) => {
    // 1. The PR page reports the run in progress.
    await page.goto(prUrl(REPO, PR4));
    await expect(page.getByTestId("progress-panel")).toBeVisible();
    await expect(page.getByTestId("progress-panel")).toContainText(/reviewing the diff/i);

    // 2. The sidebar says so from any page — including this one.
    const pill = page.getByTestId("running-pill");
    await expect(pill).toBeVisible();
    await expect(pill).toHaveText(/1 review running/i);

    // 3. Walking away to the queue does not make it disappear: the row shows the live status
    //    where its meta line would be, and still links back to the PR.
    await page.locator(".side").getByRole("link", { name: "Queue" }).click();
    await expect(page.getByRole("heading", { name: /review queue/i })).toBeVisible();
    const row = page.locator(".row", { hasText: `#${PR4}` });
    await expect(row).toBeVisible();
    await expect(row.getByTestId("row-running")).toContainText(/reviewing the diff/i);
    await expect(row.locator(".rundot")).toBeVisible();
    await expect(row.locator(".status")).toHaveText("Reviewing");
    await expect(pill).toBeVisible();

    // 4. Back to the PR page — the progress panel is there again, still polling.
    await row.locator(".rowlink").click();
    await expect(page).toHaveURL(new RegExp(`pr=${PR4}`));
    await expect(page.getByTestId("progress-panel")).toBeVisible();
    await expect(page.getByTestId("progress-panel")).toContainText(/reviewing the diff/i);
  });

  test("the sidebar pill jumps straight to the running review", async ({ page }) => {
    await page.goto("/");
    const pill = page.getByTestId("running-pill");
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(page).toHaveURL(new RegExp(`pr=${PR4}`));
    await expect(page.getByTestId("progress-panel")).toBeVisible();
  });

  test("a finished PR keeps its ordinary meta line", async ({ page }) => {
    await page.goto("/?tab=reviewed");
    const row = page.locator(".row", { hasText: `#${PR}` });
    await expect(row).toBeVisible();
    await expect(row.getByTestId("row-running")).toHaveCount(0);
    await expect(row.locator(".rowsub")).toBeVisible();
  });
});

test.describe("the stacked-review action", () => {
  test("is offered, with the stack size, on a stacked PR", async ({ page }) => {
    await page.goto(prUrl(REPO, PR));
    await page.getByTestId("pr-actions").click();
    const link = page.getByRole("link", { name: /stacked review/i });
    await expect(link).toBeVisible();
    await expect(link).toHaveText(/stacked review \(2 PRs\)/i);
    await link.click();
    await expect(page.getByRole("heading", { name: /stacked review/i })).toBeVisible();
  });

  test("is absent on a PR that is not in a stack", async ({ page }) => {
    await page.goto(prUrl(REPO2, PR3));
    await page.getByTestId("pr-actions").click();
    // The rest of the Actions menu is there — only the stack row is gone.
    const menu = page.getByTestId("pr-actions-menu");
    await expect(menu.getByRole("link", { name: /qa guide/i })).toBeVisible();
    await expect(menu.getByRole("link", { name: /stacked review/i })).toHaveCount(0);
  });
});
