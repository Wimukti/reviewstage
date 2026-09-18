// Lane S proof shots: every page this lane owns, both themes, 1440 and 390, into
// openspec/changes/one-identity-redesign/after/pages/. Reuses a running e2e server when one
// answers on PORT (start it with `pnpm test:browser --grep nothing` or run this after a suite);
// otherwise builds the fixture and boots one for the duration.
//   node --import tsx e2e/pages-shot.ts
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFixture, FIXTURE, ORIGIN, PORT, SECRET, sessionCookie } from "./fixture";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "..", "openspec", "changes", "one-identity-redesign", "after", "pages");

// name → path (+ an optional action once the page has settled)
const SHOTS: [string, string, ((p: import("@playwright/test").Page) => Promise<void>)?][] = [
  ["skills-which", "/skills#which"],
  ["skills-rules", "/skills#rules"],
  ["skills-editors", "/skills#editors"],
  ["skills-repos", "/skills#repos"],
  ["skills-profiles", "/skills#profiles", async (p) => {
    await p.locator('[data-testid="repo-profile"]').first().locator("> summary").click();
  }],
  ["skills-depth", "/skills#depth"],
  ["insights", "/dashboard"],
  ["settings", "/settings"],
  ["integrations", "/integrations"],
  ["how", "/how"],
];

async function up(): Promise<boolean> {
  try {
    const r = await fetch(`${ORIGIN}/health`);
    return r.ok;
  } catch {
    return false;
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  let server: ReturnType<typeof spawn> | undefined;
  if (!(await up())) {
    buildFixture();
    server = spawn("python3", [join(HERE, "..", "..", "bin", "server.py")], {
      env: {
        ...process.env,
        PATH: `${join(FIXTURE, "fakebin")}:${process.env.PATH}`,
        ROOT: FIXTURE,
        RS_SECRET: SECRET,
        RS_SPA: "1",
        RS_PORT: String(PORT),
      },
      stdio: "ignore",
    });
    for (let i = 0; i < 100 && !(await up()); i++) await new Promise((r) => setTimeout(r, 200));
  }
  const browser = await chromium.launch();
  try {
    for (const theme of ["light", "dark"] as const) {
      for (const [device, viewport, mobile] of [
        ["desktop", { width: 1440, height: 900 }, false],
        ["phone", { width: 390, height: 844 }, true],
      ] as const) {
        const ctx = await browser.newContext({
          colorScheme: theme,
          viewport,
          isMobile: mobile,
          hasTouch: mobile,
          deviceScaleFactor: 1,
        });
        await ctx.addCookies([sessionCookie()]);
        const page = await ctx.newPage();
        for (const [name, path, act] of SHOTS) {
          await page.goto(`${ORIGIN}${path}`, { waitUntil: "networkidle" });
          await page.locator(".muted", { hasText: /^Loading…$/ }).waitFor({ state: "detached", timeout: 15_000 }).catch(() => {});
          if (act) await act(page);
          await page.waitForTimeout(300);
          const file = join(OUT, `${name}-${theme}-${device}.png`);
          await page.screenshot({ path: file, fullPage: true });
          console.log("wrote", file);
        }
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    server?.kill();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
