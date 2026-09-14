import { expect, test, type Page } from "@playwright/test";
import { SECRET, USER } from "./fixture";
import { createHmac } from "node:crypto";

// "Sign in with GitHub" through the device flow. The fixture runs with GH_DEVICE_FLOW=0 so the
// server never reaches GitHub; here /api/me is rewritten to advertise device_flow and the two
// auth endpoints are stubbed the way the real server answers them.
const START = {
  session: "sess-e2e",
  user_code: "ABCD-1234",
  verification_uri: "https://github.com/login/device",
  expires_in: 899,
  interval: 1, // seconds — keeps the spec quick; GitHub's real minimum is 5
};

function sessionCookieHeader() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const sig = createHmac("sha256", SECRET).update(`session:${USER}:${exp}`).digest("hex");
  return `rs_session=${USER}:${exp}:${sig}; Path=/; HttpOnly; SameSite=Lax`;
}

async function stubMe(page: Page) {
  await page.route("**/api/me", async (route) => {
    const r = await route.fetch();
    await route.fulfill({ response: r, json: { ...(await r.json()), oauth: false, device_flow: true } });
  });
}

test.describe("device flow sign-in", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("shows the code, polls until GitHub says ok, then loads the app", async ({ page }) => {
    await stubMe(page);
    let starts = 0;
    const polls: string[] = [];
    await page.route("**/api/auth/device/start", async (route) => {
      starts++;
      await route.fulfill({ json: START });
    });
    // pending twice (the second as the 429 "too fast" shape), then ok with a real session cookie
    // so the following /api/me is authed and the app renders.
    await page.route("**/api/auth/device/poll", async (route) => {
      const body = route.request().postDataJSON() as { session: string };
      polls.push(body.session);
      if (polls.length === 1) return route.fulfill({ json: { status: "pending", interval: 1 } });
      if (polls.length === 2)
        return route.fulfill({ status: 429, headers: { "Retry-After": "1" }, json: { status: "pending", retry_after: 1 } });
      await page.unroute("**/api/me");
      return route.fulfill({
        json: { status: "ok", login: USER, welcome: false },
        headers: { "Set-Cookie": sessionCookieHeader() },
      });
    });

    await page.goto("/login");
    const btn = page.getByRole("button", { name: "Sign in with GitHub" });
    await expect(btn).toBeVisible();
    await expect(page.getByLabel("GitHub personal access token")).toBeHidden();
    await expect(page.getByText("Running this server?")).toHaveCount(0);
    await btn.click();

    const code = page.getByTestId("device-user-code");
    await expect(code).toHaveText("ABCD-1234");
    await expect(page.getByRole("button", { name: "Copy code" })).toBeVisible();
    const open = page.getByRole("link", { name: "Open github.com/login/device" });
    await expect(open).toHaveAttribute("href", "https://github.com/login/device");
    await expect(open).toHaveAttribute("target", "_blank");
    await expect(page.getByRole("status", { name: "Waiting for GitHub…" })).toBeVisible();
    await expect(btn).toHaveCount(0); // the primary button gives way to the code card

    // The poll resolves and the app loads for the fixture user.
    await page.waitForURL(/\/$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /review queue/i })).toBeVisible();
    expect(starts).toBe(1);
    expect(polls.length).toBeGreaterThanOrEqual(3);
    expect(polls.every((s) => s === START.session)).toBe(true);
  });

  test("denied on GitHub: inline message with Try again, which asks for a fresh code", async ({ page }) => {
    await stubMe(page);
    let starts = 0;
    await page.route("**/api/auth/device/start", async (route) => {
      starts++;
      await route.fulfill({ json: { ...START, user_code: starts === 1 ? "ABCD-1234" : "WXYZ-9876" } });
    });
    await page.route("**/api/auth/device/poll", async (route) => {
      await route.fulfill({ json: { status: starts === 1 ? "denied" : "pending", interval: 1 } });
    });

    await page.goto("/login");
    await page.getByRole("button", { name: "Sign in with GitHub" }).click();
    await expect(page.getByTestId("device-user-code")).toHaveText("ABCD-1234");
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("You cancelled the sign-in on GitHub.");
    await expect(page.getByTestId("device-user-code")).toHaveCount(0);
    await alert.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByTestId("device-user-code")).toHaveText("WXYZ-9876");
    expect(starts).toBe(2);
    // The token form is still one click away.
    await page.getByText("Use a personal access token instead").click();
    await expect(page.getByLabel("GitHub personal access token")).toBeVisible();
  });

  test("expired code: message and Try again", async ({ page }) => {
    await stubMe(page);
    await page.route("**/api/auth/device/start", (route) => route.fulfill({ json: START }));
    await page.route("**/api/auth/device/poll", (route) => route.fulfill({ json: { status: "expired" } }));
    await page.goto("/login");
    await page.getByRole("button", { name: "Sign in with GitHub" }).click();
    await expect(page.getByRole("alert")).toContainText("That code expired before GitHub saw it.");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  test("device pairing (?device=1) lands on /device after the poll says ok", async ({ page }) => {
    await stubMe(page);
    await page.route("**/api/auth/device/start", (route) => route.fulfill({ json: START }));
    await page.route("**/api/auth/device/poll", async (route) => {
      await page.unroute("**/api/me");
      await route.fulfill({
        json: { status: "ok", login: USER, welcome: false },
        headers: { "Set-Cookie": sessionCookieHeader() },
      });
    });
    await page.goto("/login?device=1&name=Pixel");
    await page.getByRole("button", { name: "Sign in with GitHub" }).click();
    await page.waitForURL(/\/device\?name=Pixel/, { timeout: 15_000 });
  });
});
