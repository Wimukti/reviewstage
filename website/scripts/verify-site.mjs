// Proof harness for the site: serves dist/ through `astro preview`, screenshots the home, the
// strip's Requested and Posted stops, the install and security pages, a guide and the docs
// sidebar in both themes at 1440 and 390, and asserts the contract — four sections under 400
// words, the hero island hydrated with the app's own staged finding, the strip's five stops on
// Radix tabs with arrow keys, the Requested stop rendering the queue's real row (a repo pill
// and an avatar, none of the legacy row classes), no sideways scroll at 390, the favicon and
// social assets, and a Lighthouse performance score of 90 or better on the home page.
// Usage: node scripts/verify-site.mjs [outDir]
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const outDir = resolve(process.argv[2] ?? "../openspec/changes/rebuild-on-a-system/after/s4");
mkdirSync(outDir, { recursive: true });
const PORT = Number(process.env.RS_SITE_PORT || 4877), BASE = `http://127.0.0.1:${PORT}/reviewstage`;
const PERF_MIN = Number(process.env.RS_SITE_PERF_MIN || 90);
// name → [path, kind]; "docs-sidebar" is the docs shell itself — on a phone that is the drawer.
const pages = {
  home: ["/", "home"],
  install: ["/start/install/", "page"],
  security: ["/security/", "page"],
  "docs-guide": ["/guides/reviewing/", "page"],
  "docs-sidebar": ["/start/", "sidebar"],
};
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); };

// Spawn the astro binary itself, not `pnpm exec astro`: killing the pnpm wrapper left the
// preview alive on the port, and the next run then verified whatever dist that orphan served.
// If something already answers on the port, refuse — astro would silently move to the next one.
const busy = await fetch(BASE + "/").then((r) => r.ok, () => false);
if (busy) { console.error(`port ${PORT} already answers — an old preview is still running; stop it first`); process.exit(2); }
const server = spawn(resolve("node_modules/.bin/astro"), ["preview", "--port", String(PORT), "--host", "127.0.0.1"], { stdio: "ignore" });
const wait = async () => { for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + "/")).ok) return; } catch {} await new Promise((r) => setTimeout(r, 500)); } throw new Error("preview did not start"); };

