// `npx reviewstage` — the desktop app. One window on the local server, which this process
// starts and owns. Everything the Docker install does with Compose and a browser happens here:
// a root with a secret, the tools the scripts need, the server on a free port, the queue count
// on the dock, a notification when a review arrives, and on request a public tunnel for the
// phone. See openspec/changes/npx-desktop/design.md.
//
// It is a resident app (openspec/changes/desktop-always-on): the launcher detaches it from the
// terminal, one instance runs per profile, closing the window leaves it in the menu bar, phone
// access comes back on by itself after a restart, and a newer published version is offered and
// installed from inside the app.
import { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, shell, session, Tray } from "electron";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { ensureEnv, freePort, spawnServer, stopServer, SERVER_DIR } from "./server.js";
import { ensureTools } from "./tools.js";
import { startTunnel, stopTunnel, superviseTunnel, tunnelStatus, waitTunnelHealthy } from "./tunnel.js";
import { acquireLock, appShortcutStatus, autostartStatus, readDesktopState, removeAppShortcut, setAutostart, writeAppShortcut, writeDesktopState } from "./lifecycle.js";
import { CHECK_EVERY_MS, createUpdater, spawnInstall } from "./update.js";
import * as tailscale from "./tailscale.js";

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(homedir(), ".reviewstage");
const ROOT = process.env.ROOT || DEFAULT_ROOT;
const CUSTOM_ROOT = resolve(ROOT) !== resolve(DEFAULT_ROOT);
const SMOKE = process.env.RS_SMOKE === "1"; // the Playwright smoke test: no notifications, exit cleanly
// The app's own mark, rendered at build time from assets/logo-light.svg and shipped with the
// server's static files. The dock and the Linux window manager show it instead of Electron's.
const ICON = join(SERVER_DIR, "static", "icons", "icon-512.png");

let win = null;
let server = null; // { child, port }
let badgeTimer = null;
let lastTodo = -1;
let phoneWin = null;
let phoneBusy = false; // an enable or disable in flight; the menu items wait for it
let supervisor = null; // restarts cloudflared once if it dies while phone access is on
let tray = null;
let tsUrl = null; // the Tailscale address while phone access runs over Tailscale (F6)
let quitting = false;
let booting = null; // the boot in flight, so a window opened meanwhile does not start another
let updateTimer = null;

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const progress = (p) => {
  if (win && !win.isDestroyed()) win.webContents.send("progress", p);
  // In the smoke test an error would otherwise sit on the Retry screen forever.
  if (SMOKE && p.error) { console.log(`RS_SMOKE_FAIL ${String(p.error).replace(/<[^>]+>/g, " ")}`); setTimeout(() => app.exit(2), 200); }
};

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 390,
    minHeight: 600,
    title: "ReviewStage",
    backgroundColor: "#0B0C10",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 14, y: 14 },
    icon: ICON,
    webPreferences: { preload: join(here, "preload.cjs"), contextIsolation: true, sandbox: false },
    show: false,
  });
  win.once("ready-to-show", () => win?.show());
  // The Dock icon is there while a window is; with the window closed the app lives in the
  // menu bar (F2). Without a tray icon there is nowhere else to live, so the Dock stays.
  if (process.platform === "darwin") void app.dock?.show();
  win.webContents.on("did-finish-load", () => void dressDashboard());
  // Links to GitHub and the docs open in the person's browser, not inside the app.
  // Nothing ever opens a second window: the app's own pages stay in this one, everything
  // else goes to the person's browser (GitHub's device page, Claude's authorize page, docs).
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (server && url.startsWith(`http://127.0.0.1:${server.port}`)) { win.loadURL(url); return { action: "deny" }; }
    shell.openExternal(url);
    return { action: "deny" };
  });
  // Right-click → Inspect element, so "this button does nothing" can be looked at in place.
  win.webContents.on("context-menu", (_e, params) => {
    Menu.buildFromTemplate([
      { role: "copy", enabled: params.editFlags.canCopy },
      { role: "paste", enabled: params.editFlags.canPaste },
      { type: "separator" },
      { label: "Inspect element", click: () => win.webContents.inspectElement(params.x, params.y) },
    ]).popup({ window: win });
  });
  win.on("closed", () => {
    win = null;
    if (process.platform === "darwin" && tray && !quitting) app.dock?.hide();
  });
}

