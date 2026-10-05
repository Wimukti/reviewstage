// The four demo recordings (openspec/changes/phone-pairing-and-ease/design.md, lane C), made
// from the offline e2e fixtures so no real repository, person or review ever appears:
//
//   review        paste a PR URL → Start review → findings arrive → tick two → Post → posted
//   wizard        the three first-run steps on the personal fixture (token form, Claude, repos)
//   phone         390-wide: queue → PR → swipe two findings to keep → Post pill → confirm → posted
//   phone-access  the desktop "Review from your phone" window with a QR code (static, 6 s)
//
// Each is recorded with Playwright's recordVideo at 2x in the dark theme with motion on, then
// cut with ffmpeg into website/src/assets/demos/<name>.{mp4,gif,jpg} and copied to docs/demos/.
// Budgets: MP4 ≤ 2.5 MB (h264, yuv420p, faststart), GIF ≤ 4 MB (12 fps, palette-optimised).
//
//   RS_E2E_PORT=8995 pnpm demos            # all four
//   RS_E2E_PORT=8995 pnpm demos review     # one
//
// The review's "run" is staged by this script: /api/review is answered in the browser and the
// per-user status and review files are written into the fixture on a timer, so the real server
// serves every poll and the findings the page renders are the server's own. /api/post and the
// Claude connect endpoints are answered in the browser (the fixture must never reach GitHub or
// Anthropic), with the server's own banner wording.
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFixture, FIXTURE, PORT, PR, PR4, REPO, SECRET, USER, patchJson, sessionCookie } from "./fixture";
import { buildPersonalFixture, PERSONAL_FIXTURE, PERSONAL_ORIGIN, PERSONAL_PORT, PERSONAL_USER } from "./personal-fixture";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..", "..");
const SITE_OUT = join(ROOT, "website", "src", "assets", "demos");
const DOCS_OUT = join(ROOT, "docs", "demos");
const TMP = join(HERE, ".demos");
const ORIGIN = `http://127.0.0.1:${PORT}`;
export const FFMPEG = process.env.FFMPEG || (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg");
const MP4_BUDGET = 2.5 * 1024 * 1024;
const GIF_BUDGET = 4 * 1024 * 1024;
export const slug = (repo: string) => repo.replace("/", "__");
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Pacing a viewer can follow.
export const BEAT = 600; // between actions
export const HOLD = 1500; // on a result

type Size = { width: number; height: number };
const DESKTOP: Size = { width: 1440, height: 900 };
const PHONE: Size = { width: 390, height: 844 };
// desktop/main.js opens the phone window at 440×620 and lets it scroll; the recording is
// tall enough to show the whole card.
const PHONE_WINDOW: Size = { width: 440, height: 680 };

// ---- fixtures and servers -----------------------------------------------------------------

/** The e2e fixture, adjusted the way a demo needs: the reviewer's Claude account connected (so
 * the run form renders, not the connect gate), dry run off (no "Dry run" chip in the status
 * line) and PR4 not yet reviewed (it is permanently in flight in the e2e fixture). */
export function demoFixture() {
  buildFixture();
  const env = join(FIXTURE, ".env");
  writeFileSync(env, readFileSync(env, "utf8").replace("DRY_RUN=1", "DRY_RUN=0"));
  const users = JSON.parse(readFileSync(join(FIXTURE, "users.json"), "utf8"));
  users[USER].claude_token_enc = "demo-fixture-not-a-token";
  writeFileSync(join(FIXTURE, "users.json"), JSON.stringify(users));
  rmSync(join(FIXTURE, "state", slug(REPO), PR4, "users", USER), { recursive: true, force: true });
  // The fake gh answers the files API for PR4 too, with hunks that cover the three findings'
  // lines, so they anchor inline the way a real review's do.
  const plus = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `+line ${from + i}`).join("\n");
  const files = [
    { filename: "app/sync/VendorSync.php", status: "modified", patch: `@@ -85,2 +85,20 @@\n ctx\n${plus(86, 104)}\n` },
    { filename: "app/sync/Backoff.php", status: "modified", patch: `@@ -29,1 +29,5 @@\n ctx\n${plus(30, 33)}\n` },
  ];
  const gh = join(FIXTURE, "fakebin", "gh");
  writeFileSync(gh, readFileSync(gh, "utf8").replace(
    "esac",
    [`  *"pulls/${PR4}/files"*) cat <<'RSDEMO'`, JSON.stringify([files]), "RSDEMO", "  exit 0;;", "esac"].join("\n"),
  ));
}

