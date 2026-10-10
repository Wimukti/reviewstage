// The phone screens (openspec/changes/mobile-app-feel M2, M3, M5): the queue's search in the
// bar, its filter sheet and chips, row swipes (archive with Undo, run a review), pull to
// refresh; the PR page's finding swipes (keep, drop) and the Post pill, the confirm sheet as the
// only way to POST /api/post, the ⋯ sheet's Approve and Re-run, the success state; and a button
// for every gesture. Touch is driven through the DevTools protocol, as in mobile-shell.spec.
//
// Every write that would change the shared fixture (archive, review, post, approve) is answered
// in the browser and recorded, so these tests can assert exactly what was sent, and how often.
import { expect, test, type Page, type Request } from "@playwright/test";
import { patchJson, PR, PR2, PR3, PR4, REPO, REPO2 } from "./fixture";

const PHONE = { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true } as const;
const enc = (r: string) => encodeURIComponent(r);
const prPath = (repo: string, num: string) => `/pr?repo=${enc(repo)}&pr=${num}`;

type Pt = { x: number; y: number };
// A one-finger pan; `release: false` leaves the finger down (a row mid-swipe).
async function pan(page: Page, from: Pt, to: Pt, release = true) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
  for (let i = 1; i <= 10; i++) {
    const x = from.x + ((to.x - from.x) * i) / 10;
    const y = from.y + ((to.y - from.y) * i) / 10;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
  }
  if (release) await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

/** Swipe an element horizontally by `dx` from a point inside it (never from the left edge). */
async function swipe(page: Page, loc: ReturnType<Page["locator"]>, dx: number) {
  await loc.scrollIntoViewIfNeeded();
  const b = (await loc.boundingBox())!;
  const y = b.y + Math.min(30, b.height / 2);
  const x = dx > 0 ? b.x + 40 : b.x + b.width - 90;
  await pan(page, { x, y }, { x: x + dx, y: y + 2 });
}

/** Records every request to `glob` and answers it with `json` (or a status). */
async function stub(page: Page, glob: string, json: unknown, status = 200) {
  const seen: Request[] = [];
  await page.route(glob, (route) => {
    seen.push(route.request());
    return route.fulfill({ status, json });
  });
  return seen;
}

const row = (page: Page, num: string) => page.getByTestId("queue-row").filter({ hasText: `#${num}` });
const DRY_BANNER = "<div class='banner warn'><span>!</span><div>Dry run — nothing was posted to GitHub.</div></div>";

async function settled(page: Page) {
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0, { timeout: 15_000 });
}

