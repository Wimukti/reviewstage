// The launch video: one recording session, cut and composed with ffmpeg into
//
//   reviewstage-launch-1080p.mp4        1920×1080, ~90 s, burned-in captions (feeds autoplay muted)
//   reviewstage-launch-1080p-clean.mp4  the same edit without captions, for the voice-over
//   reviewstage-launch-vertical.mp4     1080×1920, ~36 s, phone-first, captions in the safe area
//   reviewstage-launch-thumbnail.png    1280×720 YouTube thumbnail
//   github-social-preview.png           1280×640 repository social preview
//   captions.srt                        the burned-in captions, for the YouTube upload
//   voiceover-script.md                 the spoken lines, timed to the clean cut
//
//   RS_E2E_PORT=9005 RS_VIDEO_OUT=~/Desktop/reviewstage-launch pnpm launch-video
//
// Everything on screen comes from the offline e2e fixtures through the same machinery as
// demos.ts (pointer overlay, staged review run, stubbed /api/post and Claude connect), so no
// real repository, person or review appears. The cards (hook, terminal, end) and every overlay
// (window chrome, phone frame, notifications, captions) are HTML rendered by the same Chromium.
// Recordings are 2x and scaled down, so every UI frame stays crisp.
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FFMPEG, POINTER, PR4_REVIEW, ROOT, click, demoFixture, offline, qrDataUrl, settled, sleep,
  startServer, stubPost, swipe, unticked, writeRun, scroll,
} from "./demos";
import { FIXTURE, PORT, PR, PR4, REPO, USER, patchJson, sessionCookie } from "./fixture";
import { buildPersonalFixture, PERSONAL_FIXTURE, PERSONAL_ORIGIN, PERSONAL_PORT, PERSONAL_USER } from "./personal-fixture";

const HERE = dirname(fileURLToPath(import.meta.url));
const TMP = join(HERE, ".launch-video");
const OUT = process.env.RS_VIDEO_OUT || join(TMP, "out");
const ORIGIN = `http://127.0.0.1:${PORT}`;
const FFPROBE = FFMPEG.replace(/ffmpeg$/, "ffprobe");
const FPS = 30;
const X = 7 / FPS; // cross-fade length: 7 frames
const MAX_MB = 60;

type Size = { width: number; height: number };
const APP: Size = { width: 1280, height: 720 }; // 2x → 2560×1440, scaled to 1536×864 in the window
const PHONE: Size = { width: 390, height: 844 }; // 2x → 780×1688
const CARD_H: Size = { width: 960, height: 540 }; // 2x → 1920×1080
const CARD_V: Size = { width: 540, height: 960 }; // 2x → 1080×1920

// ---- geometry of the compositions (output pixels) ----------------------------------------------

const W_H = { w: 1920, h: 1080 };
const W_V = { w: 1080, h: 1920 };
// The app window in the 16:9 cut: title bar above, the recording under it, captions below.
const WIN = { x: 192, y: 60, w: 1536, h: 864, bar: 36 };
// Scene 8: desktop on the left, the phone on the right.
const SIDE = { x: 96, y: 214, w: 1056, h: 594, bar: 32 };
const PH_H = { x: 1238, y: 64, w: 398, h: 862, bezel: 14, r: 46 };
// The vertical cut: the phone between the top (220 px) and bottom (420 px) platform chrome.
const PH_V = { x: 286, y: 400, w: 508, h: 1100, bezel: 15, r: 58 };
const CAP_BOTTOM_H = 1052; // bottom edge of a caption pill in the 16:9 cut
const CAP_TOP_V = 232; // top edge of a caption pill in the vertical cut (below the 220 px band)

// ---- small utilities ---------------------------------------------------------------------------

