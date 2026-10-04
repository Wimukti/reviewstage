#!/usr/bin/env node
// `npx reviewstage` lands here. The job is small: find the Electron binary npm installed next
// to this package and hand it main.js. Everything that matters happens in main.js.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
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
// macOS: the dock label and the Finder icon come from the Electron.app bundle npm installed,
// which says "Electron". Rename and re-icon the bundle once (Electron's npm build is already
// ad-hoc signed, so an ad-hoc re-sign with the system codesign keeps it launchable). Every
// step is optional: if anything is missing the app runs with Electron's own name and icon.
function brandMacBundle(electronBin) {
  const m = /^(.*\/Electron\.app)\//.exec(electronBin);
  if (!m) return;
  const bundle = m[1];
  const plist = join(bundle, "Contents", "Info.plist");
  const stamp = join(bundle, "Contents", ".reviewstage-branded");
  const png = join(here, "..", "server", "bin", "static", "icons", "icon-512.png");
  if (existsSync(stamp) || !existsSync(plist) || !existsSync(png)) return;
  const run = (cmd, args) => spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
  const backup = readFileSync(plist);
  try {
    const set = join(tmpdir(), `rs-icon-${process.pid}.iconset`);
    mkdirSync(set, { recursive: true });
    for (const [n, px] of [["16x16", 16], ["16x16@2x", 32], ["32x32", 32], ["32x32@2x", 64], ["128x128", 128], ["128x128@2x", 256], ["256x256", 256], ["256x256@2x", 512], ["512x512", 512]]) {
      if (!run("sips", ["-z", String(px), String(px), png, "--out", join(set, `icon_${n}.png`)])) throw new Error("sips");
    }
    const icns = join(bundle, "Contents", "Resources", "electron.icns");
    if (!run("iconutil", ["-c", "icns", set, "-o", icns])) throw new Error("iconutil");
    rmSync(set, { recursive: true, force: true });
    for (const [k, v] of [["CFBundleName", "ReviewStage"], ["CFBundleDisplayName", "ReviewStage"], ["CFBundleIdentifier", "io.reviewstage.desktop"]]) {
      if (!run("plutil", ["-replace", k, "-string", v, plist])) throw new Error("plutil");
    }
    writeFileSync(stamp, "1\n"); // before signing, so the seal covers it
    if (!run("codesign", ["--force", "--deep", "--sign", "-", bundle])) throw new Error("codesign");
  } catch {
    writeFileSync(plist, backup);
    rmSync(stamp, { force: true });
    run("codesign", ["--force", "--deep", "--sign", "-", bundle]);
  }
}
if (process.platform === "darwin") brandMacBundle(electron);

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
