// Lane 4 (openspec/changes/p0-proof/recon.md §4.5): the public replay is the shipped PR page
// running with no server. On a static origin with no /api: the disclosure banner is visible,
// keep / drop / edit all work, Post opens the would-post sheet with the kept bodies (edits
// included) and the install CTA, not one request leaves the static origin, and the local
// counters count — in this browser only.
import { expect, test, type Page } from "@playwright/test";
import { REPLAY_ORIGIN, REPLAY_PATH } from "./replay-server";

const url = (example = "webhook-retry") => `${REPLAY_ORIGIN}${REPLAY_PATH}?example=${example}`;

// No session cookie: the replay must work for an anonymous visitor.
test.use({ storageState: { cookies: [], origins: [] } });

/**
 * Every request the page makes, every response it receives, and every request that even tried
 * to reach an /api. A request the browser refused under the shell's Content-Security-Policy
 * (Chromium reports the failure as "csp") never left the machine; a response from anywhere but the replay's own
 * files would mean something did.
 */
async function watch(page: Page) {
  const urls: string[] = [];
  const responses: string[] = [];
  const blocked: string[] = [];
  let api = 0;
  page.on("request", (r) => urls.push(r.url()));
  page.on("response", (r) => responses.push(r.url()));
  page.on("requestfailed", (r) => {
    if (/csp/i.test(r.failure()?.errorText ?? "")) blocked.push(r.url());
  });
  await page.route("**/api/**", async (route) => {
    api += 1;
    await route.abort();
  });
  const own = (u: string) => /^(data|blob):/.test(u) || u.startsWith(REPLAY_ORIGIN + REPLAY_PATH);
  return {
    urls,
    responses,
    blocked,
    api: () => api,
    // Requests that were neither the replay's own files nor refused by the CSP before leaving.
    offenders: () => urls.filter((u) => !own(u) && !blocked.includes(u)),
    // Anything that answered from outside the static origin.
    foreignResponses: () => responses.filter((u) => !own(u)),
  };
}

async function settled(page: Page) {
  await expect(page.getByTestId("replay-banner")).toBeVisible();
  await expect(page.getByTestId("pr-loading")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId("verdict")).toBeVisible();
}

const counters = (page: Page) => page.evaluate(() => window.__rsReplayEvents!.read());