/** Every load of the dashboard (first load, a reload, a notification's link) gets the same
 *  window chrome adjustments; insertCSS lasts only as long as the document. */
async function dressDashboard() {
  if (!win || win.isDestroyed() || !server) return;
  if (!win.webContents.getURL().startsWith(`http://127.0.0.1:${server.port}`)) return;
  // Belt and braces: whatever drag region the preparing page declared, the dashboard has none.
  await win.webContents.insertCSS("html, body { -webkit-app-region: no-drag; }");
  if (process.platform === "darwin") {
    // hiddenInset puts the traffic lights over the page's top-left corner. Push the sidebar's
    // brand row (and the phone header, at narrow widths) below them, and let that strip drag.
    await win.webContents.insertCSS(
      '[data-testid="sidebar"] { padding-top: 40px; } ' +
      '[data-testid="sidebar"]::before { content: ""; position: fixed; top: 0; left: 0; width: 216px; height: 40px; -webkit-app-region: drag; } ' +
      '.phone-head { padding-left: 84px; -webkit-app-region: drag; } .phone-head * { -webkit-app-region: no-drag; }',
    );
  }
}

/** Bring the window forward, opening it again when it was closed (Dock click, tray, a second
 *  `npx reviewstage`, a notification). */
async function showWindow(path = "") {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    if (path && server) await win.loadURL(`http://127.0.0.1:${server.port}${path}`);
    return;
  }
  if (!server) {
    if (!booting) void boot();
    return;
  }
  createWindow();
  await win.loadURL(`http://127.0.0.1:${server.port}${path || "/"}`);
}

async function prepare() {
  progress({ clearError: true });
  progress({ step: "tools", state: "doing" });
  let tools;
  try {
    tools = await ensureTools(ROOT, (fraction, label) => progress({ step: "tools", state: "doing", label, fraction }));
  } catch (e) {
    progress({ step: "tools", state: "failed", label: "Review tools" });
    progress({ error: `Could not fetch a tool this app needs.<br><code>${esc(e.message)}</code>` });
    return null;
  }
  progress({ step: "tools", state: "done", label: "Review tools ready" });

  const missing = tools.missing.filter((m) => m !== "claude");
  if (missing.length) {
    progress({ step: "claude", state: "failed" });
    progress({ error: `This machine is missing <code>${esc(missing.join(", "))}</code>. On macOS, run <code>xcode-select --install</code>; on Linux, install them with your package manager.` });
    return null;
  }
  if (tools.missing.includes("claude")) {
    progress({ step: "claude", state: "failed", label: "Claude Code is not installed" });
    progress({ error: `ReviewStage runs reviews on <b>your</b> Claude account, through Claude Code. Install it, then try again:<br><code>npm install -g @anthropic-ai/claude-code</code>` });
    return null;
  }
  progress({ step: "claude", state: "done", label: "Claude Code found" });

  progress({ step: "server", state: "doing" });
  const port = await freePort();
  ensureEnv(ROOT, port);
  try {
    server = await spawnServer({ root: ROOT, binDir: tools.binDir, port });
    // The port changes every launch; `npx reviewstage --doctor` reads it from here to find
    // the running app (PUBLIC_URL stops being loopback once the phone tunnel is up).
    writeDesktopState(ROOT, { port });
  } catch (e) {
    progress({ step: "server", state: "failed" });
    progress({ error: `${esc(e.message)}<br><code>${esc((e.log || []).join("\n"))}</code>` });
    return null;
  }
  progress({ step: "server", state: "done", label: "Server running" });
  console.log(`ReviewStage ${updater.state.current}: server on http://127.0.0.1:${port} (ROOT ${ROOT})`);
  return server;
}

