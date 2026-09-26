// Screenshots for the stage-light review (design.md §9, lane A2): the PR page at rest, with the
// stage lit after a re-tick, and posted; the queue and its empty state. Both themes, 1440 and
// 390, against a server already running on RS_E2E_PORT with the fixture built.
//   RS_E2E_PORT=8973 OUT=../openspec/changes/stage-light/after/a2 node --import tsx e2e/shots-a2.ts
import { chromium, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { PORT, PR, REPO, sessionCookie } from "./fixture";

const OUT = process.env.OUT || "shots";
mkdirSync(OUT, { recursive: true });
const enc = (r: string) => encodeURIComponent(r);
const settled = async (page: Page) =>
  page.locator(".muted", { hasText: /^Loading…$/ }).waitFor({ state: "detached", timeout: 15_000 }).catch(() => {});

type Shot = { name: string; path: string; prep?: (page: Page) => Promise<void> };
const SHOTS: Shot[] = [
  { name: "pr", path: `/pr?repo=${enc(REPO)}&pr=${PR}` },
  {
    // Untick both, tick one back: the head light returns on that card, the count rolls to 1 and
    // the post button is lit.
    name: "pr-staged-glow",
    path: `/pr?repo=${enc(REPO)}&pr=${PR}`,
    prep: async (page) => {
      const sel = page.locator(".finding input.fsel");
      await sel.nth(0).uncheck();
      await sel.nth(1).uncheck();
      await sel.nth(0).check();
      await page.waitForTimeout(500);
    },
  },
  {
    name: "pr-posted",
    path: `/pr?repo=${enc(REPO)}&pr=${PR}`,
    prep: async (page) => {
      await page.route("**/api/post", (route) =>
        route.fulfill({
          json: {
            bannerHtml:
              "<div class='banner warn'><span class='status is-amber' aria-hidden='true'><i></i></span>" +
              "<div><b>DRY RUN — nothing was sent to GitHub.</b><br>Your review would post as " +
              "<code>COMMENT</code> — 1 inline comment, 1 in the summary.</div></div>",
          },
        }),
      );
      await page.getByTestId("commit-bar").getByRole("button", { name: /post selected/i }).click();
      await page.getByTestId("commit-posted").waitFor();
    },
  },
  { name: "queue", path: "/?tab=reviewed" },
  { name: "queue-empty", path: "/?tab=approved" },
];

const browser = await chromium.launch();
for (const theme of ["dark", "light"] as const) {
  for (const [w, h, label] of [[1440, 900, "desktop"], [390, 844, "phone"]] as const) {
    const ctx = await browser.newContext({
      colorScheme: theme,
      viewport: { width: w, height: h },
      isMobile: w < 900,
      hasTouch: w < 900,
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
    });
    await ctx.addCookies([sessionCookie()]);
    // The app defaults to dark whatever the system says; light is the stored choice.
    await ctx.addInitScript((t) => {
      if (t === "light") localStorage.setItem("rs-theme", "light");
      else localStorage.removeItem("rs-theme");
    }, theme);
    for (const s of SHOTS) {
      const page = await ctx.newPage();
      await page.goto(`http://127.0.0.1:${PORT}${s.path}`, { waitUntil: "networkidle" });
      await settled(page);
      if (s.prep) await s.prep(page);
      await page.waitForTimeout(400);
      // Grow the viewport to the page so sticky and fixed elements sit where a reader scrolled
      // to the end would find them, instead of being stamped mid-page by the capture.
      const full = await page.evaluate(() => document.documentElement.scrollHeight);
      await page.setViewportSize({ width: w, height: Math.min(Math.max(h, full), 6000) });
      await page.waitForTimeout(200);
      const out = join(OUT, `${s.name}-${theme}-${label}.png`);
      await page.screenshot({ path: out, fullPage: true });
      console.log("wrote", out);
      await page.close();
    }
    await ctx.close();
  }
}
await browser.close();
