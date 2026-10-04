// `npx reviewstage` — the desktop app. One window on the local server, which this process
// starts and owns. Everything the Docker install does with Compose and a browser happens here:
// a root with a secret, the tools the scripts need, the server on a free port, the queue count
// on the dock, a notification when a review arrives. See openspec/changes/npx-desktop/design.md.
import { app, BrowserWindow, ipcMain, Notification, shell, session } from "electron";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureEnv, freePort, spawnServer, stopServer } from "./server.js";
import { ensureTools } from "./tools.js";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.ROOT || join(homedir(), ".reviewstage");
const SMOKE = process.env.RS_SMOKE === "1"; // the Playwright smoke test: no notifications, exit cleanly

let win = null;
let server = null; // { child, port }
let badgeTimer = null;
let lastTodo = -1;

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

async function pollBadge() {
  if (!server || !win || win.isDestroyed()) return;
  try {
    // The window's own cookies: the badge counts what the signed-in person sees, nothing else.
    const cookies = await session.defaultSession.cookies.get({ url: `http://127.0.0.1:${server.port}` });
    if (!cookies.some((c) => c.name === "rs_session")) { app.dock?.setBadge(""); return; }
    const header = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
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

async function boot() {
  createWindow();
  await win.loadFile(join(here, "pages", "preparing.html"));
  const ok = await prepare();
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

app.setName("ReviewStage");
app.whenReady().then(boot);
app.on("activate", () => { if (!win) createWindow(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", async (e) => {
  if (!server) return;
  e.preventDefault();
  clearInterval(badgeTimer);
  const child = server.child;
  server = null;
  await stopServer(child);
  app.exit(0);
});