const fileUrl = (p: string) => `file://${p}`;
const FONT = fileUrl(join(HERE, "..", "node_modules", "@fontsource-variable", "geist", "files", "geist-latin-wght-normal.woff2"));
const MONO = fileUrl(join(HERE, "..", "node_modules", "@fontsource-variable", "geist-mono", "files", "geist-mono-latin-wght-normal.woff2"));
const LOGO = readFileSync(join(ROOT, "assets", "logo-light.svg"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
const logo = (px: number) => LOGO.replace(/width="640" height="640"/, `width="${px}" height="${px}"`);

function ff(args: string[]) {
  execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
}
function probe(file: string) {
  const out = execFileSync(FFPROBE, [
    "-v", "error", "-show_entries", "format=duration:stream=width,height,codec_type,codec_name,profile,pix_fmt,r_frame_rate",
    "-of", "json", file,
  ]).toString();
  return JSON.parse(out) as { format: { duration: string }; streams: { codec_type: string; width?: number; height?: number; codec_name: string; profile?: string; pix_fmt?: string; r_frame_rate?: string }[] };
}
const duration = (file: string) => Number(probe(file).format.duration);
const mb = (file: string) => statSync(file).size / 1024 / 1024;
const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// The shared look: tokens from src/tokens.css, the Geist faces, the stage light.
const BASE_CSS = `
@font-face { font-family: "Geist"; src: url("${FONT}") format("woff2"); font-weight: 100 900; }
@font-face { font-family: "Geist Mono"; src: url("${MONO}") format("woff2"); font-weight: 100 900; }
:root {
  --paper:#0B0C10; --panel:#12141A; --raised:#181B23; --ink:#ECEEF3; --graphite:#9AA0B4;
  --hairline:#22262F; --blue:#7A83FF; --green:#3DD98F; --amber:#E0A63A; --red:#F0718A;
  --light:rgba(255,225,176,.17); --light-strong:rgba(255,225,176,.38);
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--paper); color: var(--ink); font-family: "Geist", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased; text-rendering: geometricPrecision; overflow: hidden; }
.stage { position: fixed; inset: 0;
  background: radial-gradient(ellipse 72% 62% at 50% -12%, var(--light-strong) 0%, var(--light) 36%, rgba(255,225,176,0) 72%), var(--paper); }
.transparent, .transparent body { background: transparent !important; }
`;

function htmlPage(name: string, body: string, css = "", script = "", transparent = false) {
  const dir = join(TMP, "html");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.html`);
  writeFileSync(file, `<!doctype html><html class="${transparent ? "transparent" : ""}"><head><meta charset="utf-8"><style>${BASE_CSS}${css}</style></head><body>${body}<script>${script}</script></body></html>`);
  return fileUrl(file);
}

// ---- recording ---------------------------------------------------------------------------------

type Clip = { webm: string; marks: Record<string, number>; end: number };

/** Records one context. `mark(k)` stamps a named moment on the video's clock; "start" is required. */
async function record(
  browser: Browser,
  name: string,
  opts: { viewport: Size; mobile?: boolean; cookies?: ReturnType<typeof sessionCookie>[]; pointer?: boolean },
  run: (page: Page, ctx: BrowserContext, mark: (k: string) => void) => Promise<void>,
): Promise<Clip> {
  const dir = join(TMP, "rec", name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({
    viewport: opts.viewport,
    deviceScaleFactor: 2,
    isMobile: !!opts.mobile,
    hasTouch: !!opts.mobile,
    colorScheme: "dark",
    reducedMotion: "no-preference",
    recordVideo: { dir, size: { width: opts.viewport.width * 2, height: opts.viewport.height * 2 } },
  });
  await ctx.addInitScript(() => { try { localStorage.removeItem("rs-theme"); } catch { /* private */ } });
  if (opts.pointer !== false) await ctx.addInitScript(POINTER(!!opts.mobile));
  await offline(ctx);
  if (opts.cookies) await ctx.addCookies(opts.cookies);
  const page = await ctx.newPage();
  const t0 = Date.now();
  const marks: Record<string, number> = {};
  await run(page, ctx, (k) => { marks[k] = (Date.now() - t0) / 1000; });
  const end = (Date.now() - t0) / 1000;
  const video = page.video()!;
  await ctx.close();
  if (marks.start === undefined) throw new Error(`${name}: no start mark`);
  return { webm: await video.path(), marks, end };
}

/** A card: an HTML page whose animations start when `go()` adds the class, held for `secs`. */
async function recordCard(browser: Browser, name: string, viewport: Size, url: string, secs: number) {
  return record(browser, name, { viewport, pointer: false }, async (page, _ctx, mark) => {
    await page.goto(url);
    await page.evaluate("document.fonts.ready");
    await sleep(300);
    await page.evaluate("document.body.classList.add('go'); window.go && window.go()");
    mark("start");
    await sleep(secs * 1000 + 400);
  });
}

// ---- the scenes ----------------------------------------------------------------------------------

/** Moves the page so `y` (viewport px) of the target lands near `top`, in visible wheel steps. */
async function bring(page: Page, sel: ReturnType<Page["locator"]>, top = 150) {
  const b = await sel.boundingBox();
  if (b && Math.abs(b.y - top) > 30) await scroll(page, b.y - top);
}

const hookHtml = (v: boolean) => htmlPage(`hook-${v ? "v" : "h"}`, `
  <div class="stage"></div>
  <main><h1><span class="l1">AI wrote the PR.</span><span class="l2">You still have to review it.</span></h1></main>`, `
  main { position: fixed; inset: 0; display: grid; place-items: center; text-align: center; padding: 0 ${v ? 36 : 60}px; }
  h1 { margin: 0; font-weight: 650; letter-spacing: -.035em; line-height: 1.08; font-size: ${v ? 50 : 64}px;
    transform: scale(1); }
  .go h1 { animation: push 5.5s linear forwards; }
  h1 span { display: block; opacity: 0; transform: translateY(14px); }
  .l2 { color: var(--blue); margin-top: ${v ? 18 : 10}px; }
  .go .l1 { animation: rise .7s cubic-bezier(.2,.7,.2,1) .25s forwards; }
  .go .l2 { animation: rise .7s cubic-bezier(.2,.7,.2,1) 1.45s forwards; }
  @keyframes rise { to { opacity: 1; transform: none; } }
  @keyframes push { to { transform: scale(1.035); } }`);

const terminalHtml = (v: boolean) => htmlPage(`terminal-${v ? "v" : "h"}`, `
  <div class="stage"></div>
  <div class="win">
    <div class="bar"><i></i><i></i><i></i><span>Terminal — zsh</span></div>
    <pre id="t"><span class="p">~ %</span> <span id="cmd"></span><span class="cur" id="c1"></span></pre>
  </div>`, `
  .win { position: fixed; left: 50%; top: 50%; width: ${v ? 470 : 640}px; transform: translate(-50%, -50%);
    background: #0E1015; border: 1px solid #2A2E39; border-radius: 12px; overflow: hidden;
    box-shadow: 0 30px 80px -20px rgba(0,0,0,.85), 0 0 0 1px rgba(0,0,0,.4); }
  .bar { height: 34px; display: flex; align-items: center; gap: 8px; padding: 0 14px; background: #171A21;
    border-bottom: 1px solid #23262F; position: relative; }
  .bar i { width: 12px; height: 12px; border-radius: 50%; background: #FF5F57; display: block; }
  .bar i:nth-child(2) { background: #FEBC2E; } .bar i:nth-child(3) { background: #28C840; }
  .bar span { position: absolute; left: 0; right: 0; text-align: center; font-size: 13px; color: var(--graphite); }
  pre { margin: 0; padding: 20px 22px ${v ? 26 : 30}px; min-height: ${v ? 230 : 190}px; font-family: "Geist Mono", monospace;
    font-size: ${v ? 17 : 19}px; line-height: 1.6; white-space: pre-wrap; color: var(--ink); }
  .p { color: var(--green); }
  .out { color: var(--ink); }
  .cur { display: inline-block; width: .6em; height: 1.15em; vertical-align: -.2em; background: var(--ink); margin-left: 2px;
    animation: blink 1s steps(1) infinite; }
  @keyframes blink { 50% { opacity: 0; } }`, `
  window.go = () => {
    const cmd = "npx reviewstage", el = document.getElementById("cmd"), t = document.getElementById("t");
    let i = 0;
    setTimeout(function type() {
      el.textContent = cmd.slice(0, ++i);
      if (i < cmd.length) setTimeout(type, 62 + (i % 3) * 14);
      else setTimeout(() => {
        document.getElementById("c1").remove();
        t.insertAdjacentHTML("beforeend", "\\n");
        setTimeout(() => {
          t.insertAdjacentHTML("beforeend", '<span class="out">ReviewStage is running. You can close this terminal.</span>\\n<span class="p">~ %</span> <span class="cur"></span>');
        }, 950);
      }, 380);
    }, 450);
  };`);

const endHtml = (v: boolean) => htmlPage(`end-${v ? "v" : "h"}`, `
  <div class="stage"></div>
  <main>
    <div class="mark a1">${logo(v ? 104 : 92)}</div>
    <div class="name a1">ReviewStage</div>
    <div class="cmd a2"><span>$</span> npx reviewstage</div>
    <div class="links a3"><span>reviewstage.dev</span><span>github.com/Wimukti/reviewstage</span></div>
    <div class="foot a4">Open source · MIT · Runs on your Claude plan</div>
  </main>`, `
  main { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
    text-align: center; gap: ${v ? 22 : 16}px; padding: 0 24px; }
  .go main { animation: push 8s linear forwards; }
  @keyframes push { from { transform: scale(1); } to { transform: scale(1.025); } }
  .mark svg { display: block; }
  .name { font-size: ${v ? 40 : 38}px; font-weight: 650; letter-spacing: -.03em; margin-top: -4px; }
  .cmd { font-family: "Geist Mono", monospace; font-size: ${v ? 26 : 26}px; padding: 12px 22px; border-radius: 12px;
    background: rgba(18,20,26,.85); border: 1px solid var(--hairline); margin-top: 10px; }
  .cmd span { color: var(--green); margin-right: 6px; }
  .links { display: flex; ${v ? "flex-direction: column; gap: 10px;" : "gap: 28px;"} font-size: ${v ? 23 : 22}px; color: var(--ink); margin-top: 6px; }
  .links span:first-child { color: var(--blue); }
  .foot { font-size: ${v ? 19 : 17}px; color: var(--graphite); margin-top: 4px; }
  .a1, .a2, .a3, .a4 { opacity: 0; transform: translateY(10px); }
  .go .a1 { animation: rise .7s cubic-bezier(.2,.7,.2,1) .15s forwards; }
  .go .a2 { animation: rise .7s cubic-bezier(.2,.7,.2,1) .6s forwards; }
  .go .a3 { animation: rise .7s cubic-bezier(.2,.7,.2,1) 1.0s forwards; }
  .go .a4 { animation: rise .7s cubic-bezier(.2,.7,.2,1) 1.4s forwards; }
  @keyframes rise { to { opacity: 1; transform: none; } }`);

/** The first-run wizard on the personal fixture (as demos.ts, paced for a 1.75× speed-up). */
async function recordWizard(browser: Browser) {
  return record(browser, "wizard", { viewport: APP }, async (page, ctx, mark) => {
    await page.route("**/api/login", async (route) => {
      await ctx.addCookies([sessionCookie(PERSONAL_USER)]);
      await route.fulfill({ json: { ok: true, login: PERSONAL_USER, welcome: true } });
    });
    let claude = false;
    await page.addInitScript("window.open = () => null;");
    await page.route("**/api/claude/start", (route) =>
      route.fulfill({ json: { bannerHtml: "", connected: false, authUrl: "https://claude.ai/oauth/authorize?demo=1" } }));
    await page.route("**/api/claude/code", (route) => {
      claude = true;
      return route.fulfill({ json: { connected: true, bannerHtml: "<div class='banner ok'><span>✓</span><div>Connected — reviews run on your Claude account.</div></div>" } });
    });
    // The in-process poller runs as soon as repositories are picked; the fixture has none, so say so.
    await patchJson(page, "**/api/me", () => (claude ? { claude_connected: true, poller_ran: true } : {}));
    await page.goto(`${PERSONAL_ORIGIN}/welcome`);
    await page.getByLabel("GitHub personal access token").waitFor();
    await sleep(400);
    mark("start");
    await sleep(900);
    const pat = page.getByLabel("GitHub personal access token");
    await click(page, pat, 200);
    await pat.pressSequentially("ghp_6kQ2vN8xP1rT4wZ9yB3cD5fG7hJ0kL2mN4pQ", { delay: 12 });
    await sleep(400);
    await click(page, page.getByRole("button", { name: /sign in with token/i }), 200);
    await page.waitForURL(/\/welcome\/claude$/);
    await page.getByRole("button", { name: /Connect with Claude/ }).waitFor();
    mark("claude");
    await sleep(1400);
    await click(page, page.getByRole("button", { name: /Connect with Claude/ }), 300);
    const code = page.getByLabel("Code from Claude");
    await code.waitFor();
    await click(page, code, 200);
    await code.pressSequentially("sk-ant-oat01-demo-7Kq2…", { delay: 18 });
    await sleep(400);
    await click(page, page.getByRole("button", { name: /^Connect$/ }), 200);
    await page.waitForURL(/\/welcome\/repos$/);
    await page.getByTestId("repo-row").first().waitFor();
    mark("repos");
    await sleep(1300);
    await click(page, page.getByRole("checkbox", { name: "acme-solo/widgets" }));
    await click(page, page.getByRole("checkbox", { name: "acme/api" }));
    await page.getByTestId("repo-count").getByText("2 selected").waitFor();
    await sleep(500);
    await click(page, page.getByTestId("start-reviewing"), 300);
    await page.getByTestId("page-header").getByText("Your review queue").waitFor();
    await page.locator('[data-slot="skeleton"]').first().waitFor({ state: "detached", timeout: 15_000 }).catch(() => {});
    mark("queue");
    await sleep(1800);
  });
}

/**
 * Scenes 4–6 in one take: the empty queue, the request arriving, the PR opened, the review run,
 * two findings ticked, one edited, posted. Also saves the frame with "2 staged" for the stills.
 */
async function recordDesk(browser: Browser) {
  return record(browser, "desk", { viewport: APP, cookies: [sessionCookie()] }, async (page, _ctx, mark) => {
    await stubPost(page, 2, 0);
    // Findings arrive unticked (as demos.ts's unticked(), in one handler: a second route on the
    // same glob would never run), and no model picker: the fixture's Default model has an empty
    // key, which the Select cannot show.
    await patchJson(page, "**/api/pr?*", (body) => ({
      ...(body.review ? { review: { ...body.review, findings: (body.review.findings || []).map((f: object) => ({ ...f, preselect: false })) } } : {}),
      ...(body.runForm ? { runForm: { ...body.runForm, models: [] } } : {}),
    }));
    // Until the request "arrives", the queue answers as if #38851 were not there yet.
    let arrived = false;
    await page.route("**/api/queue?*", async (route) => {
      const r = await route.fetch();
      const body = await r.json();
      if (!arrived) {
        body.rows = (body.rows || []).filter((row: { num: string }) => row.num !== PR4);
        for (const t of body.tabs || []) if (t.key === "todo" || t.key === "all") t.count -= 1;
        if (body.stats) body.stats.todo = Math.max(0, (body.stats.todo || 1) - 1);
      }
      await route.fulfill({ response: r, json: body });
    });
    // The queue reloads when the running-jobs list changes; the request "arriving" is staged as
    // one such change (a QA job on another repo, its top-bar sweep hidden for the take).
    await patchJson(page, "**/api/me", () =>
      arrived ? { running: [{ kind: "qa", repo: "acme/api", num: "7", title: "Rate-limit the lead-time endpoint", status: "writing the guide", href: "/qa" }] } : {});
    await page.route("**/api/review", async (route) => {
      writeRun("fetching the PR");
      await route.fulfill({ json: { ok: true, started: true } });
    });
    await page.goto(`${ORIGIN}/`);
    await page.getByTestId("page-header").waitFor();
    await page.locator('[data-slot="skeleton"]').first().waitFor({ state: "detached", timeout: 15_000 }).catch(() => {});
    await page.addStyleTag({ content: ".runbar{display:none!important}" + NEW_ROW_CSS });
    await sleep(500);
    mark("start");
    // Park the pointer out of the way, mid-page.
    await page.mouse.move(980, 560, { steps: 6 });
    await sleep(2100);
    arrived = true;
    await page.evaluate("document.dispatchEvent(new Event('visibilitychange'))");
    const row = page.getByTestId("queue-row").filter({ hasText: `#${PR4}` });
    await row.waitFor();
    await page.evaluate(`document.querySelectorAll('[data-testid="queue-row"]').forEach((r) => { if (r.textContent.includes('#${PR4}')) r.classList.add('rs-new'); })`);
    mark("arrived");
    await sleep(3600);
    // ---- scene 5: open it and run a review
    mark("s5");
    await click(page, row.getByTestId("row-link"), 200);
    await settled(page);
    await page.getByTestId("run-form").waitFor();
    await sleep(1400);
    await click(page, page.locator("#run-effort"), 300);
    const standard = page.getByRole("option", { name: /Standard/ });
    await standard.waitFor();
    await sleep(700);
    await click(page, standard, 500);
    await click(page, page.getByTestId("run-form").getByRole("button", { name: /^(run|start) review/i }), 200);
    mark("run");
    await page.getByTestId("progress-panel").waitFor();
    const stage = (async () => {
      await sleep(2200); writeRun("checking out the branch");
      await sleep(2600); writeRun("reviewing the diff");
      await sleep(3000); writeRun("done", PR4_REVIEW);
    })();
    await page.locator(".finding").first().waitFor({ timeout: 30_000 });
    await stage;
    mark("findings");
    await sleep(900);
    await bring(page, page.locator(".finding").first(), 230);
    await sleep(1800);
    // ---- scene 6: tick two, edit one, post
    mark("s6");
    const ticks = page.locator(".finding").getByTestId("finding-select");
    await click(page, ticks.nth(0));
    await click(page, ticks.nth(1));
    await page.getByTestId("commit-bar").getByText("2 staged").waitFor();
    await sleep(300);
    // The still for the thumbnail and the social preview: the pointer hidden, the bar lit.
    await page.evaluate("document.getElementById('__rs_pointer').style.visibility='hidden'");
    await page.screenshot({ path: join(TMP, "still-staged.png") });
    await page.evaluate("document.getElementById('__rs_pointer').style.visibility=''");
    await sleep(300);
    const first = page.locator(".finding").first();
    await click(page, first.getByRole("button", { name: "Edit comment" }), 400);
    await click(page, first.getByTestId("md-editor").getByRole("button", { name: "Edit", exact: true }), 300);
    const ta = first.locator("textarea");
    await ta.waitFor();
    await click(page, ta, 150);
    await page.keyboard.press("ControlOrMeta+End");
    await ta.pressSequentially(" Otherwise every sync falls back to one retry.", { delay: 30 });
    await sleep(900);
    mark("posting");
    await click(page, page.getByTestId("commit-bar").getByRole("button", { name: /post selected/i }), 300);
    await page.getByTestId("commit-posted").waitFor();
    mark("posted");
    await sleep(3000);
  });
}

const NEW_ROW_CSS = `
.rs-new { animation: rsnew 2.4s cubic-bezier(.2,.7,.2,1) both; position: relative; }
@keyframes rsnew {
  0% { opacity: 0; transform: translateY(-8px); box-shadow: inset 0 0 0 1px rgba(122,131,255,0); }
  15% { opacity: 1; transform: none; box-shadow: inset 0 0 0 1px rgba(122,131,255,.9), 0 0 32px rgba(122,131,255,.25); }
  100% { box-shadow: inset 0 0 0 1px rgba(122,131,255,0), 0 0 0 rgba(122,131,255,0); }
}`;

/** The phone bridge desktop/preload.cjs exposes, faked as in phone-access.spec.ts (a string). */
async function phoneBridge(page: Page) {
  const url = "https://quiet-river-ab12.trycloudflare.com";
  const dataUrl = await qrDataUrl(`${url}/pair/9fYq3Lw2Zt8vK1pR0sX6uH4nB7mC5dE2`);
  await page.addInitScript({
    content: `
      window.reviewstage = { phone: {
        _on: false,
        onData(fn) { window.__phonePush = fn; },
        async status() { return { enabled: this._on, url: this._on ? ${JSON.stringify(url)} : null }; },
        async enable() {
          this._on = true;
          const exp = Math.floor(Date.now() / 1000) + 30 * 60;
          setTimeout(() => window.__phonePush({ url: ${JSON.stringify(url)}, dataUrl: ${JSON.stringify(dataUrl)}, pair: { login: ${JSON.stringify(USER)}, exp }, warning: null, check: "checking" }), 500);
          setTimeout(() => window.__phonePush({ check: "ok" }), 1700);
          return { enabled: true, url: ${JSON.stringify(url)}, warning: null };
        },
        async disable() { this._on = false; return { enabled: false, url: null }; },
      } };`,
  });
}

async function recordSettings(browser: Browser) {
  return record(browser, "settings", { viewport: APP, cookies: [sessionCookie()] }, async (page, _ctx, mark) => {
    await phoneBridge(page);
    await patchJson(page, "**/api/me", { personal: true });
    await page.goto(`${ORIGIN}/settings`);
    const card = page.locator("#phone");
    await card.getByTestId("phone-enable").waitFor();
    await sleep(500);
    mark("start");
    await sleep(900);
    await click(page, card.getByTestId("phone-enable"), 200);
    await card.getByTestId("phone-qr").waitFor();
    mark("qr");
    await sleep(600);
    await page.mouse.move(1240, 700, { steps: 8 });
    await sleep(3800);
  });
}

async function recordSkills(browser: Browser) {
  return record(browser, "skills", { viewport: APP, cookies: [sessionCookie()] }, async (page, _ctx, mark) => {
    await page.goto(`${ORIGIN}/skills#rules`);
    const s = page.getByTestId("rule-suggestion").first();
    await s.getByTestId("rule-sentence").waitFor();
    await sleep(500);
    mark("start");
    await sleep(1200);
    await click(page, s.getByRole("button", { name: /show the 4 findings behind it/i }), 300);
    await s.locator("li").first().waitFor();
    await sleep(1400);
    await page.mouse.move(420, 300, { steps: 12 });
    const accept = s.getByRole("button", { name: /^Accept/ });
    const b = (await accept.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 16 });
    await sleep(2600);
  });
}

/** The phone: a push arrives (overlaid later), the queue, the PR, two swipes, Post, the next PR. */
async function recordPhone(browser: Browser) {
  return record(browser, "phone", { viewport: PHONE, mobile: true, cookies: [sessionCookie()] }, async (page, _ctx, mark) => {
    await unticked(page);
    await stubPost(page, 1, 1);
    await page.goto(`${ORIGIN}/?tab=all`);
    const row = page.getByTestId("queue-row").filter({ hasText: `#${PR}` });
    await row.waitFor();
    await page.locator('[data-slot="skeleton"]').first().waitFor({ state: "detached", timeout: 15_000 }).catch(() => {});
    await sleep(400);
    mark("start");
    await sleep(3400); // the push banner plays over this
    mark("tap");
    await click(page, row.getByTestId("row-link"), 200);
    await settled(page);
    await page.locator(".finding").first().waitFor();
    await sleep(1600);
    const first = page.getByTestId("finding").first();
    const b = (await first.boundingBox())!;
    await scroll(page, Math.max(0, b.y - 300));
    mark("swipe");
    await swipe(page, page.getByTestId("finding").nth(0), 220);
    await page.getByTestId("post-pill").getByText("1 kept").waitFor();
    await sleep(200);
    await swipe(page, page.getByTestId("finding").nth(1), 220);
    await page.getByTestId("post-pill").getByText("2 kept").waitFor();
    await sleep(900);
    await click(page, page.getByTestId("post-pill"), 300);
    await page.getByTestId("post-sheet").waitFor();
    mark("sheet");
    await sleep(1400);
    await click(page, page.getByTestId("post-confirm"), 300);
    await page.getByTestId("post-success").waitFor();
    mark("posted");
    await page.getByTestId("post-next").or(page.getByTestId("post-next-none")).first().waitFor({ timeout: 5000 }).catch(() => {});
    await sleep(3000);
  });
}

/** The desktop frame on the left of scene 8: PR #38849 with its findings staged. */
async function deskStill(browser: Browser) {
  const ctx = await browser.newContext({ viewport: APP, deviceScaleFactor: 2, colorScheme: "dark" });
  await offline(ctx);
  await ctx.addCookies([sessionCookie()]);
  const page = await ctx.newPage();
  await page.goto(`${ORIGIN}/pr?repo=${encodeURIComponent(REPO)}&pr=${PR}`);
  await settled(page);
  await page.locator(".finding").first().waitFor();
  await page.getByTestId("commit-bar").getByText("2 staged").waitFor();
  await sleep(600);
  await bring(page, page.locator(".finding").first(), 260);
  await sleep(500);
  await page.screenshot({ path: join(TMP, "still-pr.png") });
  await ctx.close();
}

// ---- stills: chrome, frames, notifications, captions, thumbnail -----------------------------------

async function still(browser: Browser, url: string, out: string, size: Size, scale = 1, selector?: string) {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: scale, colorScheme: "dark" });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.evaluate("document.fonts.ready");
  await sleep(150);
  const transparent = await page.evaluate("document.documentElement.classList.contains('transparent')");
  if (selector) await page.locator(selector).screenshot({ path: out, omitBackground: !!transparent });
  else await page.screenshot({ path: out, omitBackground: !!transparent });
  await ctx.close();
  return out;
}

