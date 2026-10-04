// shell-polish D1: phone access inside the app. The desktop preload exposes
// `window.reviewstage.phone`; a fake one is installed here with a STRING init script (tsx's
// function init scripts inject a `__name` helper the page lacks). The fake answers the way
// main.js does — enable() pushes the presentPhone payload on the "phone" channel — so the card
// is driven by the same data shape the real app sends. Personal mode is the desktop app's mode;
// the team fixture is patched to say so.
import { expect, test, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { patchMe, USER } from "./fixture";

const require = createRequire(import.meta.url); // qrcode is a dev dependency here, same version as the desktop package
const QRCode = require("qrcode") as { toDataURL(text: string, opts: object): Promise<string> };

const URL = "https://headline-attach-along-referred.trycloudflare.com";

async function fakeBridge(page: Page) {
  const dataUrl = await QRCode.toDataURL(`${URL}/pair/9kQe3VbT2mX7Lr0wZcY1uHsN8pAfD4gJ6iKoB5vRtEq`, { margin: 1, width: 280, color: { dark: "#ECEEF3", light: "#0B0C10" } });
  await page.addInitScript({
    content: `
      window.__phoneCalls = [];
      window.reviewstage = { phone: {
        _on: false,
        onData(fn) { window.__phonePush = fn; },
        async status() { window.__phoneCalls.push("status"); return { enabled: this._on, url: this._on ? ${JSON.stringify(URL)} : null }; },
        async enable() {
          window.__phoneCalls.push("enable");
          this._on = true;
          const exp = Math.floor(Date.now() / 1000) + 30 * 60;
          setTimeout(() => window.__phonePush({ url: ${JSON.stringify(URL)}, dataUrl: ${JSON.stringify(dataUrl)}, pair: { login: ${JSON.stringify(USER)}, exp }, warning: null, check: "checking" }), 30);
          return { enabled: true, url: ${JSON.stringify(URL)}, warning: null };
        },
        async disable() { window.__phoneCalls.push("disable"); this._on = false; return { enabled: false, url: null }; },
      } };
    `,
  });
}

const calls = (page: Page) => page.evaluate(() => (window as unknown as { __phoneCalls: string[] }).__phoneCalls);
const push = (page: Page, p: Record<string, unknown>) =>
  page.evaluate((d) => (window as unknown as { __phonePush: (p: unknown) => void }).__phonePush(d), p);

test.describe("phone access in Settings (desktop app)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("without the bridge — a browser — there is no card and no Phone item", async ({ page }) => {
    await patchMe(page, { personal: true });
    await page.goto("/settings");
    await expect(page.getByTestId("settings-form")).toBeVisible();
    await expect(page.getByTestId("phone-card")).toHaveCount(0);
    await expect(page.getByTestId("nav-setup").getByRole("link", { name: "Phone" })).toHaveCount(0);
  });

  test("in team mode the card stays hidden even with the bridge", async ({ page }) => {
    await fakeBridge(page);
    await page.goto("/settings");
    await expect(page.getByTestId("settings-form")).toBeVisible();
    await expect(page.getByTestId("phone-card")).toHaveCount(0);
    await expect(page.getByTestId("nav-setup").getByRole("link", { name: "Phone" })).toHaveCount(0);
  });

  test("the card is first, Enable shows the QR from onData, New code re-mints, Turn off hides it, and the sidebar dot follows status", async ({ page }) => {
    await fakeBridge(page);
    await patchMe(page, { personal: true });
    await page.goto("/settings");
    const card = page.getByTestId("phone-card");
    await expect(card).toBeVisible();
    await expect(page.getByTestId("settings-form").locator("> *").first()).toHaveAttribute("data-testid", "phone-card");
    await expect(card.getByRole("heading", { name: "Your phone" })).toBeVisible();
    await expect(card.getByTestId("phone-state")).toHaveText("Off");
    await expect(card.getByTestId("phone-code")).toHaveCount(0);
    const item = page.getByTestId("nav-setup").getByRole("link", { name: "Phone" });
    await expect(item).toHaveAttribute("href", "/settings#phone");
    await expect(page.getByTestId("phone-dot")).toHaveCount(0);
    expect(await calls(page)).toContain("status");

    await card.getByRole("button", { name: "Enable phone access" }).click();
    await expect(card.getByTestId("phone-qr")).toBeVisible();
    await expect(card.getByTestId("phone-qr")).toHaveAttribute("src", /^data:image\/png/);
    await expect(card.getByTestId("phone-state")).toContainText("On");
    await expect(card.getByTestId("phone-state")).toContainText(URL);
    await expect(card.getByTestId("phone-pair")).toHaveText(new RegExp(`^Scanning signs you in as ${USER}\\. Code valid until \\d`));
    await expect(card.getByTestId("phone-url")).toHaveText(URL);
    await expect(card.getByTestId("phone-check")).toHaveAttribute("data-state", "checking");
    await expect(card.getByTestId("phone-check")).toContainText(/checking that the address is reachable/i);
    await expect(card.locator("ol li")).toHaveText([
      /scan this with your phone's camera/i,
      /add to home screen/i,
      /settings → push → this device/i,
    ]);
    await expect(card.getByRole("button", { name: "Turn off" })).toBeVisible();
    await expect(card.getByRole("button", { name: "New code" })).toBeVisible();
    await expect(page.getByTestId("phone-dot")).toBeVisible();
    expect((await calls(page)).filter((c) => c === "enable")).toHaveLength(1);

    // The reachability check lands later, as a second event with only `check` in it.
    await push(page, { check: "ok" });
    await expect(card.getByTestId("phone-check")).toHaveAttribute("data-state", "ok");
    await expect(card.getByTestId("phone-check")).toHaveText("Reachable from the internet.");
    await expect(card.getByTestId("phone-qr")).toBeVisible(); // a partial payload keeps the code

    await card.getByRole("button", { name: "New code" }).click();
    await expect.poll(async () => (await calls(page)).filter((c) => c === "enable").length).toBe(2);
    await expect(card.getByTestId("phone-qr")).toBeVisible();

    await card.getByRole("button", { name: "Turn off" }).click();
    await expect(card.getByTestId("phone-state")).toHaveText("Off");
    await expect(card.getByTestId("phone-code")).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Enable phone access" })).toBeVisible();
    await expect(page.getByTestId("phone-dot")).toHaveCount(0);
    expect(await calls(page)).toContain("disable");
  });

  test("the tunnel giving up is said on the card and the code goes away", async ({ page }) => {
    await fakeBridge(page);
    await patchMe(page, { personal: true });
    await page.goto("/settings");
    const card = page.getByTestId("phone-card");
    await card.getByRole("button", { name: "Enable phone access" }).click();
    await expect(card.getByTestId("phone-qr")).toBeVisible();
    await push(page, { stopped: "Phone access turned itself off: cloudflared exited again. Links point at this computer again." });
    await expect(card.getByTestId("phone-error")).toContainText(/turned itself off/);
    await expect(card.getByTestId("phone-qr")).toHaveCount(0);
  });

  test("the sidebar's Phone item lands on the card and lights it", async ({ page }) => {
    await fakeBridge(page);
    await patchMe(page, { personal: true });
    await page.goto("/");
    await page.getByTestId("nav-setup").getByRole("link", { name: "Phone" }).click();
    await expect(page).toHaveURL(/\/settings#phone$/);
    const card = page.getByTestId("phone-card");
    await expect(card).toBeInViewport();
    await expect(card).toHaveClass(/ring-2/);
    await expect(page.getByTestId("nav-setup").getByRole("link", { name: "Phone" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("nav-setup").getByRole("link", { name: "Settings" })).not.toHaveAttribute("aria-current", "page");
  });
});
