// F6 (optional): a stable phone address over Tailscale. When the `tailscale` CLI is installed
// and logged in, `tailscale serve` publishes the local server at https://<machine>.<tailnet>.ts.net
// to the person's own devices only, and that address never changes. Nothing here installs or
// signs in to Tailscale; without it the option is a one-line explanation in Settings.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { onPath } from "./tools.js";

// The Mac App Store / standalone app ships the CLI inside the bundle and does not always link
// it onto PATH.
const MAC_APP_CLI = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";

export function findTailscale({ platform = process.platform, which = onPath, exists = existsSync } = {}) {
  return which("tailscale") || (platform === "darwin" && exists(MAC_APP_CLI) ? MAC_APP_CLI : null);
}

export const serveArgs = (port) => ["serve", "--bg", "--https=443", `http://127.0.0.1:${Number(port)}`];
export const serveOffArgs = () => ["serve", "--https=443", "off"];
export const statusArgs = () => ["status", "--json"];

/** From `tailscale status --json`: logged in (BackendState "Running") and this machine's
 *  MagicDNS name, as the https address the phone will use. */
export function parseStatus(json) {
  let d;
  try { d = typeof json === "string" ? JSON.parse(json) : json; } catch { return { loggedIn: false, url: null }; }
  const running = d?.BackendState === "Running";
  const dns = String(d?.Self?.DNSName || "").replace(/\.$/, "");
  return { loggedIn: running, url: running && dns ? `https://${dns}` : null };
}

function run(exe, args, runImpl) {
  if (runImpl) return runImpl(exe, args);
  return new Promise((resolve, reject) => {
    execFile(exe, args, { timeout: 15_000 }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(new Error(String(stderr || err.message).trim()), { code: err.code }));
      else resolve(String(stdout));
    });
  });
}

/** { installed, loggedIn, url }. Never throws. */
export async function tailscaleStatus({ runImpl, find = findTailscale } = {}) {
  const exe = find();
  if (!exe) return { installed: false, loggedIn: false, url: null };
  try {
    return { installed: true, ...parseStatus(await run(exe, statusArgs(), runImpl)) };
  } catch {
    return { installed: true, loggedIn: false, url: null };
  }
}

/** Point `tailscale serve` at the local server. Resolves to the stable https address. */
export async function serveOn(port, { runImpl, find = findTailscale } = {}) {
  const st = await tailscaleStatus({ runImpl, find });
  if (!st.installed) throw new Error("Tailscale is not installed on this computer.");
  if (!st.loggedIn || !st.url) throw new Error("Tailscale is installed but not signed in. Sign in to Tailscale, then try again.");
  await run(find(), serveArgs(port), runImpl);
  return st.url;
}

export async function serveOff({ runImpl, find = findTailscale } = {}) {
  const exe = find();
  if (!exe) return;
  try { await run(exe, serveOffArgs(), runImpl); } catch { /* nothing was served */ }
}
