// Lane A screenshots (phone-pairing-and-ease): the desktop phone window with a pair code,
// driven from desktop/pages/phone.html with fake data, and /repos at 1440 and 390, dark,
// against the personal fixture. Usage, from dashboard-ui/:
//   RS_E2E_PORT=8991 OUT=../openspec/changes/phone-pairing-and-ease/after/a node --import tsx e2e/shots-ease-a.ts
import { chromium } from "@playwright/test";
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

// The desktop package's own qrcode, so the code in the shot is the one the app would draw.
const require = createRequire(resolve(HERE, "..", "..", "desktop", "package.json"));
const QRCode = require("qrcode") as { toDataURL(text: string, opts: object): Promise<string> };

const browser = await chromium.launch();

// --- the phone window -------------------------------------------------------------------------
{
  const url = "https://headline-attach-along-referred.trycloudflare.com";
  const pairUrl = `${url}/pair/9kQe3VbT2mX7Lr0wZcY1uHsN8pAfD4gJ6iKoB5vRtEq`;
  const dataUrl = await QRCode.toDataURL(pairUrl, { margin: 1, width: 280, color: { dark: "#ECEEF3", light: "#0B0C10" } });
  const exp = Math.floor(Date.now() / 1000) + 30 * 60;
  const ctx = await browser.newContext({ viewport: { width: 440, height: 664 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
  // A string, not a function: tsx's keep-names would inject a `__name` helper the page lacks.
  await ctx.addInitScript({
    content: "window.reviewstage = { phone: { onData: (fn) => { window.__push = fn; }, disable() {}, enable() {}, status: async () => ({ enabled: true }) } };",
  });
  const page = await ctx.newPage();
  await page.goto("file://" + resolve(HERE, "..", "..", "desktop", "pages", "phone.html"));
  await page.evaluate((p) => (window as unknown as { __push: (p: unknown) => void }).__push(p), {
    url, dataUrl, warning: null, check: "ok", pair: { login: PERSONAL_USER, exp },
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, "phone-window-pair-code.png") });
  console.log("wrote", join(OUT, "phone-window-pair-code.png"));
  // Signed out on the Mac: the plain address, and the line says so.
  const plain = await QRCode.toDataURL(url, { margin: 1, width: 280, color: { dark: "#ECEEF3", light: "#0B0C10" } });
  await page.evaluate((p) => (window as unknown as { __push: (p: unknown) => void }).__push(p), { url, dataUrl: plain, pair: null });
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(OUT, "phone-window-signed-out.png") });
  console.log("wrote", join(OUT, "phone-window-signed-out.png"));
  // The tunnel gave up: the window says why.
  await page.evaluate((p) => (window as unknown as { __push: (p: unknown) => void }).__push(p), {
    stopped: "Phone access turned itself off: cloudflared exited (SIGKILL) again within 5 minutes of being restarted. Links point at this computer again.",
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(OUT, "phone-window-stopped.png") });
  console.log("wrote", join(OUT, "phone-window-stopped.png"));
  await ctx.close();
}

// --- /repos -----------------------------------------------------------------------------------
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
// Two repositories already watched, as after the wizard.
const cookie = sessionCookie(PERSONAL_USER);
await fetch(`${PERSONAL_ORIGIN}/api/repos`, {
  method: "POST", headers: { "Content-Type": "application/json", Cookie: `${cookie.name}=${cookie.value}` },
  body: JSON.stringify({ repos: ["acme-solo/widgets", "acme/api"] }),
});

for (const [vp, tag] of [[{ width: 1440, height: 900 }, "1440"], [{ width: 390, height: 844 }, "390"]] as const) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: vp.width < 900, hasTouch: vp.width < 900, deviceScaleFactor: 1, reducedMotion: "reduce" });
  await ctx.addInitScript(() => localStorage.removeItem("rs-theme"));
  await ctx.route("https://avatars.example.test/**", (r) => r.fulfill({ status: 200, contentType: "image/png", body: PIXEL }));
  await ctx.addCookies([cookie]);
  const page = await ctx.newPage();
  await page.goto(`${PERSONAL_ORIGIN}/repos`, { waitUntil: "networkidle" });
  await page.getByTestId("repo-row").first().waitFor();
  await page.waitForTimeout(400);
  const file = join(OUT, `repos-dark-${tag}.png`);
  await page.screenshot({ path: file });
  console.log("wrote", file);
  if (tag === "1440") {
    await page.getByTestId("account-card").click();
    await page.getByTestId("account-menu").waitFor();
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(OUT, "account-menu-switch-dark-1440.png") });
    console.log("wrote", join(OUT, "account-menu-switch-dark-1440.png"));
    await page.keyboard.press("Escape");
  } else {
    await page.getByTestId("more-tab").click();
    await page.getByTestId("more-sheet").waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, "more-sheet-dark-390.png") });
    console.log("wrote", join(OUT, "more-sheet-dark-390.png"));
  }
  await ctx.close();
}
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  await ctx.addInitScript(() => localStorage.removeItem("rs-theme"));
  await ctx.addCookies([cookie]);
  const page = await ctx.newPage();
  await page.goto(`${PERSONAL_ORIGIN}/settings`, { waitUntil: "networkidle" });
  await page.getByTestId("repos-card").waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, "settings-repos-card-dark-1440.png") });
  console.log("wrote", join(OUT, "settings-repos-card-dark-1440.png"));
  await ctx.close();
  const out = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, reducedMotion: "reduce" });
  await out.addInitScript(() => localStorage.removeItem("rs-theme"));
  const p2 = await out.newPage();
  await p2.goto(`${PERSONAL_ORIGIN}/login?paired=expired`, { waitUntil: "networkidle" });
  await p2.getByTestId("paired-expired").waitFor();
  await p2.waitForTimeout(300);
  await p2.screenshot({ path: join(OUT, "login-paired-expired-dark-390.png") });
  console.log("wrote", join(OUT, "login-paired-expired-dark-390.png"));
  await out.close();
}

await browser.close();
server.kill("SIGTERM");