/** The window's own cookies for the local server as a Cookie header, or null when nobody is
 *  signed in. The badge and the public-URL call both act only as the signed-in person. */
async function sessionCookieHeader() {
  if (!server) return null;
  const cookies = await session.defaultSession.cookies.get({ url: `http://127.0.0.1:${server.port}` });
  if (!cookies.some((c) => c.name === "rs_session")) return null;
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

async function pollBadge() {
  // Runs with the window closed too: a resident app still says when a review arrives.
  if (!server) return;
  try {
    const header = await sessionCookieHeader();
    if (!header) { app.dock?.setBadge(""); return; }
    const r = await fetch(`http://127.0.0.1:${server.port}/api/queue?tab=todo`, { headers: { Cookie: header } });
    if (!r.ok) return;
    const data = await r.json();
    const todo = Array.isArray(data.rows) ? data.rows.length : Number(data.counts?.todo ?? 0);
    app.dock?.setBadge(todo ? String(todo) : "");
    if (process.platform !== "darwin" && win && !win.isDestroyed()) win.setTitle(todo ? `ReviewStage (${todo})` : "ReviewStage");
    if (lastTodo >= 0 && todo > lastTodo && !SMOKE && Notification.isSupported()) {
      const n = new Notification({ title: "Review requested", body: todo === 1 ? "1 pull request is waiting for you." : `${todo} pull requests are waiting for you.`, silent: false });
      n.on("click", () => void showWindow("/"));
      n.show();
    }
    lastTodo = todo;
  } catch {
    /* server mid-restart; the next tick catches up */
  }
}

// ---- Phone access ---------------------------------------------------------------------------

/** Tell the server where browsers now reach it (lane D1's `POST /api/public-url`). Returns a
 *  warning string when it could not, so the page can say links will still point at the laptop. */
async function setPublicUrl(url, { announce = false } = {}) {
  if (!server) return "The server is not running.";
  try {
    const header = await sessionCookieHeader();
    if (!header) return "Sign in on this computer first so notification links can use the phone address.";
    const r = await fetch(`http://127.0.0.1:${server.port}/api/public-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: header },
      // announce: the address is up; the server tells subscribed phones when it is a new one (F3).
      body: JSON.stringify(announce ? { url, announce: true } : { url }),
    });
    if (r.ok) return null;
    return r.status === 404
      ? "This server cannot switch its public address at runtime; links in notifications will point at the laptop until the app restarts."
      : `The server refused the new public address (HTTP ${r.status}); links in notifications will point at the laptop until the app restarts.`;
  } catch (e) {
    return `Could not update the server's public address (${e.message}).`;
  }
}

/** A single-use sign-in link for the phone (POST /api/pair, loopback + the Mac user's cookie)
 *  with who it signs in as, or null when nobody is signed in here — then the QR carries the
 *  plain address and the phone signs in by itself. */
async function mintPair() {
  if (!server) return null;
  try {
    const header = await sessionCookieHeader();
    if (!header) return null;
    const base = `http://127.0.0.1:${server.port}`;
    const opts = { headers: { "Content-Type": "application/json", Cookie: header } };
    const [pair, me] = await Promise.all([
      fetch(`${base}/api/pair`, { ...opts, method: "POST", body: "{}" }),
      fetch(`${base}/api/me`, opts),
    ]);
    if (!pair.ok || !me.ok) return null;
    const p = await pair.json();
    const m = await me.json();
    return p.url ? { url: p.url, exp: p.exp, login: m.login || "" } : null;
  } catch {
    return null;
  }
}

/** Show the window a (fresh) pair code for `url`: the QR encodes the pairing link when the Mac
 *  is signed in, else the plain address; the text field always shows the plain address. */
async function presentPhone(url, extra = {}) {
  const pair = await mintPair();
  const dataUrl = await QRCode.toDataURL(pair ? pair.url : url, { margin: 1, width: 280, color: { dark: "#ECEEF3", light: "#0B0C10" } });
  await sendPhoneData({ url, dataUrl, pair: pair ? { login: pair.login, exp: pair.exp } : null, ...extra });
}

function notify(title, body, onClick) {
  if (SMOKE || !Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: false });
  if (onClick) n.on("click", onClick);
  n.show();
}

function openPhoneWindow() {
  if (phoneWin && !phoneWin.isDestroyed()) { phoneWin.show(); phoneWin.focus(); return phoneWin; }
  phoneWin = new BrowserWindow({
    width: 440,
    height: 664,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    parent: win && !win.isDestroyed() ? win : undefined,
    title: "Review from your phone",
    backgroundColor: "#0B0C10",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 14, y: 14 },
    icon: ICON,
    webPreferences: { preload: join(here, "preload.cjs"), contextIsolation: true, sandbox: false },
    show: false,
  });
  phoneWin.setMenuBarVisibility(false);
  phoneWin.once("ready-to-show", () => phoneWin?.show());
  phoneWin.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  phoneWin.on("closed", () => { phoneWin = null; refreshMenu(); });
  phoneWin.loadFile(join(here, "pages", "phone.html"));
  return phoneWin;
}

