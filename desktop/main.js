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
import { ensureEnv, freePort, spawnServer, stopServer } from "./server.js";
import { ensureTools } from "./tools.js";
import { startTunnel, stopTunnel, tunnelStatus } from "./tunnel.js";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.ROOT || join(homedir(), ".reviewstage");
const SMOKE = process.env.RS_SMOKE === "1"; // the Playwright smoke test: no notifications, exit cleanly

let win = null;
let server = null; // { child, port }
let badgeTimer = null;
let lastTodo = -1;
let phoneWin = null;
let phoneBusy = false; // an enable or disable in flight; the menu items wait for it

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
    webPreferences: { preload: join(here, "preload.cjs"), contextIsolation: true, sandbox: false },
    show: false,
  });
  win.once("ready-to-show", () => win.show());
  // Links to GitHub and the docs open in the person's browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (server && url.startsWith(`http://127.0.0.1:${server.port}`)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
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

function openPhoneWindow() {
  if (phoneWin && !phoneWin.isDestroyed()) { phoneWin.show(); phoneWin.focus(); return phoneWin; }
  phoneWin = new BrowserWindow({
    width: 440,
    height: 620,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    parent: win && !win.isDestroyed() ? win : undefined,
    title: "Review from your phone",
    backgroundColor: "#0B0C10",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 14, y: 14 },
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

async function sendPhoneData(data) {
  if (!phoneWin || phoneWin.isDestroyed()) return;
  if (phoneWin.webContents.isLoading()) await new Promise((r) => phoneWin.webContents.once("did-finish-load", r));
  if (phoneWin && !phoneWin.isDestroyed()) phoneWin.webContents.send("phone", data);
}

async function enablePhone() {
  if (!server) return { enabled: false, error: "The server is not running." };
  if (phoneBusy) return { ...tunnelStatus(), busy: true };
  phoneBusy = true;
  refreshMenu();
  try {
    const was = tunnelStatus();
    openPhoneWindow();
    const { url } = was.enabled ? was : await startTunnel(server.port, { root: ROOT });
    const warning = was.enabled ? null : await setPublicUrl(url);
    const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 280, color: { dark: "#ECEEF3", light: "#0B0C10" } });
    await sendPhoneData({ url, dataUrl, warning });
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

async function disablePhone() {
  if (phoneBusy) return { ...tunnelStatus(), busy: true };
  phoneBusy = true;
  refreshMenu();
  try {
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
ipcMain.handle("phone:enable", () => enablePhone());
ipcMain.handle("phone:disable", () => disablePhone());
ipcMain.handle("phone:status", () => { const { enabled, url } = tunnelStatus(); return { enabled, url }; });

app.setName("ReviewStage");
app.whenReady().then(() => { refreshMenu(); return boot(); });
app.on("activate", () => { if (!win) createWindow(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", async (e) => {
  if (!server) return;
  e.preventDefault();
  clearInterval(badgeTimer);
  const child = server.child;
  server = null;
  // The tunnel first: once it is gone the public address answers nothing, then the server.
  await stopTunnel();
  await stopServer(child);
  app.exit(0);
});
