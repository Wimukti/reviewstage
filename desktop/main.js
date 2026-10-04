// `npx reviewstage` — the desktop app. One window on the local server, which this process
// starts and owns. Everything the Docker install does with Compose and a browser happens here:
// a root with a secret, the tools the scripts need, the server on a free port, the queue count
// on the dock, a notification when a review arrives, and on request a public tunnel for the
// phone. See openspec/changes/npx-desktop/design.md.
import { app, BrowserWindow, ipcMain, Menu, Notification, shell, session } from "electron";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { ensureEnv, freePort, spawnServer, stopServer, SERVER_DIR } from "./server.js";
import { ensureTools } from "./tools.js";
import { startTunnel, stopTunnel, superviseTunnel, tunnelStatus, waitTunnelHealthy } from "./tunnel.js";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.ROOT || join(homedir(), ".reviewstage");
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
  win.once("ready-to-show", () => win.show());
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
  win.on("closed", () => { win = null; });
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
  } catch (e) {
    progress({ step: "server", state: "failed" });
    progress({ error: `${esc(e.message)}<br><code>${esc((e.log || []).join("\n"))}</code>` });
    return null;
  }
  progress({ step: "server", state: "done", label: "Server running" });
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
  if (!server || !win || win.isDestroyed()) return;
  try {
    const header = await sessionCookieHeader();
    if (!header) { app.dock?.setBadge(""); return; }
    const r = await fetch(`http://127.0.0.1:${server.port}/api/queue?tab=todo`, { headers: { Cookie: header } });
    if (!r.ok) return;
    const data = await r.json();
    const todo = Array.isArray(data.rows) ? data.rows.length : Number(data.counts?.todo ?? 0);
    app.dock?.setBadge(todo ? String(todo) : "");
    if (process.platform !== "darwin") win.setTitle(todo ? `ReviewStage (${todo})` : "ReviewStage");
    if (lastTodo >= 0 && todo > lastTodo && !SMOKE && Notification.isSupported()) {
      const n = new Notification({ title: "Review requested", body: todo === 1 ? "1 pull request is waiting for you." : `${todo} pull requests are waiting for you.`, silent: false });
      n.on("click", () => { win?.show(); win?.loadURL(`http://127.0.0.1:${server.port}/`); });
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
async function setPublicUrl(url) {
  if (!server) return "The server is not running.";
  try {
    const header = await sessionCookieHeader();
    if (!header) return "Sign in on this computer first so notification links can use the phone address.";
    const r = await fetch(`http://127.0.0.1:${server.port}/api/public-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: header },
      body: JSON.stringify({ url }),
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

/** Turn phone access on (or re-mint the code when it already is). The menu path opens the
 *  phone window; the dashboard's Settings card (over IPC) shows the same data in place. */
async function enablePhone({ window: showWindow = true } = {}) {
  if (!server) return { enabled: false, error: "The server is not running." };
  if (phoneBusy) return { ...tunnelStatus(), busy: true };
  phoneBusy = true;
  refreshMenu();
  try {
    const was = tunnelStatus();
    if (showWindow) openPhoneWindow();
    let url = was.url;
    let child = null;
    if (!was.enabled) ({ url, child } = await startTunnel(server.port, { root: ROOT }));
    const warning = was.enabled ? null : await setPublicUrl(url);
    // Every opening of the window is a new code: the earlier one stops working.
    await presentPhone(url, { warning, check: was.enabled ? "ok" : "checking" });
    if (!was.enabled) {
      watchTunnel(child);
      // The address is usable before this machine can resolve it; the check is information.
      waitTunnelHealthy(url).then(
        () => sendPhoneData({ check: "ok" }),
        (e) => sendPhoneData({ check: "slow", checkDetail: e.message }),
      );
    }
    return { enabled: true, url, warning };
  } catch (e) {
    const detail = (e.log || []).join("\n");
    await sendPhoneData({ warning: `Could not open a tunnel: ${esc(e.message)}` });
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
      waitTunnelHealthy(url).then(() => sendPhoneData({ check: "ok" }), (e) => sendPhoneData({ check: "slow", checkDetail: e.message }));
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

async function disablePhone() {
  if (phoneBusy) return { ...tunnelStatus(), busy: true };
  phoneBusy = true;
  refreshMenu();
  try {
    supervisor?.stop();
    supervisor = null;
    await stopTunnel();
    if (server) await setPublicUrl(`http://127.0.0.1:${server.port}`);
    if (phoneWin && !phoneWin.isDestroyed()) phoneWin.close();
    return { enabled: false, url: null };
  } finally {
    phoneBusy = false;
    refreshMenu();
  }
}

function phoneMenuItems() {
  const { enabled } = tunnelStatus();
  const items = enabled
    ? [{ label: "Disable phone access", enabled: !phoneBusy, click: () => void disablePhone() }]
    : [{ label: "Enable phone access…", enabled: !phoneBusy && !!server, click: () => void enablePhone() }];
  if (enabled && (!phoneWin || phoneWin.isDestroyed())) {
    items.unshift({ label: "Show phone access code…", enabled: !phoneBusy, click: () => void enablePhone() });
  }
  return items;
}

function refreshMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    isMac
      ? { label: app.name, submenu: [{ role: "about" }, { type: "separator" }, ...phoneMenuItems(), { type: "separator" }, { role: "services" }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" }] }
      : { label: "File", submenu: [...phoneMenuItems(), { type: "separator" }, { role: "quit" }] },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  if (isMac) app.dock?.setMenu(Menu.buildFromTemplate(phoneMenuItems()));
}

async function boot() {
  createWindow();
  await win.loadFile(join(here, "pages", "preparing.html"));
  const ok = await prepare();
  refreshMenu(); // "Enable phone access" is available once the server is
  if (!ok) return; // the page shows the error and a Retry
  await win.loadURL(`http://127.0.0.1:${server.port}/`);
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
  pollBadge();
  badgeTimer = setInterval(pollBadge, 60_000);
  if (SMOKE) {
    // Prove the whole path once, then leave so the test can assert on stdout.
    console.log(`RS_SMOKE_OK port=${server.port} title=${win.getTitle()}`);
    setTimeout(() => app.quit(), 500);
  }
}

ipcMain.on("retry", () => void boot());
ipcMain.on("quit", () => app.quit());
ipcMain.handle("phone:enable", () => enablePhone({ window: false }));
ipcMain.handle("phone:disable", () => disablePhone());
ipcMain.handle("phone:status", () => { const { enabled, url } = tunnelStatus(); return { enabled, url }; });

app.setName("ReviewStage");
app.whenReady().then(() => { if (process.platform === "darwin") app.dock?.setIcon(ICON); refreshMenu(); return boot(); });
app.on("activate", () => { if (!win) createWindow(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", async (e) => {
  if (!server) return;
  e.preventDefault();
  clearInterval(badgeTimer);
  const child = server.child;
  server = null;
  // The tunnel first: once it is gone the public address answers nothing, then the server.
  supervisor?.stop();
  supervisor = null;
  await stopTunnel();
  await stopServer(child);
  app.exit(0);
});
