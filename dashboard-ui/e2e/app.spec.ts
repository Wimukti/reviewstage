import { expect, test } from "@playwright/test";
import { PR, PR2, PR3, REPO, REPO2, TOUR_KEY, sessionCookie } from "./fixture";

const enc = (r: string) => encodeURIComponent(r);

// Unauthenticated: the SPA shell mounts and shows the login screen (no session cookie).
test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("shows the login screen", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /sign in|connect|log in/i }).first()).toBeVisible();
    await expect(page.locator("input")).toBeVisible();
  });

  test("the token form recommends a fine-grained PAT and still accepts a classic one", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByPlaceholder(/github_pat_… or ghp_…/)).toBeVisible();
    await expect(page.getByRole("link", { name: /create a fine-grained token/i })).toHaveAttribute(
      "href",
      "https://github.com/settings/personal-access-tokens/new",
    );
    await expect(page.getByText(/pull requests: read and write/i)).toBeVisible();
    await expect(page.getByText(/classic token/i)).toBeVisible();
    // Nothing typed yet: the button waits.
    await expect(page.getByRole("button", { name: /sign in with token/i })).toBeDisabled();
  });
});

// First sign-in: the guided tour must open on the Queue page once the queue has rendered —
// the queue mounts after its fetch, so a mount-time check would miss it. Fresh localStorage.
test.describe("first run", () => {
  test.use({ storageState: { cookies: [sessionCookie()], origins: [] } });

  test("the tour opens on the first Queue load and stays away once dismissed", async ({ page }) => {
    await page.goto("/");
    const tour = page.getByTestId("tour");
    await expect(tour).toBeVisible({ timeout: 8_000 });
    await expect(tour).toContainText(/welcome to reviewstage/i);
    // Walk to the queue step: it targets the queue card even with an empty To-do list.
    await tour.getByRole("button", { name: "Next" }).click();
    await tour.getByRole("button", { name: "Next" }).click();
    await tour.getByRole("button", { name: "Next" }).click();
    await expect(tour).toContainText(/your review queue/i);
    await tour.getByRole("button", { name: "Skip" }).click();
    await expect(tour).toHaveCount(0);
    expect(await page.evaluate((k) => localStorage.getItem(k), TOUR_KEY)).toBe("done");
    // Dismissed: a reload does not bring it back.
    await page.reload();
    await expect(page.getByRole("heading", { name: /review queue/i })).toBeVisible();
    await page.waitForTimeout(1200);
    await expect(tour).toHaveCount(0);
  });

  test("Take a tour reopens it on demand", async ({ page }) => {
    await page.goto("/");
    const tour = page.getByTestId("tour");
    await expect(tour).toBeVisible({ timeout: 8_000 });
    await tour.getByRole("button", { name: "Skip" }).click();
    await expect(tour).toHaveCount(0);
    await page.getByRole("button", { name: /help/i }).click();
    await page.getByRole("button", { name: /take a tour/i }).click();
    await expect(tour).toBeVisible();
  });
});

// Authenticated via the injected session cookie (see global-setup / fixture).
test.describe("signed in", () => {
  test("queue lists the fixture PR (in its Reviewed tab)", async ({ page }) => {
    await page.goto("/?tab=reviewed");
    await expect(page.getByRole("heading", { name: /review queue/i })).toBeVisible();
    await expect(page.getByText(`#${PR}`)).toBeVisible();
    await expect(page.getByText(/lead-time badge/i)).toBeVisible();
    // The default storage state has the tour dismissed: it must not cover the page.
    await page.waitForTimeout(800);
    await expect(page.getByTestId("tour")).toHaveCount(0);
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

  test("skills page shows a repository profile per repo with status and counts", async ({ page }) => {
    await page.goto("/skills");
    const profiles = page.getByTestId("repo-profile");
    await expect(profiles).toHaveCount(2);
    const first = profiles.filter({ hasText: REPO }).first();
    await first.locator("summary").click();
    await expect(first).toContainText(/profiled/i);
    await expect(first.getByTestId("profile-status")).toContainText(/last run/i);
    await expect(first.getByTestId("profile-status")).toContainText(/claude-sonnet-4-5/);
    await expect(first.getByTestId("profile-counts")).toContainText(/2 critical paths/);
    await expect(first.getByTestId("profile-counts")).toContainText(/2 risk paths/);
    await expect(first).toContainText(/app\/billing/); // dropped glob is surfaced
    const second = profiles.filter({ hasText: REPO2 }).first();
    await second.locator("summary").click();
    await expect(second.getByTestId("profile-status")).toContainText(/never run/i);
  });

  test("repository profile editor round-trips an edit", async ({ page }) => {
    await page.goto("/skills");
    const card = page.getByTestId("repo-profile").filter({ hasText: REPO }).first();
    await card.locator("summary").click();
    await card.getByRole("button", { name: "Edit" }).click();
    const box = card.locator("textarea.fedit");
    const before = await box.inputValue();
    expect(before).toContain("app/payments/**");
    const marker = `Refunds must be idempotent e2e-${Date.now()}`;
    await box.fill(before.replace("## Review rules\n\n", `## Review rules\n\n- ${marker}\n`));
    await card.getByRole("button", { name: "Save profile" }).click();
    await expect(page.locator(".banner.ok")).toContainText(/saved the profile/i);
    await expect(card.getByTestId("profile-counts")).toContainText(/2 review rules/);
    await page.reload();
    const again = page.getByTestId("repo-profile").filter({ hasText: REPO }).first();
    await again.locator("summary").click();
    await again.getByRole("button", { name: "Edit" }).click();
    await expect(again.locator("textarea.fedit")).toHaveValue(new RegExp(marker));
    await expect(again).toContainText(/edited by/i);
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

  test("settings shows the Webhooks card as polling-only for the fixture", async ({ page }) => {
    // The fixture .env has no GITHUB_WEBHOOK_SECRET and no webhooks.json, so the card must show
    // the payload URL GitHub needs, an unset secret, and the amber "polling only" light.
    await page.goto("/settings");
    const card = page.getByTestId("webhooks-card");
    await expect(card.getByRole("heading", { name: /^webhooks$/i })).toBeVisible();
    await expect(page.getByTestId("webhooks-status")).toHaveText(/polling only/i);
    await expect(card.getByText("https://reviewstage.example.com/webhooks/github").first()).toBeVisible();
    await expect(card.getByText(/GITHUB_WEBHOOK_SECRET/).first()).toBeVisible();
    await expect(card.getByText(/0 events received/)).toBeVisible();
    await expect(card.locator("pre.schema")).toContainText("Pull requests, Pull request reviews");
    await expect(card.getByRole("button", { name: /copy instructions/i })).toBeVisible();
    // The "lower the poll interval" hint only appears once webhooks are active.
    await expect(card.getByText(/turn polling off/i)).toHaveCount(0);
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