/** The same payload to every window that shows phone access: the phone window (when the menu
 *  opened it) and the dashboard, whose Settings → Your phone card listens on the same channel. */
async function sendPhoneData(data) {
  for (const w of [phoneWin, win]) {
    if (!w || w.isDestroyed()) continue;
    if (w.webContents.isLoading()) await new Promise((r) => w.webContents.once("did-finish-load", r));
    if (!w.isDestroyed()) w.webContents.send("phone", data);
  }
}

/** Phone access as one status, whichever path carries it: the quick tunnel, or Tailscale. */
function phoneState() {
  if (tsUrl) return { enabled: true, url: tsUrl, via: "tailscale" };
  const { enabled, url } = tunnelStatus();
  return { enabled, url, via: "tunnel" };
}

/** The path the person chose: Tailscale when they turned it on in Settings (F6), else the
 *  quick tunnel. Resolves to { url, child } (child only for the tunnel). */
async function openPhonePath() {
  if (readDesktopState(ROOT).phoneVia === "tailscale") {
    tsUrl = await tailscale.serveOn(server.port);
    return { url: tsUrl, child: null };
  }
  return startTunnel(server.port, { root: ROOT });
}

/** `ok` from `${url}/health` straight over the network — the Tailscale path, where MagicDNS
 *  answers at once and there is no edge to wait for. */
async function waitDirectHealthy(url, ms = 20_000) {
  const until = Date.now() + ms;
  let last = "";
  while (Date.now() < until) {
    try {
      const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5_000) });
      if (r.ok && (await r.text()).trim() === "ok") return true;
      last = `HTTP ${r.status}`;
    } catch (e) {
      last = e.message;
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`${url}/health did not answer within ${Math.round(ms / 1000)} s (${last}).`);
}

/** Once a new address answers (or the check gave up — a phone often reaches it before this
 *  machine does), report the reachability and tell the server it is up, so it can send
 *  subscribed phones a sign-in link for the new address (F3). */
function checkThenAnnounce(url, healthy) {
  healthy.then(
    () => sendPhoneData({ check: "ok" }),
    (e) => sendPhoneData({ check: "slow", checkDetail: e.message }),
  ).finally(() => {
    if (phoneState().url === url) void setPublicUrl(url, { announce: true });
  });
}

/** Turn phone access on (or re-mint the code when it already is). The menu path opens the
 *  phone window; the dashboard's Settings card (over IPC) shows the same data in place. The
 *  choice is remembered in ROOT/desktop.json, so the next launch turns it back on (F3). */
