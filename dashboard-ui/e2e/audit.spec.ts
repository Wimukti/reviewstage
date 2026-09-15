// The six-part audit's UI findings, each pinned by the failure it describes rather than by the
// code that fixes it: a rejected write has to become words, Enter must not post, the first-ever
// QA click has to keep polling, a QA checkbox has to be tickable, and a brand-new install must
// not be congratulated for being caught up.
import { expect, test, type Page } from "@playwright/test";
import { PR, PR3, PR4, QA_MD, REPO, REPO2, patchMe } from "./fixture";

const enc = (r: string) => encodeURIComponent(r);
const prUrl = (repo: string, num: string) => `/pr?repo=${enc(repo)}&pr=${num}`;

test.describe("a rejected write says so", () => {
  test("a failing POST shows a banner and re-enables the Post button", async ({ page }) => {
    let posts = 0;
    await page.route("**/api/post", async (route) => {
      posts++;
      await route.fulfill({
        status: 502,
        json: { error: "GitHub is unavailable right now — nothing was posted." },
      });
    });

    await page.goto(prUrl(REPO, PR));
    const post = page.getByRole("button", { name: /post selected/i });
    await expect(post).toBeEnabled();
    await post.click();

    // The server's own words, not a spinner that never stops.
    const banner = page.getByTestId("action-error");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/github is unavailable right now/i);
    await expect(post).toBeEnabled();
    await expect(post).toHaveText(/post selected/i);
    // A 502 is not an expired token, so it must not be retried behind the reviewer's back.
    expect(posts).toBe(1);
  });

  test("an expired token is retried once against a freshly minted one", async ({ page }) => {
    const sent: string[] = [];
    await page.route("**/api/post", async (route) => {
      const body = JSON.parse(route.request().postData() || "{}");
      sent.push(String(body.exp));
      if (sent.length === 1) {
        return route.fulfill({
          status: 403,
          json: { error: "This link has expired — reload the page for a fresh one." },
        });
      }
      await route.fulfill({ json: { bannerHtml: "<div class='banner ok'>Posted.</div>" } });
    });

    await page.goto(prUrl(REPO, PR));
    await page.getByRole("button", { name: /post selected/i }).click();

    await expect(page.getByText("Posted.", { exact: true })).toBeVisible();
    expect(sent).toHaveLength(2);
    // The retry used a token the page went back for, not the one that had just been refused.
    expect(sent[1]).not.toBe("");
    await expect(page.getByTestId("action-error")).toHaveCount(0);
  });

  test("a failing QA generate shows a banner and re-enables the button", async ({ page }) => {
    await patchMe(page, { claude_connected: true });
    await stubQa(page, [{ state: "none" }]);
    await page.route("**/api/qa/gen", (route) =>
      route.fulfill({ status: 500, json: { error: "The job could not be started." } }),
    );

    await page.goto(`/qa?repo=${enc(REPO2)}&pr=${PR3}`);
    const gen = page.getByTestId("qa-generate");
    await gen.click();
    await expect(page.getByTestId("qa-error")).toContainText(/could not be started/i);
    await expect(gen).toBeEnabled();
  });
});

test.describe("Enter never writes to GitHub", () => {
  test("Enter on a finding checkbox does not post the review", async ({ page }) => {
    let posts = 0;
    await page.route("**/api/post", async (route) => {
      posts++;
      await route.fulfill({ json: { bannerHtml: "" } });
    });

    await page.goto(prUrl(REPO, PR));
    const box = page.locator(".finding input.fsel").first();
    await box.focus();
    await page.keyboard.press("Enter");
    // The "Request changes instead" toggle sits in the same panel and is just as reachable.
    await page.locator(".rqtoggle input").focus();
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("post-panel")).toBeVisible();
    await page.waitForTimeout(500);
    expect(posts).toBe(0);
    await expect(page.getByTestId("action-error")).toHaveCount(0);
  });

  // PR3 has a blocker, so its approve panel carries the "approve anyway" acknowledgement — a
  // checkbox, the control Enter used to submit the whole form from.
  test("Enter on the approve-anyway checkbox does not approve the PR", async ({ page }) => {
    let approvals = 0;
    await page.route("**/api/approve", async (route) => {
      approvals++;
      await route.fulfill({ json: { bannerHtml: "" } });
    });

    await page.goto(prUrl(REPO2, PR3));
    const panel = page.getByTestId("approve-panel");
    await expect(panel).toBeVisible();
    const ack = panel.locator("input[type=checkbox]");
    const approve = panel.getByRole("button", { name: /approve/i });

    // The gate `required` used to enforce is now on the button itself.
    await expect(approve).toBeDisabled();
    await ack.focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    expect(approvals).toBe(0);

    // Ticking it enables the button — and still takes a click, not a keystroke.
    await ack.check();
    await expect(approve).toBeEnabled();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    expect(approvals).toBe(0);
  });
});

