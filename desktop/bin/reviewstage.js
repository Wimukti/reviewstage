#!/usr/bin/env node
// `npx reviewstage` lands here. The job is small: find the Electron binary npm installed next
// to this package and hand it main.js. Everything that matters happens in main.js.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
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