const trafficLights = (size = 12, gap = 8) => `<span class="tl" style="display:flex;gap:${gap}px">${["#FF5F57", "#FEBC2E", "#28C840"].map((c) => `<i style="width:${size}px;height:${size}px;border-radius:50%;background:${c};display:block"></i>`).join("")}</span>`;

const windowCss = `
.win { position: absolute; border-radius: 12px; box-shadow: 0 40px 90px -30px rgba(0,0,0,.9), 0 0 0 1px #262A35; background: #0B0C10; }
.win .bar { position: absolute; left: 0; right: 0; top: 0; display: flex; align-items: center; padding: 0 14px;
  background: #15171E; border-bottom: 1px solid #22262F; border-radius: 12px 12px 0 0; }
.win .bar b { position: absolute; left: 0; right: 0; text-align: center; font-weight: 500; font-size: 14px; color: #9AA0B4; }
`;

/** The window chrome behind the app recordings (16:9) and the corner fillets laid over them. */
async function windowFrames(browser: Browser) {
  const { x, y, w, h, bar } = WIN;
  const bg = htmlPage("frame-window", `<div class="stage"></div>
    <div class="win" style="left:${x}px;top:${y - bar}px;width:${w}px;height:${h + bar}px">
      <div class="bar" style="height:${bar}px">${trafficLights()}<b>ReviewStage</b></div></div>`, windowCss);
  const corners = htmlPage("frame-corners", `
    <i style="left:${x}px;top:${y + h - 12}px;background:radial-gradient(circle at 100% 0, transparent 11.5px, #262A35 12px, #0B0C10 13.2px)"></i>
    <i style="left:${x + w - 12}px;top:${y + h - 12}px;background:radial-gradient(circle at 0 0, transparent 11.5px, #262A35 12px, #0B0C10 13.2px)"></i>`,
  "i { position: absolute; width: 12px; height: 12px; display: block; }", "", true);
  return {
    bg: await still(browser, bg, join(TMP, "frame-window.png"), { width: W_H.w, height: W_H.h }),
    corners: await still(browser, corners, join(TMP, "frame-corners.png"), { width: W_H.w, height: W_H.h }),
  };
}