// GitHub avatars are fetched by the browser from github.com; the proof set must not depend on
// the network, so every avatar is answered with a flat tile.
const AVATAR_SVG = (seed) => {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="hsl(${h} 45% 55%)"/><circle cx="32" cy="26" r="11" fill="rgba(255,255,255,.85)"/><ellipse cx="32" cy="52" rx="18" ry="11" fill="rgba(255,255,255,.85)"/></svg>`;
};

// Lighthouse, through `pnpm dlx` so the site has no dependency on it, in the Chromium
// Playwright already installed (CHROME_PATH), headless. Performance only: the other categories
// are not this gate's. The run is the default mobile profile — throttled CPU and network —
// which is the harder of the two, so a pass here holds on a desktop too.
function lighthouse(url) {
  const out = join(tmpdir(), `rs-site-lh-${process.pid}.json`);
  const r = spawnSync(
    "pnpm",
    ["dlx", "lighthouse", url, "--quiet", "--only-categories=performance", "--output=json", `--output-path=${out}`, "--chrome-flags=--headless=new --no-sandbox"],
    { env: { ...process.env, CHROME_PATH: process.env.CHROME_PATH || chromium.executablePath() }, encoding: "utf8", timeout: 300_000 },
  );
  if (r.status !== 0) return { error: (r.stderr || r.stdout || `exit ${r.status}`).trim().split("\n").slice(-5).join(" | ") };
  const report = JSON.parse(readFileSync(out, "utf8"));
  rmSync(out, { force: true });
  const a = report.audits;
  const ms = (k) => Math.round(a[k]?.numericValue ?? 0);
  return {
    score: Math.round((report.categories.performance.score ?? 0) * 100),
    fcp: ms("first-contentful-paint"), lcp: ms("largest-contentful-paint"), tbt: ms("total-blocking-time"),
    cls: Number((a["cumulative-layout-shift"]?.numericValue ?? 0).toFixed(3)), si: ms("speed-index"),
  };
}

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
  // The legacy register is gone from the served markup: no hand-rolled button class, no legacy
  // queue-row classes (the islands are checked in the DOM below, shadow roots included).
  const legacy = html.match(/class="[^"]*\b(btn|row|rowlink|rowsub|repochip)\b[^"]*"/g) ?? [];
  check(legacy.length === 0, `served home HTML carries no legacy .btn/.row/.repochip class (${legacy.length})`);
  // The stage light's token stays where design §4 puts it: the hero's wrapper, in base.css only.
  const cssFiles = (await import("node:fs")).readdirSync("dist/_astro").filter((f) => f.endsWith(".css"));
  const lightUses = cssFiles.flatMap((f) => (readFileSync(join("dist/_astro", f), "utf8").match(/[^{}]*\{[^}]*var\(--light\)[^}]*\}/g) ?? []).map((m) => m.trim().slice(0, 60)));
  const offSite = lightUses.filter((m) => !/stage-hero|stage-login|finding\.is-staged|has-staged/.test(m));
  check(offSite.length === 0, `--light appears only in the stage-light selectors (${lightUses.length} rules, ${offSite.length} elsewhere)`);

  const browser = await chromium.launch();
  for (const scheme of ["light", "dark"]) {
    for (const [w, label] of [[1440, "desktop"], [390, "phone"]]) {
      const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: w, height: 900 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
      await ctx.route(/https:\/\/github\.com\/([^/]+)\.png/, (route) => {
        const login = route.request().url().match(/github\.com\/([^/.]+)\.png/)?.[1] || "";
        return route.fulfill({ contentType: "image/svg+xml", body: AVATAR_SVG(login) });
      });
      for (const [name, [path, kind]] of Object.entries(pages)) {
        const page = await ctx.newPage();
        await page.goto(BASE + path, { waitUntil: "load" });
        await page.evaluate((t) => { localStorage.setItem("starlight-theme", t); }, scheme);
        await page.reload({ waitUntil: "load" });
        await page.waitForTimeout(400);
        if (kind === "sidebar" && w === 390) {
          // The docs sidebar is a drawer on a phone: open it, then shoot the viewport.
          await page.locator("starlight-menu-button button").click();
          await page.waitForTimeout(300);
          await page.screenshot({ path: join(outDir, `${name}-${scheme}-${label}.png`) });
        } else {
          await page.screenshot({ path: join(outDir, `${name}-${scheme}-${label}.png`), fullPage: kind !== "sidebar" });
        }
        const { sw, iw, theme, resolved } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, theme: document.documentElement.dataset.theme, resolved: document.documentElement.dataset.resolved }));
        check(theme === scheme && resolved === scheme, `${name} ${label} rendered in ${scheme} (got ${theme}/${resolved})`);
        if (w === 390) check(sw <= iw, `${name} ${scheme} phone: scrollWidth ${sw} <= ${iw}`);
        if (kind === "home") {
          const small = await page.evaluate(() => [...document.querySelectorAll("a, button")].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 44) && getComputedStyle(el).visibility !== "hidden"; }).map((el) => `${el.tagName}.${el.className} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`));
          if (w === 390) console.log(`     targets under 44px on home phone: ${small.length ? small.join(" | ") : "none"}`);
          // The install command is the page's one conversion moment; it rendered as an empty
          // box once already (a containment collapse), so its width is asserted, not assumed.
          const cta = page.locator("#install [data-install] code");
          const ctaText = (await cta.textContent())?.trim() ?? "";
          const ctaBox = await cta.boundingBox();
          check(ctaText.startsWith("git clone") && ctaBox && ctaBox.width > 100, `${scheme} ${label}: install command renders (${Math.round(ctaBox?.width ?? 0)}px wide)`);
          const mono = await page.evaluate(() => [...document.querySelectorAll("main *")].filter((el) => el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && /Mono|monospace/i.test(getComputedStyle(el).fontFamily) && !el.closest("code, pre, kbd")).map((el) => el.tagName + "." + el.className));
          check(mono.length === 0, `${scheme} ${label}: monospace only inside code (${mono.length} stray: ${mono.slice(0, 3).join(", ")})`);

          // Four sections, and the page stays short enough to be read (design §9).
          const words = await page.evaluate(() => (document.querySelector("main")?.innerText ?? "").trim().split(/\s+/).filter(Boolean).length);
          check(words < 400, `${scheme} ${label}: home reads ${words} words (< 400)`);

          // The hero is the app itself, not a picture of it (design §7).
          const hero = page.locator(".stage-hero [data-stage-frame]").first();
          await hero.waitFor({ state: "attached" });
          const heroState = await hero.evaluate(async (el) => {
            for (let i = 0; i < 100 && !el.shadowRoot?.querySelector(".finding"); i++) await new Promise((r) => setTimeout(r, 100));
            const root = el.shadowRoot;
            return { shadow: !!root, staged: root?.querySelectorAll(".finding.is-staged").length ?? 0 };
          });
          check(heroState.shadow && heroState.staged >= 1, `${scheme} ${label}: hero island hydrated, ${heroState.staged} staged finding(s) in its shadow root`);

          // The strip is keyboard-operable, five stops on Radix tabs (design §"How it works").
          const tabs = page.locator('.strip [role="tab"]');
          const nTabs = await tabs.count();
          check(nTabs === 5, `${scheme} ${label}: how-it-works strip has ${nTabs} stops (5)`);
          if (nTabs === 5) {
            await tabs.first().focus();
            await page.keyboard.press("ArrowRight");
            await page.waitForTimeout(150);
            const firstId = await tabs.first().getAttribute("id");
            const selId = await page.locator('.strip [role="tab"][aria-selected="true"]').first().getAttribute("id");
            check(selId !== null && selId !== firstId, `${scheme} ${label}: arrow key moves the strip selection (${firstId} -> ${selId})`);
            // The Requested stop is the queue's real row: the app's RepoPill and UserAvatar, and
            // none of the legacy row classes, in the island's shadow root.
            await tabs.first().click();
            await page.waitForTimeout(400);
            const req = page.locator('.stage-panel[data-stop="requested"] [data-stage-frame]').first();
            const reqState = await req.evaluate(async (el) => {
              for (let i = 0; i < 100 && !el.shadowRoot?.querySelector('[data-testid="queue-row"]'); i++) await new Promise((r) => setTimeout(r, 100));
              const root = el.shadowRoot;
              return {
                pill: root?.querySelectorAll('[data-testid="repo-pill"]').length ?? 0,
                avatar: root?.querySelectorAll('[data-testid="user-avatar"]').length ?? 0,
                badge: root?.querySelectorAll('[data-testid="status-badge"][data-kind="new"]').length ?? 0,
              };
            });
            check(reqState.pill >= 1 && reqState.avatar >= 1 && reqState.badge >= 1, `${scheme} ${label}: Requested stop renders the queue row (${reqState.pill} repo-pill, ${reqState.avatar} user-avatar, ${reqState.badge} New badge)`);
            const strayRows = await page.evaluate(() => {
              const sel = ".row, .rowlink, .rowsub, .repochip, .btn";
              let n = document.querySelectorAll(sel).length;
              for (const host of document.querySelectorAll("[data-stage-frame]")) n += host.shadowRoot?.querySelectorAll(sel).length ?? 0;
              return n;
            });
            check(strayRows === 0, `${scheme} ${label}: no .row/.repochip/.btn in the home DOM or any island (${strayRows})`);
            const strip = page.locator("[data-how-it-works]");
            await strip.screenshot({ path: join(outDir, `home-strip-requested-${scheme}-${label}.png`) });
            await tabs.nth(3).click();
            await page.waitForTimeout(400);
            const posted = await page.locator('.stage-panel[data-stop="posted"] [data-stage-frame]').first().evaluate((el) => el.shadowRoot?.querySelectorAll('[data-testid="status-badge"][data-kind="posted"]').length ?? 0);
            check(posted >= 1, `${scheme} ${label}: Posted stop shows the posted badge (${posted})`);
            await strip.screenshot({ path: join(outDir, `home-strip-posted-${scheme}-${label}.png`) });
          }
        }
        await page.close();
      }
      await ctx.close();
    }
  }
  await browser.close();

  const lh = lighthouse(BASE + "/");
  if (lh.error) check(false, `lighthouse did not run: ${lh.error}`);
  else check(lh.score >= PERF_MIN, `lighthouse performance on / is ${lh.score} (>= ${PERF_MIN}) — FCP ${lh.fcp}ms, LCP ${lh.lcp}ms, TBT ${lh.tbt}ms, CLS ${lh.cls}, SI ${lh.si}ms`);

  console.log("\n<head> as served on the home page:\n" + head);
} finally {
  server.kill();
}
if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1); }
console.log(`\nall checks passed; screenshots in ${outDir}`);
