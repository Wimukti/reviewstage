// Mobile shots from the offline fixture at iPhone 15 size.
//   audit (the "before"):  RS_E2E_PORT=8987 node --import tsx e2e/shots-mobile-audit.ts
//     -> openspec/changes/mobile-app-feel/audit/
//   lane G (the shell):    RS_SHOTS=g RS_E2E_PORT=8987 node --import tsx e2e/shots-mobile-audit.ts
//     -> openspec/changes/mobile-app-feel/after/g/, 393×852 in dark and light, the launch image
//        and one desktop queue at 1440 to prove the desktop is unchanged.
//   lane H (the screens):  RS_SHOTS=h RS_E2E_PORT=8987 node --import tsx e2e/shots-mobile-audit.ts
//     -> openspec/changes/mobile-app-feel/after/h/, the queue, its search and filter sheet, a row
//        mid-swipe, the PR page, kept and dropped findings, the Post pill, the confirm sheet,
//        the success state and Activity at 393×852 in dark and light; the desktop queue and PR
//        page at 1440. Every write is answered in the browser.
import { chromium, devices, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildFixture, FIXTURE, ORIGIN, PORT, sessionCookie } from "./fixture";

const MODE = process.env.RS_SHOTS || "audit";
const CHANGE = join(process.cwd(), "..", "openspec", "changes", "mobile-app-feel");
const OUT = MODE === "g" || MODE === "h" ? join(CHANGE, "after", MODE) : join(CHANGE, "audit");
mkdirSync(OUT, { recursive: true });
buildFixture();
const srv = spawn("python3", ["../bin/server.py"], { env: { ...process.env, ROOT: FIXTURE, RS_SPA: "1", RS_PORT: String(PORT), RS_COOKIE_SECURE: "0", PATH: `${FIXTURE}/fakebin:${process.env.PATH}` }, stdio: "ignore" });
for (let i = 0; i < 100; i++) { try { if ((await (await fetch(`${ORIGIN}/health`)).text()).trim() === "ok") break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const b = await chromium.launch();
const PR = "/pr?repo=acme%2Fwidgets&pr=38849";
type Shot = [string, string, ((p: Page) => Promise<void>)?];

const AUDIT: Shot[] = [
  ["01-queue", "/"], ["02-queue-scrolled", "/", async (p) => p.mouse.wheel(0, 600)],
  ["03-pr", PR], ["04-pr-findings", PR, async (p) => p.mouse.wheel(0, 900)],
  ["05-pr-bottom", PR, async (p) => p.mouse.wheel(0, 4000)],
  ["06-qa", "/qa"], ["07-learnings", "/learnings"], ["08-insights", "/dashboard"],
  ["09-skills", "/skills"], ["10-integrations", "/integrations"], ["11-settings", "/settings"],
  ["12-more-sheet", "/", async (p) => p.getByRole("button", { name: /More/ }).click()],
  ["13-search", "/", async (p) => p.getByRole("button", { name: /search|review a pr/i }).first().click()],
  ["14-run-form", "/pr?repo=acme%2Fwidgets&pr=38851"],
];
const G: Shot[] = [
  ["01-queue", "/?tab=reviewed"],
  ["02-queue-scrolled", "/?tab=reviewed", async (p) => { await p.mouse.wheel(0, 260); }],
  ["03-pr", PR],
  ["04-activity", "/activity"],
  ["05-you", "/you"],
  ["06-you-poller", "/you", async (p) => { await p.getByRole("link", { name: /^Poller/ }).click(); }],
  ["07-insights", "/dashboard"],
  ["08-skills", "/skills"],
  ["09-learnings", "/learnings"],
  ["10-qa", "/qa"],
];

// A finger on the glass: touchStart and the moves through the DevTools protocol, released or held.
async function pan(p: Page, from: { x: number; y: number }, to: { x: number; y: number }, release = true) {
  const cdp = await p.context().newCDPSession(p);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x + ((to.x - from.x) * i) / 10, y: from.y + ((to.y - from.y) * i) / 10 }] });
  }
  if (release) await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}
