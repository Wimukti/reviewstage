// shell-polish screenshots: Settings with the phone card off and on (QR via a fake bridge, as
// phone-access.spec.ts drives it), the account menu, Settings → Appearance and the Queue "?"
// popover; 1440 and 390, dark, against the personal fixture. Usage, from dashboard-ui/:
//   RS_E2E_PORT=8993 RS_E2E_PERSONAL_PORT=8997 OUT=../openspec/changes/shell-polish/after node --import tsx e2e/shots-shell-polish.ts
import { chromium, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sessionCookie } from "./fixture";
import { buildPersonalFixture, PERSONAL_FIXTURE, PERSONAL_ORIGIN, PERSONAL_PORT, PERSONAL_USER } from "./personal-fixture";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT || "shots";
mkdirSync(OUT, { recursive: true });
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

const require = createRequire(resolve(HERE, "..", "..", "desktop", "package.json"));
const QRCode = require("qrcode") as { toDataURL(text: string, opts: object): Promise<string> };
const URL = "https://headline-attach-along-referred.trycloudflare.com";
const dataUrl = await QRCode.toDataURL(`${URL}/pair/9kQe3VbT2mX7Lr0wZcY1uHsN8pAfD4gJ6iKoB5vRtEq`, { margin: 1, width: 280, color: { dark: "#ECEEF3", light: "#0B0C10" } });
// A string, not a function: tsx's keep-names would inject a `__name` helper the page lacks.
const BRIDGE = `
  window.reviewstage = { phone: {
    _on: false,
    onData(fn) { window.__phonePush = fn; },
    async status() { return { enabled: this._on, url: this._on ? ${JSON.stringify(URL)} : null }; },
    async enable() {
      this._on = true;
      const exp = Math.floor(Date.now() / 1000) + 30 * 60;
      setTimeout(() => window.__phonePush({ url: ${JSON.stringify(URL)}, dataUrl: ${JSON.stringify(dataUrl)}, pair: { login: ${JSON.stringify(PERSONAL_USER)}, exp }, warning: null, check: "ok" }), 30);
      return { enabled: true, url: ${JSON.stringify(URL)}, warning: null };
    },
    async disable() { this._on = false; return { enabled: false, url: null }; },
  } };
`;

buildPersonalFixture();
const server = spawn("python3", ["../bin/server.py"], {
  env: { ...process.env, ROOT: PERSONAL_FIXTURE, RS_SPA: "1", RS_PORT: String(PERSONAL_PORT), RS_COOKIE_SECURE: "0", PATH: `${PERSONAL_FIXTURE}/fakebin:${process.env.PATH || ""}` },
  stdio: "ignore",
});
for (let i = 0; i < 150; i++) {
  try {
    if ((await (await fetch(`${PERSONAL_ORIGIN}/health`)).text()).trim() === "ok") break;
  } catch { /* not yet */ }
  await new Promise((r) => setTimeout(r, 200));
}
const cookie = sessionCookie(PERSONAL_USER);
await fetch(`${PERSONAL_ORIGIN}/api/repos`, {
  method: "POST", headers: { "Content-Type": "application/json", Cookie: `${cookie.name}=${cookie.value}` },
  body: JSON.stringify({ repos: ["acme-solo/widgets", "acme/api"] }),
});

const browser = await chromium.launch();
const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(250);
  const file = join(OUT, name);
  await page.screenshot({ path: file });
  console.log("wrote", file);
};

for (const [vp, tag] of [[{ width: 1440, height: 900 }, "1440"], [{ width: 390, height: 844 }, "390"]] as const) {
  const phone = vp.width < 900;
  const ctx = await browser.newContext({ viewport: vp, isMobile: phone, hasTouch: phone, deviceScaleFactor: 1, reducedMotion: "reduce" });
  await ctx.addInitScript(() => localStorage.removeItem("rs-theme"));
  await ctx.addInitScript({ content: BRIDGE });
  await ctx.route("https://avatars.example.test/**", (r) => r.fulfill({ status: 200, contentType: "image/png", body: PIXEL }));
  await ctx.route("https://github.com/**", (r) => r.fulfill({ status: 200, contentType: "image/png", body: PIXEL }));
  await ctx.addCookies([cookie]);
  const page = await ctx.newPage();

  // Settings: the Your phone section off, then on with the code.
  await page.goto(`${PERSONAL_ORIGIN}/settings#phone`, { waitUntil: "networkidle" });
  await page.locator("#phone").waitFor();
  await shot(page, `settings-phone-off-dark-${tag}.png`);
  await page.getByRole("button", { name: "Enable phone access" }).click();
  await page.getByTestId("phone-qr").waitFor();
  await shot(page, `settings-phone-on-dark-${tag}.png`);
  // Appearance: the segmented theme control.
  await page.goto(`${PERSONAL_ORIGIN}/settings#appearance`, { waitUntil: "networkidle" });
  await page.getByTestId("theme-control").waitFor();
  await shot(page, `settings-appearance-dark-${tag}.png`);

  // The Queue "?" popover with the Help items.
  await page.goto(`${PERSONAL_ORIGIN}/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "About this page" }).click();
  await page.getByTestId("help-menu").waitFor();
  await shot(page, `queue-help-dark-${tag}.png`);
  await page.keyboard.press("Escape");

  // The account menu (desktop) / the More sheet (phone).
  if (!phone) {
    await page.getByTestId("account-card").click();
    await page.getByTestId("account-menu").waitFor();
    await shot(page, `account-menu-dark-${tag}.png`);
  } else {
    await page.getByTestId("more-tab").click();
    await page.getByTestId("more-sheet").waitFor();
    await shot(page, `more-sheet-dark-${tag}.png`);
  }
  await ctx.close();
}

await browser.close();
server.kill("SIGTERM");