async function enablePhone({ window: showWindow = true } = {}) {
  if (!server) return { enabled: false, error: "The server is not running." };
  if (phoneBusy) return { ...phoneState(), busy: true };
  phoneBusy = true;
  refreshMenu();
  try {
    const was = phoneState();
    if (showWindow) openPhoneWindow();
    let url = was.url;
    let child = null;
    if (!was.enabled) ({ url, child } = await openPhonePath());
    writeDesktopState(ROOT, { phone: true });
    const warning = was.enabled ? null : await setPublicUrl(url);
    // Every opening of the window is a new code: the earlier one stops working.
    await presentPhone(url, { warning, check: was.enabled ? "ok" : "checking" });
    if (!was.enabled) {
      if (child) watchTunnel(child);
      // The address is usable before this machine can resolve it; the check is information.
      checkThenAnnounce(url, child ? waitTunnelHealthy(url) : waitDirectHealthy(url));
    }
    return { enabled: true, url, warning };
  } catch (e) {
    const detail = (e.log || []).join("\n");
    const what = readDesktopState(ROOT).phoneVia === "tailscale" ? "the Tailscale address" : "a tunnel";
    await sendPhoneData({ warning: `Could not open ${what}: ${esc(e.message)}` });
    console.error(`phone access: ${e.message}\n${detail}`);
    return { enabled: false, error: e.message, log: e.log || [] };
  } finally {
    phoneBusy = false;
    refreshMenu();
  }
}

/** cloudflared died under us: one restart with a new address (the QR must change, so the
 *  window and a notification say so); a second death within five minutes turns phone access
 *  off and the window says why. See tunnel.js superviseTunnel. */
function watchTunnel(child) {
  supervisor?.stop();
  supervisor = superviseTunnel(child, {
    start: () => startTunnel(server.port, { root: ROOT }),
    onRestart: async (url) => {
      const warning = await setPublicUrl(url);
      refreshMenu();
      await presentPhone(url, { warning, check: "checking", notice: "The tunnel restarted with a new address — scan the new code." });
      checkThenAnnounce(url, waitTunnelHealthy(url));
      notify("Phone address changed — rescan the code", "The tunnel restarted. Open Settings → Your phone and scan the new code.", () => void enablePhone());
    },
    onGiveUp: async (reason) => {
      supervisor = null;
      if (server) await setPublicUrl(`http://127.0.0.1:${server.port}`);
      refreshMenu();
      await sendPhoneData({ stopped: `Phone access turned itself off: ${reason}. Links point at this computer again.` });
      notify("Phone access stopped", "The tunnel kept dropping. Turn it on again from Settings → Your phone when you're ready.");
      console.error(`phone access: ${reason}`);
    },
  });
}

/** Turn phone access off. `remember: false` is a path switch (tunnel ↔ Tailscale), not the
 *  person turning it off, so the remembered choice stays as it was. */
async function disablePhone({ remember = true } = {}) {
  if (phoneBusy) return { ...phoneState(), busy: true };
  phoneBusy = true;
  refreshMenu();
  try {
    supervisor?.stop();
    supervisor = null;
    await stopTunnel();
    if (tsUrl) {
      tsUrl = null;
      await tailscale.serveOff();
    }
    if (remember) writeDesktopState(ROOT, { phone: false });
    if (server) await setPublicUrl(`http://127.0.0.1:${server.port}`);
    if (phoneWin && !phoneWin.isDestroyed()) phoneWin.close();
    return { enabled: false, url: null };
  } finally {
    phoneBusy = false;
    refreshMenu();
  }
}

/** Settings → Your phone → Use Tailscale. On: remember it and (re)open phone access over it.
 *  Off: stop serving, back to the quick tunnel as the path, phone access off. */
