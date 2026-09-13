import { expect, test } from "@playwright/test";
import { PR, PR2, PR3, REPO, REPO2 } from "./fixture";

const enc = (r: string) => encodeURIComponent(r);

// Unauthenticated: the SPA shell mounts and shows the login screen (no session cookie).
test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("shows the login screen", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /sign in|connect|log in/i }).first()).toBeVisible();
    await expect(page.locator("input")).toBeVisible();
  });
});

// Authenticated via the injected session cookie (see global-setup / fixture).
test.describe("signed in", () => {
  test("queue lists the fixture PR (in its Reviewed tab)", async ({ page }) => {
    await page.goto("/?tab=reviewed");
    await expect(page.getByRole("heading", { name: /review queue/i })).toBeVisible();
    await expect(page.getByText(`#${PR}`)).toBeVisible();
    await expect(page.getByText(/lead-time badge/i)).toBeVisible();
    // Legacy /prbot URLs must still resolve (old bookmarks + signed Slack links).
    await page.goto("/prbot/?tab=reviewed");
    await expect(page.getByText(`#${PR}`)).toBeVisible();
  });

  test("archive button works: moves a PR to Archived and restores it", async ({ page }) => {
    const rowFor = (num: string) => page.locator(".row", { hasText: `#${num}` });
    await page.goto("/?tab=reviewed");
    await expect(rowFor(PR2)).toBeVisible();

    // Archive it — the row leaves the Reviewed tab.
    await rowFor(PR2).getByRole("button", { name: new RegExp(`archive #${PR2}`, "i") }).click();
    await expect(rowFor(PR2)).toHaveCount(0);

    // It now shows under Archived with a Restore action.
    await page.goto("/?tab=archived");
    await expect(rowFor(PR2)).toBeVisible();
    await rowFor(PR2).getByRole("button", { name: new RegExp(`restore #${PR2}`, "i") }).click();
    await expect(rowFor(PR2)).toHaveCount(0);
  });

  test("queue rows carry a repo chip and the repo filter narrows the list", async ({ page }) => {
    await page.goto("/?tab=reviewed");
    const rowFor = (num: string) => page.locator(".row", { hasText: `#${num}` });
    await expect(rowFor(PR).locator(".repochip")).toHaveText(REPO);
    await expect(rowFor(PR3).locator(".repochip")).toHaveText(REPO2);
    // Filter to the second repo: only its PR remains …
    await page.locator("#repofilter").selectOption(REPO2);
    await expect(rowFor(PR3)).toBeVisible();
    await expect(rowFor(PR)).toHaveCount(0);
    // … and the choice survives a reload (localStorage).
    await page.reload();
    await expect(page.locator("#repofilter")).toHaveValue(REPO2);
    await expect(rowFor(PR)).toHaveCount(0);
    await page.locator("#repofilter").selectOption("");
    await expect(rowFor(PR)).toBeVisible();
    // The search box matches the repo name too.
    await page.locator("#qsearch").fill("acme/api");
    await expect(rowFor(PR3)).toBeVisible();
    await expect(rowFor(PR)).toHaveCount(0);
  });

  test("pasting a bare number with several repos shows a repo picker", async ({ page }) => {
    await page.goto("/");
    await page.locator(".reviewany input").fill(PR3);
    const pick = page.getByTestId("repo-pick");
    await expect(pick).toBeVisible();
    await pick.locator("select").selectOption(REPO2);
    await page.locator(".reviewany button[type=submit]").click();
    await expect(page).toHaveURL(new RegExp(`/pr\\?repo=${enc(REPO2)}&pr=${PR3}`));
    await expect(page.locator("h1.prtitle")).toContainText(`${REPO2}#${PR3}`);
  });

  test("pasting a GitHub URL derives the repo — no picker", async ({ page }) => {
    await page.goto("/");
    await page.locator(".reviewany input").fill(`https://github.com/${REPO2}/pull/${PR3}`);
    await expect(page.getByTestId("repo-pick")).toHaveCount(0);
    await page.locator(".reviewany button[type=submit]").click();
    await expect(page).toHaveURL(new RegExp(`/pr\\?repo=${enc(REPO2)}&pr=${PR3}`));
  });

  test("opens the PR detail with its drafted findings", async ({ page }) => {
    await page.goto(`/pr?repo=${enc(REPO)}&pr=${PR}`);
    await expect(page.locator("h1.prtitle")).toContainText(`${REPO}#${PR}`);
    await expect(page.locator("h1.prtitle")).toContainText(/lead-time badge/i);
    // Breadcrumbs include the repo.
    await expect(page.locator("nav.bc")).toContainText(REPO);
    await expect(page.getByText(/can crash the lead-time badge/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /explain simply/i }).first()).toBeVisible();
    await expect(page.getByText(/the badge logic is sound/i)).toBeVisible();
  });

  test("a legacy /pr?pr=N link resolves when the number is unique across repos", async ({ page }) => {
    await page.goto(`/pr?pr=${PR3}`);
    await expect(page.locator("h1.prtitle")).toContainText(`${REPO2}#${PR3}`);
  });

  test("insights has a repo breakdown and a repo filter", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByText(/by repository/i)).toBeVisible();
    const pills = page.getByTestId("repo-pills");
    await expect(pills).toBeVisible();
    await pills.getByRole("button", { name: REPO2 }).click();
    await expect(pills.getByRole("button", { name: REPO2 })).toHaveClass(/on/);
  });

  test("skills page offers a team default per repository", async ({ page }) => {
    await page.goto("/skills");
    await expect(page.getByTestId("repo-skill")).toHaveCount(2);
    await expect(page.getByTestId("repo-skill").first()).toContainText(REPO);
  });

  test("insights dashboard renders from the rollup api", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /^insights$/i })).toBeVisible();
    await expect(page.getByText(/review activity/i)).toBeVisible();
    await expect(page.getByText(/agreement across reviewers/i)).toBeVisible();
  });

  test("skills page renders", async ({ page }) => {
    await page.goto("/skills");
    await expect(page.getByRole("heading", { name: /review skills/i })).toBeVisible();
  });

  test("integrations page renders the connect cards", async ({ page }) => {
    await page.goto("/integrations");
    await expect(page.getByRole("heading", { name: /integrations/i })).toBeVisible();
    await expect(page.getByText(/connected as/i)).toBeVisible(); // GitHub card
    await expect(page.getByText(/pings you when a review is requested/i)).toBeVisible(); // Slack
    await expect(page.getByText(/required to review/i)).toBeVisible(); // Claude
  });

  test("integrations page shows the Discord and generic webhook cards", async ({ page }) => {
    await page.goto("/integrations");
    await expect(page.getByText(/mentions you in the discord card/i)).toBeVisible();
    await expect(page.getByPlaceholder("123456789012345678")).toHaveValue("4242");
    await page.getByRole("button", { name: /show payload schema/i }).click();
    await expect(page.getByText(/X-ReviewStage-Signature/)).toBeVisible();
    await expect(page.locator("pre.schema")).toContainText("review_requested");
  });

  test("settings page renders for the fixture admin and the interval round-trips", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: /^settings$/i })).toBeVisible();
    await expect(page.getByText(/^poller$/i)).toBeVisible();
    await expect(page.getByText(/^notifications$/i)).toBeVisible();
    await expect(page.getByText(/^pr filters$/i)).toBeVisible();
    // The fixture user is REVIEWER, hence admin: the save button exists (non-admins get read-only).
    const save = page.getByRole("button", { name: /save settings/i });
    await expect(save).toBeVisible();
    await expect(save).toBeDisabled(); // nothing dirty yet

    const minutes = page.getByLabel("Poll interval (minutes)");
    await minutes.fill("7");
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.locator(".banner.ok")).toContainText(/saved/i);

    // Round-trip: a fresh load shows 7 minutes and marks the value as coming from Settings.
    await page.reload();
    await expect(page.getByLabel("Poll interval (minutes)")).toHaveValue("7");
    await expect(page.getByText(/every 7 minutes/i)).toBeVisible();

    // Put it back so the fixture stays deterministic for the other tests.
    await page.getByLabel("Poll interval (minutes)").fill("3");
    await page.getByRole("button", { name: /save settings/i }).click();
    await expect(page.locator(".banner.ok")).toBeVisible();
  });

  test("learnings page renders", async ({ page }) => {
    await page.goto("/learnings");
    await expect(page.getByRole("heading", { name: /has learned/i })).toBeVisible();
  });

  test("how-it-works page renders the flow", async ({ page }) => {
    await page.goto("/how");
    await expect(page.getByRole("heading", { name: /how reviewstage works/i })).toBeVisible();
    await expect(page.getByText(/a review is requested/i)).toBeVisible();
  });

  test("QA index renders", async ({ page }) => {
    await page.goto("/qa");
    await expect(page.getByRole("heading", { name: /qa guides/i })).toBeVisible();
  });

  test("sidebar navigates between pages", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /integrations/i }).click();
    await expect(page).toHaveURL(/\/integrations/);
    await expect(page.getByRole("heading", { name: /integrations/i })).toBeVisible();
  });

  test("command palette (\u2318K) reviews a PR by number", async ({ page }) => {
    await page.goto("/");
    // Wait for the app to mount before the global ⌘K listener exists (else the keypress is lost
    // on a cold start and the palette never opens).
    await expect(page.getByRole("heading", { name: /review queue/i })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.locator(".cmdk")).toBeVisible();
    // A bare number with two repos configured lists one row per repo (the picker).
    await page.locator(".cmdk-in").fill(PR);
    await expect(page.getByText(`Review PR #${PR} in ${REPO}`)).toBeVisible();
    await expect(page.getByText(`Review PR #${PR} in ${REPO2}`)).toBeVisible();
    await page.locator(".cmdk-in").press("Enter");
    await expect(page).toHaveURL(new RegExp(`/pr\\?repo=${enc(REPO)}&pr=${PR}`));
    // A GitHub URL needs no picker.
    await page.keyboard.press("ControlOrMeta+k");
    await page.locator(".cmdk-in").fill(`https://github.com/${REPO2}/pull/${PR3}`);
    await expect(page.getByText(`Review PR #${PR3}`)).toBeVisible();
    await expect(page.getByText(`in ${REPO2}`)).toBeVisible();
  });

  test("the Review a PR button opens the palette", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /review a pr/i }).click();
    await expect(page.locator(".cmdk")).toBeVisible();
  });

  test("How it works is under Help, not the primary nav", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("nav.nav").getByText(/how it works/i)).toHaveCount(0);
    await page.getByRole("button", { name: /help/i }).click();
    await page.getByRole("link", { name: /how it works/i }).click();
    await expect(page).toHaveURL(/\/how/);
    await expect(page.getByRole("heading", { name: /how reviewstage works/i })).toBeVisible();
  });
});
