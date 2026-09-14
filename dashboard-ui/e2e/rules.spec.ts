import { expect, test } from "@playwright/test";

// The durable half of the learnings loop: a complaint dropped four times across three PRs is
// offered as a rule, and only a click puts it in the skill. Serial, because each action here
// changes server-side state the next one reads (a dismissal file, then the skill itself).
test.describe.configure({ mode: "serial" });

test.describe("suggested rules", () => {
  test("the Skills page offers the drafted rule with its evidence", async ({ page }) => {
    await page.goto("/skills");
    const sec = page.getByTestId("suggested-rules");
    await expect(sec).toBeVisible();
    await expect(sec.getByRole("heading", { name: /suggested rules/i })).toBeVisible();

    const s = page.getByTestId("rule-suggestion").first();
    await expect(s.getByTestId("rule-sentence")).toHaveText(
      /do not raise const-over-let style nits/i,
    );
    await expect(s).toContainText("from 4 findings you dropped across 3 PRs");
    // The evidence is real rows, each linking at its PR.
    await s.getByRole("group").getByText(/show the 4 findings behind it/i).click();
    await expect(s.getByRole("link", { name: "acme/widgets#38849" })).toHaveAttribute(
      "href",
      "https://github.com/acme/widgets/pull/38849",
    );
    await expect(s.locator("li")).toHaveCount(4);
  });

  test("Dismiss hides it and Show dismissed brings it back", async ({ page }) => {
    await page.goto("/skills");
    const s = page.getByTestId("rule-suggestion").first();
    await s.getByRole("button", { name: "Dismiss" }).click();

    // Gone from the live list, and the page says so.
    await expect(page.getByTestId("suggested-rules")).toContainText(/nothing pending/i);
    await expect(page.getByTestId("dismissed-list")).toHaveCount(0);

    await page.getByTestId("show-dismissed").click();
    const back = page.getByTestId("dismissed-list").getByTestId("rule-suggestion").first();
    await expect(back.getByTestId("rule-sentence")).toBeVisible();

    // Undo restores it to the live list, so a dismissal is never a one-way door.
    await back.getByRole("button", { name: /undo dismiss/i }).click();
    await expect(page.getByTestId("show-dismissed")).toHaveCount(0);
    await expect(page.getByTestId("rule-suggestion")).toHaveCount(1);
  });

  test("Accept appends the rule to the team default and the suggestion is gone", async ({ page }) => {
    await page.goto("/skills");
    await page
      .getByTestId("rule-suggestion")
      .first()
      .getByRole("button", { name: /^accept/i })
      .click();

    await expect(page.locator(".banner.ok")).toContainText(/from 4 dropped findings across 3 PRs/i);
    // The suggestion is spent — it is a rule now, not a proposal.
    await expect(page.getByTestId("suggested-rules")).toHaveCount(0);

    // And it really is in the skill, under the managed Team rules section.
    await page.getByRole("group").filter({ hasText: /edit the team default skill/i }).first().click();
    const box = page.locator("textarea").first();
    await expect(box).toContainText("## Team rules");
    await expect(box).toContainText("Do not raise const-over-let style nits");
  });
});