export async function healthy(origin: string, ms = 30_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(`${origin}/health`);
      if (r.ok && (await r.text()).trim() === "ok") return true;
    } catch { /* not yet */ }
    await sleep(200);
  }
  return false;
}

export async function startServer(root: string, port: number, extra: Record<string, string> = {}) {
  const child = spawn("python3", [join(ROOT, "bin", "server.py")], {
    env: {
      ...process.env,
      PATH: `${join(root, "fakebin")}:${process.env.PATH || ""}`,
      ROOT: root,
      RS_SECRET: SECRET,
      RS_SPA: "1",
      RS_PORT: String(port),
      RS_COOKIE_SECURE: "0",
      ...extra,
    },
    stdio: "ignore",
  });
  if (!(await healthy(`http://127.0.0.1:${port}`))) {
    child.kill("SIGTERM");
    throw new Error(`no server on port ${port}`);
  }
  return child;
}

// ---- the review this script "runs" for PR4 ----------------------------------------------------

export const PR4_REVIEW = {
  event: "COMMENT",
  summary: "Retries the vendor sync on a 502 with exponential back-off. Two things to fix before merge.",
  keyPoints: [
    "The back-off is sound, but the cap is read before the config loads.",
    "A 502 storm is retried without jitter, so every client hammers the vendor at once.",
    "One nit: the retry counter is logged as a string.",
  ],
  explainer: "A COMMENT review — nothing here blocks the merge by itself.",
  analysis: "",
  comments: [
    {
      path: "app/sync/VendorSync.php",
      line: 88,
      severity: "should-fix",
      title: "The retry cap is read before the config is loaded",
      impact: "Every sync falls back to the default of one retry, so the new behaviour never kicks in.",
      body: "Move the `maxRetries` read inside `run()` so it sees the loaded config.",
      reply_to: null,
      suggestion: "",
    },
    {
      path: "app/sync/Backoff.php",
      line: 31,
      severity: "should-fix",
      title: "No jitter on the back-off",
      impact: "After a vendor outage every client retries on the same schedule and the vendor sees the storm again.",
      body: "Add ±20% jitter to each delay; the standard library's `random_int` is enough here.",
      reply_to: null,
      suggestion: "$delay = (int) ($delay * (0.8 + random_int(0, 40) / 100));",
    },
    {
      path: "app/sync/VendorSync.php",
      line: 102,
      severity: "nit",
      title: "The retry counter is logged as a string",
      impact: "Style only — the log line still reads correctly.",
      body: "Pass the integer; the logger formats it.",
      reply_to: null,
      suggestion: "",
    },
  ],
};

export function writeRun(status: string, review?: object) {
  const d = join(FIXTURE, "state", slug(REPO), PR4, "users", USER);
  mkdirSync(d, { recursive: true });
  if (review) writeFileSync(join(d, "review.json"), JSON.stringify(review));
  writeFileSync(join(d, "status"), status);
}

// ---- the recorder ----------------------------------------------------------------------------

