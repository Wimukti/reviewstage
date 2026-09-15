import { expect, test } from "@playwright/test";
import { PR, PR2, PR3, REPO, REPO2, REPO3, TOUR_USER, sessionCookie } from "./fixture";

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
  // TOUR_USER's record has no tour_seen flag — "first run" is now a property of the account,
  // not of this browser's localStorage, so a second person on a shared box gets their own.
  test.use({ storageState: { cookies: [sessionCookie(TOUR_USER)], origins: [] } });

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
    // Dismissing records it on the SERVER, against this user — there is nothing in this
    // browser that remembers it any more.
    const recorded = page.waitForResponse((r) => r.url().includes("/api/tour-seen") && r.ok());
    await tour.getByRole("button", { name: "Skip" }).click();
    await expect(tour).toHaveCount(0);
    await recorded;
    await page.reload();
    await expect(page.getByRole("heading", { name: /review queue/i })).toBeVisible();
    await page.waitForTimeout(1200);
    await expect(tour).toHaveCount(0);
  });
});

test.describe("the tour on demand", () => {
  test("Take a tour reopens it for someone who has already dismissed it", async ({ page }) => {
    // The shared fixture user has seen it: nothing opens by itself, and Help is the way back.
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /review queue/i })).toBeVisible();
    const tour = page.getByTestId("tour");
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

  test("a finding outside the diff is chipped and counted into the summary", async ({ page }) => {
    await page.goto(`/pr?repo=${enc(REPO)}&pr=${PR}`);
    const cards = page.locator(".finding");
    // Product.php:42 sits inside the fixture's hunk; Badge.tsx is not in the PR at all.
    const inline = cards.filter({ hasText: "app/models/Product.php" });
    const off = cards.filter({ hasText: "src/javascripts/Badge.tsx" });
    await expect(inline.locator(".offdiff")).toHaveCount(0);
    await expect(off.locator(".offdiff")).toHaveText("in summary");
    await expect(off.locator(".offdiff")).toHaveAttribute("title", /not part of the PR's diff/);
    // Both are selected by default, so the post bar splits them.
    const bar = page.locator(".bar .inner .muted");
    await expect(bar).toContainText("2 selected");
    await expect(bar).toContainText("1 inline");
    await expect(bar).toContainText("1 in the summary");
    // Unselecting the off-diff one drops the split entirely.
    await off.locator("input.fsel").uncheck();
    await expect(bar).toContainText("1 selected");
    await expect(bar).not.toContainText("in the summary");
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
    await expect(page.getByTestId("repo-skill")).toHaveCount(3);
    await expect(page.getByTestId("repo-skill").first()).toContainText(REPO);
  });

  test("skills page shows a repository profile per repo with status and counts", async ({ page }) => {
    await page.goto("/skills");
    const profiles = page.getByTestId("repo-profile");
    await expect(profiles).toHaveCount(3);
    const first = profiles.filter({ hasText: REPO }).first();
    await first.locator("> summary").click();
    await expect(first).toContainText(/profiled/i);
    await expect(first.getByTestId("profile-status")).toContainText(/last run/i);
    await expect(first.getByTestId("profile-status")).toContainText(/claude-sonnet-4-5/);
    await expect(first.getByTestId("profile-counts")).toContainText(/2 critical paths/);
    await expect(first.getByTestId("profile-counts")).toContainText(/2 risk paths/);
    await expect(first).toContainText(/app\/billing/); // dropped glob is surfaced
    const second = profiles.filter({ hasText: REPO2 }).first();
    await second.locator("> summary").click();
    await expect(second.getByTestId("profile-status")).toContainText(/never run/i);
    await expect(second.getByTestId("profile-error")).toHaveCount(0);
  });

  test("a failed profile run shows the error, its log tail and an enabled Retry", async ({ page }) => {
    await page.goto("/skills");
    const card = page.getByTestId("repo-profile").filter({ hasText: REPO3 }).first();
    await expect(card).toContainText(/failed/i);
    await card.locator("> summary").click(); // the card's own summary, not the log tail's
    await expect(card.getByTestId("profile-status")).toContainText(/last run failed/i);
    const err = card.getByTestId("profile-error");
    await expect(err).toContainText(/failed: the model produced no result/);
    const log = card.getByTestId("profile-log");
    await expect(log.locator("summary")).toContainText(/lines of the log/i);
    await expect(log.locator("pre")).toBeHidden(); // collapsed until opened
    await log.locator("summary").click();
    await expect(log.locator("pre")).toContainText("error: unknown option '---'");
    const retry = card.getByTestId("profile-run");
    await expect(retry).toHaveText(/retry/i);
    // The fixture user has no Claude account connected, so Retry is gated on that — not on the
    // failed state. Confirm the gate is the only thing holding it.
    await expect(retry).toHaveAttribute("title", /connect your claude account/i);
    await expect(retry).not.toHaveAttribute("aria-busy", "true");
    const done = page.getByTestId("repo-profile").filter({ hasText: REPO }).first();
    await done.locator("> summary").click();
    await expect(done.getByTestId("profile-error")).toHaveCount(0);
  });

  test("a second Retry while the build is alive keeps the Profiling view (started:false is not a failure)", async ({ page }) => {
    // The live-test sequence: Retry on a failed profile, the page briefly re-shows FAILED (a
    // stale verdict from the poll), Retry again ~2 s later while the first run is queued on the
    // review lock. The server answers the second click with started:false + state "running";
    // the card must read that as "already running" and stay in Profiling — never FAILED.
    const running = {
      state: "running",
      running: { phases: ["Fetching the repository", "Gathering signals", "Asking the model", "Validating paths"], cur: 2, queued: true, text: "queued — waiting for another job to finish" },
    };
    let polls = 0;
    await page.route(`**/api/profile?repo=${enc(REPO3)}`, async (route) => {
      const r = await route.fetch();
      const body = await r.json();
      polls += 1;
      // 1st GET: the failed card with a connected account, so Retry is enabled. 2nd GET (the
      // poll after the first click): the stale "failed" verdict that re-enables Retry. After
      // that: the truth — running.
      const patch = polls <= 2 ? { connected: true } : { ...running, connected: true, failed: undefined, logTail: undefined };
      await route.fulfill({ response: r, json: { ...body, ...patch } });
    });
    const runs: string[] = [];
    await page.route("**/api/profile/run", async (route) => {
      const body = route.request().postDataJSON() as { repo: string };
      runs.push(body.repo);
      const base = { ok: true, repo: REPO3, token: { exp: "9", sig: "x" }, connected: true, isAdmin: true, autoProfile: false, counts: null, versions: [], md: "", json: null, last: null };
      const json =
        runs.length === 1
          ? { ...base, ...running, started: true }
          : { ...base, ...running, started: false, reason: "already running" };
      await route.fulfill({ status: 200, contentType: "application/json", json });
    });

    await page.goto("/skills");
    const card = page.getByTestId("repo-profile").filter({ hasText: REPO3 }).first();
    await card.locator("> summary").click();
    const retry = card.getByTestId("profile-run");
    await expect(retry).toHaveText(/retry/i);
    await expect(retry).toBeEnabled();

    await retry.click(); // 1st click → started:true, the card shows Profiling
    await expect(card.locator("> summary")).toContainText(/profiling/i);
    await expect(card.getByTestId("profile-status")).toContainText(/queued — waiting for another job/i);
    // The poll comes back with the stale failed verdict; Retry is enabled again (the live bug's
    // pre-condition — the server no longer produces this, but the UI must survive it).
    await expect(retry).toHaveText(/retry/i, { timeout: 15_000 });
    await expect(retry).toBeEnabled();

    await retry.click(); // 2nd click → started:false, state running
    await expect.poll(() => runs.length).toBe(2);
    await expect(card.locator("> summary")).toContainText(/profiling/i);
    await expect(card.locator("> summary")).not.toContainText(/failed/i);
    await expect(card.getByTestId("profile-status")).toContainText(/queued — waiting for another job/i);
    await expect(card.getByTestId("profile-error")).toHaveCount(0);
    await expect(page.locator(".banner.err")).toHaveCount(0);
    await expect(page.getByText(/already profiling this repository/i)).toBeVisible();
    await expect(retry).toHaveAttribute("aria-busy", "true");
    await expect(retry).toBeDisabled();
    // Still Profiling after the next poll — nothing flips it back to FAILED.
    await expect.poll(() => polls, { timeout: 15_000 }).toBeGreaterThanOrEqual(4);
    await expect(card.locator("> summary")).toContainText(/profiling/i);
    expect(runs).toEqual([REPO3, REPO3]);
  });

  test("repository profile editor round-trips an edit", async ({ page }) => {
    await page.goto("/skills");
    const card = page.getByTestId("repo-profile").filter({ hasText: REPO }).first();
    await card.locator("> summary").click();
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
    await again.locator("> summary").click();
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
