// F4: tell the person about a newer published version and apply it on request. The check reads
// the `latest` dist-tag from the npm registry (the same registry npx will install from: npm
// hands its configured registry to the child as npm_config_registry). Installing is `npx -y
// reviewstage@<v> --wait-for-lock`, detached, after which this instance quits; the new one
// takes the single-instance lock once this one has let go and comes up on the same ROOT.
import { spawn } from "node:child_process";
import { existsSync, openSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDevVersion, updateAvailable } from "./lifecycle.js";

const here = dirname(fileURLToPath(import.meta.url));
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/** The running package's version: desktop/package.json, which CI stamps from the tag. */
export function runningVersion() {
  try {
    return JSON.parse(readFileSync(join(here, "package.json"), "utf8")).version || "0.0.0-dev";
  } catch {
    return "0.0.0-dev";
  }
}

export function registryUrl(env = process.env) {
  const base = (env.npm_config_registry || "https://registry.npmjs.org/").replace(/\/+$/, "");
  return `${base}/reviewstage`;
}

/** { latest } from the registry's abbreviated document, or throws with a plain message. */
export async function fetchLatest({ env = process.env, fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  const r = await fetchImpl(registryUrl(env), {
    headers: { Accept: "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`the registry answered HTTP ${r.status}`);
  const doc = await r.json();
  const latest = doc?.["dist-tags"]?.latest;
  if (typeof latest !== "string" || !latest) throw new Error("the registry did not name a latest version");
  return { latest };
}

/**
 * The update state the tray, the banner and Settings all read. `check()` never throws: a
 * failed check keeps the last good answer and records the error and the time.
 */
export function createUpdater({ current = runningVersion(), env = process.env, fetchImpl = fetch, now = Date.now, onChange = () => {} } = {}) {
  const state = { current, latest: null, available: false, checkedAt: null, error: null, dev: isDevVersion(current), installing: false, installError: null };
  const snapshot = () => ({ ...state });
  async function check() {
    if (state.dev) {
      state.checkedAt = now();
      onChange(snapshot());
      return snapshot();
    }
    try {
      const { latest } = await fetchLatest({ env, fetchImpl });
      state.latest = latest;
      state.available = updateAvailable(current, latest);
      state.error = null;
    } catch (e) {
      state.error = e?.message || String(e);
    }
    state.checkedAt = now();
    onChange(snapshot());
    return snapshot();
  }
  return { state, snapshot, check, set: (patch) => { Object.assign(state, patch); onChange(snapshot()); } };
}

/** The command that installs `version`: the launcher's own npx (sibling of the node that ran
 *  it, passed down as RS_LAUNCH_NODE), else npx from PATH. */
export function installCommand(version, env = process.env) {
  const node = env.RS_LAUNCH_NODE;
  const sibling = node ? join(dirname(node), "npx") : null;
  const npx = sibling && existsSync(sibling) ? sibling : "npx";
  return { cmd: npx, args: ["-y", `reviewstage@${version}`, "--wait-for-lock"] };
}

/**
 * Start the new version, detached, with the launcher's environment (its PATH, its ROOT, its
 * registry). Resolves once the process has started; rejects when it could not be — then the
 * caller must not quit. Output goes to `logFile` (ROOT/update.log).
 */
export function spawnInstall(version, { env = process.env, logFile, spawnImpl = spawn } = {}) {
  const { cmd, args } = installCommand(version, env);
  const childEnv = { ...env };
  if (env.RS_LAUNCH_PATH) childEnv.PATH = env.RS_LAUNCH_PATH;
  delete childEnv.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve, reject) => {
    let out = "ignore";
    try { if (logFile) out = openSync(logFile, "a"); } catch { /* no log, still install */ }
    let child;
    try {
      child = spawnImpl(cmd, args, { detached: true, stdio: ["ignore", out, out], env: childEnv });
    } catch (e) {
      reject(e);
      return;
    }
    child.once("error", (e) => reject(new Error(`could not start ${cmd}: ${e.message}`)));
    child.once("spawn", () => { child.unref(); resolve({ cmd, args, pid: child.pid }); });
  });
}