// A visible pointer: headless Chromium records no cursor, so a viewer could not see what is
// about to be clicked. Desktop gets an arrow; the phone a translucent fingertip that shows only
// while pressed.
export const POINTER = (mobile: boolean) => `(() => {
  const mobile = ${mobile};
  let el = null;
  const mk = () => {
    if (el && el.isConnected) return el;
    el = document.createElement("div");
    el.id = "__rs_pointer";
    el.setAttribute("aria-hidden", "true");
    el.style.cssText = "position:fixed;left:0;top:0;pointer-events:none;z-index:2147483647;" +
      (mobile
        ? "width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:rgba(236,238,243,.35);" +
          "box-shadow:0 0 0 2px rgba(236,238,243,.5);opacity:0;transition:opacity .12s,transform .12s;"
        : "width:22px;height:28px;margin:-2px 0 0 -2px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6));" +
          "transition:transform .05s linear;") +
      "transform:translate(-100px,-100px);";
    if (!mobile) el.innerHTML = '<svg width="22" height="28" viewBox="0 0 22 28"><path d="M2 2 L2 22 L7.5 17 L11 25 L14.5 23.5 L11 15.5 L18 15.5 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    (document.documentElement).appendChild(el);
    return el;
  };
  let x = -100, y = -100;
  const place = () => { const e = mk(); e.style.transform = "translate(" + x + "px," + y + "px)" + (e.dataset.down ? " scale(.85)" : ""); };
  document.addEventListener("mousemove", (ev) => { x = ev.clientX; y = ev.clientY; place(); }, true);
  document.addEventListener("mousedown", (ev) => { x = ev.clientX; y = ev.clientY; const e = mk(); e.dataset.down = "1"; if (mobile) e.style.opacity = "1"; place(); }, true);
  document.addEventListener("mouseup", () => { const e = mk(); delete e.dataset.down; if (mobile) setTimeout(() => { e.style.opacity = "0"; }, 180); place(); }, true);
  // A swipe is touch, not mouse: the fingertip follows it too.
  document.addEventListener("touchstart", (ev) => { const t = ev.touches[0]; x = t.clientX; y = t.clientY; const e = mk(); e.dataset.down = "1"; if (mobile) e.style.opacity = "1"; place(); }, true);
  document.addEventListener("touchmove", (ev) => { const t = ev.touches[0]; x = t.clientX; y = t.clientY; place(); }, true);
  document.addEventListener("touchend", () => { const e = mk(); delete e.dataset.down; if (mobile) setTimeout(() => { e.style.opacity = "0"; }, 180); place(); }, true);
})();`;

