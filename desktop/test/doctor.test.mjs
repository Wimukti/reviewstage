// `npx reviewstage --doctor` (openspec/changes/p0-proof lane 5): the launcher forwards the
// doctor flags, reports its node and Electron to the server-side checks, records the port it
// chose in desktop.json so the doctor can find the running app, and relays the exit code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DOCTOR_FLAGS, doctorArgs, doctorEnv, electronPath, runDoctor } from "../doctor.js";
import { readDesktopState, writeDesktopState } from "../lifecycle.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, "..");

test("only the doctor's flags are forwarded, in a fixed order", () => {
  assert.deepEqual(doctorArgs(["--doctor"]), []);
  assert.deepEqual(doctorArgs(["--strict", "--doctor", "--json"]), ["--json", "--strict"]);
  assert.deepEqual(doctorArgs(["--doctor", "--live", "--foreground", "--no-sandbox"]), ["--live"]);
  assert.deepEqual(DOCTOR_FLAGS, ["--json", "--live", "--strict"]);
});

test("the Electron path is the package's default export, or null when it is missing", () => {
  assert.equal(electronPath(() => "/apps/Electron"), "/apps/Electron");
  assert.equal(electronPath(() => { throw new Error("Cannot find module 'electron'"); }), null);
  assert.equal(electronPath(() => ({ not: "a path" })), null);
  // A real require resolves the package and reads path.txt without running electron's index.js
  // (which downloads and prints when the binary is missing).
  const fake = mkdtempSync(join(tmpdir(), "rs-electron-"));
  mkdirSync(join(fake, "electron", "dist", "Electron.app", "Contents", "MacOS"), { recursive: true });
  writeFileSync(join(fake, "electron", "package.json"), "{}");
  writeFileSync(join(fake, "electron", "path.txt"), "Electron.app/Contents/MacOS/Electron\n");
  const resolving = () => { throw new Error("index.js must not run"); };
  resolving.resolve = () => join(fake, "electron", "package.json");
  assert.equal(electronPath(resolving), null, "path.txt names a binary that is not on disk yet");
  writeFileSync(join(fake, "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron"), "");
  assert.equal(electronPath(resolving), join(fake, "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron"));
});

test("the doctor environment: ROOT, tools first on PATH, personal mode, the launcher's runtime facts", () => {
  const env = doctorEnv({ env: { PATH: "/usr/bin", HOME: "/home/ann" }, platform: "linux", nodeVersion: "22.1.0", electron: "/x/electron", root: "/home/ann/.reviewstage" });
  assert.equal(env.ROOT, "/home/ann/.reviewstage");
  assert.equal(env.PATH, "/home/ann/.reviewstage/bin:/usr/bin");
  assert.equal(env.RS_PERSONAL, "1");
  assert.equal(env.RS_DOCTOR_DESKTOP, "1");
  assert.equal(env.RS_DOCTOR_NODE, "22.1.0");
  assert.equal(env.RS_DOCTOR_ELECTRON, "/x/electron");
  assert.equal(env.HOME, "/home/ann", "the rest of the environment passes through");

  const team = doctorEnv({ env: { PATH: "a", RS_PERSONAL: "0", ROOT: "/r", RS_DOCTOR_ELECTRON: "stale" }, platform: "win32", nodeVersion: "20.0.0", electron: null });
  assert.equal(team.RS_PERSONAL, "0", "an explicit RS_PERSONAL is respected");
  assert.equal(team.ROOT, "/r");
  assert.equal(team.PATH, `${join("/r", "bin")};a`, "Windows PATH separator");
  assert.equal(team.RS_DOCTOR_ELECTRON, undefined, "no Electron means no stale path, so the doctor reports it missing");
});

test("runDoctor spawns the bundled doctor.sh with the flags and relays its status", () => {
  const calls = [];
  const spawn = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { status: 2 }; };
  const code = runDoctor(["--doctor", "--json", "--strict"], { env: { PATH: "/bin", ROOT: "/r" }, require: () => "/e/electron", pkgDir: "/pkg", spawn });
  assert.equal(code, 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, "bash");
  assert.deepEqual(calls[0].args, ["/pkg/server/bin/doctor.sh", "--json", "--strict"]);
  assert.equal(calls[0].opts.stdio, "inherit");
  assert.equal(calls[0].opts.env.RS_DOCTOR_ELECTRON, "/e/electron");
  assert.equal(calls[0].opts.env.ROOT, "/r");
  assert.equal(runDoctor([], { env: {}, pkgDir: "/pkg", spawn: () => ({ status: null }) }), 1, "a doctor that died of a signal is a failure");
});

