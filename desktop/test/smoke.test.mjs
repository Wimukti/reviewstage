// The whole launch path, for real: `node bin/reviewstage.js` with RS_SMOKE=1 starts Electron,
// which writes the root, provisions tools, boots the bundled server on a free port, loads the
// window, prints RS_SMOKE_OK and quits. Runs headless-enough on CI under xvfb-run.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, "..");

function launch(root, extraEnv = {}) {
  return new Promise((resolve) => {
    const out = [];
    const child = spawn(process.execPath, [join(pkg, "bin", "reviewstage.js")], {
      env: { ...process.env, ROOT: root, RS_SMOKE: "1", ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 240_000);
    for (const s of [child.stdout, child.stderr]) s.on("data", (d) => out.push(String(d)));
    child.on("exit", (code) => { clearTimeout(timer); resolve({ code, text: out.join("") }); });
  });
}

test("launches, boots the server, loads the window, quits", async (t) => {
  if (!existsSync(join(pkg, "server", "bin", "server.py"))) {
    t.skip("server/ not assembled — run `node scripts/prepack.mjs` first");
    return;
  }
  const root = mkdtempSync(join(tmpdir(), "rs-smoke-"));
  // An .env as the rc.24–rc.28 launcher wrote it (no defaults stamp, dry run on): the upgrade
  // path turns dry run off and stamps it.
  writeFileSync(join(root, ".env"), `RS_SECRET=${"a".repeat(48)}\nREPOS=acme/widgets\nRS_PERSONAL=1\nGH_DEVICE_FLOW=1\nDRY_RUN=1\n`);
  const { code, text } = await launch(root);
  const ok = /RS_SMOKE_OK port=(\d+) title=ReviewStage tray=(\d)/.exec(text);
  assert.ok(ok, `expected RS_SMOKE_OK, got:\n${text.split("\n").filter((l) => !/ERROR:gpu|ERROR:components|objc\[/.test(l)).slice(-25).join("\n")}`);
  assert.equal(code, 0);
  const env = readFileSync(join(root, ".env"), "utf8");
  assert.match(env, new RegExp(`PUBLIC_URL=http://127\\.0\\.0\\.1:${ok[1]}`), "the launcher records the port it chose");
  assert.equal(JSON.parse(readFileSync(join(root, "desktop.json"), "utf8")).port, Number(ok[1]), "desktop.json carries the port so --doctor can find the running app");
  assert.ok(existsSync(join(root, "bin", "flock")) || process.platform === "linux", "the flock shim is installed where the OS lacks flock");
  assert.match(env, /DRY_RUN=0/, "a pre-stamp personal .env is upgraded to live");
  assert.match(env, /RS_DESKTOP_DEFAULTS=2/);
  if (process.platform === "darwin") assert.equal(ok[2], "1", "the menu-bar icon was created");
  assert.ok(existsSync(join(root, "electron")), "a non-default ROOT gets its own Electron profile (cookies, single-instance lock)");
});

test("a fresh root gets a secret and personal-mode defaults", async (t) => {
  if (!existsSync(join(pkg, "server", "bin", "server.py"))) { t.skip("server/ not assembled"); return; }
  const root = mkdtempSync(join(tmpdir(), "rs-smoke-fresh-"));
  // No .env at all, so no REPOS either: personal mode boots anyway (the first-run wizard adds
  // repositories while the server runs) and the window reaches the queue shell.
  const { code, text } = await launch(root);
  const env = readFileSync(join(root, ".env"), "utf8");
  assert.match(env, /RS_SECRET=[0-9a-f]{48}/);
  assert.match(env, /RS_PERSONAL=1/);
  assert.match(env, /GH_DEVICE_FLOW=1/);
  assert.match(env, /DRY_RUN=0/, "the desktop app posts live; the Post click is the gate");
  assert.match(env, /RS_DESKTOP_DEFAULTS=2/);
  assert.doesNotMatch(env, /^REPOS=/m, "the launcher writes no repository");
  assert.match(text, /RS_SMOKE_OK port=\d+ title=ReviewStage/, `expected RS_SMOKE_OK without REPOS, got:\n${text.split("\n").filter((l) => !/ERROR:gpu|ERROR:components|objc\[/.test(l)).slice(-25).join("\n")}`);
  assert.equal(code, 0);
});

// openspec/changes/desktop-always-on F1, for real: no RS_SMOKE, no --foreground. The launcher
// prints one line and exits while the app keeps serving; a second launch on the same ROOT
// exits and leaves the first alone; SIGTERM takes the Quit path and the server goes with it.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function health(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2_000) });
    return r.ok && (await r.text()).trim() === "ok";
  } catch {
    return false;
  }
}
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(250); }
  throw new Error(`timed out waiting for ${what}`);
}
function runLauncher(root, args = []) {
  return new Promise((resolve) => {
    const out = [];
    const env = { ...process.env, ROOT: root };
    delete env.RS_SMOKE;
    const child = spawn(process.execPath, [join(pkg, "bin", "reviewstage.js"), ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
    for (const s of [child.stdout, child.stderr]) s.on("data", (d) => out.push(String(d)));
    child.on("exit", (code) => resolve({ code, text: out.join("") }));
  });
}
const pidOn = (port) => Number(execFileSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"]).toString().trim().split("\n")[0]);
const parentOf = (pid) => Number(execFileSync("ps", ["-o", "ppid=", "-p", String(pid)]).toString().trim());
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test("detached: the launcher exits, the app keeps running, one instance per ROOT, SIGTERM quits it all", { skip: process.platform === "win32" }, async (t) => {
  if (!existsSync(join(pkg, "server", "bin", "server.py"))) { t.skip("server/ not assembled"); return; }
  const root = mkdtempSync(join(tmpdir(), "rs-detach-"));
  const first = await runLauncher(root);
  assert.equal(first.code, 0);
  assert.equal(first.text.trim(), "ReviewStage is running. You can close this terminal.");
  const port = await until(() => { try { return (/PUBLIC_URL=http:\/\/127\.0\.0\.1:(\d+)/.exec(readFileSync(join(root, ".env"), "utf8")) || [])[1]; } catch { return null; } }, 120_000, "the .env port");
  await until(() => health(port), 120_000, "/health");
  const serverPid = pidOn(port);
  const appPid = parentOf(serverPid);
  t.after(() => { for (const p of [appPid, serverPid]) { try { process.kill(p, "SIGKILL"); } catch { /* gone */ } } });

  // A second launch on the same ROOT: its Electron finds the lock taken and exits.
  const second = await runLauncher(root, ["--foreground"]);
  assert.equal(second.code, 0);
  assert.match(second.text, /already running/);
  assert.ok(await health(port), "the first instance is untouched");
  assert.ok(alive(appPid));

  process.kill(appPid, "SIGTERM");
  await until(() => !alive(appPid) && !alive(serverPid), 20_000, "the app and its server to exit");
  assert.equal(await health(port), false);
  assert.match(readFileSync(join(root, "desktop.log"), "utf8"), /server on http:\/\/127\.0\.0\.1:\d+[^]*ReviewStage quit: tunnel and server stopped\./, "the detached app's output went to ROOT/desktop.log");
});
