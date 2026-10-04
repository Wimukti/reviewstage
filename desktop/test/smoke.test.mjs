// The whole launch path, for real: `node bin/reviewstage.js` with RS_SMOKE=1 starts Electron,
// which writes the root, provisions tools, boots the bundled server on a free port, loads the
// window, prints RS_SMOKE_OK and quits. Runs headless-enough on CI under xvfb-run.
import { spawn } from "node:child_process";
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
  // Personal mode is lane D1; until then the server insists on a repository.
  writeFileSync(join(root, ".env"), `RS_SECRET=${"a".repeat(48)}\nREPOS=acme/widgets\nRS_PERSONAL=1\nGH_DEVICE_FLOW=1\nDRY_RUN=1\n`);
  const { code, text } = await launch(root);
  const ok = /RS_SMOKE_OK port=(\d+) title=ReviewStage/.exec(text);
  assert.ok(ok, `expected RS_SMOKE_OK, got:\n${text.split("\n").filter((l) => !/ERROR:gpu|ERROR:components|objc\[/.test(l)).slice(-25).join("\n")}`);
  assert.equal(code, 0);
  const env = readFileSync(join(root, ".env"), "utf8");
  assert.match(env, new RegExp(`PUBLIC_URL=http://127\\.0\\.0\\.1:${ok[1]}`), "the launcher records the port it chose");
  assert.ok(existsSync(join(root, "bin", "flock")) || process.platform === "linux", "the flock shim is installed where the OS lacks flock");
});

test("a fresh root gets a secret and personal-mode defaults", async (t) => {
  if (!existsSync(join(pkg, "server", "bin", "server.py"))) { t.skip("server/ not assembled"); return; }
  const root = mkdtempSync(join(tmpdir(), "rs-smoke-fresh-"));
  // No .env at all. Until lane D1 the server will refuse to boot without REPOS — so this test
  // only asserts what the launcher wrote, and accepts either outcome from the server.
  const { text } = await launch(root);
  const env = readFileSync(join(root, ".env"), "utf8");
  assert.match(env, /RS_SECRET=[0-9a-f]{48}/);
  assert.match(env, /RS_PERSONAL=1/);
  assert.match(env, /GH_DEVICE_FLOW=1/);
  assert.match(env, /DRY_RUN=1/);
  assert.ok(/RS_SMOKE_(OK|FAIL)/.test(text), "smoke mode always reports and exits");
});