test.describe("the queue on a phone", () => {
  test.use(PHONE);

  test("search is the bar's action: it expands over the title, filters, and Escape or Cancel collapses it", async ({ page }) => {
    await page.goto("/?tab=all");
    await settled(page);
    const bar = page.getByTestId("search-bar");
    await expect(bar).toBeHidden();
    await page.getByRole("button", { name: "Search or open a PR" }).click();
    await expect(bar).toBeVisible();
    const field = page.locator("#qsearch");
    await expect(field).toBeFocused();
    // Over the navigation bar, the whole width.
    const b = (await bar.boundingBox())!;
    const nav = (await page.getByTestId("nav-bar").boundingBox())!;
    expect(b.y).toBe(0);
    expect(b.width).toBe(393);
    expect(b.height).toBeGreaterThanOrEqual(nav.height - 1);
    await field.fill("vendor");
    await expect(page.getByTestId("queue-row")).toHaveCount(2);
    await page.keyboard.press("Escape");
    await expect(bar).toBeHidden();
    await expect(page.getByTestId("queue-row")).toHaveCount(5); // the query went with it
    await page.getByRole("button", { name: "Search or open a PR" }).click();
    await field.fill(`#${PR}`);
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(bar).toBeHidden();
    // A PR reference opens on Enter.
    await page.getByRole("button", { name: "Search or open a PR" }).click();
    await field.fill(`${REPO}#${PR}`);
    await expect(page.getByTestId("open-pr")).toHaveText(`Open #${PR}`);
    await field.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/pr\\?repo=${enc(REPO)}&pr=${PR}`));
  });

  test("To review · In flight is a segmented control; anything else is a removable chip", async ({ page }) => {
    await page.goto("/");
    const views = page.getByRole("tablist", { name: "Queue views" });
    await expect(views.getByRole("tab")).toHaveText([/^To review/, /^In flight/]);
    await expect(views.getByRole("tab", { name: /^To review/ })).toHaveAttribute("aria-selected", "true");
    const tops = await views.getByRole("tab").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    await views.getByRole("tab", { name: /^In flight/ }).click();
    await expect(page).toHaveURL(/\?running=1$/);
    await expect(row(page, PR4)).toBeVisible();
    // A desk view by its address is a chip, and the chip's × goes back to To review.
    await page.goto("/?tab=reviewed");
    const chip = page.getByTestId("filter-chip").filter({ hasText: "Reviewed" });
    await expect(chip).toBeVisible();
    await chip.getByRole("button", { name: "Remove filter: Reviewed" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(views.getByRole("tab", { name: /^To review/ })).toHaveAttribute("aria-selected", "true");
  });

  test("repository and sort live in a filter sheet; a set filter dots the button and shows as a chip", async ({ page }) => {
    await page.goto("/?tab=all");
    await settled(page);
    const open = page.getByTestId("filter-open");
    await expect(page.getByTestId("filter-dot")).toHaveCount(0);
    await open.click();
    const sheet = page.getByTestId("filter-sheet");
    await expect(sheet).toBeVisible();
    await sheet.getByRole("radiogroup", { name: "Repository" }).getByRole("radio", { name: new RegExp(`^${REPO2}`) }).click();
    await sheet.getByRole("radiogroup", { name: "Sort" }).getByRole("radio", { name: "Oldest" }).click();
    await expect(sheet.getByRole("radio", { name: "Oldest" })).toHaveAttribute("aria-checked", "true");
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByTestId("filter-dot")).toBeVisible();
    await expect(open).toHaveAccessibleName("Filter and sort (on)");
    await expect(page).toHaveURL(/sort=oldest/);
    await expect(page.getByTestId("queue-row")).toHaveCount(1);
    await expect(row(page, PR3)).toBeVisible();
    await page.getByRole("button", { name: `Remove filter: ${REPO2}` }).click();
    await expect(page.getByTestId("queue-row")).toHaveCount(5);
    await expect(page.getByTestId("filter-dot")).toBeVisible(); // the sort is still set
    await page.getByRole("button", { name: "Remove filter: Oldest" }).click();
    await expect(page).not.toHaveURL(/sort=/);
    await expect(page.getByTestId("filter-dot")).toHaveCount(0);
  });

  test("rows: the title first on up to two lines, then repo #n · author, one pill, at least 72px", async ({ page }) => {
    await page.goto("/?tab=all");
    await settled(page);
    const r = row(page, PR);
    const title = r.getByTestId("row-title");
    await expect(title).toHaveText("Add lead-time badge to product cards");
    expect(await title.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBe(17);
    expect(await title.evaluate((el) => getComputedStyle(el).webkitLineClamp)).toBe("2");
    await expect(r.getByTestId("row-by")).toHaveText(new RegExp(`^${REPO} #${PR} · teammate`));
    await expect(r.getByTestId("status-badge")).toHaveCount(1);
    expect(Math.round((await r.boundingBox())!.height)).toBeGreaterThanOrEqual(72);
    // Full-width list rows, not cards in a card.
    expect(Math.round((await r.boundingBox())!.width)).toBe(393);
    await expect(page.locator("#qlist [data-slot=card]")).toHaveCount(0);
    // Body copy is 16px on a phone.
    expect(await page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe("16px");
  });

  test("swipe left archives at once, Undo brings it back; a failed archive rolls back", async ({ page }) => {
    const seen = await stub(page, "**/api/archive", { ok: true });
    await page.goto("/?tab=all");
    await settled(page);
    await swipe(page, row(page, PR2).getByTestId("row-fg"), -260);
    await expect(row(page, PR2)).toHaveCount(0);
    const toast = page.getByTestId("toast");
    await expect(toast).toContainText(`Archived #${PR2}`);
    await expect.poll(() => seen.length).toBe(1);
    expect(seen[0].postDataJSON()).toMatchObject({ repo: REPO, pr: PR2, action: "archive" });
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(row(page, PR2)).toBeVisible();
    await expect.poll(() => seen.length).toBe(2);
    expect(seen[1].postDataJSON()).toMatchObject({ action: "unarchive" });

    // Rollback: the server refuses, the row comes back and the toast says why.
    await page.unroute("**/api/archive");
    await stub(page, "**/api/archive", { error: "nope" }, 500);
    await swipe(page, row(page, PR2).getByTestId("row-fg"), -260);
    await expect(page.getByTestId("toast")).toContainText(/couldn't archive|nope/i);
    await expect(row(page, PR2)).toBeVisible();
  });

  test("a short swipe shows the action instead of running it; a tap elsewhere closes it", async ({ page }) => {
    const seen = await stub(page, "**/api/archive", { ok: true });
    await page.goto("/?tab=all");
    await settled(page);
    const r = row(page, PR2);
    await swipe(page, r.getByTestId("row-fg"), -90);
    await expect(r).toHaveAttribute("data-swiped", "left");
    const btn = r.locator("[data-swipe-action=archive]");
    await expect(btn).toBeVisible();
    expect(seen.length).toBe(0);
    await r.getByTestId("row-link").click(); // closes, does not open the PR
    await expect(page).toHaveURL(/\/\?tab=all$/);
    await expect(r).not.toHaveAttribute("data-swiped", /./);
    await swipe(page, r.getByTestId("row-fg"), -90);
    await btn.click();
    await expect(r).toHaveCount(0);
    await expect.poll(() => seen.length).toBe(1);
  });

  test("swipe right runs a review on your account at the suggested effort — it starts a run and never posts", async ({ page }) => {
    await patchJson(page, "**/api/pr?*", { claudeConnected: true });
    const runs = await stub(page, "**/api/review", { ok: true, started: true });
    const posts = await stub(page, "**/api/post", { bannerHtml: "" });
    await page.goto("/?tab=all");
    await settled(page);
    const pr = await page.evaluate((u) => fetch(u).then((r) => r.json()), `/api/pr?repo=${enc(REPO)}&pr=${PR}`);
    // A short swipe only shows the button.
    await swipe(page, row(page, PR).getByTestId("row-fg"), 90);
    await expect(row(page, PR)).toHaveAttribute("data-swiped", "right");
    await expect(row(page, PR).locator("[data-swipe-action=run]")).toBeVisible();
    expect(runs.length).toBe(0);
    await row(page, PR).getByTestId("row-link").click(); // close it
    // A long one runs it.
    await swipe(page, row(page, PR).getByTestId("row-fg"), 270);
    await expect.poll(() => runs.length).toBe(1);
    expect(runs[0].postDataJSON()).toMatchObject({ repo: REPO, pr: PR, effort: pr.runForm.suggested, focus: "", model: "" });
    await expect(page.getByTestId("toast")).toContainText(`Review started on #${PR}`);
    expect(posts.length).toBe(0);
    // A row whose review is already running cannot be run again.
    await swipe(page, row(page, PR4).getByTestId("row-fg"), 270);
    await page.waitForTimeout(300);
    expect(runs.length).toBe(1);
  });

  test("without a Claude account the swipe says so instead of starting anything", async ({ page }) => {
    const runs = await stub(page, "**/api/review", { ok: true, started: true });
    await page.goto("/?tab=all");
    await settled(page);
    await swipe(page, row(page, PR).getByTestId("row-fg"), 270);
    await expect(page.getByTestId("toast")).toContainText("Connect your Claude account");
    await page.getByTestId("toast-action").click();
    await expect(page).toHaveURL(/\/integrations$/);
    expect(runs.length).toBe(0);
  });

  test("pull to refresh reloads the queue", async ({ page }) => {
    await page.goto("/?tab=all");
    await settled(page);
    let n = 0;
    page.on("request", (r) => {
      if (r.url().includes("/api/queue")) n++;
    });
    const ptr = page.getByTestId("ptr");
    await expect(ptr).toHaveAttribute("data-state", "idle");
    // Not far enough: nothing.
    await pan(page, { x: 200, y: 260 }, { x: 200, y: 330 });
    await page.waitForTimeout(300);
    expect(n).toBe(0);
    await pan(page, { x: 200, y: 260 }, { x: 200, y: 560 });
    await expect.poll(() => n).toBeGreaterThan(0);
    await expect(ptr).toHaveAttribute("data-state", "idle", { timeout: 5000 });
  });

  test("the phone skeleton is shaped like the rows", async ({ page }) => {
    await page.route("**/api/queue?*", async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });
    await page.goto("/?tab=all");
    const sk = page.getByTestId("rows-skeleton");
    await expect(sk).toBeVisible();
    expect(Math.round((await sk.locator(":scope > div").first().boundingBox())!.height)).toBeGreaterThanOrEqual(72);
    await expect(sk).toHaveCount(0);
  });

  test("the empty queue is one sentence and one button", async ({ page }) => {
    await page.goto("/?tab=approved");
    const empty = page.getByTestId("empty-state");
    await expect(empty.locator("p")).toHaveCount(1);
    await expect(empty.getByRole("button")).toHaveCount(1);
    await empty.getByRole("button", { name: "Back to To review" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("Activity uses the same rows and swipes", async ({ page }) => {
    await page.goto("/activity");
    await settled(page);
    const r = page.getByTestId("queue-row").first();
    await expect(r.getByTestId("row-title")).toBeVisible();
    await expect(r.getByTestId("row-actions")).toBeVisible();
    await expect(r.getByTestId("row-fg")).toHaveCSS("touch-action", "pan-y");
  });
});

test.describe("every queue gesture has a button", () => {
  test.use(PHONE);

  test("the row's ⋯ menu archives and runs, with the keyboard alone", async ({ page }) => {
    await patchJson(page, "**/api/pr?*", { claudeConnected: true });
    const archives = await stub(page, "**/api/archive", { ok: true });
    const runs = await stub(page, "**/api/review", { ok: true, started: true });
    await page.goto("/?tab=all");
    await settled(page);
    const more = row(page, PR).getByRole("button", { name: `Actions for #${PR}` });
    await more.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("menuitem", { name: "Re-run review" }).click();
    await expect.poll(() => runs.length).toBe(1);
    await row(page, PR2).getByRole("button", { name: `Actions for #${PR2}` }).click();
    await page.getByRole("menuitem", { name: `Archive #${PR2}` }).click();
    await expect(row(page, PR2)).toHaveCount(0);
    await expect.poll(() => archives.length).toBe(1);
  });
});

test.describe("the PR page on a phone", () => {
  test.use(PHONE);

  test("the header is the title, repo #n · author · +/−, and one pill; no stepper, one notice at most", async ({ page }) => {
    await page.goto(prPath(REPO, PR));
    await settled(page);
    const head = page.getByTestId("pr-header");
    await expect(head.getByRole("heading", { level: 1 })).toHaveText("Add lead-time badge to product cards");
    expect(await head.getByRole("heading", { level: 1 }).evaluate((el) => getComputedStyle(el).webkitLineClamp)).toBe("2");
    await expect(head.getByTestId("pr-meta")).toHaveText(`${REPO} #${PR} · teammate · +42 −8`);
    await expect(head.getByTestId("review-state")).toHaveText("Reviewed");
    await expect(head.locator("[data-slot=badge]")).toHaveCount(1);
    await expect(page.getByTestId("steps")).toHaveCount(0);
    await expect(page.getByTestId("status-line")).toHaveCount(0);
    await expect(page.getByTestId("status-claude")).toHaveCount(0);
    // The fixture is a dry run with no Claude account: one notice, about the dry run.
    await expect(page.getByTestId("pr-notice")).toHaveCount(1);
    await expect(page.getByTestId("pr-notice")).toContainText("Dry run");
    await page.getByTestId("pr-notice").getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByTestId("pr-notice")).toHaveCount(0);
    // The assessment stays.
    await expect(page.getByTestId("verdict")).toBeVisible();
  });

  test("swipe right keeps, swipe left drops: the pill counts the same set the checkboxes tick", async ({ page }) => {
    await page.goto(prPath(REPO, PR));
    await settled(page);
    const cards = page.getByTestId("finding");
    const first = cards.nth(0);
    const pill = page.getByTestId("post-pill");
    await expect(pill).toHaveText(/2 kept/);
    // Drop the second: dimmed to one line, out of the staged set.
    await swipe(page, cards.nth(1), -200);
    const dropped = page.locator("[data-testid=finding][data-dropped]");
    await expect(dropped).toHaveCount(1);
    expect(Math.round((await dropped.boundingBox())!.height)).toBeLessThanOrEqual(52);
    await expect(pill).toHaveText(/1 kept/);
    // Untick the first with its checkbox: nothing kept, the pill says how to keep.
    await first.getByTestId("finding-select").uncheck();
    await expect(pill).toHaveText("Swipe right to keep findings");
    await expect(pill).toHaveAttribute("data-state", "empty");
    // Swipe it right: kept again, its checkbox ticked, a green edge.
    await swipe(page, first, 200);
    await expect(first.getByTestId("finding-select")).toBeChecked();
    await expect(first).toHaveClass(/is-staged/);
    await expect(first).toHaveCSS("border-left-color", await page.evaluate(() => {
      const d = document.createElement("div");
      d.className = "text-green";
      document.body.appendChild(d);
      const c = getComputedStyle(d).color;
      d.remove();
      return c;
    }));
    await expect(pill).toHaveText(/1 kept/);
    // Tap to restore the dropped one: back, and not kept until you say so.
    await dropped.getByTestId("finding-restore").click();
    await expect(page.locator("[data-testid=finding][data-dropped]")).toHaveCount(0);
    await expect(cards.nth(1).getByTestId("finding-select")).not.toBeChecked();
    await cards.nth(1).getByTestId("finding-select").check();
    await expect(pill).toHaveText(/2 kept/);
  });

  test("the confirm sheet is the only way to POST /api/post", async ({ page }) => {
    const posts = await stub(page, "**/api/post", { bannerHtml: DRY_BANNER });
    await page.goto(prPath(REPO, PR));
    await settled(page);
    const cards = page.getByTestId("finding");
    // Swipes, checkboxes, the pill, the sheet and its Cancel: none of them posts.
    await swipe(page, cards.nth(1), -200);
    await swipe(page, cards.nth(0), 200);
    await cards.nth(0).getByTestId("finding-select").uncheck();
    await cards.nth(0).getByTestId("finding-select").check();
    const pill = page.getByTestId("post-pill");
    await pill.click();
    const sheet = page.getByTestId("post-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("heading")).toHaveText("Post 1 comment");
    await expect(sheet.getByTestId("post-inline")).toContainText("1");
    await expect(sheet.getByTestId("post-summary")).toContainText("0");
    await sheet.getByRole("button", { name: "Cancel" }).click();
    await expect(sheet).toBeHidden();
    await pill.click();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await pill.click();
    const go = sheet.getByTestId("post-confirm");
    // The dry-run label is kept; Request changes changes the words, not the path.
    await expect(go).toHaveText("Post as acme-dev (dry run)");
    await sheet.getByTestId("request-changes").check();
    await expect(go).toHaveText("Request changes as acme-dev (dry run)");
    await sheet.getByTestId("request-changes").uncheck();
    await page.waitForTimeout(200);
    expect(posts.length).toBe(0);
    await go.click();
    await expect.poll(() => posts.length).toBe(1);
    // Exactly the set on screen: the kept card's index, not the dropped one.
    const body = posts[0].postDataJSON();
    expect(body.selected).toEqual([0]);
    expect(body.request_changes).toBe(false);
    // Success: the next PR waiting on you, and the way back.
    const done = page.getByTestId("post-success");
    await expect(done).toBeVisible();
    await expect(done).toContainText("Recorded 1 comment");
    await expect(done.getByTestId("post-next")).toContainText(`#${PR4} Retry the vendor sync`);
    await expect(sheet).toBeHidden();
    expect(posts.length).toBe(1);
    await done.getByTestId("post-back").click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("the success state's next item opens that PR", async ({ page }) => {
    await stub(page, "**/api/post", { bannerHtml: DRY_BANNER });
    await page.goto(prPath(REPO, PR));
    await settled(page);
    await page.getByTestId("post-pill").click();
    await page.getByTestId("post-confirm").click();
    await page.getByTestId("post-next").click();
    await expect(page).toHaveURL(new RegExp(`pr=${PR4}`));
  });

  test("tap a card for the full text with Edit and Explain; Teach and Copy are in its ⋯ menu", async ({ page }) => {
    await page.route("**/api/explain", (route) => route.fulfill({ json: { md: "In plain words: guard the null." } }));
    await page.goto(prPath(REPO, PR));
    await settled(page);
    const card = page.getByTestId("finding").first();
    await expect(card.getByTestId("finding-detail")).toHaveCount(0);
    // Closed, the card already carries the verification contract: confidence in the head,
    // why it matters and how to verify under the claim. The nit has no verify line, so no row.
    await expect(card.getByTestId("confidence")).toHaveText("high confidence");
    await expect(card.getByTestId("why-it-matters")).toContainText("A shopper viewing such a product");
    await expect(card.getByTestId("how-to-verify")).toContainText("Open a product whose vendor is null");
    await expect(page.getByTestId("finding").nth(1).getByTestId("how-to-verify")).toHaveCount(0);
    await card.getByTestId("finding-expand").click();
    await expect(card.getByTestId("finding-detail")).toBeVisible();
    await card.getByRole("button", { name: "Edit" }).click();
    await expect(card.getByTestId("finding-body")).toBeVisible();
    await card.getByTestId("explain").click();
    await expect(card.getByTestId("explain-box")).toContainText("guard the null");
    await card.getByTestId("finding-menu").click();
    await expect(page.getByRole("menuitem", { name: /Teach the skill/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /^Copy / })).toBeVisible();
    await page.getByRole("menuitem", { name: /Teach the skill/ }).click();
    await expect(card.getByTestId("teach")).toBeVisible();
  });

  // Dismissal reasons (openspec/changes/p0-proof/lane2-reasons.md) on the phone: the drop is
  // the swipe and has already happened; a bottom chip row above the pill asks why for ~6 s.
  test("a swipe-drop opens the reason bar above the pill; a pick marks the dropped line and rides the post", async ({ page }) => {
    const posts = await stub(page, "**/api/post", { bannerHtml: DRY_BANNER });
    await page.goto(prPath(REPO, PR));
    await settled(page);
    const cards = page.getByTestId("finding");
    const pill = page.getByTestId("post-pill");
    await expect(page.getByTestId("reason-bar")).toHaveCount(0);
    await swipe(page, cards.nth(1), -200);
    const dropped = page.locator("[data-testid=finding][data-dropped]");
    await expect(dropped).toHaveCount(1);
    await expect(pill).toHaveText(/1 kept/);
    // The bar: the dropped title, seven 44 px chips in a scrolling row, above the pill, above
    // the tab bar — and the dropped line is still one line, with a Why? chip of its own.
    const bar = page.getByTestId("reason-bar");
    await expect(bar).toBeVisible();
    await expect(bar.getByTestId("reason-bar-title")).toContainText("Use const instead of let");
    const chips = bar.getByTestId("reason-chip");
    await expect(chips).toHaveCount(7);
    expect((await chips.first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const barBox = (await bar.locator("> div").boundingBox())!;
    const pillBox = (await pill.boundingBox())!;
    const tab = (await page.locator(".tabbar").boundingBox())!;
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(pillBox.y + 1);
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(tab.y + 1);
    expect(Math.round((await dropped.boundingBox())!.height)).toBeLessThanOrEqual(52);
    await expect(dropped.getByTestId("reason-open")).toHaveText("Why?");
    await chips.filter({ hasText: "Duplicate" }).click();
    await expect(page.getByTestId("reason-bar")).toHaveCount(0);
    await expect(dropped.getByTestId("reason-picked")).toHaveText("Duplicate");
    await expect(dropped).toHaveAttribute("data-reason", "duplicate");
    // Tapping the answer asks again; Restore forgets it and closes the bar.
    await dropped.getByTestId("reason-picked").click();
    await expect(page.getByTestId("reason-bar")).toBeVisible();
    await expect(page.getByTestId("reason-bar").getByTestId("reason-picked")).toHaveAttribute("data-reason", "duplicate");
    await page.getByTestId("reason-bar").getByTestId("reason-clear").click();
    await expect(dropped.getByTestId("reason-open")).toHaveText("Why?");
    await dropped.getByTestId("reason-open").click();
    await page.getByTestId("reason-bar").getByRole("button", { name: "Irrelevant" }).click();
    await expect(dropped).toHaveAttribute("data-reason", "irrelevant");
    // Post: the reason goes with the dropped index.
    await pill.click();
    await page.getByTestId("post-confirm").click();
    await expect(page.getByTestId("post-success")).toBeVisible();
    expect(posts).toHaveLength(1);
    const body = posts[0].postDataJSON();
    expect(body.reasons).toEqual({ "1": "irrelevant" });
    expect(body.selected).toEqual([0]);
  });

  test("the reason bar closes after six seconds, on Restore, and never asks a kept card", async ({ page }) => {
    await page.goto(prPath(REPO, PR));
    await settled(page);
    await page.clock.install();
    const cards = page.getByTestId("finding");
    await cards.nth(1).getByTestId("finding-menu").click();
    await page.getByRole("menuitem", { name: "Drop" }).click();
    await expect(page.getByTestId("reason-bar")).toBeVisible();
    await page.clock.fastForward(6_100);
    await expect(page.getByTestId("reason-bar")).toHaveCount(0);
    const dropped = page.locator("[data-testid=finding][data-dropped]");
    await expect(dropped).toHaveCount(1, { timeout: 2_000 });
    await dropped.getByTestId("reason-open").click();
    await expect(page.getByTestId("reason-bar")).toBeVisible();
    await dropped.getByTestId("finding-restore").click();
    await expect(page.getByTestId("reason-bar")).toHaveCount(0);
    await expect(page.locator("[data-testid=finding][data-dropped]")).toHaveCount(0);
    // Keeping asks nothing.
    await swipe(page, cards.nth(1), 200);
    await expect(cards.nth(1)).toHaveClass(/is-staged/);
    await expect(page.getByTestId("reason-bar")).toHaveCount(0);
  });

  test("every card gesture has a button: Keep and Drop in the ⋯ menu, Restore on the dropped line", async ({ page }) => {
    await page.goto(prPath(REPO, PR));
    await settled(page);
    const card = page.getByTestId("finding").first();
    const pill = page.getByTestId("post-pill");
    await card.getByTestId("finding-menu").click();
    await page.getByRole("menuitem", { name: "Drop" }).click();
    await expect(page.locator("[data-testid=finding][data-dropped]")).toHaveCount(1);
    await expect(pill).toHaveText(/1 kept/);
    await page.getByTestId("finding-restore").click();
    await page.getByTestId("finding").first().getByTestId("finding-menu").click();
    await page.getByRole("menuitem", { name: "Keep" }).click();
    await expect(pill).toHaveText(/2 kept/);
    await expect(page.getByTestId("finding").first().getByTestId("finding-select")).toHaveAccessibleName(/^Keep this/);
  });

  test("keep, drop and post tick the haptic where the platform has one", async ({ page }) => {
    await page.addInitScript("window.__buzz = 0; navigator.vibrate = function () { window.__buzz++; return true; };");
    await stub(page, "**/api/post", { bannerHtml: DRY_BANNER });
    await page.goto(prPath(REPO, PR));
    await settled(page);
    const cards = page.getByTestId("finding");
    await swipe(page, cards.nth(1), -200);
    await swipe(page, cards.nth(0), -200);
    await page.getByTestId("finding-restore").first().click();
    await swipe(page, cards.nth(0), 200);
    await page.getByTestId("post-pill").click();
    await page.getByTestId("post-confirm").click();
    await expect(page.getByTestId("post-success")).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __buzz: number }).__buzz)).toBe(4);
  });

  test("Approve and Re-run are in the ⋯ sheet in the navigation bar", async ({ page }) => {
    await patchJson(page, "**/api/pr?*", { claudeConnected: true });
    const approvals = await stub(page, "**/api/approve", { bannerHtml: DRY_BANNER });
    const runs = await stub(page, "**/api/review", { ok: true, started: true });
    await page.goto(prPath(REPO, PR));
    await settled(page);
    await expect(page.getByTestId("sections")).toHaveCount(0);
    const more = page.getByTestId("nav-bar").getByRole("button", { name: "Actions" });
    const mb = (await more.boundingBox())!;
    expect(mb.width).toBeGreaterThanOrEqual(44);
    await more.click();
    const sheet = page.getByTestId("pr-action-sheet");
    await expect(sheet).toBeVisible();
    await sheet.getByTestId("sheet-approve").click();
    await expect(sheet.getByTestId("approve-panel")).toBeVisible();
    await sheet.getByRole("button", { name: "Approve (dry run)" }).click();
    await expect.poll(() => approvals.length).toBe(1);
    await sheet.getByTestId("sheet-back").click();
    await sheet.getByTestId("sheet-rerun").click();
    await expect(sheet.getByTestId("run-form")).toBeVisible();
    await sheet.getByTestId("run-form").getByRole("button", { name: "Re-run review" }).click();
    await expect.poll(() => runs.length).toBe(1);
  });

  test("the PR skeleton is shaped like the header and the cards", async ({ page }) => {
    await page.route("**/api/pr?*", async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });
    await page.goto(prPath(REPO, PR));
    const sk = page.getByTestId("pr-loading");
    await expect(sk).toBeVisible();
    await expect(sk.locator("[data-slot=card]")).toHaveCount(3);
    await expect(sk).toHaveCount(0);
  });
});

test.describe("at 430 × 932", () => {
  test.use({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });

  test("the queue and the PR page fit, and the pill sits above the tab bar", async ({ page }) => {
    for (const path of ["/?tab=all", prPath(REPO, PR)]) {
      await page.goto(path);
      await settled(page);
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
      expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
    }
    const pill = (await page.getByTestId("post-pill").boundingBox())!;
    expect(Math.round(pill.height)).toBe(56);
    const tab = (await page.getByTestId("tab-bar").boundingBox())!;
    expect(pill.y + pill.height).toBeLessThanOrEqual(tab.y);
  });
});

test.describe("the desktop keeps its layout", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("no phone queue, no pill, no swipe; the commit bar and the section tabs are where they were", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("phone-queue")).toHaveCount(0);
    await expect(page.locator("#qsearch")).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Queue views" }).getByRole("tab")).toHaveCount(6);
    await page.goto(prPath(REPO, PR));
    await expect(page.getByTestId("commit-bar")).toBeVisible();
    await expect(page.getByTestId("sections")).toBeVisible();
    await expect(page.getByTestId("post-pill")).toHaveCount(0);
    await expect(page.getByTestId("steps")).toBeVisible();
    await expect(page.locator(".finding").first().getByTestId("finding-expand")).toHaveCount(0);
  });
});
