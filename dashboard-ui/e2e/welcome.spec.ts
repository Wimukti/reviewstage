// The first-run wizard of personal mode (openspec/changes/npx-desktop §4), against a server
// booted HERE on the personal fixture: RS_PERSONAL=1, zero repositories, one user with a stored
// dummy token, a fake gh. Serial, because the steps build on each other the way a first run
// does — sign in, skip Claude, pick two repositories, land on the queue.
import { spawn, type ChildProcess } from "node:child_process";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { sessionCookie } from "./fixture";
import {
  buildPersonalFixture,
  PERSONAL_FIXTURE,
  PERSONAL_ORIGIN,
  PERSONAL_PORT,
  PERSONAL_REPOS,
  PERSONAL_USER,
} from "./personal-fixture";

test.describe.configure({ mode: "serial" });
// This server is a different install: start signed out, and never send the main fixture's
// cookie (cookies ignore ports, so the default storageState would reach it).
test.use({ baseURL: PERSONAL_ORIGIN, storageState: { cookies: [], origins: [] } });

let server: ChildProcess | null = null;
const log: string[] = [];

async function healthy(ms = 30_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(`${PERSONAL_ORIGIN}/health`);
      if (r.ok && (await r.text()).trim() === "ok") return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

test.beforeAll(async () => {
  buildPersonalFixture();
  server = spawn("python3", ["../bin/server.py"], {
    env: {
      ...process.env,
      ROOT: PERSONAL_FIXTURE,
      RS_SPA: "1",
      RS_PORT: String(PERSONAL_PORT),
      RS_COOKIE_SECURE: "0",
      PATH: `${PERSONAL_FIXTURE}/fakebin:${process.env.PATH || ""}`,
      PYTHONUNBUFFERED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const s of [server.stdout!, server.stderr!]) s.on("data", (d) => log.push(String(d)));
  expect(await healthy(), `personal server did not start:\n${log.join("")}`).toBe(true);
});

test.afterAll(async () => {
  server?.kill("SIGTERM");
  server = null;
});

const signedIn = (browser: Browser, extra: Parameters<Browser["newContext"]>[0] = {}) =>
  browser.newContext({ baseURL: PERSONAL_ORIGIN, ...extra }).then(async (c) => {
    await c.addCookies([sessionCookie(PERSONAL_USER)]);
    return c;
  });

const steps = (page: Page) => page.getByTestId("welcome-step");

test("the server boots with no repository and warns rather than dying", async () => {
  const me = await (await fetch(`${PERSONAL_ORIGIN}/api/me`)).json();
  expect(me.personal).toBe(true);
  expect(me.repos).toEqual([]);
  expect(log.join("")).toMatch(/WARN: no repository configured/);
  expect(log.join("")).not.toMatch(/FATAL/);
});

test("landing on / redirects to /welcome with three steps, GitHub first", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(steps(page)).toHaveCount(3);
  await expect(steps(page)).toHaveText(["GitHub", "Claude", "Repositories"]);
  await expect(steps(page).nth(0)).toHaveAttribute("data-state", "current");
  await expect(steps(page).nth(1)).toHaveAttribute("data-state", "pending");
  await expect(page.getByTestId("welcome-github")).toBeVisible();
  // The login page's own form is what is embedded here.
  await expect(page.getByLabel("GitHub personal access token")).toBeVisible();
  // And nothing of the shell: it is a focused flow.
  await expect(page.getByRole("navigation")).toHaveCount(0);
});

test("signing in advances to the Claude step; 'later' skips to repositories", async ({ browser }) => {
  const ctx = await signedIn(browser);
  const page = await ctx.newPage();
  await page.goto("/welcome");
  await expect(page).toHaveURL(/\/welcome\/claude$/);
  await expect(steps(page).nth(0)).toHaveAttribute("data-state", "done");
  await expect(steps(page).nth(1)).toHaveAttribute("data-state", "current");
  // The Integrations control, as is. No connect is in flight, so the control is a button that
  // mints one (POST /api/claude/start) and opens the address it gets back; an anchor with an
  // empty href used to open the dashboard itself in a second window.
  const AUTH = "https://claude.ai/oauth/authorize?code=true&state=e2e";
  let starts = 0;
  await page.route("**/api/claude/start", (route) => {
    starts++;
    return route.fulfill({ json: { bannerHtml: "", connected: false, authUrl: AUTH } });
  });
  await page.evaluate(() => {
    (window as unknown as { __opened: string[] }).__opened = [];
    window.open = ((u: string) => { (window as unknown as { __opened: string[] }).__opened.push(u); return null; }) as typeof window.open;
  });
  const connect = page.getByRole("button", { name: /Connect with Claude/ });
  await expect(connect).toBeVisible();
  await expect(page.getByRole("link", { name: /Connect with Claude/ })).toHaveCount(0);
  await connect.click();
  await expect(page.getByRole("link", { name: /Reopen Claude/ })).toHaveAttribute("href", AUTH);
  expect(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual([AUTH]);
  expect(starts).toBe(1);
  await expect(page.getByLabel(/code/i).first()).toBeVisible(); // the paste-the-code form is revealed
  await page.getByTestId("claude-later").click();
  await expect(page).toHaveURL(/\/welcome\/repos$/);
  await expect(steps(page).nth(2)).toHaveAttribute("data-state", "current");
  await ctx.close();
});

// A 1x1 PNG, so the owner avatars the API names can "load" offline and the <img> renders
// (Radix shows the fallback and drops the <img> on a load error).
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

test("the repository step lists the user's repositories with their owners' avatars", async ({ browser }) => {
  const ctx = await signedIn(browser);
  const page = await ctx.newPage();
  const avatarHits: string[] = [];
  await page.route("https://avatars.example.test/**", async (route) => {
    avatarHits.push(route.request().url());
    await route.fulfill({ status: 200, contentType: "image/png", body: PIXEL });
  });
  await page.goto("/welcome/repos");
  const rows = page.getByTestId("repo-row");
  await expect(rows).toHaveCount(PERSONAL_REPOS.length);
  // Newest push first, as GitHub sorted them.
  expect(await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-repo")))).toEqual(
    PERSONAL_REPOS.map((r) => r.full_name),
  );
  for (const r of PERSONAL_REPOS) {
    const row = page.locator(`[data-testid=repo-row][data-repo="${r.full_name}"]`);
    await expect(row.getByTestId("repo-pill")).toHaveText(r.full_name);
    // The pill shows GitHub's own owner avatar from the API — not a URL guessed from the name.
    await expect(row.locator("[data-testid=repo-pill] img")).toHaveAttribute("src", r.owner.avatar_url);
  }
  expect(new Set(avatarHits)).toEqual(new Set(PERSONAL_REPOS.map((r) => r.owner.avatar_url)));
  await expect(page.getByLabel("Private")).toHaveCount(2);
  await expect(page.getByText(/pushed \d+(m|h|d|mo|y) ago/).first()).toBeVisible();
  await expect(page.getByTestId("start-reviewing")).toBeDisabled();
  await expect(page.getByTestId("repo-count")).toHaveText("0 selected");
  await ctx.close();
});

test("search filters on the server; no match shows the empty state", async ({ browser }) => {
  const ctx = await signedIn(browser);
  const page = await ctx.newPage();
  await page.goto("/welcome/repos");
  await expect(page.getByTestId("repo-row")).toHaveCount(3);
  await page.getByTestId("repo-search").fill("bill");
  await expect(page.getByTestId("repo-row")).toHaveCount(1);
  await expect(page.getByTestId("repo-row")).toHaveAttribute("data-repo", "acme/billing");
  await page.getByTestId("repo-search").fill("zzz-nothing");
  await expect(page.getByTestId("empty-state")).toContainText("No match");
  await ctx.close();
});

test("selecting two and Start reviewing posts them and lands on the queue", async ({ browser }) => {
  const ctx = await signedIn(browser);
  const page = await ctx.newPage();
  await page.goto("/welcome/repos");
  await expect(page.getByTestId("repo-row")).toHaveCount(3);
  await page.getByRole("checkbox", { name: "acme-solo/widgets" }).click();
  await page.getByRole("checkbox", { name: "acme/api" }).click();
  await expect(page.getByTestId("repo-count")).toHaveText("2 selected");
  const saved = page.waitForResponse((r) => r.url().endsWith("/api/repos") && r.request().method() === "POST");
  await page.getByTestId("start-reviewing").click();
  const body = await (await saved).json();
  expect(body.repos).toEqual(["acme-solo/widgets", "acme/api"]);
  await expect(page).toHaveURL(new RegExp(`^${PERSONAL_ORIGIN}/(\\?.*)?$`));
  // The queue now knows both repositories: its repository filter offers them.
  await page.getByLabel("Filter by repository").click();
  await expect(page.getByRole("option", { name: "acme-solo/widgets" })).toBeVisible();
  await expect(page.getByRole("option", { name: "acme/api" })).toBeVisible();
  await page.keyboard.press("Escape");
  // And the server agrees — settings.json carries them, unioned with (the empty) .env.
  const me = await page.evaluate(() => fetch("/api/me").then((r) => r.json()));
  expect(me.repos).toEqual(["acme-solo/widgets", "acme/api"]);
  await ctx.close();
});

test("a second visit to / does not redirect", async ({ browser }) => {
  const ctx = await signedIn(browser);
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.getByTestId("page-header")).toContainText("Your review queue");
  await page.waitForTimeout(500);
  await expect(page).not.toHaveURL(/welcome/);
  // The wizard stays reachable, pre-checked with what is already configured.
  await page.goto("/welcome/repos");
  await expect(page.getByTestId("repo-already")).toHaveCount(2);
  await expect(page.getByTestId("repo-count")).toHaveText("2 selected");
  await ctx.close();
});

test.describe("phone", () => {
  test("no step scrolls sideways at 390", async ({ browser }) => {
    const ctx = await signedIn(browser, {
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    });
    const page = await ctx.newPage();
    for (const path of ["/welcome/claude", "/welcome/repos"]) {
      await page.goto(path);
      await expect(page.getByTestId("welcome-steps")).toBeVisible();
      if (path.endsWith("repos")) await expect(page.getByTestId("repo-row")).toHaveCount(3);
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: Math.round(window.visualViewport?.width ?? window.innerWidth),
      }));
      expect(scrollWidth, path).toBeLessThanOrEqual(innerWidth);
    }
    await ctx.close();
    // Signed out as well: the GitHub step.
    const out = await browser.newContext({
      baseURL: PERSONAL_ORIGIN, storageState: { cookies: [], origins: [] },
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    });
    const page2 = await out.newPage();
    await page2.goto("/welcome");
    await expect(page2.getByTestId("welcome-github")).toBeVisible();
    const m = await page2.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: Math.round(window.visualViewport?.width ?? window.innerWidth),
    }));
    expect(m.scrollWidth).toBeLessThanOrEqual(m.innerWidth);
    await out.close();
  });
});
