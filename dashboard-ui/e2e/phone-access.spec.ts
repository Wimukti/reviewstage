// shell-polish D1: phone access inside the app. The desktop preload exposes
// `window.reviewstage.phone`; a fake one is installed here with a STRING init script (tsx's
// function init scripts inject a `__name` helper the page lacks). The fake answers the way
// main.js does — enable() pushes the presentPhone payload on the "phone" channel — so the
// section is driven by the same data shape the real app sends. Personal mode is the desktop
// app's mode; the team fixture is patched to say so. Phone access is reached through Settings
// only (settings-redesign E1): there is no Phone item in the sidebar.
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
  const sections = (page: Page) => page.getByRole("navigation", { name: "Settings sections" });

  test("without the bridge — a browser — there is no Your phone section and Settings opens on Appearance", async ({ page }) => {
    await patchMe(page, { personal: true });
    await page.goto("/settings");
    await expect(page.getByTestId("settings-form")).toBeVisible();
    await expect(page.locator("#phone")).toHaveCount(0);
    await expect(page.locator("#appearance")).toBeVisible();
    await expect(sections(page).getByRole("link", { name: "Your phone" })).toHaveCount(0);
    await expect(page.getByTestId("nav-setup").getByRole("link", { name: "Phone" })).toHaveCount(0);
    // A stale deep link falls back to the first section this install has.
    await page.goto("/settings#phone");
    await expect(page.locator("#appearance")).toBeVisible();
    await expect(page.locator("#phone")).toHaveCount(0);
  });

  test("in team mode the section stays hidden even with the bridge", async ({ page }) => {
    await fakeBridge(page);
    await page.goto("/settings");
    await expect(page.getByTestId("settings-form")).toBeVisible();
    await expect(page.locator("#phone")).toHaveCount(0);
    await expect(page.locator("#appearance")).toBeVisible();
    await expect(sections(page).getByRole("link", { name: "Your phone" })).toHaveCount(0);
    await expect(page.getByTestId("nav-setup").getByRole("link", { name: "Phone" })).toHaveCount(0);
  });

  test("Settings opens on Your phone, Enable shows the QR from onData, New code re-mints, Turn off hides it", async ({ page }) => {
    await fakeBridge(page);
    await patchMe(page, { personal: true });
    await page.goto("/settings");
    const card = page.locator("#phone");
    await expect(card).toBeVisible();
    await expect(page.getByTestId("settings-section")).toHaveCount(1);
    await expect(sections(page).getByRole("link", { name: "Your phone" })).toHaveAttribute("aria-current", "page");
    await expect(card.getByRole("heading", { name: "Your phone" })).toBeVisible();
    await expect(card.getByTestId("phone-state")).toHaveText("Off");
    await expect(card.getByTestId("phone-code")).toHaveCount(0);
    // No sidebar item, no dot: Settings is the only way in.
    await expect(page.getByTestId("nav-setup").getByRole("link", { name: "Phone" })).toHaveCount(0);
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
    expect((await calls(page)).filter((c) => c === "enable")).toHaveLength(1);
    // Phone access acts at once: nothing here makes the page dirty.
    await expect(page.getByTestId("settings-save")).toBeHidden();

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
    expect(await calls(page)).toContain("disable");
  });

  test("the tunnel giving up is said in the section and the code goes away", async ({ page }) => {
    await fakeBridge(page);
    await patchMe(page, { personal: true });
    await page.goto("/settings#phone");
    const card = page.locator("#phone");
    await card.getByRole("button", { name: "Enable phone access" }).click();
    await expect(card.getByTestId("phone-qr")).toBeVisible();
    await push(page, { stopped: "Phone access turned itself off: cloudflared exited again. Links point at this computer again." });
    await expect(card.getByTestId("phone-error")).toContainText(/turned itself off/);
    await expect(card.getByTestId("phone-qr")).toHaveCount(0);
  });

  test("/settings#phone opens the Your phone section, with Settings current in the sidebar", async ({ page }) => {
    await fakeBridge(page);
    await patchMe(page, { personal: true });
    await page.goto("/settings#appearance");
    await expect(page.locator("#appearance")).toBeVisible();
    await page.goto("/settings#phone");
    await expect(page).toHaveURL(/\/settings#phone$/);
    const card = page.locator("#phone");
    await expect(card).toBeVisible();
    await expect(card.getByRole("heading", { name: "Your phone" })).toBeInViewport();
    await expect(page.locator("#appearance")).toHaveCount(0);
    await expect(sections(page).getByRole("link", { name: "Your phone" })).toHaveAttribute("aria-current", "page");
    await expect(sections(page).getByRole("link", { name: "Appearance" })).not.toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("nav-setup").getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
    // And the section nav gets there too, by hash.
    await sections(page).getByRole("link", { name: "Appearance" }).click();
    await expect(page).toHaveURL(/\/settings#appearance$/);
    await expect(page.locator("#appearance")).toBeVisible();
    await sections(page).getByRole("link", { name: "Your phone" }).click();
    await expect(page).toHaveURL(/\/settings#phone$/);
    await expect(card).toBeVisible();
  });
});
