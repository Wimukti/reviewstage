// Proof harness for the site: serves dist/ through `astro preview`, screenshots the home and a
// handful of docs pages in both themes at 1440 and 390, and asserts the contract of
// openspec/changes/landing-v2/design.md — the nine home sections with their headings, at most 900
// words, two equal contrast columns, four steps, six feature tiles, three gate snippets, a
// six-row comparison, six script-free FAQ disclosures, the hero command pill, the videos'
// preload rules and the hero above a 390x844 fold, the demo lightbox loading only on open, 44px
// tap targets and no sideways scroll at 390 (measured against visualViewport), the favicon and
// social assets, and a Lighthouse performance score of 95 or better on the home page. The
// discovery contract (openspec/changes/go-to-tool, lane seo-discovery): robots.txt names the
// sitemap, every sitemap entry carries <lastmod>, the SoftwareApplication JSON-LD is complete,
// the title and the one <h1> carry the category, and each docs page's <title> is its heading.
// Usage: node scripts/verify-site.mjs [outDir]
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const outDir = resolve(process.argv[2] ?? "../openspec/changes/landing-v2/after/verify");
mkdirSync(outDir, { recursive: true });
const PORT = Number(process.env.RS_SITE_PORT || 4877), BASE = `http://127.0.0.1:${PORT}`;
const PERF_MIN = Number(process.env.RS_SITE_PERF_MIN || 95);
// name → [path, kind]; "docs-sidebar" is the docs shell itself — on a phone that is the drawer.
const pages = {
  home: ["/", "home"],
  install: ["/start/install/", "page"],
  security: ["/security/", "page"],
  "docs-guide": ["/guides/reviewing/", "page"],
  "docs-sidebar": ["/start/", "sidebar"],
  "team-workflow": ["/guides/team-workflow/", "page"],
  faq: ["/operations/faq/", "page"],
};
// The command the home page shows is named once in src/content/install.ts; read it from there
// so this check cannot drift from the page (it did, when the install became `npx reviewstage`).
const installCommand = readFileSync("src/content/install.ts", "utf8").match(/installCommand = "([^"]+)"/)?.[1] ?? "npx reviewstage";
const CATEGORY = "human review layer";
const decode = (t) => t.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
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
  // The social preview is the launch kit's 1280x640 image (landing-v2), not the old generated card.
  const og = Buffer.from(await (await fetch(BASE + "/og.png")).arrayBuffer());
  const [ogW, ogH] = [og.readUInt32BE(16), og.readUInt32BE(20)];
  check(ogW === 1280 && ogH === 640, `/og.png is ${ogW}x${ogH} (1280x640)`);
  const html = await (await fetch(BASE + "/")).text();
  const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>") + 7);
  const desc = head.match(/name="description" content="([^"]*)"/)?.[1] ?? "";
  check(desc.length > 0 && desc.length <= 155, `meta description is ${desc.length} chars (<= 155)`);
  const title = head.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
  check(title.includes(CATEGORY), `<title> carries the category: "${title}"`);
  check(desc.includes(CATEGORY), `meta description carries the category`);
  // The structured data Google reads for a software result: it must parse, and the
  // SoftwareApplication node must carry the fields its rich-result guidance asks for.
  const ldRaw = head.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? "";
  let app = null;
  try { const ld = JSON.parse(ldRaw); app = (ld["@graph"] ?? [ld]).find((n) => n["@type"] === "SoftwareApplication") ?? null; } catch {}
  check(!!app, "JSON-LD parses and has a SoftwareApplication node");
  if (app) {
    const missing = [["name", app.name], ["offers.price", app.offers?.price], ["applicationCategory", app.applicationCategory], ["operatingSystem", app.operatingSystem], ["downloadUrl", app.downloadUrl], ["author", app.author?.name], ["softwareVersion", app.softwareVersion], ["video.embedUrl", app.video?.embedUrl]].filter(([, v]) => !v).map(([k]) => k);
    check(missing.length === 0, `SoftwareApplication has name, offers.price, applicationCategory, operatingSystem, downloadUrl, author, softwareVersion, video${missing.length ? " (missing: " + missing.join(", ") + ")" : ""}`);
    check(/^\d+\.\d+\.\d+/.test(app.softwareVersion ?? ""), `softwareVersion is a release number (${app.softwareVersion})`);
  }
  // robots.txt advertises the sitemap, and every entry in it says when the page last changed.
  const robots = await fetch(BASE + "/robots.txt");
  const robotsText = robots.ok ? await robots.text() : "";
  check(robots.status === 200 && /^Sitemap: https:\/\/reviewstage\.dev\/sitemap-index\.xml$/m.test(robotsText) && /^User-agent: \*$/m.test(robotsText), `/robots.txt → ${robots.status}, names the sitemap index`);
  const sitemap = await (await fetch(BASE + "/sitemap-0.xml")).text();
  const entries = [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => ({ loc: m[1].match(/<loc>([^<]+)</)?.[1] ?? "", lastmod: m[1].match(/<lastmod>([^<]+)</)?.[1] ?? "" }));
  const noDate = entries.filter((e) => !/^\d{4}-\d{2}-\d{2}T/.test(e.lastmod));
  check(entries.length >= 15 && noDate.length === 0, `sitemap-0.xml: ${entries.length} entries, every one with an ISO <lastmod>${noDate.length ? " (missing: " + noDate.map((e) => e.loc).join(", ") + ")" : ""}`);
  // Every docs page: <title> is its heading plus the site suffix, and the sidebar names it with
  // the heading itself or a deliberately shorter label (sidebar.label / the config's items).
  for (const e of entries) {
    const path = new URL(e.loc).pathname;
    if (path === "/") continue;
    const doc = await (await fetch(BASE + path)).text();
    const dt = decode(doc.match(/<title>([^<]*)<\/title>/)?.[1] ?? "");
    const h1 = decode(doc.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "");
    const label = decode(doc.match(/aria-current="page"[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? "");
    const labelOk = label.length > 0 && (label === h1 || label.length < h1.length);
    check(dt === `${h1} | ReviewStage` && labelOk, `${path} <title> "${dt}" = h1 + suffix; sidebar "${label}"`);
  }
  for (const needle of [ 'property="og:image:width" content="1280"', 'property="og:image:height" content="640"', 'rel="icon" href="/favicon.ico"', 'rel="apple-touch-icon"', 'sizes="192x192"', 'sizes="512x512"', 'property="og:title"', 'property="og:description"', 'property="og:image"', 'property="og:url"', 'property="og:type"', 'name="twitter:card" content="summary_large_image"', 'name="twitter:image"', 'name="theme-color" media="(prefers-color-scheme: light)"', 'name="theme-color" media="(prefers-color-scheme: dark)"', 'name="description"']) {
    check(head.includes(needle), `head has ${needle}`);
  }
  // The legacy register is gone from the served markup: no hand-rolled button class, no legacy
  // queue-row classes (the islands are checked in the DOM below, shadow roots included).
  const legacy = html.match(/class="(?:[^"]*\s)?(btn|row|rowlink|rowsub|repochip)(?:\s[^"]*)?"/g) ?? [];
  check(legacy.length === 0, `served home HTML carries no legacy .btn/.row/.repochip class (${legacy.length})`);
  // The stage light's token stays in its two places (landing-v2 design rules): the hero and the gate band.
  const cssFiles = (await import("node:fs")).readdirSync("dist/_astro").filter((f) => f.endsWith(".css"));
  const lightUses = cssFiles.flatMap((f) => (readFileSync(join("dist/_astro", f), "utf8").match(/[^{}]*\{[^}]*var\(--light\)[^}]*\}/g) ?? []).map((m) => m.trim().slice(0, 60)));
  const offSite = lightUses.filter((m) => !/stage-hero|stage-login|finding\.is-staged|has-staged|\.gate/.test(m));
  check(offSite.length === 0, `--light appears only in the stage-light selectors (${lightUses.length} rules, ${offSite.length} elsewhere)`);

  const browser = await chromium.launch();
  for (const scheme of ["light", "dark"]) {
    for (const [w, label] of [[1440, "desktop"], [390, "phone"]]) {
      const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: w, height: w === 390 ? 844 : 900 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
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
        const { sw, iw, theme, resolved } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: Math.round(visualViewport?.width ?? innerWidth), theme: document.documentElement.dataset.theme, resolved: document.documentElement.dataset.resolved }));
        check(theme === scheme && resolved === scheme, `${name} ${label} rendered in ${scheme} (got ${theme}/${resolved})`);
        if (w === 390) check(sw <= iw, `${name} ${scheme} phone: no sideways scroll (scrollWidth ${sw} <= visualViewport ${iw})`);
        if (kind === "home") {
          const small = await page.evaluate(() => [...document.querySelectorAll("main a, main button, main summary")].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (Math.round(r.height) < 44 || Math.round(r.width) < 44) && getComputedStyle(el).visibility !== "hidden"; }).map((el) => `${el.tagName}.${el.className.slice?.(0, 30) ?? ""} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`));
          if (w === 390) check(small.length === 0, `${scheme} phone: every tap target in main is at least 44px (${small.length ? small.join(" | ") : "none under"})`);
          // The install command is the page's conversion moment and the hero's primary button; it
          // rendered as an empty box once already (a containment collapse), so its width is asserted.
          const cta = page.locator(".hero [data-install] code");
          const ctaText = (await cta.textContent())?.trim() ?? "";
          const ctaBox = await cta.boundingBox();
          check(ctaText.startsWith(installCommand) && ctaBox && ctaBox.width > 100, `${scheme} ${label}: hero command pill renders "${ctaText}" (${Math.round(ctaBox?.width ?? 0)}px wide)`);
          const mono = await page.evaluate(() => [...document.querySelectorAll("main *")].filter((el) => el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && /Mono|monospace/i.test(getComputedStyle(el).fontFamily) && !el.closest("code, pre, kbd")).map((el) => el.tagName + "." + el.className));
          check(mono.length === 0, `${scheme} ${label}: monospace only inside code (${mono.length} stray: ${mono.slice(0, 3).join(", ")})`);

          const h1s = await page.evaluate(() => [...document.querySelectorAll("h1")].map((h) => h.textContent.trim()));
          check(h1s.length === 1 && h1s[0].toLowerCase().includes(CATEGORY), `${scheme} ${label}: exactly one h1, carrying the category ("${h1s.join('" / "')}")`);
          // landing-v2: the nine sections, in order, each opening with its statement.
          const words = await page.evaluate(() => (document.querySelector("main")?.innerText ?? "").trim().split(/\s+/).filter(Boolean).length);
          check(words <= 900, `${scheme} ${label}: home reads ${words} words (<= 900)`);
          const heads = await page.evaluate(() => ["hero-title", "why-title", "how-title", "features-title", "gate-title", "compare-title", "install-title", "faq-title", "final-title"].map((id) => { const el = document.getElementById(id); return el ? `${id}:${el.textContent.trim()}` : `${id}:MISSING`; }));
          check(!heads.some((h) => h.endsWith(":MISSING")), `${scheme} ${label}: section headings ${heads.map((h) => h.split(":")[0]).join(", ")} ${heads.some((h) => h.endsWith(":MISSING")) ? "(missing: " + heads.filter((h) => h.endsWith(":MISSING")).join(", ") + ")" : "present"}`);
          if (scheme === "dark" && w === 1440) console.log("     " + heads.join("\n     "));
          const shape = await page.evaluate(() => {
            const cols = [...document.querySelectorAll("#why article")].map((a) => Math.round(a.getBoundingClientRect().height));
            return {
              cols,
              steps: document.querySelectorAll("#how-it-works ol > li").length,
              tiles: document.querySelectorAll("#features .tile").length,
              gate: document.querySelectorAll("#gate pre").length,
              rows: document.querySelectorAll("#compare tbody tr").length,
              faq: document.querySelectorAll("#faq details > summary").length,
              finalCta: document.querySelectorAll(".final [data-install]").length,
            };
          });
          check(shape.cols.length === 2 && (w === 390 || shape.cols[0] === shape.cols[1]), `${scheme} ${label}: the contrast is two columns${w === 390 ? "" : " of equal height"} (${shape.cols.join(" / ")}px)`);
          check(shape.steps === 4 && shape.tiles === 6 && shape.gate === 3 && shape.rows === 6 && shape.faq === 6 && shape.finalCta === 1, `${scheme} ${label}: 4 steps (${shape.steps}), 6 feature tiles (${shape.tiles}), 3 gate snippets (${shape.gate}), 6 compare rows (${shape.rows}), 6 FAQ disclosures (${shape.faq}), closing command (${shape.finalCta})`);
          // A disclosure opens with no script.
          const first = page.locator("#faq details").first();
          await first.locator("summary").click();
          check(await first.evaluate((d) => d.open), `${scheme} ${label}: an FAQ answer opens on click`);
          // Videos: only the hero preloads (metadata, with a poster); under reduced motion it stays
          // on its poster; every other recording waits for a click.
          const vids = await page.evaluate(() => [...document.querySelectorAll("main video")].map((v) => ({ hero: v.hasAttribute("data-hero-video"), preload: v.getAttribute("preload"), poster: !!v.getAttribute("poster"), paused: v.paused, auto: v.autoplay })));
          const hero = vids.find((v) => v.hero), rest = vids.filter((v) => !v.hero);
          check(!!hero && hero.preload === "metadata" && hero.poster && hero.paused, `${scheme} ${label}: hero video preload=metadata with a poster, paused under reduced motion (${JSON.stringify(hero)})`);
          check(rest.length >= 2 && rest.every((v) => v.preload === "none" && v.poster && !v.auto), `${scheme} ${label}: ${rest.length} other videos are preload=none with posters, no autoplay`);
          // The fold on a 390x844 phone: the actions, then the product, all above the fold.
          if (w === 390) {
            const fold = await page.evaluate(() => { const r = document.querySelector("[data-hero-video]").getBoundingClientRect(); return { top: Math.round(r.top + scrollY), bottom: Math.round(r.bottom + scrollY) }; });
            check(fold.bottom <= 844, `${scheme} phone: hero video sits above the fold of a 390x844 screen (${fold.top}-${fold.bottom}px)`);
          }
          // The demo lightbox opens a native dialog and loads the recording only then.
          const before = await page.evaluate(() => document.querySelectorAll("[data-demo-slot] video, [data-demo-slot] iframe").length);
          await page.locator("[data-demo-open]").click();
          const dlg = await page.evaluate(() => ({ open: document.querySelector("[data-demo-dialog]").open, src: document.querySelector("[data-demo-slot] video")?.getAttribute("src") ?? document.querySelector("[data-demo-slot] iframe")?.getAttribute("src") ?? "" }));
          check(before === 0 && dlg.open && /reviewstage-demo\.mp4|youtube/.test(dlg.src), `${scheme} ${label}: the demo lightbox opens and only then loads ${dlg.src}`);
          await page.keyboard.press("Escape");
          await page.waitForTimeout(150);
          check(await page.evaluate(() => !document.querySelector("[data-demo-dialog]").open && !document.querySelector("[data-demo-slot] video")), `${scheme} ${label}: Escape closes the lightbox and unloads the player`);
          const strayRows = await page.evaluate(() => document.querySelectorAll(".row, .rowlink, .rowsub, .repochip, .btn").length);
          check(strayRows === 0, `${scheme} ${label}: no .row/.repochip/.btn in the home DOM (${strayRows})`);
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
