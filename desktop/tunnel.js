// Phone access is a Cloudflare quick tunnel: `cloudflared tunnel --url http://127.0.0.1:<port>`
// gives a real HTTPS address with no account, which is what a phone needs for Add to Home
// Screen and web push. The binary comes from tools.json like gh and jq. The URL is read off
// cloudflared's log, then proven reachable through the edge before anyone sees a QR code of it:
// a tunnel that has been created but not propagated yet makes a QR that fails on the phone.
import { spawn } from "node:child_process";
import { Resolver } from "node:dns/promises";
import https from "node:https";
import { ensureTool } from "./tools.js";

export const TUNNEL_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const URL_TIMEOUT_MS = 45_000;
const HEALTH_TIMEOUT_MS = 30_000; // the hostname takes ~5-10 s to exist at the edge
const STOP_GRACE_MS = 3_000;

let current = null; // { child, url, port }

/** The tunnel's public URL on a log line, or null. `api.trycloudflare.com` is the control API
 *  cloudflared talks to and shows up in its error messages; it is never the tunnel. */
export function parseTunnelUrl(line) {
  const m = TUNNEL_URL_RE.exec(String(line));
  if (!m || m[0].startsWith("https://api.")) return null;
  return m[0];
}

/** Resolve the tunnel host at Cloudflare's own resolver. The system resolver is deliberately
 *  not used: ask it for a hostname that does not exist yet and macOS caches the NXDOMAIN for
 *  over a minute, after which the tunnel is fine and the laptop still cannot see it. */
export function resolveAtEdge(host) {
  const r = new Resolver();
  r.setServers(["1.1.1.1", "1.0.0.1"]);
  return r.resolve4(host).then((ips) => ips[0]);
}

/** GET `${url}/health` by IP with the hostname as SNI and Host, so the probe needs no resolver
 *  at all once the edge has published the record. Resolves to { status, body }. */
export function probeHealth(url, ip, timeoutMs = 5_000) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.request({ host: ip, servername: u.hostname, port: 443, path: "/health", method: "GET", headers: { Host: u.hostname }, timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (d) => { body += d; });
      res.on("end", () => resolve({ status: res.statusCode, body: body.trim() }));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

/** `ok` from `${url}/health` through the edge within `ms`: first wait for the hostname to
 *  exist, then for the edge to proxy it. Retries all the way; rejects with the last reason. */
export async function waitTunnelHealthy(url, ms = HEALTH_TIMEOUT_MS, deps = {}) {
  const resolve = deps.resolve || resolveAtEdge;
  const probe = deps.probe || probeHealth;
  const host = new URL(url).hostname;
  const until = Date.now() + ms;
  let last = "";
  let ip = null;
  while (Date.now() < until) {
    try {
      ip = ip || (await resolve(host));
      const { status, body } = await probe(url, ip);
      if (status === 200 && body === "ok") return true;
      last = `HTTP ${status}`;
    } catch (e) {
      last = ip ? e?.message || String(e) : `DNS: ${e?.code || e?.message || e}`;
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  const err = new Error(`The tunnel was created but ${url}/health did not answer within ${Math.round(ms / 1000)} s (${last}).`);
  err.code = "TUNNEL_UNREACHABLE";
  throw err;
}

/** Terminate a child: SIGTERM, then SIGKILL after a grace period. Resolves once it has exited
 *  (or at once when it already had). */
export function stopChild(child, graceMs = STOP_GRACE_MS) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode) return resolve();
    const t = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } }, graceMs);
    child.once("exit", () => { clearTimeout(t); resolve(); });
    try { child.kill("SIGTERM"); } catch { clearTimeout(t); resolve(); }
  });
}

/**
 * Start a quick tunnel to the local server. Resolves to { url, child } once the URL has shown
 * up in cloudflared's output and `${url}/health` answers `ok` through the edge. Rejects with the
 * last 20 log lines on `.log` when either does not happen in time; nothing is left running.
 */
export async function startTunnel(port, { root, onLog = () => {}, bin } = {}) {
  if (current) return { url: current.url, child: current.child };
  const exe = bin || (await ensureTool("cloudflared", root)) || "cloudflared";
  const log = [];
  const keep = (line) => {
    log.push(line);
    if (log.length > 200) log.shift();
    onLog(line);
  };
  const child = spawn(exe, ["tunnel", "--url", `http://127.0.0.1:${port}`, "--no-autoupdate"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1" },
  });

  const url = await new Promise((resolve, reject) => {
    let settled = false;
    const fail = (why) => {
      if (settled) return;
      settled = true;
      const err = new Error(why);
      err.log = log.slice(-20);
      reject(err);
    };
    const timer = setTimeout(() => fail(`cloudflared did not report a tunnel URL within ${URL_TIMEOUT_MS / 1000} s.`), URL_TIMEOUT_MS);
    for (const s of [child.stdout, child.stderr]) {
      let buf = "";
      s.setEncoding("utf8");
      s.on("data", (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          keep(line);
          const u = parseTunnelUrl(line);
          if (u && !settled) { settled = true; clearTimeout(timer); resolve(u); }
        }
      });
    }
    child.on("error", (e) => { clearTimeout(timer); fail(`could not start cloudflared: ${e.message}`); });
    child.on("exit", (code) => { clearTimeout(timer); fail(`cloudflared exited (code ${code}) before reporting a URL.`); });
  }).catch(async (e) => { await stopChild(child); throw e; });

  try {
    await waitTunnelHealthy(url);
  } catch (e) {
    e.log = log.slice(-20);
    await stopChild(child);
    throw e;
  }
  current = { child, url, port };
  child.once("exit", () => { if (current?.child === child) current = null; });
  return { url, child };
}

/** Stop the running tunnel, if any. `child` may be passed explicitly (tests, or a tunnel that
 *  was started outside this module's bookkeeping). */
export async function stopTunnel(child = current?.child) {
  if (current && (!child || current.child === child)) current = null;
  await stopChild(child);
}

export function tunnelStatus() {
  return current ? { enabled: true, url: current.url, port: current.port } : { enabled: false, url: null, port: null };
}