// The QA detail view, driven entirely off stubbed /api/qa answers: the fixture has no Claude
// token, and the point under test is what the client does while the server says "none".
async function stubQa(page: Page, sequence: Record<string, unknown>[]) {
  let i = 0;
  await page.route("**/api/qa?*", async (route) => {
    const step = sequence[Math.min(i, sequence.length - 1)];
    i++;
    await route.fulfill({
      json: {
        repo: REPO2,
        pr: PR3,
        title: "Rate-limit the lead-time endpoint",
        ghUrl: `https://github.com/${REPO2}/pull/${PR3}`,
        state: "none",
        connected: true,
        genToken: { exp: "9999999999", sig: "stub" },
        stopToken: { exp: "9999999999", sig: "stub" },
        ...step,
      },
    });
  });
}

test.describe("the first QA guide", () => {
  test("keeps polling through the spawn window instead of saying 'No guide yet'", async ({
    page,
  }) => {
    await patchMe(page, { claude_connected: true });
    // What the server really does: "none" for the seconds the job takes to spawn, and only then
    // "running". Arming the timer on "running" alone meant this page never moved again.
    await stubQa(page, [
      { state: "none" },
      { state: "none" },
      { state: "running", running: { phases: ["Reading the diff", "Writing the cases"], cur: 0, queued: false } },
      { state: "done", md: QA_MD },
    ]);
    await page.route("**/api/qa/gen", (route) => route.fulfill({ json: { ok: true, started: true } }));

    await page.goto(`/qa?repo=${enc(REPO2)}&pr=${PR3}`);
    await expect(page.getByRole("heading", { name: /no guide yet/i })).toBeVisible();
    await page.getByTestId("qa-generate").click();

    // Immediately: an optimistic starting state, not "No guide yet".
    await expect(page.getByTestId("qa-starting")).toBeVisible();
    await expect(page.getByRole("heading", { name: /no guide yet/i })).toHaveCount(0);

    // And it keeps going on its own — no reload, no second click.
    await expect(page.locator("ul.prog")).toContainText(/reading the diff/i, { timeout: 15_000 });
    await expect(page.locator(".qaguide")).toBeVisible({ timeout: 15_000 });
  });

  test("a gen that started nothing is reported, not swallowed", async ({ page }) => {
    await patchMe(page, { claude_connected: true });
    await stubQa(page, [{ state: "none" }]);
    await page.route("**/api/qa/gen", (route) =>
      route.fulfill({ json: { ok: true, started: false, reason: "A job for this PR is already running" } }),
    );

    await page.goto(`/qa?repo=${enc(REPO2)}&pr=${PR3}`);
    await page.getByTestId("qa-generate").click();
    await expect(page.getByTestId("qa-error")).toContainText(/already running/i);
    await expect(page.getByTestId("qa-starting")).toHaveCount(0);
  });
});

