// Teaching the reviewing skill from one finding card. The server side is covered by
// bin/test_rs_teach.py; this is about what the reviewer sees and cannot do by accident.
//
// The fixture reviewer has no Claude account connected, which is the real default and the first
// state worth proving. For the drafting flow the PR payload is patched to say connected and
// /api/teach is answered by the test, so the states are exercised without spending a real quota
// or reaching a real model.
import { expect, test } from "@playwright/test";
import { ORIGIN, PR, REPO } from "./fixture";

const prPath = `/pr?repo=${encodeURIComponent(REPO)}&pr=${PR}`;

/** Make the page believe the viewer has connected a Claude account. */
async function asConnected(page: import("@playwright/test").Page) {
  await page.route(`${ORIGIN}/api/pr?**`, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    if (body.review?.teach) body.review.teach.connected = true;
    if (body.teach) body.teach.connected = true;
    await route.fulfill({ response: res, json: body });
  });
}

/** Answer /api/teach with whatever this test wants, and record what was asked. */
async function stubTeach(
  page: import("@playwright/test").Page,
  reply: (req: Record<string, unknown>) => { status?: number; json: Record<string, unknown> },
) {
  const seen: Record<string, unknown>[] = [];
  await page.route(`${ORIGIN}/api/teach`, async (route) => {
    const req = route.request().postDataJSON() as Record<string, unknown>;
    seen.push(req);
    const r = reply(req);
    await route.fulfill({ status: r.status ?? 200, json: r.json });
  });
  return seen;
}

const card = (page: import("@playwright/test").Page) => page.locator(".finding").first();

test.describe("teaching the skill from a finding", () => {
  test("the card offers it, and says where the rule would go", async ({ page }) => {
    await asConnected(page);
    await page.goto(prPath);
    const open = card(page).getByTestId("teach-open");
    await expect(open).toHaveText("Teach the skill");
    await expect(open).toHaveAttribute("aria-expanded", "false");
    await open.click();
    await expect(open).toHaveAttribute("aria-expanded", "true");
    await expect(card(page).getByTestId("teach")).toBeVisible();
    await expect(card(page).getByTestId("teach-avoid")).toBeVisible();
    await expect(card(page).getByTestId("teach-always")).toBeVisible();
  });

  test("with no Claude account it explains rather than offering a dead button", async ({ page }) => {
    await page.goto(prPath);
    await card(page).getByTestId("teach-open").click();
    await expect(card(page).getByTestId("teach-noclaude")).toContainText("your own Claude account");
    await expect(card(page).getByTestId("teach-avoid")).toHaveCount(0);
  });

  test("choosing a direction drafts, and the direction reaches the server", async ({ page }) => {
    await asConnected(page);
    const seen = await stubTeach(page, () => ({
      json: { rule: "Skip style-only nits about let versus const.", rationale: "Pure noise.",
              target: "global", targetLabel: "the team default skill" },
    }));
    await page.goto(prPath);
    await card(page).getByTestId("teach-open").click();
    await card(page).getByTestId("teach-always").click();
    const box = card(page).locator(".teach-in");
    await expect(box).toHaveValue("Skip style-only nits about let versus const.");
    expect(seen).toHaveLength(1);
    expect(seen[0].direction).toBe("always");
    expect(seen[0].action).toBe("draft");
    // The panel names the exact skill before anything is written.
    await expect(card(page).locator(".teach-l")).toContainText("the team default skill");
  });

  test("a draft is not a write: nothing is added until the button is pressed", async ({ page }) => {
    await asConnected(page);
    const seen = await stubTeach(page, () => ({
      json: { rule: "Skip style-only nits.", target: "global",
              targetLabel: "the team default skill" },
    }));
    await page.goto(prPath);
    await card(page).getByTestId("teach-open").click();
    await card(page).getByTestId("teach-avoid").click();
    await expect(card(page).locator(".teach-in")).toBeVisible();
    expect(seen.every((r) => r.action === "draft")).toBe(true);
    await expect(card(page).getByTestId("teach-added")).toHaveCount(0);
  });

  test("the reviewer's edit is what gets sent, not the draft", async ({ page }) => {
    await asConnected(page);
    const seen = await stubTeach(page, (req) =>
      req.action === "draft"
        ? { json: { rule: "Machine wording.", target: "global",
                    targetLabel: "the team default skill" } }
        : { json: { added: true, rule: "My wording.", target: "global",
                    targetLabel: "the team default skill" } },
    );
    await page.goto(prPath);
    await card(page).getByTestId("teach-open").click();
    await card(page).getByTestId("teach-avoid").click();
    await card(page).locator(".teach-in").fill("My wording.");
    await card(page).getByTestId("teach-add").click();
    await expect(card(page).getByTestId("teach-added")).toContainText("the team default skill");
    const add = seen.find((r) => r.action === "add")!;
    expect(add.rule).toBe("My wording.");
  });

  test("once taught, the card says so and will not offer it again", async ({ page }) => {
    await asConnected(page);
    await stubTeach(page, (req) =>
      req.action === "draft"
        ? { json: { rule: "A rule.", target: "global", targetLabel: "the team default skill" } }
        : { json: { added: true, rule: "A rule.", target: "global",
                    targetLabel: "the team default skill" } },
    );
    await page.goto(prPath);
    await card(page).getByTestId("teach-open").click();
    await card(page).getByTestId("teach-avoid").click();
    await card(page).getByTestId("teach-add").click();
    await expect(card(page).getByTestId("teach-added")).toBeVisible();
    await expect(card(page).getByTestId("teach-open")).toHaveText("Already a rule");
    await expect(card(page).getByTestId("teach-open")).toBeDisabled();
  });

  test("a refusal from the server is shown, not swallowed", async ({ page }) => {
    await asConnected(page);
    await stubTeach(page, (req) =>
      req.action === "draft"
        ? { json: { rule: "A rule.", target: "global", targetLabel: "the team default skill" } }
        : { status: 400, json: { error: "That skill is already very large (>40k chars)." } },
    );
    await page.goto(prPath);
    await card(page).getByTestId("teach-open").click();
    await card(page).getByTestId("teach-avoid").click();
    await card(page).getByTestId("teach-add").click();
    await expect(card(page).getByTestId("teach-err")).toContainText("already very large");
    await expect(card(page).getByTestId("teach-added")).toHaveCount(0);
  });

  test("a draft failure keeps the panel usable instead of stranding it", async ({ page }) => {
    await asConnected(page);
    await stubTeach(page, () => ({ status: 400, json: { error: "Claude did not answer in time." } }));
    await page.goto(prPath);
    await card(page).getByTestId("teach-open").click();
    await card(page).getByTestId("teach-avoid").click();
    await expect(card(page).getByTestId("teach-err")).toContainText("did not answer");
    await expect(card(page).getByTestId("teach-avoid")).toBeEnabled();
  });

  test("a finding already taught on the server is disabled from the first render", async ({ page }) => {
    await page.route(`${ORIGIN}/api/pr?**`, async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      if (body.teach) body.teach.connected = true;
      const fs = body.review?.findings;
      if (fs?.length) fs[0].taught = true;
      await route.fulfill({ response: res, json: body });
    });
    await page.goto(prPath);
    const open = card(page).getByTestId("teach-open");
    await expect(open).toHaveText("Already a rule");
    await expect(open).toBeDisabled();
  });
});
