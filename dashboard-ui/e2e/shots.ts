// Screenshots of the lane Q pages in both themes at 1440 and 390, for the redesign's proof set.
// Needs the e2e server up (playwright's webServer command, or `pnpm test:browser` once).
//   node --import tsx e2e/shots.ts [outdir]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ORIGIN, PR3, REPO2, sessionCookie } from "./fixture";

const out = process.argv[2] || join(process.cwd(), "..", "openspec/changes/one-identity-redesign/after/pages");
mkdirSync(out, { recursive: true });

type Shot = { name: string; path: string; prep?: (page: import("@playwright/test").Page) => Promise<void> };
const SHOTS: Shot[] = [
  { name: "queue", path: "/?tab=reviewed" },
  {
    name: "queue-filtered",
    path: "/?tab=reviewed",
    prep: async (page) => {
      await page.locator("#qsearch").fill("rate-limit");
      await page.waitForResponse((r) => r.url().includes("q=rate-limit"));
    },
  },
  { name: "queue-empty", path: "/?tab=approved" },
  { name: "qa", path: "/qa" },
  { name: "qa-none", path: `/qa?repo=${encodeURIComponent(REPO2)}&pr=${PR3}` },
  { name: "learnings", path: "/learnings" },
];

const browser = await chromium.launch();
for (const theme of ["light", "dark"] as const) {
  for (const [label, viewport, mobile] of [
    ["desktop", { width: 1440, height: 900 }, false],
    ["phone", { width: 390, height: 844 }, true],
  ] as const) {
    const ctx = await browser.newContext({
      colorScheme: theme,
      viewport,
      isMobile: mobile,
      hasTouch: mobile,
      deviceScaleFactor: 1,
    });
    await ctx.addCookies([sessionCookie()]);
    for (const s of SHOTS) {
      const page = await ctx.newPage();
      await page.goto(ORIGIN + s.path, { waitUntil: "networkidle" });
      await page.locator(".muted", { hasText: /^Loading…$/ }).waitFor({ state: "detached", timeout: 15_000 }).catch(() => {});
      if (s.prep) await s.prep(page);
      await page.waitForTimeout(400);
      const file = join(out, `${s.name}-${theme}-${label}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log("wrote", file);
      await page.close();
    }
    await ctx.close();
  }
}
await browser.close();