test.describe("the replay on a desktop", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("keep, drop, edit, then Post shows what would be posted — with no request to any /api", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const net = await watch(page);
    await page.goto(url());
    await settled(page);

    // The disclosure, in those words.
    await expect(page.getByTestId("replay-banner")).toContainText("Precomputed example. Nothing leaves this page.");
    await expect(page.getByTestId("replay")).toHaveAttribute("data-example", "webhook-retry");
    expect(await counters(page)).toMatchObject({ replay_started: 1, first_decision: 0, replay_completed: 0 });

    // Three findings, every one pre-ticked (none is low confidence).
    const cards = page.locator(".finding");
    await expect(cards).toHaveCount(3);
    for (let i = 0; i < 3; i++) await expect(cards.nth(i).getByTestId("finding-select")).toBeChecked();
    await expect(cards.nth(0)).toContainText("Every non-2xx is retried");

    // Drop the second (the plausible-but-wrong one).
    await cards.nth(1).getByTestId("finding-select").uncheck();
    await expect(cards.nth(1)).not.toHaveClass(/is-staged/);
    expect((await counters(page)).first_decision).toBe(1);

    // Edit the third.
    const third = cards.nth(2);
    await third.getByRole("button", { name: "Edit comment" }).click();
    const editor = third.getByTestId("md-editor");
    await editor.getByRole("button", { name: "Edit", exact: true }).click();
    const edited = "Consider adding jitter (±20%) so simultaneous failures do not retry in lockstep.";
    await editor.locator("textarea").fill(edited);
    expect((await counters(page)).first_decision).toBe(1); // counted once, not per keystroke

    // Post from the commit bar: the would-post sheet opens with the two kept comments.
    const bar = page.getByTestId("commit-bar");
    await expect(bar).toContainText("2");
    await bar.locator("button[data-post]").click();
    const sheet = page.getByTestId("replay-post-preview");
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("Precomputed example — nothing was sent");
    const posted = sheet.getByTestId("replay-post-comment");
    await expect(posted).toHaveCount(2);
    await expect(posted.nth(0)).toContainText("src/webhooks/deliver.ts:25");
    await expect(posted.nth(1)).toContainText(edited);
    await expect(sheet).not.toContainText("Backoff is unbounded");
    await expect(sheet.getByTestId("replay-post-event")).toContainText("Comment review on northwind/dispatch#412 as sam · 2 comments");

    // The CTA: the command, and the install page.
    await expect(sheet.getByTestId("replay-cta-link")).toHaveAttribute("href", "/start/install/");
    await sheet.getByTestId("replay-cta-copy").click();
    await expect(sheet.getByTestId("replay-cta-copy")).toContainText("npx reviewstage");

    // Behind the sheet the page shows the dry-run receipt the server would have sent.
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(page.locator(".banner.warn")).toContainText("nothing was sent");

    // Not one request reached an /api, and nothing left the static origin.
    expect(net.api()).toBe(0);
    expect(net.urls.length).toBeGreaterThan(0);
    expect(net.offenders()).toEqual([]);
    expect(net.foreignResponses()).toEqual([]);
    // The PR header renders avatar <img>s for the author and the owner — the CSP is what stops
    // those from reaching github.com for a fictional login.
    expect(net.blocked.some((u) => u.startsWith("https://github.com/"))).toBe(true);
    expect(await counters(page)).toMatchObject({ replay_started: 1, first_decision: 1, replay_completed: 1, install_copied: 1 });
  });

  test("explain simply answers from the fixture; a second example loads by slug", async ({ page }) => {
    const net = await watch(page);
    await page.goto(url("rate-limit-tenant"));
    await settled(page);
    await expect(page.getByTestId("replay")).toHaveAttribute("data-example", "rate-limit-tenant");
    await expect(page.getByTestId("verdict")).toContainText("2 things to fix before merge");
    const first = page.locator(".finding").first();
    await first.getByTestId("explain").click();
    await expect(first.getByTestId("explain-box")).toContainText("bucket that is meant to slowly refill");
    expect(net.api()).toBe(0);
  });

  test("an unknown slug falls back to the first example", async ({ page }) => {
    await page.goto(url("not-a-real-example"));
    await settled(page);
    await expect(page.getByTestId("replay")).toHaveAttribute("data-example", "webhook-retry");
    expect(page.url()).toContain("example=webhook-retry");
    expect(page.url()).toContain("pr=412");
  });
});

test.describe("the replay on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the post pill opens the real sheet, whose Post shows the would-post review", async ({ page }) => {
    const net = await watch(page);
    await page.goto(url("cache-stale-read"));
    await settled(page);
    // No sideways scroll at 390.
    const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    expect(sw).toBeLessThanOrEqual(iw);

    const pill = page.getByTestId("post-pill");
    await expect(pill).toBeVisible();
    await expect(page.getByTestId("post-pill-count")).toHaveText("3 kept");
    // Drop one from its card, then post.
    await page.locator("[data-testid=finding]").nth(1).getByTestId("finding-select").click();
    await expect(page.getByTestId("post-pill-count")).toHaveText("2 kept");
    await pill.click();
    const sheet = page.getByTestId("post-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId("post-dry")).toContainText("nothing reaches GitHub");
    await sheet.getByTestId("post-confirm").click();
    const preview = page.getByTestId("replay-post-preview");
    await expect(preview).toBeVisible();
    await expect(preview.getByTestId("replay-post-comment")).toHaveCount(2);
    await expect(preview).toContainText("src/catalog/service.ts:20");
    expect(net.api()).toBe(0);
    expect(net.offenders()).toEqual([]);
    expect(net.foreignResponses()).toEqual([]);
  });
});
