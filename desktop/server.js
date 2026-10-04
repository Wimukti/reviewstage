// The server is the same bin/server.py the Docker image runs, carried inside the npm package
// under server/. The launcher's job is to give it a root, a secret, a free loopback port and a
// PATH that has the tools, then wait until /health answers.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync, createWriteStream } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const SERVER_DIR = join(here, "server", "bin");

export function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** Read ROOT/.env into a map. Lines are KEY=value; quotes are not interpreted (the server
 *  reads it the same way). */
export function readEnv(root) {
  const f = join(root, ".env");
  const out = {};
  if (!existsSync(f)) return out;
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#")) out[m[1]] = m[2];
  }
  return out;
}

export function writeEnv(root, env) {
  mkdirSync(root, { recursive: true });
  const f = join(root, ".env");
  const body = Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
  writeFileSync(f, body);
  chmodSync(f, 0o600);
}

/**
 * First launch writes a personal-mode .env: a real secret, the device-flow sign-in, dry run on,
 * and a loopback PUBLIC_URL for the port we chose. Later launches keep every value the user or
 * the app has set and only refresh the loopback PUBLIC_URL when it still points at loopback.
 */
export function ensureEnv(root, port) {
  const env = readEnv(root);
  const fresh = Object.keys(env).length === 0;
  if (fresh) {
    Object.assign(env, {
      RS_SECRET: randomBytes(24).toString("hex"),
      RS_PERSONAL: "1",
      GH_DEVICE_FLOW: "1",
      DRY_RUN: "1",
    });
  }
  if (!env.PUBLIC_URL || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(env.PUBLIC_URL)) {
    env.PUBLIC_URL = `http://127.0.0.1:${port}`;
  }
  writeEnv(root, env);
  return { env, fresh };
}

async function waitHealthy(port, ms = 30_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`);
      if (r.ok && (await r.text()).trim() === "ok") return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/**
 * Start the server. Resolves to { child, port, log } once /health answers, or rejects with the
 * tail of its output so the window can show what went wrong.
 */
export async function spawnServer({ root, binDir, port, extraEnv = {}, onLog = () => {} }) {
  const log = [];
  // The last 400 lines stay in memory for the error screen; the whole run goes to
  // ROOT/server.log (fresh each launch) so "what happened" survives a restart.
  const logFile = createWriteStream(join(root, "server.log"), { flags: "w" });
  const keep = (line) => {
    log.push(line);
    if (log.length > 400) log.shift();
    logFile.write(line + "\n");
    onLog(line);
  };
  const env = {
    ...process.env,
    ...extraEnv,
    ROOT: root,
    RS_PORT: String(port),
    RS_SPA: "1",
    RS_COOKIE_SECURE: "0", // loopback is http; the tunnel path flips cookies to Secure itself
    PATH: `${binDir}${process.platform === "win32" ? ";" : ":"}${process.env.PATH || ""}`,
    PYTHONUNBUFFERED: "1",
  };
  const child = spawn("python3", [join(SERVER_DIR, "server.py")], { cwd: SERVER_DIR, env, stdio: ["ignore", "pipe", "pipe"] });
  for (const s of [child.stdout, child.stderr]) {
    let buf = "";
    s.setEncoding("utf8");
    s.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        keep(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    });
  }
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  const ok = await Promise.race([waitHealthy(port), exited.then(() => false)]);
  if (!ok) {
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
    const err = new Error("The server did not start.");
    err.log = log.slice(-40);
    throw err;
  }
  return { child, port, log };
}

export function stopServer(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    const t = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } }, 3000);
    child.once("exit", () => { clearTimeout(t); resolve(); });
    try { child.kill("SIGTERM"); } catch { clearTimeout(t); resolve(); }
  });
}
