// Mobile shots from the offline fixture at iPhone 15 size.
//   audit (the "before"):  RS_E2E_PORT=8987 node --import tsx e2e/shots-mobile-audit.ts
//     -> openspec/changes/mobile-app-feel/audit/
//   lane G (the shell):    RS_SHOTS=g RS_E2E_PORT=8987 node --import tsx e2e/shots-mobile-audit.ts
//     -> openspec/changes/mobile-app-feel/after/g/, 393×852 in dark and light, the launch image
//        and one desktop queue at 1440 to prove the desktop is unchanged.
import { chromium, devices, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildFixture, FIXTURE, ORIGIN, PORT, sessionCookie } from "./fixture";

const MODE = process.env.RS_SHOTS || "audit";
const CHANGE = join(process.cwd(), "..", "openspec", "changes", "mobile-app-feel");
const OUT = MODE === "g" ? join(CHANGE, "after", "g") : join(CHANGE, "audit");
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

if (MODE === "g") {
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