test("the chosen port is remembered in desktop.json beside the phone preference", () => {
  const root = mkdtempSync(join(tmpdir(), "rs-port-"));
  writeDesktopState(root, { phone: true });
  writeDesktopState(root, { port: 51234 });
  assert.deepEqual(readDesktopState(root), { phone: true, port: 51234 });
  writeDesktopState(root, { port: 51235 });
  assert.equal(readDesktopState(root).port, 51235, "a new launch overwrites the old port");
  // main.js writes it right after the server is up, with the same helper.
  const main = readFileSync(join(pkg, "main.js"), "utf8");
  assert.match(main, /server = await spawnServer\(\{[^}]*\}\);\s*\n(\s*\/\/[^\n]*\n)*\s*writeDesktopState\(ROOT, \{ port \}\);/, "main.js records the port once spawnServer resolves");
});

test("`reviewstage --doctor --json` against a fixture ROOT: valid JSON, no GITHUB_PAT failure, the desktop.json port", (t) => {
  if (!existsSync(join(pkg, "server", "bin", "doctor.sh"))) {
    t.skip("server/ not assembled — run `node scripts/prepack.mjs` first");
    return;
  }
  // pnpm does not run electron's postinstall, so on a fresh CI box the binary is not on disk
  // until something requires the package once (the Electron smoke test does the same).
  try { createRequire(import.meta.url)("electron"); } catch { /* reported by env.electron below */ }
  const root = mkdtempSync(join(tmpdir(), "rs-doctor-cli-"));
  chmodSync(root, 0o700);
  mkdirSync(join(root, "state"));
  const shim = join(root, "shim");
  mkdirSync(shim);
  for (const [name, body] of [["gh", "echo 'gh version 2.0.0 (shim)'"], ["claude", "echo '2.0.0 (Claude Code)'"], ["curl", "exit 7"], ["flock", "exit 0"]]) {
    writeFileSync(join(shim, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  }
  writeFileSync(join(root, ".env"), `RS_SECRET=${"a".repeat(48)}\nRS_PERSONAL=1\nPUBLIC_URL=http://127.0.0.1:51777\n`, { mode: 0o600 });
  writeFileSync(join(root, "desktop.json"), JSON.stringify({ phone: false, port: 51778 }), { mode: 0o600 });
  writeFileSync(join(root, "users.json"), JSON.stringify({ ann: { gh_token_enc: "x", gh_exp: 0, gh_client: "device", claude_token_enc: "y", claude_exp: 0 } }), { mode: 0o600 });
  const r = spawnSync(process.execPath, [join(pkg, "bin", "reviewstage.js"), "--doctor", "--json"], {
    env: { ...process.env, ROOT: root, HOME: root, PATH: `${shim}:${process.env.PATH}`, MIN_FREE_DISK_MB: "0" },
    encoding: "utf8",
    cwd: root,
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  let doc;
  try {
    doc = JSON.parse(r.stdout);
  } catch (e) {
    assert.fail(`--json stdout is not one JSON document: ${e.message}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  }
  assert.equal(doc.fails, 0, JSON.stringify(doc.checks.filter((c) => c.status === "FAIL")));
  assert.ok(!doc.checks.some((c) => /GITHUB_PAT not set/.test(c.text)), "a personal install has no service token by design");
  const port = doc.checks.find((c) => c.id === "port.free");
  assert.equal(port.status, "WARN", "app not running is a warning, not a failure");
  assert.match(port.text, /port 51778 \(port from desktop\.json\)/);
  assert.equal(doc.checks.find((c) => c.id === "env.node").text, `node ${process.versions.node}`);
  assert.equal(doc.checks.find((c) => c.id === "env.electron").status, "PASS", "this launcher's Electron resolved");
  for (const c of doc.checks) assert.ok(["PASS", "WARN", "FAIL", "NOTE"].includes(c.status) && typeof c.id === "string" && typeof c.text === "string");
  // --strict turns the warnings into exit 2.
  const strict = spawnSync(process.execPath, [join(pkg, "bin", "reviewstage.js"), "--doctor", "--strict"], {
    env: { ...process.env, ROOT: root, HOME: root, PATH: `${shim}:${process.env.PATH}`, MIN_FREE_DISK_MB: "0" },
    encoding: "utf8",
    cwd: root,
  });
  assert.equal(strict.status, 2, strict.stdout);
  assert.match(strict.stdout, /^ReviewStage doctor — desktop install at /);
});