type PhoneGeo = { x: number; y: number; w: number; h: number; bezel: number; r: number };

/** The phone body (under the recording) and its bezel ring (over it, rounding the screen). */
async function phoneFrames(browser: Browser, tag: string, canvas: { w: number; h: number }, g: PhoneGeo, left: string) {
  const body = `<div style="position:absolute;left:${g.x - g.bezel}px;top:${g.y - g.bezel}px;width:${g.w + 2 * g.bezel}px;height:${g.h + 2 * g.bezel}px;border-radius:${g.r + g.bezel}px;background:#050608;box-shadow:0 50px 100px -30px rgba(0,0,0,.95)"></div>`;
  const bg = htmlPage(`phone-bg-${tag}`, `<div class="stage"></div>${left}${body}`, windowCss);
  const ring = htmlPage(`phone-ring-${tag}`, `
    <div style="position:absolute;left:${g.x}px;top:${g.y}px;width:${g.w}px;height:${g.h}px;border-radius:${g.r}px;
      box-shadow:0 0 0 ${g.bezel}px #050608, 0 0 0 ${g.bezel + 1.5}px #30343F, 0 0 0 ${g.bezel + 3}px #15171D"></div>
    <div style="position:absolute;left:${g.x + g.w / 2 - g.w * 0.16}px;top:${g.y - g.bezel + 4}px;width:${g.w * 0.32}px;height:${Math.round(g.bezel * 0.45)}px;border-radius:9px;background:#14161C"></div>`,
  "", "", true);
  return {
    bg: await still(browser, bg, join(TMP, `phone-bg-${tag}.png`), { width: canvas.w, height: canvas.h }),
    ring: await still(browser, ring, join(TMP, `phone-ring-${tag}.png`), { width: canvas.w, height: canvas.h }),
  };
}

