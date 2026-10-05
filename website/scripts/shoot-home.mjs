// Screenshots of the home page for review: the whole page and each section, at 1440 and 390,
// dark and light, into openspec/changes/landing-v2/after/ (or the dir given). Serves dist/
// through `astro preview` on its own port, so run `pnpm build` first.
// Usage: node scripts/shoot-home.mjs [outDir]
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const outDir = resolve(process.argv[2] ?? "../openspec/changes/landing-v2/after");
mkdirSync(outDir, { recursive: true });
const PORT = Number(process.env.RS_SHOOT_PORT || 4879), BASE = `http://127.0.0.1:${PORT}`;
const sections = ["hero", "why", "how-it-works", "features", "gate", "compare", "install", "faq", "final"];

const busy = await fetch(BASE + "/").then((r) => r.ok, () => false);
if (busy) { console.error(`port ${PORT} already answers; stop the old preview first`); process.exit(2); }
const server = spawn(resolve("node_modules/.bin/astro"), ["preview", "--port", String(PORT), "--host", "127.0.0.1"], { stdio: "ignore" });
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + "/")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
  const browser = await chromium.launch();
  for (const scheme of ["dark", "light"]) {
    for (const [w, label] of [[1440, "1440"], [390, "390"]]) {
      // Reduced motion: the hero shows its poster, so every shot is deterministic.
      const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: w, height: w === 390 ? 844 : 900 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
      const page = await ctx.newPage();
      await page.goto(BASE + "/", { waitUntil: "load" });
      await page.evaluate((t) => localStorage.setItem("starlight-theme", t), scheme);
      await page.reload({ waitUntil: "load" });
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(outDir, `fold-${scheme}-${label}.png`) });
      await page.screenshot({ path: join(outDir, `page-${scheme}-${label}.png`), fullPage: true });
      // The sticky bar would sit over every section shot; take it out of the flow for those.
      await page.addStyleTag({ content: ".site-header { position: static !important; } .skip-link { display: none !important; }" });
      for (const s of sections) {
        const el = s === "hero" ? page.locator("section.hero") : s === "final" ? page.locator("section.final") : page.locator(`#${s}`);
        await el.screenshot({ path: join(outDir, `${s}-${scheme}-${label}.png`) });
      }
      await ctx.close();
    }
  }
  await browser.close();
  console.log(`screenshots in ${outDir}`);
} finally {
  server.kill();
}