async function swipeEl(p: Page, testid: string, nth: number, dx: number, release = true) {
  const el = p.getByTestId(testid).nth(nth);
  await el.scrollIntoViewIfNeeded();
  const b = (await el.boundingBox())!;
  const x = dx > 0 ? b.x + 40 : b.x + b.width - 90;
  await pan(p, { x, y: b.y + 30 }, { x: x + dx, y: b.y + 31 }, release);
}
const DRY = "<div class='banner warn'><span>!</span><div>Dry run — nothing was posted to GitHub.</div></div>";
const findings = async (p: Page) => {
  const f = p.getByTestId("finding").first();
  await f.waitFor();
  const b = (await f.boundingBox())!;
  await p.mouse.wheel(0, b.y - 330);
  await p.waitForTimeout(400);
};
const H: Shot[] = [
  ["01-queue", "/?tab=all"],
  ["02-queue-search", "/?tab=all", async (p) => { await p.getByTestId("search-open").click(); await p.keyboard.type("lead"); }],
  ["03-filter-sheet", "/?tab=all", async (p) => { await p.getByTestId("filter-open").click(); }],
  ["04-row-mid-swipe", "/?tab=all", async (p) => { await swipeEl(p, "row-fg", 2, -150, false); }],
  ["05-pr-top", PR],
  ["06-findings-kept-dropped", PR, async (p) => { await findings(p); await swipeEl(p, "finding", 1, -200); }],
  ["07-post-pill-swipe-keep", PR, async (p) => {
    await findings(p);
    await p.getByTestId("finding-select").nth(0).uncheck();
    await p.getByTestId("finding-select").nth(1).uncheck();
    await p.waitForTimeout(300);
    await swipeEl(p, "finding", 0, 130, false);
  }],
  ["08-confirm-sheet", PR, async (p) => { await p.getByTestId("post-pill").click(); }],
  ["09-success", PR, async (p) => {
    await p.route("**/api/post", (r) => r.fulfill({ json: { bannerHtml: DRY } }));
    await p.getByTestId("post-pill").click();
    await p.getByTestId("post-confirm").click();
    await p.getByTestId("post-next").waitFor();
  }],
  ["10-activity", "/activity"],
];

async function run(shots: Shot[], theme: "dark" | "light" | null, suffix: string) {
  const c = await b.newContext({ ...devices["iPhone 15"], deviceScaleFactor: 2 });
  await c.addCookies([sessionCookie()]);
  if (theme === "light") await c.addInitScript("try{localStorage.setItem('rs-theme','light')}catch(e){}");
  const p = await c.newPage();
  for (const [n, path, act] of shots) {
    await p.goto(ORIGIN + path, { waitUntil: "networkidle" }).catch(() => {});
    await p.waitForTimeout(600);
    if (act) { await act(p).catch((e: Error) => console.log(n, "action failed:", e.message.split("\n")[0])); await p.waitForTimeout(900); }
    await p.screenshot({ path: join(OUT, `${n}${suffix}.png`) });
  }
  await c.close();
}

if (MODE === "h") {
  await run(H, "dark", "-dark");
  await run(H, "light", "-light");
  const d = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await d.addCookies([sessionCookie()]);
  const dp = await d.newPage();
  for (const [n, path] of [["11-desktop-queue-1440", "/?tab=reviewed"], ["12-desktop-pr-1440", PR]] as const) {
    await dp.goto(ORIGIN + path, { waitUntil: "networkidle" }).catch(() => {});
    await dp.waitForTimeout(600);
    await dp.screenshot({ path: join(OUT, `${n}.png`) });
  }
} else if (MODE === "g") {
  await run(G, "dark", "-dark");
  await run(G, "light", "-light");
  copyFileSync(join(process.cwd(), "..", "bin", "static", "icons", "startup-1179x2556.png"), join(OUT, "11-launch-1179x2556.png"));
  const d = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await d.addCookies([sessionCookie()]);
  const dp = await d.newPage();
  await dp.goto(ORIGIN + "/?tab=reviewed", { waitUntil: "networkidle" }).catch(() => {});
  await dp.waitForTimeout(600);
  await dp.screenshot({ path: join(OUT, "12-desktop-queue-1440.png") });
} else {
  await run(AUDIT, null, "");
  const lg = await b.newContext({ ...devices["iPhone 15"], deviceScaleFactor: 2 });
  const lp = await lg.newPage(); await lp.goto(ORIGIN + "/login"); await lp.waitForTimeout(600); await lp.screenshot({ path: join(OUT, "00-login.png") });
}
await b.close(); srv.kill();
console.log("done", OUT);
