// Lane D1 screenshots: the three wizard steps, both themes, 1440 and 390, against the personal
// fixture server welcome.spec.ts boots (or one you start the same way). Usage:
//   RS_E2E_PORT=8981 OUT=../openspec/changes/npx-desktop/after/d1 node --import tsx e2e/shots-welcome.ts
// The GitHub step is shot with the device flow advertised (the desktop app's .env sets
// GH_DEVICE_FLOW=1), the Claude step signed in and unconnected, the repositories step with two
// rows checked.
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { sessionCookie } from "./fixture";
import { buildPersonalFixture, PERSONAL_FIXTURE, PERSONAL_ORIGIN, PERSONAL_PORT, PERSONAL_USER } from "./personal-fixture";

const OUT = process.env.OUT || "shots";
mkdirSync(OUT, { recursive: true });
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

buildPersonalFixture();
const server = spawn("python3", ["../bin/server.py"], {
  env: { ...process.env, ROOT: PERSONAL_FIXTURE, RS_SPA: "1", RS_PORT: String(PERSONAL_PORT),
         RS_COOKIE_SECURE: "0", PATH: `${PERSONAL_FIXTURE}/fakebin:${process.env.PATH || ""}` },
  stdio: "ignore",
});
for (let i = 0; i < 150; i++) {
  try {
    if ((await (await fetch(`${PERSONAL_ORIGIN}/health`)).text()).trim() === "ok") break;
  } catch { /* not yet */ }
  await new Promise((r) => setTimeout(r, 200));
}

const browser = await chromium.launch();

async function ctx(theme: "dark" | "light", vp: { width: number; height: number }, signedIn: boolean) {
  const c = await browser.newContext({
    viewport: vp, isMobile: vp.width < 900, hasTouch: vp.width < 900, deviceScaleFactor: 1, reducedMotion: "reduce",
  });
  await c.addInitScript((t) => {
    if (t === "light") localStorage.setItem("rs-theme", "light");
    else localStorage.removeItem("rs-theme");
  }, theme);
  await c.route("https://avatars.example.test/**", (r) => r.fulfill({ status: 200, contentType: "image/png", body: PIXEL }));
  if (signedIn) await c.addCookies([sessionCookie(PERSONAL_USER)]);
  return c;
}

async function shot(c: BrowserContext, path: string, out: string, before?: (p: Page) => Promise<void>) {
  const page = await c.newPage();
  await page.goto(`${PERSONAL_ORIGIN}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  if (before) await before(page);
  await page.waitForTimeout(250);
  const file = join(OUT, out);
  await page.screenshot({ path: file, fullPage: false });
  console.log("wrote", file);
  await page.close();
}

for (const theme of ["dark", "light"] as const) {
  for (const [vp, tag] of [[DESKTOP, "1440"], [PHONE, "390"]] as const) {
    const out = await ctx(theme, vp, false);
    await out.route("**/api/me", async (route) => {
      const r = await route.fetch();
      await route.fulfill({ response: r, json: { ...(await r.json()), device_flow: true } });
    });
    await shot(out, "/welcome", `welcome-1-github-${theme}-${tag}.png`);
    await out.close();

    const inn = await ctx(theme, vp, true);
    await shot(inn, "/welcome/claude", `welcome-2-claude-${theme}-${tag}.png`);
    await shot(inn, "/welcome/repos", `welcome-3-repos-${theme}-${tag}.png`, async (p) => {
      await p.getByTestId("repo-row").first().waitFor();
      await p.getByRole("checkbox", { name: "acme-solo/widgets" }).click();
      await p.getByRole("checkbox", { name: "acme/api" }).click();
    });
    await inn.close();
  }
}

await browser.close();
server.kill("SIGTERM");