test.describe("the QA guide is usable", () => {
  test("a task checkbox renders once and can be ticked", async ({ page }) => {
    await stubQa(page, [{ state: "done", md: QA_MD, connected: false }]);
    await page.goto(`/qa?repo=${enc(REPO2)}&pr=${PR3}`);

    const items = page.locator(".qaguide li.task-list-item");
    await expect(items).toHaveCount(2);
    // One box per item — the old CSS drew a second, decorative one.
    await expect(page.locator(".qaguide input[type=checkbox]")).toHaveCount(2);

    const first = items.first().locator("input[type=checkbox]");
    await expect(first).toBeEnabled();
    await expect(first).not.toBeChecked();
    await first.check();
    await expect(first).toBeChecked();
    // The pre-ticked one from the markdown starts checked and can be cleared again.
    const second = items.nth(1).locator("input[type=checkbox]");
    await expect(second).toBeChecked();
    await second.uncheck();
    await expect(second).not.toBeChecked();
  });

  test("a guide can be taken out of the page even with no clipboard", async ({ page }) => {
    await stubQa(page, [{ state: "done", md: QA_MD, connected: false }]);
    await page.goto(`/qa?repo=${enc(REPO2)}&pr=${PR3}`);
    const dl = page.getByTestId("qa-download");
    await expect(dl).toBeVisible();
    const download = page.waitForEvent("download");
    await dl.click();
    expect((await download).suggestedFilename()).toBe(`qa-acme-api-${PR3}.md`);
  });
});

test.describe("a brand-new install", () => {
  test("is told what to set up, not that it is all caught up", async ({ page }) => {
    await patchMe(page, { claude_connected: false, poller_ran: false });
    await page.route("**/api/queue*", async (route) => {
      const r = await route.fetch();
      await route.fulfill({ response: r, json: { ...(await r.json()), rows: [] } });
    });

    await page.goto("/?tab=todo");
    const setup = page.getByTestId("setup-needed");
    await expect(setup).toBeVisible();
    await expect(setup).toContainText(/finish setting/i);
    await expect(setup).toContainText(/connect your claude account/i);
    await expect(setup).toContainText(/let the poller run once/i);
    await expect(setup.getByRole("link", { name: /integrations/i })).toBeVisible();
    await expect(page.getByText(/you're all caught up/i)).toHaveCount(0);
  });

  test("a configured install with an empty queue is still congratulated", async ({ page }) => {
    await patchMe(page, { claude_connected: true, poller_ran: true });
    await page.route("**/api/queue*", async (route) => {
      const r = await route.fetch();
      await route.fulfill({ response: r, json: { ...(await r.json()), rows: [] } });
    });

    await page.goto("/?tab=todo");
    await expect(page.getByText(/you're all caught up/i)).toBeVisible();
    await expect(page.getByTestId("setup-needed")).toHaveCount(0);
  });
});

test.describe("the running view and the counts", () => {
  test("?running=1 lists the jobs themselves, QA guides included", async ({ page }) => {
    // Two jobs in flight, one of them a QA guide on a PR no queue tab would carry.
    await patchMe(page, {
      running: [
        {
          kind: "review",
          repo: REPO,
          num: PR4,
          title: "Retry the vendor sync on a 502",
          status: "reviewing the diff",
          href: prUrl(REPO, PR4),
        },
        {
          kind: "qa",
          repo: REPO2,
          num: PR3,
          title: "Rate-limit the lead-time endpoint",
          status: "reading the diff",
          href: `/qa?repo=${enc(REPO2)}&pr=${PR3}`,
        },
      ],
    });

    await page.goto("/?running=1");
    const list = page.getByTestId("running-list");
    await expect(list.locator(".row")).toHaveCount(2);
    await expect(list).toContainText(/reviewing the diff/i);
    await expect(list).toContainText(/reading the diff/i);
    await expect(list).toContainText("QA guide");
    await expect(page.getByText(/nothing running/i)).toHaveCount(0);
  });

  test("filtering recomputes the open tab's count instead of leaving 41 over 2 rows", async ({
    page,
  }) => {
    await page.goto("/?tab=reviewed");
    const openTab = page.locator(".tab.on .cnt");
    const before = Number((await openTab.textContent())?.replace(/\D/g, "") || "0");
    const rows = page.locator("#qlist .row");
    const rowsBefore = await rows.count();
    expect(before).toBe(rowsBefore);

    await page.locator("#qsearch").fill("rate-limit");
    await expect(rows).toHaveCount(1);
    await expect(openTab).toHaveText("1");
    // The tiles and the other tabs say out loud that they still count everything.
    await expect(page.getByTestId("filter-note")).toBeVisible();
  });
});
