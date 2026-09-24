// Lane A1 screenshots (stage-light design review): the login card, the queue inside the shell at
// 1440 and 390, and the phone More sheet, in both themes, against a server already running on
// RS_E2E_PORT with the fixture built. Usage:
//   RS_E2E_PORT=8972 OUT=../openspec/changes/stage-light/after/a1 node --import tsx e2e/shots-shell.ts
import { chromium, type BrowserContext } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { PORT, sessionCookie } from "./fixture";

const OUT = process.env.OUT || "shots";
mkdirSync(OUT, { recursive: true });
const BASE = `http://127.0.0.1:${PORT}`;
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

const browser = await chromium.launch();

async function ctx(theme: "dark" | "light", vp: { width: number; height: number }, signedIn: boolean) {
  const c = await browser.newContext({
    viewport: vp,
    isMobile: vp.width < 900,
    hasTouch: vp.width < 900,
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  // The theme is a stored per-device choice; dark is what nothing-stored means.
  await c.addInitScript((t) => {
    if (t === "light") localStorage.setItem("rs-theme", "light");
    else localStorage.removeItem("rs-theme");
  }, theme);
  if (signedIn) await c.addCookies([sessionCookie()]);
  return c;
}

async function shot(c: BrowserContext, path: string, out: string, before?: (p: import("@playwright/test").Page) => Promise<void>) {
  const page = await c.newPage();
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  if (before) await before(page);
  await page.waitForTimeout(250);
  const file = join(OUT, out);
  await page.screenshot({ path: file, fullPage: false });
  console.log("wrote", file);
  await page.close();
}

for (const theme of ["dark", "light"] as const) {
  // Login, signed out, with GitHub sign-in on so the primary is Continue with GitHub.
  const out = await ctx(theme, DESKTOP, false);
  await out.route("**/api/me", async (route) => {
    const r = await route.fetch();
    await route.fulfill({ response: r, json: { ...(await r.json()), oauth: true, oauth_blocked: false } });
  });
  await shot(out, "/login", `login-${theme}.png`);
  await out.close();

  const desk = await ctx(theme, DESKTOP, true);
  await shot(desk, "/?tab=reviewed", `queue-shell-${theme}.png`);
  await desk.close();

  const phone = await ctx(theme, PHONE, true);
  await shot(phone, "/?tab=reviewed", `queue-shell-phone-${theme}.png`);
  await shot(phone, "/?tab=reviewed", `more-sheet-${theme}.png`, async (p) => {
    await p.getByTestId("more-tab").click();
    await p.getByTestId("more-sheet").waitFor();
  });
  await phone.close();
}
await browser.close();