/** An iOS-style push banner, drawn at the phone screen's own scale. */
async function banner(browser: Browser, tag: string, screenW: number) {
  const scale = screenW / PHONE.width;
  const url = htmlPage(`banner-${tag}`, `<div id="b"><div class="ic">${logo(26)}</div><div class="tx">
      <div class="top"><span>REVIEWSTAGE</span><span>now</span></div>
      <div class="t">Review ready: acme/widgets#${PR}</div>
      <div class="s">Add lead-time badge to product cards</div></div></div>`, `
    #b { position: absolute; left: 8px; top: 8px; width: ${PHONE.width - 16}px; display: flex; gap: 10px; padding: 11px 13px;
      border-radius: 20px; background: rgba(38,41,52,.96); box-shadow: 0 10px 30px rgba(0,0,0,.5); }
    .ic { width: 38px; height: 38px; border-radius: 9px; background: #0B0C10; display: grid; place-items: center; flex: none;
      border: 1px solid #2B2F3A; }
    .tx { min-width: 0; flex: 1; font-size: 14px; line-height: 1.3; }
    .top { display: flex; justify-content: space-between; font-size: 11px; color: #A9AEC0; letter-spacing: .02em; margin-bottom: 1px; }
    .t { font-weight: 600; } .s { color: #C9CCD8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`,
  "", true);
  return still(browser, url, join(TMP, `banner-${tag}.png`), { width: PHONE.width, height: 120 }, scale, "#b");
}

/** The macOS notification in scene 4. */
async function toast(browser: Browser) {
  const url = htmlPage("toast", `<div id="t"><div class="ic">${logo(34)}</div><div class="tx">
      <div class="top"><span>ReviewStage</span><span>now</span></div>
      <div class="t">Review requested: ${REPO}#${PR4}</div>
      <div class="s">Retry the vendor sync on a 502 · teammate</div></div></div>`, `
    #t { position: absolute; left: 20px; top: 20px; width: 470px; display: flex; gap: 14px; padding: 14px 16px; border-radius: 18px;
      background: rgba(44,47,58,.97); border: 1px solid rgba(255,255,255,.08); box-shadow: 0 18px 50px rgba(0,0,0,.55); }
    .ic { width: 46px; height: 46px; border-radius: 11px; background: #0B0C10; display: grid; place-items: center; flex: none; border: 1px solid #2B2F3A; }
    .tx { min-width: 0; flex: 1; font-size: 17px; line-height: 1.32; }
    .top { display: flex; justify-content: space-between; font-size: 14px; color: #A9AEC0; }
    .t { font-weight: 600; } .s { color: #C9CCD8; }`, "", true);
  return still(browser, url, join(TMP, "toast.png"), { width: 520, height: 160 }, 1, "#t");
}

type Caption = { t0: number; t1: number; lines: string[] };

