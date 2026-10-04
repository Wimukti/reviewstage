#!/usr/bin/env node
// `npx reviewstage` lands here. The job is small: find the Electron binary npm installed next
// to this package and hand it main.js. Everything that matters happens in main.js.
import { spawn, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// `npx reviewstage --doctor` runs the server's own doctor against this install, no window:
// the same PASS/WARN/FAIL lines the team install gets, with the fetched tools on PATH.
if (process.argv.includes("--doctor")) {
  const root = process.env.ROOT || join(homedir(), ".reviewstage");
  const sep = process.platform === "win32" ? ";" : ":";
  const r = spawnSync("bash", [join(here, "..", "server", "bin", "doctor.sh")], {
    stdio: "inherit",
    env: { ...process.env, ROOT: root, RS_PERSONAL: process.env.RS_PERSONAL || "1", PATH: `${join(root, "bin")}${sep}${process.env.PATH || ""}` },
  });
  process.exit(r.status ?? 1);
}
let electron;
try {
  electron = require("electron"); // the package's default export is the binary path
} catch (e) {
  console.error("ReviewStage: the Electron binary is missing. Reinstall with `npx reviewstage@latest`.");
  console.error(String(e?.message || e));
  process.exit(1);
}
// Linux: Chromium's setuid sandbox helper has to be root-owned 4755, which nothing installed by
// npm into a user's home can be, and Ubuntu 24.04 also restricts the unprivileged-namespace
// fallback. Every npm-distributed Electron app hits this. The window only ever shows the local
// server (external links open in the system browser), so running without the Chromium sandbox
// is the documented trade on Linux; it is left on wherever the helper is usable.
const flags = [];
if (process.platform === "linux") {
  try {
    const st = statSync(join(dirname(electron), "chrome-sandbox"));
    if (!(st.uid === 0 && (st.mode & 0o4000))) flags.push("--no-sandbox");
  } catch { flags.push("--no-sandbox"); }
}
const child = spawn(electron, [join(here, "..", "main.js"), ...flags, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "1" },
});
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