// GitHub avatars are fetched from github.com; the demos must not depend on the network.
export const AVATAR_SVG = (seed: string) => {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="hsl(${h} 45% 55%)"/><circle cx="32" cy="26" r="11" fill="rgba(255,255,255,.85)"/><ellipse cx="32" cy="52" rx="18" ry="11" fill="rgba(255,255,255,.85)"/></svg>`;
};
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

export async function offline(ctx: BrowserContext) {
  await ctx.route(/https:\/\/github\.com\/([^/]+)\.png/, (route) => {
    const login = route.request().url().match(/github\.com\/([^/.]+)\.png/)?.[1] || "";
    return route.fulfill({ contentType: "image/svg+xml", body: AVATAR_SVG(login) });
  });
  await ctx.route("https://avatars.example.test/**", (r) => r.fulfill({ contentType: "image/png", body: PIXEL }));
}

/** Moves the pointer to the element over ~300 ms, then presses it. */
export async function click(page: Page, loc: Locator, settle = BEAT) {
  await loc.scrollIntoViewIfNeeded();
  await loc.waitFor({ state: "visible" });
  const b = (await loc.boundingBox())!;
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  const from = await page.evaluate(() => {
    const m = document.getElementById("__rs_pointer")?.style.transform.match(/translate\(([-\d.]+)px, ?([-\d.]+)px\)/);
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
  });
  const start = from && from.x > 0 ? from : { x: x - 160, y: y + 120 };
  const steps = 14;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, e = 1 - (1 - t) * (1 - t); // ease-out
    await page.mouse.move(start.x + (x - start.x) * e, start.y + (y - start.y) * e);
    await sleep(22);
  }
  await sleep(140);
  await page.mouse.down();
  await sleep(90);
  await page.mouse.up();
  await sleep(settle);
}

/** A one-finger swipe across an element, slow enough to follow (touch, via the DevTools protocol). */
export async function swipe(page: Page, loc: Locator, dx: number) {
  await loc.scrollIntoViewIfNeeded();
  const b = (await loc.boundingBox())!;
  const y = b.y + Math.min(40, b.height / 2);
  const x0 = dx > 0 ? b.x + 60 : b.x + b.width - 90;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y }] });
  const steps = 18;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, e = 1 - (1 - t) * (1 - t);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + dx * e, y: y + 2 * e }] });
    await sleep(24);
  }
  await sleep(120);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
  await sleep(BEAT);
}

/** Scrolls by `dy` in small wheel steps so the viewer sees the page move. */
export async function scroll(page: Page, dy: number) {
  const n = 10;
  for (let i = 0; i < n; i++) {
    await page.mouse.wheel(0, dy / n);
    await sleep(30);
  }
  await sleep(300);
}

type Cue = { mark: () => void; poster: () => void };
type Demo = {
  name: string;
  viewport: Size;
  mobile?: boolean;
  gifWidth: number;
  cookies?: () => ReturnType<typeof sessionCookie>[];
  run: (page: Page, ctx: BrowserContext, cue: Cue) => Promise<void>;
};

async function record(browser: Browser, d: Demo) {
  const dir = join(TMP, d.name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({
    viewport: d.viewport,
    deviceScaleFactor: 2,
    isMobile: !!d.mobile,
    hasTouch: !!d.mobile,
    colorScheme: "dark",
    reducedMotion: "no-preference",
    recordVideo: { dir, size: { width: d.viewport.width * 2, height: d.viewport.height * 2 } },
  });
  // Dark is the app's default whatever the OS says (theme.ts); make sure nothing stored says otherwise.
  await ctx.addInitScript(() => { try { localStorage.removeItem("rs-theme"); } catch {} });
  await ctx.addInitScript(POINTER(!!d.mobile));
  await offline(ctx);
  if (d.cookies) await ctx.addCookies(d.cookies());
  const page = await ctx.newPage();
  const t0 = Date.now();
  let first = 0, poster = 0;
  const cue: Cue = {
    mark: () => { if (!first) first = Date.now() - t0; },
    poster: () => { poster = Date.now() - t0; },
  };
  await d.run(page, ctx, cue);
  const end = Date.now() - t0;
  const video = page.video()!;
  await ctx.close();
  const webm = await video.path();
  // Start a touch after the first marked frame — the video's clock and ours differ by the
  // encoder's own latency — and end a beat before the context closed.
  const ss = Math.max(0, first / 1000 + 0.25);
  const to = Math.max(ss + 1, end / 1000 - 0.15);
  return { webm, ss, to, poster: Math.min(Math.max(poster / 1000, ss + 0.5), to - 0.2), gifWidth: d.gifWidth };
}

function ff(args: string[]) {
  execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
}

function encode(name: string, r: { webm: string; ss: number; to: number; poster: number; gifWidth: number }) {
  mkdirSync(SITE_OUT, { recursive: true });
  const mp4 = join(SITE_OUT, `${name}.mp4`);
  const gif = join(SITE_OUT, `${name}.gif`);
  // A JPEG poster, not PNG: a 1 MB PNG poster on the landing page took Lighthouse from 99 to 77.
  const png = join(SITE_OUT, `${name}.jpg`);
  const cut = ["-ss", r.ss.toFixed(2), "-to", r.to.toFixed(2), "-i", r.webm];
  // MP4: the whole 2x frame, even dimensions, crf tuned down until it fits the budget.
  for (const crf of [26, 29, 32, 35]) {
    ff([...cut, "-an", "-c:v", "libx264", "-preset", "slow", "-crf", String(crf), "-pix_fmt", "yuv420p",
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-movflags", "+faststart", "-r", "30", mp4]);
    if (statSync(mp4).size <= MP4_BUDGET) break;
  }
  // GIF: 12 fps, downscaled, one palette for the whole clip, dithered lightly.
  for (const w of [r.gifWidth, Math.round(r.gifWidth * 0.85), Math.round(r.gifWidth * 0.7)]) {
    ff([...cut, "-an", "-vf",
        `fps=12,scale=${w}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
        "-loop", "0", gif]);
    if (statSync(gif).size <= GIF_BUDGET) break;
  }
  // Poster: the frame the clip is about, at the MP4's size.
  ff(["-ss", r.poster.toFixed(2), "-i", r.webm, "-frames:v", "1", "-vf", "scale='min(1440,iw)':-2", "-q:v", "4", png]);
  mkdirSync(DOCS_OUT, { recursive: true });
  for (const f of [mp4, gif, png]) copyFileSync(f, join(DOCS_OUT, f.slice(f.lastIndexOf("/") + 1)));
  const dur = execFileSync(FFMPEG.replace(/ffmpeg$/, "ffprobe"), ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp4]).toString().trim();
  const kb = (p: string) => `${(statSync(p).size / 1024).toFixed(0)} KB`;
  console.log(`${name}: mp4 ${kb(mp4)} (${Number(dur).toFixed(1)} s), gif ${kb(gif)}, jpg ${kb(png)}`);
  if (statSync(mp4).size > MP4_BUDGET) throw new Error(`${name}.mp4 is over 2.5 MB`);
  if (statSync(gif).size > GIF_BUDGET) throw new Error(`${name}.gif is over 4 MB`);
}