/** One caption pill per cue: Geist 44 px, white on a soft dark pill, centred. */
async function captionPngs(browser: Browser, caps: Caption[], tag: string, width: number) {
  const out: string[] = [];
  for (const [i, c] of caps.entries()) {
    const url = htmlPage(`cap-${tag}-${i}`, `<div id="c">${c.lines.map((l) => `<div>${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div>`).join("")}</div>`, `
      body { display: flex; justify-content: center; padding-top: 10px; }
      #c { display: inline-block; text-align: center; font-size: 44px; font-weight: 560; line-height: 1.18; letter-spacing: -.012em;
        color: #FFFFFF; padding: 10px 30px 12px; border-radius: 22px; background: rgba(9,10,14,.80);
        border: 1px solid rgba(255,255,255,.07); }`, "", true);
    out.push(await still(browser, url, join(TMP, `cap-${tag}-${i}.png`), { width, height: 260 }, 1, "#c"));
  }
  return out;
}

function pngSize(file: string) {
  const b = readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

// The thumbnail's PR frame: the main column of the "2 staged" still (CSS px of the 1280×720
// take), findings down to the sticky commit bar, scaled to fit beside the hook line.
const CROP = { x: 232, y: 196, cw: 928, ch: 524, s: 600 / 928, w: 600, h: Math.round(524 * 600 / 928), left: 632, topT: 168, topS: 136 };

async function thumbnails(browser: Browser) {
  const shot = fileUrl(join(TMP, "still-staged.png"));
  const make = (name: string, social: boolean) => htmlPage(name, `<div class="stage"></div>
    <div class="txt">
      <div class="brand">${logo(social ? 44 : 40)}<span>ReviewStage</span></div>
      <h1><span>AI wrote the PR.</span><span class="b">You still have to review it.</span></h1>
      ${social ? `<div class="sub">Claude drafts it. You post what you mean, as you.</div><div class="cmd"><span>$</span> npx reviewstage</div>` : `<div class="cmd"><span>$</span> npx reviewstage</div>`}
    </div>
    <div class="win shot" style="left:${CROP.left}px;top:${social ? CROP.topS : CROP.topT}px;width:${CROP.w}px;height:${CROP.h + 30}px">
      <div class="bar" style="height:30px">${trafficLights(11, 7)}<b>ReviewStage</b></div>
      <div style="position:absolute;left:0;top:30px;width:${CROP.w}px;height:${CROP.h}px;overflow:hidden;border-radius:0 0 12px 12px">
        <img src="${shot}" style="position:absolute;left:${-CROP.x * CROP.s}px;top:${-CROP.y * CROP.s}px;width:${APP.width * CROP.s}px;display:block">
      </div>
    </div>`, `${windowCss}
    .txt { position: absolute; left: 56px; top: 0; bottom: 0; width: 560px; display: flex; flex-direction: column; justify-content: center; gap: 22px; z-index: 2; }
    .brand { display: flex; align-items: center; gap: 12px; font-size: 26px; font-weight: 650; letter-spacing: -.02em; }
    h1 { margin: 0; font-size: ${social ? 60 : 66}px; line-height: 1.04; letter-spacing: -.04em; font-weight: 700; }
    h1 span { display: block; } h1 .b { color: var(--blue); margin-top: 8px; }
    .sub { font-size: 23px; color: var(--graphite); line-height: 1.35; }
    .cmd { align-self: flex-start; font-family: "Geist Mono", monospace; font-size: 24px; padding: 10px 18px; border-radius: 12px;
      background: rgba(18,20,26,.9); border: 1px solid var(--hairline); }
    .cmd span { color: var(--green); margin-right: 6px; }
    .shot { z-index: 1; }`);
  mkdirSync(OUT, { recursive: true });
  await still(browser, make("thumb", false), join(OUT, "reviewstage-launch-thumbnail.png"), { width: 1280, height: 720 });
  await still(browser, make("social", true), join(OUT, "github-social-preview.png"), { width: 1280, height: 640 });
}

// ---- composition ---------------------------------------------------------------------------------

type Overlay = { png: string; x: string; y: string; t0: number; t1?: number; fadeIn?: number; fadeOut?: number };
type Scene = {
  id: string;
  kind: "card" | "window" | "phone";
  clip: Clip;
  from?: string; // mark the scene starts at ("start" when omitted)
  to?: string; // mark it ends at (the end of the take when omitted)
  speed?: number;
  min?: number; // hold the last frame to at least this long
  overlays?: (s: Cut) => Overlay[];
};
type Cut = { ss: number; to: number; speed: number; dur: number; at: (mark: string) => number };

function cut(s: Scene): Cut {
  const m = s.clip.marks;
  const from = s.from || "start";
  const ss = from === "start" ? m.start + 0.2 : m[from] - X / 2;
  const to = s.to ? m[s.to] + X / 2 : s.clip.end - 0.2;
  if (Number.isNaN(ss) || Number.isNaN(to)) throw new Error(`${s.id}: unknown mark`);
  const speed = s.speed || 1;
  const natural = (to - ss) / speed;
  const dur = Math.max(natural, s.min || 0);
  return { ss, to, speed, dur, at: (k: string) => (m[k] - ss) / speed };
}

function overlayChain(base: string, firstInput: number, ovs: Overlay[]) {
  const parts: string[] = [];
  let cur = base;
  ovs.forEach((o, i) => {
    const n = firstInput + i;
    const fades = [`format=rgba`];
    if (o.fadeIn) fades.push(`fade=in:st=${o.t0.toFixed(3)}:d=${o.fadeIn}:alpha=1`);
    if (o.t1 !== undefined && o.fadeOut) fades.push(`fade=out:st=${(o.t1 - o.fadeOut).toFixed(3)}:d=${o.fadeOut}:alpha=1`);
    parts.push(`[${n}:v]${fades.join(",")}[o${i}]`);
    const enable = `between(t,${o.t0.toFixed(3)},${(o.t1 ?? 9999).toFixed(3)})`;
    parts.push(`[${cur}][o${i}]overlay=x='${o.x}':y='${o.y}':enable='${enable}'[ov${i}]`);
    cur = `ov${i}`;
  });
  return { parts, out: cur };
}

const loopIn = (png: string, secs: number) => ["-loop", "1", "-framerate", String(FPS), "-t", secs.toFixed(3), "-i", png];

/** Renders one scene to a 30 fps intermediate of exactly its duration. */
function composeScene(s: Scene, c: Cut, out: string, frames: { window: { bg: string; corners: string }; phone?: { bg: string; ring: string; banner: string; geo: PhoneGeo }; canvas: { w: number; h: number } }) {
  const D = c.dur;
  const src = ["-ss", c.ss.toFixed(3), "-to", c.to.toFixed(3), "-i", s.clip.webm];
  const speed = `setpts=(PTS-STARTPTS)/${c.speed}`;
  const ovs = s.overlays ? s.overlays(c) : [];
  const { w, h } = frames.canvas;
  let inputs: string[] = [];
  let graph: string[] = [];
  let last = "";
  if (s.kind === "card") {
    inputs = src;
    graph = [`[0:v]${speed},fps=${FPS},scale=${w}:${h}:flags=lanczos,tpad=stop_mode=clone:stop_duration=30[v]`];
    last = "v";
  } else if (s.kind === "window") {
    inputs = [...loopIn(frames.window.bg, D), ...src, ...loopIn(frames.window.corners, D)];
    graph = [
      `[1:v]${speed},fps=${FPS},scale=${WIN.w}:${WIN.h}:flags=lanczos[v]`,
      `[0:v][v]overlay=${WIN.x}:${WIN.y}:eof_action=repeat[a]`,
      `[a][2:v]overlay=0:0[b]`,
    ];
    last = "b";
  } else {
    const p = frames.phone!;
    const g = p.geo;
    inputs = [...loopIn(p.bg, D), ...src, ...loopIn(p.banner, D), ...loopIn(p.ring, D)];
    const bn = pngSize(p.banner);
    const scale = g.w / PHONE.width;
    const bx = g.x + Math.round(((g.w - bn.w) / 2));
    const by = g.y + Math.round(8 * scale);
    const a = 0.5, b = c.at("tap") - 0.35;
    graph = [
      `[1:v]${speed},fps=${FPS},scale=${g.w}:${g.h}:flags=lanczos[v]`,
      `[0:v][v]overlay=${g.x}:${g.y}:eof_action=repeat[a]`,
      `[2:v]format=rgba,fade=in:st=${a}:d=0.3:alpha=1,fade=out:st=${b.toFixed(3)}:d=0.3:alpha=1[bn]`,
      `[a][bn]overlay=x=${bx}:y='${by}-${Math.round(16 * scale)}*max(0,1-(t-${a})/0.35)':enable='between(t,${a},${(b + 0.3).toFixed(3)})'[a2]`,
      `[a2][3:v]overlay=0:0[b]`,
    ];
    last = "b";
  }
  const first = inputs.filter((x) => x === "-i").length;
  for (const o of ovs) inputs.push(...loopIn(o.png, D));
  const chain = overlayChain(last, first, ovs);
  graph.push(...chain.parts, `[${chain.out}]format=yuv420p,settb=AVTB[out]`);
  ff([...inputs, "-filter_complex", graph.join(";"), "-map", "[out]", "-t", D.toFixed(3), "-r", String(FPS),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "10", "-pix_fmt", "yuv420p", "-an", out]);
}

/** Joins the scene intermediates with cross-fades, optionally burning in the captions. */
function finalCut(parts: string[], durs: number[], caps: { png: string; c: Caption }[], capY: (h: number) => number, out: string) {
  const inputs = parts.flatMap((p) => ["-i", p]);
  const graph: string[] = parts.map((_, i) => `[${i}:v]fps=${FPS},settb=AVTB,format=yuv420p[s${i}]`);
  let cur = "s0";
  let offset = 0;
  for (let i = 1; i < parts.length; i++) {
    offset += durs[i - 1] - X;
    graph.push(`[${cur}][s${i}]xfade=transition=fade:duration=${X.toFixed(4)}:offset=${offset.toFixed(4)}[x${i}]`);
    cur = `x${i}`;
  }
  const total = durs.reduce((a, b) => a + b, 0) - X * (parts.length - 1);
  const first = parts.length;
  const ovs: Overlay[] = caps.map(({ png, c }) => ({
    png, x: `(W-w)/2`, y: String(capY(pngSize(png).h)), t0: c.t0, t1: c.t1, fadeIn: 0.18, fadeOut: 0.18,
  }));
  for (const o of ovs) inputs.push(...loopIn(o.png, total));
  const chain = overlayChain(cur, first, ovs);
  graph.push(...chain.parts, `[${chain.out}]format=yuv420p[out]`);
  for (const crf of [18, 20, 22, 24]) {
    ff([...inputs, "-filter_complex", graph.join(";"), "-map", "[out]", "-t", total.toFixed(3), "-r", String(FPS),
      "-c:v", "libx264", "-profile:v", "high", "-preset", "slow", "-crf", String(crf), "-pix_fmt", "yuv420p",
      "-movflags", "+faststart", "-an", out]);
    if (mb(out) <= MAX_MB) break;
  }
  return total;
}

// ---- captions, SRT, voice-over ---------------------------------------------------------------------

type Timeline = { id: string; start: number; dur: number }[];

function timeline(cuts: { id: string; dur: number }[]): Timeline {
  let t = 0;
  return cuts.map((c, i) => {
    const r = { id: c.id, start: i === 0 ? 0 : t, dur: c.dur };
    t = (i === 0 ? 0 : t) + c.dur - X;
    return r;
  });
}

const srtTime = (s: number) => {
  const ms = Math.round(s * 1000);
  const hh = Math.floor(ms / 3600000), mm = Math.floor(ms / 60000) % 60, ss = Math.floor(ms / 1000) % 60, f = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(hh)}:${p(mm)}:${p(ss)},${p(f, 3)}`;
};

function writeSrt(caps: Caption[], file: string) {
  writeFileSync(file, caps.map((c, i) => `${i + 1}\n${srtTime(c.t0)} --> ${srtTime(c.t1)}\n${c.lines.join("\n")}\n`).join("\n"));
}

// The spoken lines, one per scene, first person from the maintainer.
const VOICE: Record<string, { action: string; line: string }> = {
  hook: { action: "Hook card: “AI wrote the PR.” then “You still have to review it.”", line: "I review a lot of pull requests an agent wrote." },
  terminal: { action: "Terminal types `npx reviewstage`; “ReviewStage is running.”", line: "So I built ReviewStage. One command, and it's a real desktop app." },
  wizard: { action: "Wizard: GitHub token → Connect Claude → pick two repos → the queue.", line: "Sign in with GitHub, connect your own Claude plan, and pick the repos you review. That's the setup." },
  queue: { action: "Empty queue; a notification slides in; #38851 appears in To review.", line: "When a teammate asks for your review, it lands right here." },
  review: { action: "Open #38851, pick Standard effort, Run review; phases tick; three findings with file:line.", line: "I open it and run a review. Claude Code reads the real diff on my own plan and drafts findings, each one pinned to a file and a line." },
  post: { action: "Tick two findings, edit one, Post selected → “Posted as acme-dev”.", line: "I tick the ones worth saying, fix the wording, and post. It goes up as a plain comment under my name. Nothing posts until I click." },
  settings: { action: "Settings → Your phone → Enable phone access → QR code.", line: "Scan one code and your phone is signed in as you." },
  phone: { action: "Desktop left, phone right: push banner → queue → PR → swipe two → Post → next PR.", line: "Now a review ping reaches my phone. I swipe right on the findings I agree with, post, and it hands me the next one." },
  skills: { action: "Skills → Suggested rules: a rule drafted from four dropped findings.", line: "Drop the same kind of nit a few times, and it suggests a rule." },
  end: { action: "End card: npx reviewstage · reviewstage.dev · github.com/Wimukti/reviewstage.", line: "It's open source, MIT, and runs on your Claude plan. N P X reviewstage." },
};

function writeVoiceover(tl: Timeline, total: number, file: string) {
  const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
  const rows: string[] = [];
  let all = 0;
  tl.forEach((s, i) => {
    const end = i + 1 < tl.length ? tl[i + 1].start : total;
    const v = VOICE[s.id];
    const n = words(v.line);
    all += n;
    const rate = n / (end - s.start);
    if (rate > 2.6) throw new Error(`voice-over line for ${s.id} runs ${rate.toFixed(2)} words/s`);
    rows.push(`| ${i + 1} | ${Math.round(s.start)}–${Math.round(end)} s | ${v.action} | “${v.line}” | ${n} · ${rate.toFixed(1)}/s |`);
  });
  writeFileSync(file, `# ReviewStage launch video: voice-over script

Timed to \`reviewstage-launch-1080p-clean.mp4\` (${fmt(total)} s, 30 fps). Times are where each scene
starts and ends on the clean cut; start speaking about a quarter second after the cut and finish
before the next one. Every line stays at or under 2.6 words per second, so there is room to breathe.

| # | Time | On screen | Spoken line | Words · pace |
| --- | --- | --- | --- | --- |
${rows.join("\n")}

Total: ${all} words over ${fmt(total)} s (${(all / total).toFixed(1)} words/s on average).

## Recording tips

- Read it as yourself, the way you would explain it to a colleague at your desk. Plain words, no
  announcer voice. If a line feels long when you say it, drop words; never speed up.
- Record each scene's line as its own take (ten short takes), with a second of room tone before
  and after. It is far easier to place short takes than to fix one long read.
- A quiet room with soft surfaces beats a good microphone in an echoing one. Keep the mic a hand's
  width from your mouth, slightly off-axis, with a pop filter.
- Record at 48 kHz, 24-bit, peaks around −12 dBFS. Leave the final level to the command below,
  which normalises to −16 LUFS integrated (true peak −1.5 dB), the usual target for YouTube and
  social video.
- Lay the takes on one track in your editor at the times above, export a single WAV
  (\`voiceover.wav\`) exactly as long as the video or shorter, then run the command below. There is no
  music bed, so there is nothing to duck.

## Laying the voice on the clean cut

\`\`\`bash
ffmpeg -i reviewstage-launch-1080p-clean.mp4 -i voiceover.wav \\
  -filter_complex "[1:a]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,apad[a]" \\
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart \\
  reviewstage-launch-1080p-voice.mp4
\`\`\`

The video stream is copied untouched; \`apad\` plus \`-shortest\` makes the audio exactly as long as the
picture. For a captioned version with voice, run the same command on
\`reviewstage-launch-1080p.mp4\`.
`);
}

