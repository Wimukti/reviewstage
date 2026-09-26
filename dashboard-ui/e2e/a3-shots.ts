// Lane A3 proof shots: every page this lane owns, both themes, 1440 and 390, into
// openspec/changes/stage-light/after/a3/. Modelled on pages-shot.ts. Reuses a running e2e server
// when one answers on PORT; otherwise builds the fixture and boots one for the duration.
//   node --import tsx e2e/a3-shots.ts
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFixture, FIXTURE, ORIGIN, PORT, SECRET, sessionCookie } from "./fixture";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "..", "openspec", "changes", "stage-light", "after", "a3");

const SHOTS: [string, string, ((p: import("@playwright/test").Page) => Promise<void>)?][] = [
  ["skills-which", "/skills#which"],
  ["skills-editors", "/skills#editors"],
  ["insights", "/dashboard"],
  ["learnings", "/learnings"],
  ["qa", "/qa"],
  ["integrations", "/integrations"],
  ["settings", "/settings"],
];

// The editors shot needs a skill with a Team rules section so the band is visible.
const TEAM_SKILL = [
  "# Review skill",
  "",
  "Read the diff before the description. Prefer questions to assertions when the intent is",
  "unclear, and never request changes.",
  "",
  "## Team rules",
  "",
  "- Do not raise const-over-let style nits.",
  "- Never ask for a Jira link in code comments.",
  "",
  "## Output",
  "",
  "One finding per comment; severity first.",
].join("\n");

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
    for (const theme of ["dark", "light"] as const) {
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
        // Dark is the default; light is a stored choice (theme.ts).
        await ctx.addInitScript((t) => {
          try {
            if (t === "light") localStorage.setItem("rs-theme", "light");
            else localStorage.removeItem("rs-theme");
          } catch {
            /* ignore */
          }
        }, theme);
        const page = await ctx.newPage();
        await page.route("**/api/skills", async (route) => {
          const r = await route.fetch();
          const body = await r.json();
          await route.fulfill({ response: r, json: { ...body, teamSkill: TEAM_SKILL, globalEdited: true } });
        });
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