// ---- the demos --------------------------------------------------------------------------------

export async function settled(page: Page) {
  await page.getByTestId("pr-loading").waitFor({ state: "detached", timeout: 15_000 });
  await page.locator('[data-slot="skeleton"]').first().waitFor({ state: "detached", timeout: 15_000 }).catch(() => {});
}

/** Findings arrive unticked, so the demo can show the tick. */
export async function unticked(page: Page) {
  await patchJson(page, "**/api/pr?*", (body) =>
    body.review
      ? { review: { ...body.review, findings: (body.review.findings || []).map((f: object) => ({ ...f, preselect: false })) } }
      : {},
  );
}

export const POSTED_BANNER = (inline: number, summary: number) =>
  "<div class='banner ok'><span>✓</span><div>Posted your review as <code>" + USER + "</code> — " +
  (inline && summary ? `${inline} inline, ${summary} in the summary.` : `${inline} inline comments.`) + "</div></div>";

export async function stubPost(page: Page, inline: number, summary: number) {
  await page.route("**/api/post", (route) => route.fulfill({ json: { bannerHtml: POSTED_BANNER(inline, summary) } }));
}

const review: Demo = {
  name: "review",
  viewport: DESKTOP,
  gifWidth: 960,
  cookies: () => [sessionCookie()],
  run: async (page, _ctx, cue) => {
    await unticked(page);
    await stubPost(page, 2, 0);
    await page.route("**/api/review", async (route) => {
      writeRun("fetching the PR");
      await route.fulfill({ json: { ok: true, started: true } });
    });
    await page.goto(`${ORIGIN}/?tab=all`);
    await page.getByTestId("queue-row").first().waitFor();
    await page.locator('[data-slot="skeleton"]').first().waitFor({ state: "detached", timeout: 15_000 }).catch(() => {});
    await sleep(400);
    cue.mark();
    await sleep(900);
    // Paste a PR URL into the queue's one field and open it.
    const field = page.locator("#qsearch");
    await click(page, field, 200);
    await field.pressSequentially(`https://github.com/${REPO}/pull/${PR4}`, { delay: 26 });
    await page.getByTestId("open-pr").waitFor();
    await sleep(500);
    await field.press("Enter");
    await settled(page);
    await page.getByTestId("run-form").waitFor();
    await sleep(HOLD);
    // Start the review. The "run" is staged on disk while the page polls the real server.
    await click(page, page.getByTestId("run-form").getByRole("button", { name: /^(run|start) review/i }), 200);
    await page.getByTestId("progress-panel").waitFor();
    const stage = (async () => {
      await sleep(1500); writeRun("checking out the branch");
      await sleep(1800); writeRun("reviewing the diff");
      await sleep(2200); writeRun("done", PR4_REVIEW);
    })();
    await page.locator(".finding").first().waitFor({ timeout: 25_000 });
    await stage;
    await sleep(300);
    cue.poster();
    await sleep(HOLD);
    // Tick two of the three findings, then post them.
    const ticks = page.locator(".finding").getByTestId("finding-select");
    await click(page, ticks.nth(0));
    await click(page, ticks.nth(1));
    await page.getByTestId("commit-bar").getByText("2 staged").waitFor();
    await sleep(400);
    await click(page, page.getByTestId("commit-bar").getByRole("button", { name: /post selected/i }), 300);
    await page.getByTestId("commit-posted").waitFor();
    await sleep(1800);
  },
};

