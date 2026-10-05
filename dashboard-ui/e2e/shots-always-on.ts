// desktop-always-on screenshots: the update banner and Settings → Desktop app at 1440 (fake
// desktop bridge, personal mode), offline.html and the in-app unreachable state at 390. Runs
// against the e2e fixture server; start it the way playwright.config.ts does, then, from
// dashboard-ui/:
//   RS_E2E_PORT=8997 OUT=../openspec/changes/desktop-always-on/after node --import tsx e2e/shots-always-on.ts
import { chromium, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { AUTH_STATE, ORIGIN, patchMe } from "./fixture";

const OUT = process.env.OUT || "shots";
mkdirSync(OUT, { recursive: true });
// A string, not a function: tsx's keep-names would inject a `__name` helper the page lacks.
const BRIDGE = `
  const st = { current: "1.0.0-rc.31", latest: "1.0.0-rc.40", available: true, checkedAt: new Date(2026, 9, 5, 9, 41).getTime(), error: null, dev: false, installing: false, installError: null };
  window.reviewstage = {
    phone: { onData() {}, async status() { return { enabled: false, url: null }; }, async enable() { return { enabled: false }; }, async disable() { return { enabled: false, url: null }; },
      tailscale: { async status() { return { installed: false, loggedIn: false, url: null }; }, async set() { return {}; } } },
    update: { async status() { return st; }, async check() { return st; }, async install() { return { ok: true }; }, onAvailable() {} },
    openAtLogin: { async status() { return { supported: true, enabled: true, available: true, file: null }; }, async set(on) { return { supported: true, enabled: on, available: true }; } },
  };
`;

const browser = await chromium.launch();
async function page(width: number, height: number, mobile = false): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: ORIGIN, storageState: AUTH_STATE, viewport: { width, height }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, colorScheme: "dark" });
  return ctx.newPage();
}

{
  const p = await page(1440, 900);
  await p.addInitScript({ content: BRIDGE });
  await patchMe(p, { personal: true });
  await p.goto("/?tab=reviewed");
  await p.getByTestId("update-banner").waitFor();
  await p.waitForTimeout(400);
  await p.screenshot({ path: join(OUT, "update-banner-1440.png") });
  await p.getByTestId("update-banner").screenshot({ path: join(OUT, "update-banner-strip.png") });
  await p.goto("/settings#desktop");
  await p.getByTestId("desktop-app").waitFor();
  await p.waitForTimeout(400);
  await p.screenshot({ path: join(OUT, "settings-desktop-app-1440.png") });
  await p.goto("/settings#phone");
  await p.getByTestId("phone-tailscale").waitFor();
  await p.waitForTimeout(300);
  await p.screenshot({ path: join(OUT, "settings-phone-tailscale-1440.png") });
  await p.context().close();
}
{
  const p = await page(390, 844, true);
  await p.goto("/offline.html");
  await p.getByTestId("offline").waitFor();
  await p.waitForTimeout(300);
  await p.screenshot({ path: join(OUT, "offline-390.png") });
  await p.route("**/api/me", (r) => r.fulfill({ status: 530, contentType: "text/html", body: "error code: 1033" }));
  await p.goto("/");
  await p.getByTestId("unreachable").waitFor();
  await p.waitForTimeout(300);
  await p.screenshot({ path: join(OUT, "unreachable-390.png") });
  await p.context().close();
}
{
  const p = await page(390, 844, true);
  await p.addInitScript({ content: BRIDGE });
  await patchMe(p, { personal: true });
  await p.goto("/settings#desktop");
  await p.getByTestId("desktop-app").waitFor();
  await p.waitForTimeout(400);
  await p.screenshot({ path: join(OUT, "settings-desktop-app-390.png"), fullPage: true });
  await p.context().close();
}
await browser.close();
console.log(`shots -> ${OUT}`);
