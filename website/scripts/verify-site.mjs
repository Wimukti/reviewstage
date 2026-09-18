// Proof harness for the redesign: serves dist/ through `astro preview`, screenshots the landing,
// install and security pages in both themes at 1440 and 390, asserts no sideways scroll at 390,
// asserts the live-run hero keeps one height across steps 1, 4 and 6, and checks the favicon
// and social assets are served. Usage: node scripts/verify-site.mjs [outDir]
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const outDir = resolve(process.argv[2] ?? "../openspec/changes/one-identity-redesign/after/site");
mkdirSync(outDir, { recursive: true });
const PORT = 4877, BASE = `http://127.0.0.1:${PORT}/reviewstage`;
const pages = { landing: "/", install: "/start/install/", security: "/security/" };
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); };

const server = spawn("pnpm", ["exec", "astro", "preview", "--port", String(PORT), "--host", "127.0.0.1"], { stdio: "ignore" });
const wait = async () => { for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + "/")).ok) return; } catch {} await new Promise((r) => setTimeout(r, 500)); } throw new Error("preview did not start"); };
try {
  await wait();
  for (const [path, type] of [["/favicon.ico", "image/vnd.microsoft.icon"], ["/favicon-192.png", "image/png"], ["/favicon-512.png", "image/png"], ["/apple-touch-icon.png", "image/png"], ["/og.png", "image/png"]]) {
    const r = await fetch(BASE + path);
    const ct = r.headers.get("content-type") ?? "";
    check(r.status === 200 && (ct.includes(type) || (path.endsWith(".ico") && /icon/.test(ct))), `${path} → ${r.status} ${ct}`);
  }
  const html = await (await fetch(BASE + "/")).text();
  const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>") + 7);
  for (const needle of ["<title>ReviewStage</title>", 'rel="icon" href="/reviewstage/favicon.ico"', 'rel="apple-touch-icon"', 'sizes="192x192"', 'sizes="512x512"', 'property="og:title"', 'property="og:description"', 'property="og:image"', 'property="og:url"', 'property="og:type"', 'name="twitter:card" content="summary_large_image"', 'name="twitter:image"', 'name="theme-color" media="(prefers-color-scheme: light)"', 'name="theme-color" media="(prefers-color-scheme: dark)"', 'name="description"']) {
    check(head.includes(needle), `head has ${needle}`);
  }
  const browser = await chromium.launch();
  for (const scheme of ["light", "dark"]) {
    for (const [w, label] of [[1440, "desktop"], [390, "phone"]]) {
      const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: w, height: 900 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
      for (const [name, path] of Object.entries(pages)) {
        const page = await ctx.newPage();
        await page.goto(BASE + path, { waitUntil: "load" });
        await page.evaluate((t) => { localStorage.setItem("starlight-theme", t); }, scheme);
        await page.reload({ waitUntil: "load" });
        await page.waitForTimeout(400);
        await page.screenshot({ path: join(outDir, `${name}-${scheme}-${label}.png`), fullPage: true });
        const { sw, iw, theme } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, theme: document.documentElement.dataset.theme }));
        check(theme === scheme, `${name} ${label} rendered in ${scheme} (got ${theme})`);
        if (w === 390) check(sw <= iw, `${name} ${scheme} phone: scrollWidth ${sw} <= ${iw}`);
        if (name === "landing") {
          const small = await page.evaluate(() => [...document.querySelectorAll("a, button")].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 44) && getComputedStyle(el).visibility !== "hidden"; }).map((el) => `${el.tagName}.${el.className} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`));
          if (w === 390) console.log(`     targets under 44px on landing phone: ${small.length ? small.join(" | ") : "none"}`);
          const cta = page.locator(".cta [data-install] code");
          const ctaText = (await cta.textContent())?.trim() ?? "";
          const ctaBox = await cta.boundingBox();
          check(ctaText.startsWith("git clone") && ctaBox && ctaBox.width > 100, `${scheme} ${label}: closing CTA install command renders (${Math.round(ctaBox?.width ?? 0)}px wide)`);
          await cta.scrollIntoViewIfNeeded();
          await page.screenshot({ path: join(outDir, `closing-cta-${scheme}-${label}.png`) });
          const heights = [];
          for (const s of [1, 4, 6]) {
            await page.locator(`[data-lr-step="${s}"]`).click();
            await page.waitForTimeout(150);
            heights.push(await page.locator(".lr").evaluate((el) => el.getBoundingClientRect().height));
          }
          check(new Set(heights.map((h) => Math.round(h))).size === 1, `${scheme} ${label}: hero height across steps 1/4/6 = ${heights.map((h) => Math.round(h)).join(", ")}`);
        }
        await page.close();
      }
      await ctx.close();
    }
  }
  await browser.close();
  console.log("\n<head> as served on the landing page:\n" + head);
} finally {
  server.kill();
}
if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1); }
console.log(`\nall checks passed; screenshots in ${outDir}`);
