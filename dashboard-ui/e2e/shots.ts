// Screenshots for the design review (design.md §8): the PR page, the blocker PR and the stack
// page in both themes at 1440 and 390, against a server already running on RS_E2E_PORT with the
// fixture built. Usage: RS_E2E_PORT=8992 OUT=../openspec/changes/one-identity-redesign/after/pages \
//   node --import tsx e2e/shots.ts
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { PORT, PR, PR3, REPO, REPO2, sessionCookie } from "./fixture";

const OUT = process.env.OUT || "shots";
mkdirSync(OUT, { recursive: true });
const enc = (r: string) => encodeURIComponent(r);
const PAGES: [string, string][] = [
  ["pr", `/pr?repo=${enc(REPO)}&pr=${PR}`],
  ["pr3", `/pr?repo=${enc(REPO2)}&pr=${PR3}`],
  ["stack", `/stack?repo=${enc(REPO)}&pr=${PR}`],
];
const browser = await chromium.launch();
for (const scheme of ["light", "dark"] as const) {
  for (const [w, h, label] of [[1440, 900, "desktop"], [390, 844, "phone"]] as const) {
    const ctx = await browser.newContext({
      colorScheme: scheme,
      viewport: { width: w, height: h },
      isMobile: w < 900,
      hasTouch: w < 900,
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
    });
    await ctx.addCookies([sessionCookie()]);
    const page = await ctx.newPage();
    for (const [name, path] of PAGES) {
      await page.goto(`http://127.0.0.1:${PORT}${path}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(400);
      // Grow the viewport to the page so sticky and fixed elements sit where a reader scrolled
      // to the end would find them, instead of being stamped mid-page by the capture.
      const full = await page.evaluate(() => document.documentElement.scrollHeight);
      await page.setViewportSize({ width: w, height: Math.min(Math.max(h, full), 6000) });
      await page.waitForTimeout(200);
      const out = join(OUT, `${name}-${scheme}-${label}.png`);
      await page.screenshot({ path: out, fullPage: true });
      await page.setViewportSize({ width: w, height: h });
      console.log("wrote", out);
    }
    await ctx.close();
  }
}
await browser.close();
