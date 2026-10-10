// `npx reviewstage --doctor`: the desktop half of the doctor. The checks themselves live in
// the server's bin/doctor.sh and bin/rs_doctor.py (the team install runs the same ones); this
// module only tells them what the launcher knows — which node ran it, where the Electron
// binary is, that this is a desktop install — and forwards the flags.
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

export const DOCTOR_FLAGS = ["--json", "--live", "--strict"];

/** The doctor flags out of argv, in a fixed order, so `--doctor --json` and `--json --doctor`
 *  reach the script the same way. Anything else on the command line is not the doctor's. */
export function doctorArgs(argv) {
  return DOCTOR_FLAGS.filter((f) => argv.includes(f));
}

/** Where Electron's binary is, or null when the package did not resolve (a half-finished
 *  install) — the doctor reports that as env.electron FAIL rather than this crashing. */
export function electronPath(require) {
  try {
    const p = require("electron");
    return typeof p === "string" && p ? p : null;
  } catch {
    return null;
  }
}

/** The environment doctor.sh runs in: the install's ROOT with its fetched tools first on
 *  PATH, personal mode, and the runtime facts rs_doctor.py cannot find out by itself. */
export function doctorEnv({ env = process.env, platform = process.platform, nodeVersion = process.versions.node, electron = null, root = env.ROOT || join(homedir(), ".reviewstage") } = {}) {
  const sep = platform === "win32" ? ";" : ":";
  const out = {
    ...env,
    ROOT: root,
    RS_PERSONAL: env.RS_PERSONAL || "1",
    RS_DOCTOR_DESKTOP: "1",
    RS_DOCTOR_NODE: nodeVersion,
    PATH: `${join(root, "bin")}${sep}${env.PATH || ""}`,
  };
  if (electron) out.RS_DOCTOR_ELECTRON = electron;
  else delete out.RS_DOCTOR_ELECTRON;
  return out;
}

/** Run the doctor and return its exit status: 0 all pass, 1 any FAIL, 2 only warnings with
 *  --strict. Output goes straight to the terminal (or, with --json, one JSON document). */
export function runDoctor(argv, { env = process.env, require, pkgDir, spawn = spawnSync } = {}) {
  const r = spawn("bash", [join(pkgDir, "server", "bin", "doctor.sh"), ...doctorArgs(argv)], {
    stdio: "inherit",
    env: doctorEnv({ env, electron: require ? electronPath(require) : null }),
  });
  return r.status ?? 1;
}
