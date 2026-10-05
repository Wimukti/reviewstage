// Mobile audit shots: every page at iPhone 15 size from the offline fixture, into
// openspec/changes/mobile-app-feel/audit/.  RS_E2E_PORT=8987 node --import tsx e2e/shots-mobile-audit.ts
import { chromium, devices } from "@playwright/test";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { buildFixture, FIXTURE, ORIGIN, PORT, sessionCookie } from "./fixture";
const OUT = join(process.cwd(), "..", "openspec", "changes", "mobile-app-feel", "audit");
buildFixture();
const srv = spawn("python3", ["../bin/server.py"], { env: { ...process.env, ROOT: FIXTURE, RS_SPA: "1", RS_PORT: String(PORT), RS_COOKIE_SECURE: "0", PATH: `${FIXTURE}/fakebin:${process.env.PATH}` }, stdio: "ignore" });
for (let i = 0; i < 100; i++) { try { if ((await (await fetch(`${ORIGIN}/health`)).text()).trim() === "ok") break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const b = await chromium.launch();
const c = await b.newContext({ ...devices["iPhone 15"], deviceScaleFactor: 2 });
await c.addCookies([sessionCookie()]);
const p = await c.newPage();
const shots: [string, string, ((p: any) => Promise<void>)?][] = [
  ["01-queue", "/"], ["02-queue-scrolled", "/", async (p) => p.mouse.wheel(0, 600)],
  ["03-pr", "/pr?repo=acme%2Fwidgets&pr=38849"], ["04-pr-findings", "/pr?repo=acme%2Fwidgets&pr=38849", async (p) => p.mouse.wheel(0, 900)],
  ["05-pr-bottom", "/pr?repo=acme%2Fwidgets&pr=38849", async (p) => p.mouse.wheel(0, 4000)],
  ["06-qa", "/qa"], ["07-learnings", "/learnings"], ["08-insights", "/dashboard"],
  ["09-skills", "/skills"], ["10-integrations", "/integrations"], ["11-settings", "/settings"],
  ["12-more-sheet", "/", async (p) => p.getByRole("button", { name: /More/ }).click()],
  ["13-search", "/", async (p) => p.getByRole("button", { name: /search|review a pr/i }).first().click()],
  ["14-run-form", "/pr?repo=acme%2Fwidgets&pr=38851"],
];
for (const [n, path, act] of shots) {
  await p.goto(ORIGIN + path, { waitUntil: "networkidle" }).catch(() => {});
  await p.waitForTimeout(600);
  if (act) { await act(p).catch((e: Error) => console.log(n, "action failed:", e.message.split("\n")[0])); await p.waitForTimeout(700); }
  await p.screenshot({ path: join(OUT, `${n}.png`) });
}
const lg = await b.newContext({ ...devices["iPhone 15"], deviceScaleFactor: 2 });
const lp = await lg.newPage(); await lp.goto(ORIGIN + "/login"); await lp.waitForTimeout(600); await lp.screenshot({ path: join(OUT, "00-login.png") });
await b.close(); srv.kill();
console.log("done");