async function setTailscale(on) {
  const st = await tailscale.tailscaleStatus();
  if (on && (!st.installed || !st.loggedIn)) return { ...st, error: st.installed ? "Sign in to Tailscale first." : "Tailscale is not installed." };
  if (phoneState().enabled) await disablePhone({ remember: false });
  writeDesktopState(ROOT, { phoneVia: on ? "tailscale" : "tunnel" });
  if (on) {
    const r = await enablePhone({ window: false });
    return { ...st, active: !!r.enabled, error: r.error };
  }
  writeDesktopState(ROOT, { phone: false });
  return { ...st, active: false };
}

// ---- Updates (F4) ---------------------------------------------------------------------------

const updater = createUpdater({ onChange: (u) => { refreshMenu(); for (const w of [win]) if (w && !w.isDestroyed()) w.webContents.send("update", u); } });

async function checkUpdates({ manual = false } = {}) {
  const u = await updater.check();
  if (!manual) return u;
  if (u.dev) notify("Updates are off for this build", `This is a development build (${u.current}); updates are offered to published versions only.`);
  else if (u.error) notify("Could not check for updates", u.error);
  else if (u.available) notify(`ReviewStage ${u.latest} is available`, "Restart to update — from the banner, the menu bar icon or Settings → Desktop app.", () => void showWindow());
  else notify("ReviewStage is up to date", `You have ${u.current}, the latest version.`);
  return u;
}

/** Start the new version detached, then quit this one; the new instance waits for the lock.
 *  If the new process cannot be started, nothing quits and the banner says why. */
async function installUpdate() {
  const u = updater.snapshot();
  if (!u.available || !u.latest) return { ok: false, error: "No update to install." };
  if (u.installing) return { ok: true };
  updater.set({ installing: true, installError: null });
  try {
    const r = await spawnInstall(u.latest, { logFile: join(ROOT, "update.log") });
    console.log(`update: started ${r.cmd} ${r.args.join(" ")} (pid ${r.pid}); quitting`);
  } catch (e) {
    updater.set({ installing: false, installError: e.message });
    return { ok: false, error: e.message };
  }
  setTimeout(() => app.quit(), 300);
  return { ok: true };
}

// ---- Menus ----------------------------------------------------------------------------------

function phoneMenuItems() {
  const { enabled } = phoneState();
  const items = enabled
    ? [{ label: "Disable phone access", enabled: !phoneBusy, click: () => void disablePhone() }]
    : [{ label: "Enable phone access…", enabled: !phoneBusy && !!server, click: () => void enablePhone() }];
  if (enabled && (!phoneWin || phoneWin.isDestroyed())) {
    items.unshift({ label: "Show phone access code…", enabled: !phoneBusy, click: () => void enablePhone() });
  }
  return items;
}

function updateMenuItems() {
  const u = updater.snapshot();
  return [
    ...(u.available ? [{ label: u.installing ? `Updating to ${u.latest}…` : `Update to ${u.latest}`, enabled: !u.installing, click: () => void installUpdate() }] : []),
    { label: "Check for updates", click: () => void checkUpdates({ manual: true }) },
  ];
}

/** The menu-bar icon's menu (F2): open, phone access, updates, quit. */
function trayMenuTemplate() {
  const { enabled } = phoneState();
  return [
    { label: "Open ReviewStage", click: () => void showWindow() },
    { type: "separator" },
    {
      label: `Phone access: ${enabled ? "On" : "Off"}`,
      enabled: !phoneBusy && !!server,
      click: () => void (enabled ? disablePhone() : enablePhone()),
    },
    { type: "separator" },
    ...updateMenuItems(),
    { type: "separator" },
    { label: "Quit ReviewStage", click: () => app.quit() },
  ];
}

/** The template image rendered from the app mark at pack time (scripts/prepack.mjs); macOS
 *  tints a `Template` image for the light or dark menu bar. Without it (a checkout that never
 *  ran prepack), the app icon scaled down. */
