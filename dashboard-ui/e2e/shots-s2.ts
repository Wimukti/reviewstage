// Lane S2 screenshots (rebuild-on-a-system): the PR page, its staged glow at the foot of the
// page, the posted state, the unknown-PR frame and the stack page, in both themes at 1440 and
// 390, against a server already running on RS_E2E_PORT with the fixture built. Usage:
//   RS_E2E_PORT=8966 OUT=../openspec/changes/rebuild-on-a-system/after/s2 node --import tsx e2e/shots-s2.ts
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { PORT, PR, PR3, REPO, REPO2, sessionCookie } from "./fixture";

const OUT = process.env.OUT || "shots";
mkdirSync(OUT, { recursive: true });
const BASE = `http://127.0.0.1:${PORT}`;
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const enc = (r: string) => encodeURIComponent(r);

// GitHub avatars are fetched by the browser from github.com; the proof set must not depend on
// the network, so every avatar is answered with a flat tile in the login's hue.
const AVATAR_SVG = (seed: string) => {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="hsl(${h} 45% 55%)"/><circle cx="32" cy="26" r="11" fill="rgba(255,255,255,.85)"/><ellipse cx="32" cy="52" rx="18" ry="11" fill="rgba(255,255,255,.85)"/></svg>`;
};

const DRY_RECEIPT =
  "<div class='banner warn'><span class='status is-amber' aria-hidden='true'><i></i></span>" +
  "<div><b>DRY RUN — nothing was sent to GitHub.</b><br>Your review would post as " +
  "<code>COMMENT</code> — 1 inline comment, 1 in the summary.</div></div>";

const browser = await chromium.launch();

async function ctx(theme: "dark" | "light", vp: { width: number; height: number }) {
  const c = await browser.newContext({
    viewport: vp,
    isMobile: vp.width < 900,
    hasTouch: vp.width < 900,
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
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

const pr = `/pr?repo=${enc(REPO)}&pr=${PR}`;
const pr3 = `/pr?repo=${enc(REPO2)}&pr=${PR3}`;
for (const theme of ["dark", "light"] as const) {
  for (const [label, vp] of [
    ["desktop", DESKTOP],
    ["phone", PHONE],
  ] as const) {
    const c = await ctx(theme, vp);
    await shot(c, pr, `pr-${theme}-${label}.png`, async (p) => {
      await p.locator(".finding").first().waitFor();
    });
    // The foot of the page: the Approve section open, the bar lit — hovering the first card so
    // its actions show on the desktop.
    await shot(c, pr3, `pr-staged-glow-${theme}-${label}.png`, async (p) => {
      await p.locator(".finding").first().waitFor();
      await p.getByTestId("sec-approve").click();
      await p.getByTestId("approve-panel").waitFor();
      await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await p.waitForTimeout(200);
      if (vp.width >= 900) await p.locator(".finding").first().hover();
    });
    await shot(c, pr, `pr-posted-${theme}-${label}.png`, async (p) => {
      await p.route("**/api/post", (route) => route.fulfill({ json: { bannerHtml: DRY_RECEIPT } }));
      await p.locator(".finding").first().waitFor();
      await p.getByTestId("commit-bar").locator("[data-post]").click();
      await p.getByTestId("commit-posted").waitFor();
    });
    await shot(c, `/pr?repo=${enc(REPO)}&pr=999999`, `pr-unknown-${theme}-${label}.png`, async (p) => {
      await p.getByTestId("pr-unknown").waitFor();
    });
    await shot(c, `/stack?repo=${enc(REPO)}&pr=${PR}`, `stack-${theme}-${label}.png`, async (p) => {
      await p.getByTestId("stack-row").first().waitFor();
    });
    await c.close();
  }
}
await browser.close();
