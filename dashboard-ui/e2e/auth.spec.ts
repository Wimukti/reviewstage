import { expect, request as pwRequest, test } from "@playwright/test";
import { DEVICES_USER, PORT, sessionCookie } from "./fixture";

const BASE = `http://127.0.0.1:${PORT}`;

// Sign-in surface. The fixture has no GH_CLIENT_ID, so the real /api/me reports oauth:false;
// the OAuth variant is exercised by rewriting that one response.
test.describe("login page", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("with OAuth configured: Continue with GitHub is primary, the token form is behind a disclosure", async ({ page }) => {
    await page.route("**/api/me", async (route) => {
      const r = await route.fetch();
      const body = await r.json();
      await route.fulfill({ response: r, json: { ...body, oauth: true, oauth_blocked: false } });
    });
    await page.goto("/login");
    await expect(page.getByText("Stage your review. Post it as yourself.")).toBeVisible();
    const gh = page.getByRole("link", { name: "Continue with GitHub" });
    await expect(gh).toBeVisible();
    await expect(gh).toHaveAttribute("href", "/oauth/start");
    const patInput = page.getByLabel("GitHub personal access token");
    await expect(patInput).toBeHidden();
    await page.getByText("Use a token instead").click();
    await expect(patInput).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in with token" })).toBeVisible();
  });

  test("redirect flow wins over device flow when both are configured", async ({ page }) => {
    await page.route("**/api/me", async (route) => {
      const r = await route.fetch();
      await route.fulfill({ response: r, json: { ...(await r.json()), oauth: true, device_flow: true } });
    });
    await page.goto("/login");
    await expect(page.getByRole("link", { name: "Continue with GitHub" })).toHaveAttribute("href", "/oauth/start");
    await expect(page.getByRole("button", { name: "Continue with GitHub" })).toHaveCount(0);
  });

  test("device pairing carries ?device=1 into the OAuth start link", async ({ page }) => {
    await page.route("**/api/me", async (route) => {
      const r = await route.fetch();
      await route.fulfill({ response: r, json: { ...(await r.json()), oauth: true } });
    });
    await page.goto("/login?device=1&name=Pixel");
    const href = await page.getByRole("link", { name: "Continue with GitHub" }).getAttribute("href");
    expect(href).toBe(`/oauth/start?next=${encodeURIComponent("/device?name=Pixel")}`);
  });

  test("with both flows off: the token form is the sign-in and team setup is one docs link", async ({ page }) => {
    // The fixture runs with GH_DEVICE_FLOW=0 and no GH_CLIENT_ID, so this is the real /api/me.
    await page.goto("/login");
    await expect(page.getByLabel("GitHub personal access token")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in with token" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Continue with GitHub" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Continue with GitHub" })).toHaveCount(0);
    // No server-setup paragraph and no environment-variable names on the screen: one link.
    await expect(page.getByText("Running this server?")).toHaveCount(0);
    await expect(page.locator(".authcard").getByText(/GH_[A-Z_]+/)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Setting up sign-in for a team" })).toHaveAttribute(
      "href",
      "https://wimukti.github.io/reviewstage/start/team-mode/",
    );
  });
});

// Settings → Devices: mint, list, use as a bearer, revoke, and the bearer then gets 401.
test.describe("devices", () => {
  // Both tests mutate the fixture user's device list.
  test.describe.configure({ mode: "serial" });
  // Their own user: "Sign out everywhere" bumps that user's credential epoch, which now
  // invalidates their session cookies as well as their device tokens. Run as the shared
  // fixture user and it would sign every other test out mid-run.
  test.use({ storageState: { cookies: [sessionCookie(DEVICES_USER)], origins: [] } });

  test("mints a token that authenticates /api/me until it is revoked", async ({ page }) => {
    await page.goto("/settings");
    const card = page.locator("#devices");
    await expect(card.getByRole("heading", { name: "Devices" })).toBeVisible();

    const name = `e2e ${Date.now()}`;
    await card.getByLabel("New device name").fill(name);
    await card.getByRole("button", { name: "Create a token for the CLI/mobile" }).click();
    const tokEl = card.getByTestId("device-token");
    await expect(tokEl).toBeVisible();
    const token = (await tokEl.textContent())!.trim();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(card.getByText(`Token for “${name}” — copy it now.`)).toBeVisible();
    const row = card.getByTestId("device-row").filter({ hasText: name });
    await expect(row).toBeVisible();

    // A cookie-less client holding only the bearer is the signed-in user.
    const api = await pwRequest.newContext({
      baseURL: BASE,
      storageState: { cookies: [], origins: [] }, // the project default would send the cookie
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
    const me = await api.get("/api/me");
    expect(me.status()).toBe(200);
    const meJson = await me.json();
    expect(meJson.authed).toBe(true);
    expect(meJson.auth).toBe("bearer");
    const list = await api.get("/api/devices");
    expect(list.status()).toBe(200);
    const mine = (await list.json()).devices.find((d: { name: string }) => d.name === name);
    expect(mine.current).toBe(true);
    // ... but may not mint another bearer.
    const mint = await api.post("/api/device-token", { data: { name: "nope" } });
    expect(mint.status()).toBe(403);

    // Revoke from the card; the same bearer is now refused.
    await row.getByRole("button", { name: `Revoke ${name}` }).click();
    await expect(row).toHaveCount(0);
    const after = await api.get("/api/me");
    expect(after.status()).toBe(200); // /api/me answers unauthenticated rather than 401
    expect((await after.json()).authed).toBe(false);
    const queue = await api.get("/api/queue?tab=reviewed&sort=newest");
    expect(queue.status()).toBe(401);
    await api.dispose();
  });

  test("sign out everywhere clears every device", async ({ page }) => {
    await page.goto("/settings");
    const card = page.locator("#devices");
    await card.getByLabel("New device name").fill("all-1");
    await card.getByRole("button", { name: "Create a token for the CLI/mobile" }).click();
    await expect(card.getByTestId("device-token")).toBeVisible();
    await card.getByRole("button", { name: "I have saved it" }).click();
    await expect(card.getByTestId("device-row").filter({ hasText: "all-1" })).toBeVisible();
    page.once("dialog", (d) => d.accept());
    await card.getByRole("button", { name: "Sign out everywhere" }).click();
    await expect(card.getByText("No devices yet.")).toBeVisible();
  });
});