const phone: Demo = {
  name: "phone",
  viewport: PHONE,
  mobile: true,
  gifWidth: 390,
  cookies: () => [sessionCookie()],
  run: async (page, _ctx, cue) => {
    await unticked(page);
    await stubPost(page, 1, 1);
    // Everything you have open, the reviewed PR among it, in the phone's list rows.
    await page.goto(`${ORIGIN}/?tab=all`);
    const row = page.getByTestId("queue-row").filter({ hasText: `#${PR}` });
    await row.waitFor();
    await page.locator('[data-slot="skeleton"]').first().waitFor({ state: "detached", timeout: 15_000 }).catch(() => {});
    await sleep(400);
    cue.mark();
    await sleep(1200);
    await click(page, row.getByTestId("row-link"), 200);
    await settled(page);
    await page.locator(".finding").first().waitFor();
    await sleep(HOLD);
    const first = page.getByTestId("finding").first();
    const b = (await first.boundingBox())!;
    await scroll(page, Math.max(0, b.y - 300));
    // Swipe right to keep: two findings, the pill counting each one.
    await swipe(page, page.getByTestId("finding").nth(0), 220);
    await page.getByTestId("post-pill").getByText("1 kept").waitFor();
    await swipe(page, page.getByTestId("finding").nth(1), 220);
    await page.getByTestId("post-pill").getByText("2 kept").waitFor();
    await sleep(500);
    await click(page, page.getByTestId("post-pill"), 300);
    await page.getByTestId("post-sheet").waitFor();
    await sleep(400);
    cue.poster();
    await sleep(HOLD - 400);
    await click(page, page.getByTestId("post-confirm"), 300);
    await page.getByTestId("post-success").waitFor();
    await page.getByTestId("post-next").waitFor().catch(() => {});
    await sleep(2400);
  },
};

const wizard: Demo = {
  name: "wizard",
  viewport: DESKTOP,
  gifWidth: 960,
  run: async (page, ctx, cue) => {
    // GitHub: the token form. The fixture's fake gh cannot verify a token, so the sign-in is
    // answered here and the session cookie the server would set is added to the context.
    await page.route("**/api/login", async (route) => {
      await ctx.addCookies([sessionCookie(PERSONAL_USER)]);
      await route.fulfill({ json: { ok: true, login: PERSONAL_USER, welcome: true } });
    });
    // Claude: start hands back an address (the window it would open is suppressed), the pasted
    // code connects, and /api/me says so from then on.
    let claude = false;
    await page.addInitScript("window.open = () => null;");
    await page.route("**/api/claude/start", (route) =>
      route.fulfill({ json: { bannerHtml: "", connected: false, authUrl: "https://claude.ai/oauth/authorize?demo=1" } }));
    await page.route("**/api/claude/code", (route) => {
      claude = true;
      return route.fulfill({ json: { connected: true, bannerHtml: "<div class='banner ok'><span>✓</span><div>Connected — reviews run on your Claude account.</div></div>" } });
    });
    await patchJson(page, "**/api/me", () => (claude ? { claude_connected: true } : {}));

    await page.goto(`${PERSONAL_ORIGIN}/welcome`);
    await page.getByTestId("welcome-github").waitFor();
    await page.getByLabel("GitHub personal access token").waitFor();
    await sleep(400);
    cue.mark();
    await sleep(800);
    const pat = page.getByLabel("GitHub personal access token");
    await click(page, pat, 200);
    await pat.pressSequentially("ghp_6kQ2vN8xP1rT4wZ9yB3cD5fG7hJ0kL2mN4pQ", { delay: 9 });
    await sleep(300);
    await click(page, page.getByRole("button", { name: /sign in with token/i }), 200);
    await page.waitForURL(/\/welcome\/claude$/);
    await page.getByRole("button", { name: /Connect with Claude/ }).waitFor();
    await sleep(1100);
    await click(page, page.getByRole("button", { name: /Connect with Claude/ }), 300);
    const code = page.getByLabel("Code from Claude");
    await code.waitFor();
    await click(page, code, 200);
    await code.pressSequentially("sk-ant-oat01-demo-7Kq2…", { delay: 14 });
    await sleep(300);
    await click(page, page.getByRole("button", { name: /^Connect$/ }), 200);
    await page.waitForURL(/\/welcome\/repos$/);
    await page.getByTestId("repo-row").first().waitFor();
    await sleep(1100);
    cue.poster();
    await click(page, page.getByRole("checkbox", { name: "acme-solo/widgets" }));
    await click(page, page.getByRole("checkbox", { name: "acme/api" }));
    await page.getByTestId("repo-count").getByText("2 selected").waitFor();
    await sleep(400);
    await click(page, page.getByTestId("start-reviewing"), 300);
    await page.getByTestId("page-header").getByText("Your review queue").waitFor();
    await page.locator('[data-slot="skeleton"]').first().waitFor({ state: "detached", timeout: 15_000 }).catch(() => {});
    await sleep(1600);
  },
};

