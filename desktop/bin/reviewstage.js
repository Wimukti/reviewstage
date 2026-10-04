#!/usr/bin/env node
// `npx reviewstage` lands here. The job is small: find the Electron binary npm installed next
// to this package and hand it main.js. Everything that matters happens in main.js.
import { spawn, spawnSync } from "node:child_process";
import { homedir } from "node:os";
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
const child = spawn(electron, [join(here, "..", "main.js"), ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "1" },
});
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