// ---- main ------------------------------------------------------------------------------------------

async function main() {
  if (!existsSync(join(ROOT, "bin", "static", "assets.json"))) {
    console.log("building the dashboard bundle…");
    execFileSync("pnpm", ["build"], { cwd: join(HERE, ".."), stdio: "inherit" });
  }
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  mkdirSync(OUT, { recursive: true });

  // Fixtures: the demo fixture, with #38851 sized to the two files its diff touches.
  demoFixture();
  const qf = join(FIXTURE, "queue.json");
  const queue = JSON.parse(readFileSync(qf, "utf8"));
  for (const q of queue) if (String(q.number) === PR4) Object.assign(q, { changedFiles: 2, additions: 24 });
  writeFileSync(qf, JSON.stringify(queue));
  buildPersonalFixture();
  const penv = join(PERSONAL_FIXTURE, ".env");
  writeFileSync(penv, readFileSync(penv, "utf8").replace("DRY_RUN=1", "DRY_RUN=0"));
  const servers = [await startServer(FIXTURE, PORT), await startServer(PERSONAL_FIXTURE, PERSONAL_PORT)];

  // recordVideo captures CSS pixels; forcing the scale factor makes the frames genuinely 2x.
  const rec = await chromium.launch({ args: ["--force-device-scale-factor=2"] });
  const stills = await chromium.launch();
  try {
    console.log("recording the cards…");
    const hook = await recordCard(rec, "hook", CARD_H, hookHtml(false), 4.2);
    const term = await recordCard(rec, "terminal", CARD_H, terminalHtml(false), 5.3);
    const end = await recordCard(rec, "end", CARD_H, endHtml(false), 7.2);
    const hookV = await recordCard(rec, "hook-v", CARD_V, hookHtml(true), 5.6);
    const termV = await recordCard(rec, "terminal-v", CARD_V, terminalHtml(true), 6.0);
    const endV = await recordCard(rec, "end-v", CARD_V, endHtml(true), 7.8);
    console.log("recording the wizard…");
    const wizard = await recordWizard(rec);
    // The phone first: #38851 is still waiting then, so the success sheet offers it as the next PR.
    console.log("recording the phone…");
    const phone = await recordPhone(rec);
    console.log("recording the queue, the review and the post…");
    const desk = await recordDesk(rec);
    console.log("recording settings and skills…");
    const settingsClip = await recordSettings(rec);
    const skills = await recordSkills(rec);
    await deskStill(rec);

    console.log("rendering the chrome, the notifications and the captions…");
    const win = await windowFrames(stills);
    const leftDesk = `<div class="win" style="left:${SIDE.x}px;top:${SIDE.y - SIDE.bar}px;width:${SIDE.w}px;height:${SIDE.h + SIDE.bar}px">
      <div class="bar" style="height:${SIDE.bar}px">${trafficLights(11, 7)}<b>ReviewStage</b></div>
      <img src="${fileUrl(join(TMP, "still-pr.png"))}" style="position:absolute;left:0;top:${SIDE.bar}px;width:${SIDE.w}px;height:${SIDE.h}px;border-radius:0 0 12px 12px;display:block"></div>`;
    const phH = await phoneFrames(stills, "h", W_H, PH_H, leftDesk);
    const phV = await phoneFrames(stills, "v", W_V, PH_V, "");
    const bannerH = await banner(stills, "h", PH_H.w);
    const bannerV = await banner(stills, "v", PH_V.w);
    const toastPng = await toast(stills);
    await thumbnails(stills);

    // ---- A / B: the 16:9 edit
    const toastOv = (c: Cut): Overlay[] => {
      const a = 1.0, tw = pngSize(toastPng).w;
      const x1 = W_H.w - tw - 28;
      return [{ png: toastPng, x: `if(lt(t,${a}),W,${x1}+(W-${x1})*pow(1-min(1,(t-${a})/0.45),3))`, y: "26", t0: a, t1: c.dur, fadeIn: 0.15 }];
    };
    const scenes: Scene[] = [
      { id: "hook", kind: "card", clip: hook, min: 4.1 },
      { id: "terminal", kind: "card", clip: term, min: 5.2 },
      { id: "wizard", kind: "window", clip: wizard, speed: 1.75 },
      { id: "queue", kind: "window", clip: desk, to: "s5", overlays: toastOv },
      { id: "review", kind: "window", clip: desk, from: "s5", to: "s6" },
      { id: "post", kind: "window", clip: desk, from: "s6" },
      { id: "settings", kind: "window", clip: settingsClip },
      { id: "phone", kind: "phone", clip: phone },
      { id: "skills", kind: "window", clip: skills },
      { id: "end", kind: "card", clip: end, min: 7.0 },
    ];
    const cuts = scenes.map(cut);
    const parts: string[] = [];
    for (const [i, s] of scenes.entries()) {
      const out = join(TMP, `scene-${String(i + 1).padStart(2, "0")}-${s.id}.mp4`);
      composeScene(s, cuts[i], out, {
        window: win,
        phone: { bg: phH.bg, ring: phH.ring, banner: bannerH, geo: PH_H },
        canvas: W_H,
      });
      parts.push(out);
    }
    const tl = timeline(scenes.map((s, i) => ({ id: s.id, dur: cuts[i].dur })));
    const T = (id: string) => tl.find((s) => s.id === id)!;
    const C = (id: string) => cuts[scenes.findIndex((s) => s.id === id)];
    const sceneEnd = (id: string) => T(id).start + T(id).dur - X;
    // Caption times on the final timeline: scene start + the mark's place in the scene.
    const at = (id: string, mark: string) => T(id).start + C(id).at(mark);
    const pad = X / 2 + 0.05;
    const capsA: Caption[] = [
      { t0: T("terminal").start + 0.6, t1: sceneEnd("terminal") - 0.1, lines: ["One command. A real desktop app."] },
      { t0: T("wizard").start + pad, t1: at("wizard", "claude") - 0.05, lines: ["Sign in with GitHub."] },
      { t0: at("wizard", "claude"), t1: at("wizard", "repos") - 0.05, lines: ["Connect your Claude."] },
      { t0: at("wizard", "repos"), t1: sceneEnd("wizard") - 0.1, lines: ["Pick your repos."] },
      { t0: T("queue").start + 0.5, t1: sceneEnd("queue") - 0.1, lines: ["Review requests land in your queue."] },
      { t0: T("review").start + 0.5, t1: sceneEnd("review") - 0.1, lines: ["Claude drafts the review", "from the real diff."] },
      { t0: T("post").start + pad, t1: at("post", "posting") - 0.05, lines: ["You pick what's worth saying."] },
      { t0: at("post", "posting"), t1: sceneEnd("post") - 0.1, lines: ["Posted under your name.", "Nothing posts until you click."] },
      { t0: T("settings").start + 0.4, t1: sceneEnd("settings") - 0.1, lines: ["Scan once.", "Your phone is signed in."] },
      { t0: T("phone").start + 0.4, t1: at("phone", "swipe") - 0.05, lines: ["Review from anywhere."] },
      { t0: at("phone", "swipe"), t1: sceneEnd("phone") - 0.1, lines: ["Swipe to keep."] },
      { t0: T("skills").start + 0.4, t1: sceneEnd("skills") - 0.1, lines: ["It learns what your team drops."] },
    ];
    for (const c of capsA) for (const l of c.lines) if (l.split(/\s+/).length > 6) throw new Error(`caption line over 6 words: ${l}`);
    const pngsA = await captionPngs(stills, capsA, "h", W_H.w);
    console.log("composing the 16:9 cuts…");
    const fileA = join(OUT, "reviewstage-launch-1080p.mp4");
    const fileB = join(OUT, "reviewstage-launch-1080p-clean.mp4");
    const totalA = finalCut(parts, cuts.map((c) => c.dur), capsA.map((c, i) => ({ png: pngsA[i], c })), (h) => CAP_BOTTOM_H - h, fileA);
    finalCut(parts, cuts.map((c) => c.dur), [], () => 0, fileB);
    writeSrt(capsA, join(OUT, "captions.srt"));
    writeVoiceover(tl, totalA, join(OUT, "voiceover-script.md"));

    // ---- C: the vertical cut
    const scenesV: Scene[] = [
      { id: "hook", kind: "card", clip: hookV, min: 5.5 },
      { id: "terminal", kind: "card", clip: termV, min: 5.9 },
      { id: "phone", kind: "phone", clip: phone },
      { id: "end", kind: "card", clip: endV, min: 7.7 },
    ];
    const cutsV = scenesV.map(cut);
    const partsV: string[] = [];
    for (const [i, s] of scenesV.entries()) {
      const out = join(TMP, `vscene-${i + 1}-${s.id}.mp4`);
      composeScene(s, cutsV[i], out, {
        window: win,
        phone: { bg: phV.bg, ring: phV.ring, banner: bannerV, geo: PH_V },
        canvas: W_V,
      });
      partsV.push(out);
    }
    const tlV = timeline(scenesV.map((s, i) => ({ id: s.id, dur: cutsV[i].dur })));
    const TV = (id: string) => tlV.find((s) => s.id === id)!;
    const atV = (mark: string) => TV("phone").start + cutsV[2].at(mark);
    const endV2 = (id: string) => TV(id).start + TV(id).dur - X;
    const capsV: Caption[] = [
      { t0: TV("terminal").start + 0.6, t1: endV2("terminal") - 0.1, lines: ["One command.", "A real desktop app."] },
      { t0: TV("phone").start + 0.4, t1: atV("swipe") - 0.05, lines: ["Review requests", "reach your phone."] },
      { t0: atV("swipe"), t1: atV("sheet") - 0.05, lines: ["Swipe right to keep."] },
      { t0: atV("sheet"), t1: endV2("phone") - 0.1, lines: ["Posted under your name."] },
    ];
    const pngsV = await captionPngs(stills, capsV, "v", W_V.w);
    console.log("composing the vertical cut…");
    const fileC = join(OUT, "reviewstage-launch-vertical.mp4");
    const totalV = finalCut(partsV, cutsV.map((c) => c.dur), capsV.map((c, i) => ({ png: pngsV[i], c })), () => CAP_TOP_V, fileC);

    // ---- report
    for (const f of [fileA, fileB, fileC]) {
      const p = probe(f);
      const v = p.streams.find((s) => s.codec_type === "video")!;
      const audio = p.streams.some((s) => s.codec_type === "audio");
      console.log(`${f.slice(f.lastIndexOf("/") + 1)}: ${v.width}×${v.height} ${v.codec_name} ${v.profile} ${v.pix_fmt} ${v.r_frame_rate} · ${fmt(duration(f))} s · ${fmt(mb(f))} MB${audio ? " · HAS AUDIO" : ""}`);
      if (audio) throw new Error(`${f} has an audio track`);
    }
    if (mb(fileA) > MAX_MB) throw new Error(`A is over ${MAX_MB} MB`);
    console.log(`A total ${fmt(totalA)} s; vertical ${fmt(totalV)} s`);
    if (totalA < 85 || totalA > 95) console.warn(`warning: A runs ${fmt(totalA)} s (target 85–95)`);
    if (totalV < 35 || totalV > 45) console.warn(`warning: the vertical cut runs ${fmt(totalV)} s (target 35–45)`);
    console.log("scene starts (A):", tl.map((s) => `${s.id} ${fmt(s.start)}`).join(" · "));
    for (const f of ["reviewstage-launch-thumbnail.png", "github-social-preview.png"]) {
      const s = pngSize(join(OUT, f));
      console.log(`${f}: ${s.w}×${s.h} · ${fmt(statSync(join(OUT, f)).size / 1024)} KB`);
    }
  } finally {
    await rec.close();
    await stills.close();
    for (const s of servers) s.kill("SIGTERM");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