function trayImage() {
  const f = join(here, "assets", "trayTemplate.png");
  if (existsSync(f)) {
    const img = nativeImage.createFromPath(f);
    img.setTemplateImage(true);
    return img;
  }
  return nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 });
}

function createTray() {
  try {
    tray = new Tray(trayImage());
    tray.setToolTip("ReviewStage");
    // Linux tray hosts show the menu on click; on macOS a click opens it too.
    refreshMenu();
  } catch (e) {
    tray = null;
    console.error(`tray: ${e.message}`);
  }
}

function refreshMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    isMac
      ? { label: app.name, submenu: [{ role: "about" }, ...updateMenuItems(), { type: "separator" }, ...phoneMenuItems(), { type: "separator" }, { role: "services" }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" }] }
      : { label: "File", submenu: [...phoneMenuItems(), { type: "separator" }, ...updateMenuItems(), { type: "separator" }, { role: "quit" }] },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  if (isMac) app.dock?.setMenu(Menu.buildFromTemplate(phoneMenuItems()));
  if (tray && !tray.isDestroyed()) tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate()));
}

// ---- Boot -----------------------------------------------------------------------------------

async function boot() {
  if (booting) return booting;
  booting = (async () => {
    if (!win || win.isDestroyed()) createWindow();
    await win.loadFile(join(here, "pages", "preparing.html"));
    const ok = server || (await prepare());
    refreshMenu(); // "Enable phone access" is available once the server is
    if (!ok) return; // the page shows the error and a Retry
    if (!win || win.isDestroyed()) createWindow(); // closed while preparing
    await win.loadURL(`http://127.0.0.1:${server.port}/`);
    if (badgeTimer) return; // a Retry after the first boot: the rest already runs
    pollBadge();
    badgeTimer = setInterval(pollBadge, 60_000);
    if (SMOKE) {
      // Prove the whole path once, then leave so the test can assert on stdout.
      console.log(`RS_SMOKE_OK port=${server.port} title=${win.getTitle()} tray=${tray ? 1 : 0}`);
      setTimeout(() => app.quit(), 500);
      return;
    }
    // Phone access was on when the app last ran: turn it back on (a new address for the quick
    // tunnel; the server tells subscribed phones once it answers).
    if (readDesktopState(ROOT).phone) void enablePhone({ window: false });
    ensureAppShortcut();
    void checkUpdates();
    updateTimer = setInterval(() => void checkUpdates(), CHECK_EVERY_MS);
  })().finally(() => { booting = null; });
  return booting;
}

