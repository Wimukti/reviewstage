// The marketing screenshots for the public site and the README: seven views, each captured in
// both themes, into website/src/assets/screenshots/{name}-{light,dark}.png. These are tight,
// composed crops of the real dashboard running against the offline e2e fixture — no real
// repository, user or review ever appears in them.
//
//   hero      the PR page end to end: assessment, finding cards, sticky commit bar
//   gate      the Approve panel and the commit bar — the posting gate
//   staging   one finding card close up
//   run       the run form: effort, model, focus, Start
//   team      the queue: tabs with counts and the reviewed rows
//   learnings the Skills page (the site's alt text describes Skills, not Learnings)
//   qa        a QA guide with its cases
//   insights  the Insights page: range pills, the tiles and the first chart row
//   integrations  the Integrations page (the Notifications guide's view)
//   profile   the Skills page's Repository profile section, open
//
// It builds its own copy of the fixture, adjusts three things the marketing shots need
// (the reviewer's Claude account connected, dry run off, a QA guide that is not a failed one),
// and boots its own server on RS_SHOTS_PORT so it never races a Playwright run.
//
//   node --import tsx e2e/site-shots.ts
import { chromium, type Locator, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFixture, FIXTURE, PR, PR2, PR4, REPO, SECRET, USER, sessionCookie } from "./fixture";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "..", "website", "src", "assets", "screenshots");
const PORT = Number(process.env.RS_SHOTS_PORT || 8991);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const enc = encodeURIComponent;
const slug = (repo: string) => repo.replace("/", "__");
const W = 1440;

/** A QA guide with all three tiers, so the shot shows what the page is for. */
const QA_GUIDE = [
  "# QA guide — Cache vendor lead times",
  "",
  "Set up: a storefront account, one vendor with a lead time and one without.",
  "",
  "## P0 — must pass",
  "",
  "1. Open a product card for a vendor **with** a lead time. The badge reads the vendor's own",
  "   figure. Pass: the number matches the vendor record. Fail: any other number.",
  "2. Open a product card for a vendor with **no** lead time. Pass: no badge at all.",
  "   Fail: an empty badge, a dash, or a crash.",
  "",
  "## P1 — the feature",
  "",
  "3. Change a vendor's lead time, then reload the product card within a minute.",
  "   Pass: the card shows the new figure. Fail: the old one persists.",
  "",
  "## P2 — regression",
  "",
  "4. The checkout summary must not show a lead-time badge. Pass: absent. Fail: present.",
  "",
  "## Do not file",
  "",
  "- The badge is absent on archived products. That is deliberate.",
  "",
].join("\n");

function fixtureForShots() {
  buildFixture();
  const env = join(FIXTURE, ".env");
  writeFileSync(env, readFileSync(env, "utf8").replace("DRY_RUN=1", "DRY_RUN=0"));
  // The reviewer has connected their own Claude account, so the run form renders instead of
  // the connect gate. Only the key's presence is read; no run is ever started here.
  const users = JSON.parse(readFileSync(join(FIXTURE, "users.json"), "utf8"));
  users[USER].claude_token_enc = "shots-fixture-not-a-token";
  writeFileSync(join(FIXTURE, "users.json"), JSON.stringify(users));
  // PR4 is mid-run in the e2e fixture; for the "run" shot it is simply a PR nobody has
  // reviewed yet, which is the state the run form belongs to.
  rmSync(join(FIXTURE, "state", slug(REPO), PR4, "users", USER, "status"), { force: true });
  // Enough posted decisions for the Skills page to show a real keep rate rather than
  // "too few to rate" — the never-truncated tally is the page's own source.
  writeFileSync(
    join(FIXTURE, "learnings_totals.json"),
    JSON.stringify({
      version: 1, complete: true, dryDecisions: 0,
      outcomes: { kept: 30, edited: 10, dropped: 16 },
      criticalPath: { kept: 0, edited: 0, dropped: 0 },
      repos: { [REPO]: { kept: 30, edited: 10, dropped: 16 } },
      repoCriticalPath: {}, skills: { global: { kept: 30, edited: 10, dropped: 16 } }, days: {},
    }),
  );
  // PR2's guide is a deliberate failure case in the e2e fixture. Give the shot a good one.
  writeFileSync(join(FIXTURE, "state", slug(REPO), PR2, "qa.md"), QA_GUIDE);
  writeFileSync(join(FIXTURE, "state", slug(REPO), PR2, "qa.status"), "done");
}

async function up() {
  try {
    return (await fetch(`${ORIGIN}/health`)).ok;
  } catch {
    return false;
  }
}

async function settle(page: Page) {
  await page.locator(".muted", { hasText: /^Loading…$/ }).waitFor({ state: "detached", timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(500);
}

/** The union of these elements' boxes, padded, as a screenshot clip. */
async function box(page: Page, parts: Locator[], pad = 20) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of parts) {
    const b = await p.boundingBox();
    if (!b) throw new Error("no box for a clip part");
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height);
  }
  const pageW = await page.evaluate(() => document.documentElement.clientWidth);
  const x = Math.max(0, Math.round(x0 - pad));
  const y = Math.max(0, Math.round(y0 - pad));
  return {
    x, y,
    width: Math.min(pageW - x, Math.round(x1 - x0 + pad * 2)),
    height: Math.round(y1 - y0 + pad * 2),
  };
}

