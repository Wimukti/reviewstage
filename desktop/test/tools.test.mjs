import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onPath, platformKey, sha256, TOOLS, ensureFlock } from "../tools.js";

test("every tool has a pinned sha256 and url for this platform", () => {
  const key = platformKey();
  for (const [name, spec] of Object.entries(TOOLS)) {
    if (name.startsWith("_")) continue;
    const p = spec.platforms[key];
    assert.ok(p, `${name} lacks ${key}`);
    assert.match(p.sha256, /^[0-9a-f]{64}$/, `${name} sha256`);
    assert.match(p.url, /^https:\/\/github\.com\/.+\/releases\/download\//, `${name} url must be a GitHub release asset`);
    assert.match(spec.version, /^\d+\.\d+\.\d+$/);
  }
});

test("onPath walks PATH itself and does not need `which`", () => {
  const dir = mkdtempSync(join(tmpdir(), "rs-path-"));
  writeFileSync(join(dir, "rs-fake-tool"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(dir, "rs-fake-tool"), 0o755);
  const saved = process.env.PATH;
  process.env.PATH = dir; // no /usr/bin, so `which` itself is unreachable
  try {
    assert.equal(onPath("rs-fake-tool"), join(dir, "rs-fake-tool"));
    assert.equal(onPath("definitely-not-here"), null);
  } finally {
    process.env.PATH = saved;
  }
});

test("sha256 matches the system digest", () => {
  const dir = mkdtempSync(join(tmpdir(), "rs-sha-"));
  const f = join(dir, "x");
  writeFileSync(f, "hello\n");
  assert.equal(sha256(f), "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03");
});

test("the flock shim is installed only where the OS has no flock", () => {
  const root = mkdtempSync(join(tmpdir(), "rs-flock-"));
  mkdirSync(join(root, "bin"), { recursive: true });
  const saved = process.env.PATH;
  process.env.PATH = root; // nothing on PATH → shim is needed
  try {
    const p = ensureFlock(root);
    assert.equal(p, join(root, "bin", "flock"));
  } finally {
    process.env.PATH = saved;
  }
});
