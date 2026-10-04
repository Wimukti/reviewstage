// Lane S1 screenshots (rebuild-on-a-system): the queue, its empty state, the command palette and
// the More sheet (the account menu on the desktop), in both themes at 1440 and 390, against a
// server already running on RS_E2E_PORT with the fixture built. Usage:
//   RS_E2E_PORT=8961 OUT=../openspec/changes/rebuild-on-a-system/after/s1 node --import tsx e2e/shots-s1.ts
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { PORT, sessionCookie } from "./fixture";

const OUT = process.env.OUT || "shots";
mkdirSync(OUT, { recursive: true });
const BASE = `http://127.0.0.1:${PORT}`;
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

// GitHub avatars are fetched by the browser from github.com; the proof set must not depend on
// the network, so every avatar is answered with a flat tile in the login's hue.
const AVATAR_SVG = (seed: string) => {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="hsl(${h} 45% 55%)"/><circle cx="32" cy="26" r="11" fill="rgba(255,255,255,.85)"/><ellipse cx="32" cy="52" rx="18" ry="11" fill="rgba(255,255,255,.85)"/></svg>`;
};

const browser = await chromium.launch();

async function ctx(theme: "dark" | "light", vp: { width: number; height: number }) {
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
  await c.route(/https:\/\/github\.com\/([^/]+)\.png/, (route) => {
    const login = route.request().url().match(/github\.com\/([^/.]+)\.png/)?.[1] || "";
    return route.fulfill({ contentType: "image/svg+xml", body: AVATAR_SVG(login) });
  });
  await c.addCookies([sessionCookie()]);
  return c;
}

async function shot(c: BrowserContext, path: string, out: string, before?: (p: Page) => Promise<void>) {
  const page = await c.newPage();
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.getByTestId("page-header").waitFor();
  await page.waitForTimeout(400);
  if (before) await before(page);
  await page.waitForTimeout(300);
  const file = join(OUT, out);
  await page.screenshot({ path: file, fullPage: false });
  console.log("wrote", file);
  await page.close();
}

for (const theme of ["dark", "light"] as const) {
  for (const [label, vp] of [
    ["desktop", DESKTOP],
    ["phone", PHONE],
  ] as const) {
    const c = await ctx(theme, vp);
    await shot(c, "/?tab=reviewed", `queue-${theme}-${label}.png`);
    await shot(c, "/?tab=approved", `queue-empty-${theme}-${label}.png`);
    await shot(c, "/?tab=reviewed", `palette-${theme}-${label}.png`, async (p) => {
      await p.keyboard.press("ControlOrMeta+k");
      await p.getByRole("dialog", { name: "Command palette" }).waitFor();
      await p.getByRole("option").first().waitFor();
    });
    await shot(c, "/?tab=reviewed", `more-sheet-${theme}-${label}.png`, async (p) => {
      if (vp.width < 900) {
        await p.getByTestId("more-tab").click();
        await p.getByTestId("more-sheet").waitFor();
      } else {
        await p.getByTestId("account-card").click();
        await p.getByTestId("account-menu").waitFor();
      }
    });
    await c.close();
  }
}
await browser.close();