type Shot = {
  name: string;
  path: string;
  width?: number;
  height: number;
  shoot: (p: Page) => Promise<Buffer>;
};

const SHOTS: Shot[] = [
  {
    // The whole page, sidebar included: assessment, both finding cards, the sticky bar.
    name: "hero",
    path: `/pr?repo=${enc(REPO)}&pr=${PR}`,
    height: 965,
    shoot: (p) => p.screenshot({ clip: { x: 0, y: 0, width: W, height: 965 } }),
  },
  {
    // A viewport taller than the page, so the sticky bar sits where it belongs in the flow
    // rather than pinned over the Approve panel it is meant to sit under.
    name: "gate",
    path: `/pr?repo=${enc(REPO)}&pr=${PR}`,
    height: 1700,
    shoot: async (p) => {
      await p.getByTestId("sec-approve").click();
      await p.waitForTimeout(500);
      return p.screenshot({ clip: await box(p, [p.getByTestId("section-row"), p.getByTestId("commit-bar")], 18) });
    },
  },
  {
    // Narrower viewport so the card is not mostly empty gutter.
    name: "staging",
    path: `/pr?repo=${enc(REPO)}&pr=${PR}`,
    width: 1080,
    height: 1100,
    // Pad under the card's 10px margin, so the next card does not peek into frame.
    shoot: async (p) => p.screenshot({ clip: await box(p, [p.locator(".finding").first()], 8) }),
  },
  {
    name: "run",
    path: `/pr?repo=${enc(REPO)}&pr=${PR4}`,
    height: 1400,
    shoot: async (p) => {
      await p.locator("textarea.in").fill(
        "Pay close attention to the retry back-off — a 502 storm must not hammer the vendor.",
      );
      await p.locator("textarea.in").blur();
      await p.waitForTimeout(200);
      return p.screenshot({ clip: await box(p, [p.locator(".card.top").first()], 18) });
    },
  },
  {
    name: "team",
    path: "/?tab=reviewed",
    height: 900,
    shoot: (p) => topCrop(p, p.locator(".list").first()),
  },
  {
    name: "learnings",
    path: "/skills",
    height: 900,
    shoot: (p) => topCrop(p, p.locator(".list").last()),
  },
  {
    name: "qa",
    path: `/qa?repo=${enc(REPO)}&pr=${PR2}`,
    height: 1400,
    shoot: (p) => topCrop(p, p.locator(".qaguide")),
  },
  {
    name: "insights",
    path: "/dashboard",
    height: 1400,
    shoot: (p) => topCrop(p, p.locator(".grid2").first()),
  },
  {
    name: "integrations",
    path: "/integrations",
    height: 1400,
    shoot: (p) => topCrop(p, p.getByTestId("integrations-list")),
  },
  {
    name: "profile",
    path: "/skills#profiles",
    height: 1600,
    shoot: async (p) => {
      const prof = p.getByTestId("repo-profile").first();
      await prof.locator("> summary").click();
      await p.waitForTimeout(400);
      return topCrop(p, prof);
    },
  },
];

/** Page top down to the bottom of `last`, full window width — the sidebar stays in frame. */
async function topCrop(page: Page, last: Locator) {
  const b = await last.boundingBox();
  if (!b) throw new Error("no box for the crop's last element");
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  return page.screenshot({ clip: { x: 0, y: 0, width, height: Math.round(b.y + b.height + 24) } });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  fixtureForShots();
  const server = spawn("python3", [join(HERE, "..", "..", "bin", "server.py")], {
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
  if (!(await up())) throw new Error(`no server on ${ORIGIN}`);

  const browser = await chromium.launch();
  try {
    for (const theme of ["light", "dark"] as const) {
      for (const s of SHOTS) {
        const ctx = await browser.newContext({
          colorScheme: theme,
          viewport: { width: s.width ?? W, height: s.height },
          deviceScaleFactor: 2,
          reducedMotion: "reduce",
        });
        await ctx.addCookies([sessionCookie()]);
        // Dark is the app's default whatever the OS says (theme.ts), so the light pair needs the
        // stored choice; the dark pair needs it absent.
        await ctx.addInitScript((t: string) => {
          try { if (t === "light") localStorage.setItem("rs-theme", "light"); else localStorage.removeItem("rs-theme"); } catch {}
        }, theme);
        const page = await ctx.newPage();
        await page.goto(ORIGIN + s.path, { waitUntil: "networkidle" });
        await settle(page);
        const png = await s.shoot(page);
        const file = join(OUT, `${s.name}-${theme}.png`);
        writeFileSync(file, png);
        console.log("wrote", file, png.length, "bytes");
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