ipcMain.on("retry", () => void boot());
ipcMain.on("quit", () => app.quit());
ipcMain.handle("phone:enable", () => enablePhone({ window: false }));
ipcMain.handle("phone:disable", () => disablePhone());
ipcMain.handle("phone:status", () => phoneState());
ipcMain.handle("phone:tailscale:status", async () => ({ ...(await tailscale.tailscaleStatus()), active: phoneState().via === "tailscale", preferred: readDesktopState(ROOT).phoneVia === "tailscale" }));
ipcMain.handle("phone:tailscale:set", (_e, on) => setTailscale(!!on));
ipcMain.handle("update:status", () => updater.snapshot());
ipcMain.handle("update:check", () => checkUpdates());
ipcMain.handle("update:install", () => installUpdate());
const loginOpts = () => ({
  platform: process.platform,
  home: homedir(),
  node: process.env.RS_LAUNCH_NODE || "",
  path: process.env.RS_LAUNCH_PATH || process.env.PATH || "",
  root: CUSTOM_ROOT ? ROOT : null,
  logFile: join(ROOT, "login.log"),
});
// In Applications: written on the first normal launch of the everyday ROOT, kept current when
// the node that runs npx moves, and never brought back once the person turns it off.
const shortcutOpts = () => ({
  ...loginOpts(),
  // The branded Electron bundle's icon (the launcher re-icons it before Electron starts).
  icns: join(dirname(process.execPath), "..", "Resources", "electron.icns"),
  png: join(SERVER_DIR, "static", "icons", "icon-512.png"),
  run: (cmd, args) => { try { spawnSync(cmd, args, { stdio: "ignore", timeout: 15_000 }); } catch { /* best effort */ } },
});
function ensureAppShortcut() {
  if (SMOKE || CUSTOM_ROOT || !process.env.RS_LAUNCH_NODE) return;
  if (readDesktopState(ROOT).appShortcut === false) return;
  try { writeAppShortcut(shortcutOpts()); } catch (e) { console.error(`app shortcut: ${e.message}`); }
}
const shortcutStatus = () => ({ ...appShortcutStatus(loginOpts()), available: !!process.env.RS_LAUNCH_NODE });
ipcMain.handle("appShortcut:status", () => shortcutStatus());
ipcMain.handle("appShortcut:set", (_e, on) => {
  try {
    writeDesktopState(ROOT, { appShortcut: !!on });
    if (on) writeAppShortcut(shortcutOpts()); else removeAppShortcut(loginOpts());
    return shortcutStatus();
  } catch (e) {
    return { ...shortcutStatus(), error: e.message };
  }
});
ipcMain.handle("openAtLogin:status", () => ({ ...autostartStatus(loginOpts()), available: !!process.env.RS_LAUNCH_NODE }));
ipcMain.handle("openAtLogin:set", (_e, on) => {
  try {
    return { ...setAutostart(!!on, loginOpts()), available: !!process.env.RS_LAUNCH_NODE };
  } catch (e) {
    return { ...autostartStatus(loginOpts()), available: !!process.env.RS_LAUNCH_NODE, error: e.message };
  }
});

// One profile per ROOT: the default ROOT keeps Electron's usual profile (and the signed-in
// session in it); any other ROOT gets its own, so a second root — a test, a second account —
// never shares cookies or the single-instance lock with the everyday app.
app.setName("ReviewStage");
if (CUSTOM_ROOT) app.setPath("userData", join(ROOT, "electron"));

// One running instance per profile (F1). A second `npx reviewstage` brings this one forward
// and exits; an update's new instance (--wait-for-lock) waits for this one to finish quitting.
acquireLock(() => app.requestSingleInstanceLock(), { wait: process.argv.includes("--wait-for-lock") }).then((locked) => {
  if (!locked) {
    console.log("ReviewStage is already running; brought it to the front.");
    app.exit(0);
    return;
  }
  app.on("second-instance", () => { if (!quitting) void showWindow(); });
  app.whenReady().then(() => {
    if (process.platform === "darwin") app.dock?.setIcon(ICON);
    createTray();
    refreshMenu();
    return boot();
  });
});
app.on("activate", () => { if (app.isReady() && !quitting) void showWindow(); });
// Closing the last window keeps the app in the menu bar / tray; without a tray (a Linux
// desktop with no status area) there is nothing left to reopen it from, so it quits.
app.on("window-all-closed", () => { if (process.platform !== "darwin" && !tray) app.quit(); });
// A detached app has no terminal to Ctrl-C it, but `kill`, a logout or a system shutdown sends
// SIGTERM: take the same path as Quit so the tunnel and the server go with it.
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(sig, () => app.quit());
app.on("before-quit", async (e) => {
  quitting = true;
  if (!server) return;
  e.preventDefault();
  clearInterval(badgeTimer);
  clearInterval(updateTimer);
  const child = server.child;
  server = null;
  // The tunnel first: once it is gone the public address answers nothing, then the server.
  supervisor?.stop();
  supervisor = null;
  await stopTunnel();
  if (tsUrl) { tsUrl = null; await tailscale.serveOff(); }
  await stopServer(child);
  console.log("ReviewStage quit: tunnel and server stopped.");
  tray?.destroy();
  app.exit(0);
});