// A QR code the way desktop/main.js draws it (`qrcode`, a dev dependency here at the desktop's version).
export async function qrDataUrl(url: string) {
  const mod = await import("qrcode");
  const QRCode = (mod.default ?? mod) as { toDataURL: (s: string, o: object) => Promise<string> };
  return QRCode.toDataURL(url, { margin: 1, width: 280, color: { dark: "#ECEEF3", light: "#0B0C10" } });
}

const phoneAccess: Demo = {
  name: "phone-access",
  viewport: PHONE_WINDOW,
  gifWidth: 440,
  run: async (page, _ctx, cue) => {
    const url = "https://quiet-river-ab12.trycloudflare.com";
    const dataUrl = await qrDataUrl(`${url}/pair/9fYq3Lw2Zt8vK1pR0sX6uH4nB7mC5dE2`);
    // The window's bridge (desktop/preload.cjs) is faked: it hands the page one data frame.
    // As a string: tsx serialises a function with an esbuild `__name` helper the page lacks.
    await page.addInitScript(
      "window.reviewstage = { phone: { onData: (cb) => { window.__rsPhone = cb; }, disable: () => {} } };",
    );
    await page.goto(`file://${join(ROOT, "desktop", "pages", "phone.html")}`);
    await page.evaluate(
      "window.__rsPhone(" + JSON.stringify({ url, dataUrl, check: "ok" }) + ")",
    );
    await page.locator("#qr").waitFor({ state: "visible" });
    await sleep(300);
    cue.mark();
    await sleep(2500);
    cue.poster();
    await sleep(3700);
  },
};

// ---- main ---------------------------------------------------------------------------------------

async function main() {
  const want = process.argv.slice(2);
  const all: Demo[] = [review, wizard, phone, phoneAccess];
  const demos = want.length ? all.filter((d) => want.includes(d.name)) : all;
  if (!demos.length) throw new Error(`unknown demo; choose from ${all.map((d) => d.name).join(", ")}`);
  const servers: ChildProcess[] = [];
  mkdirSync(TMP, { recursive: true });
  if (demos.some((d) => d === review || d === phone)) {
    demoFixture();
    servers.push(await startServer(FIXTURE, PORT));
  }
  if (demos.includes(wizard)) {
    buildPersonalFixture();
    const env = join(PERSONAL_FIXTURE, ".env");
    writeFileSync(env, readFileSync(env, "utf8").replace("DRY_RUN=1", "DRY_RUN=0"));
    servers.push(await startServer(PERSONAL_FIXTURE, PERSONAL_PORT));
  }
  // recordVideo captures the viewport in CSS pixels whatever the context's deviceScaleFactor
  // says; forcing the browser's own scale factor is what makes the frames genuinely 2x.
  const browser = await chromium.launch({ args: ["--force-device-scale-factor=2"] });
  try {
    for (const d of demos) {
      console.log(`recording ${d.name}…`);
      const r = await record(browser, d);
      encode(d.name, r);
    }
  } finally {
    await browser.close();
    for (const s of servers) s.kill("SIGTERM");
  }
}

// Run only when invoked as the script, so launch-video.ts can reuse the helpers above.
if (process.argv[1]?.endsWith("demos.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
