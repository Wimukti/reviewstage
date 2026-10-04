// The server's shell scripts need gh, jq and flock. A Claude Code user's machine has Node, Git,
// Python and Bash, and on macOS none of those three. Whatever the system lacks is fetched once
// from the tool's own GitHub release, pinned by version and SHA-256 in tools.json, into
// ROOT/bin, which the server's PATH gets first. Claude Code itself is never fetched: reviews run
// on the user's own account, so its presence is theirs to arrange.
import { createHash } from "node:crypto";
import { accessSync, chmodSync, constants, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
export const TOOLS = JSON.parse(readFileSync(join(here, "tools.json"), "utf8"));

export function platformKey() {
  const os = process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "win32" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return `${os}-${arch}`;
}

/** First executable called `name` on PATH, or null. A plain walk of PATH rather than `which`,
 *  so the answer does not depend on a tool that may itself be missing or shadowed. */
export function onPath(name) {
  const sep = process.platform === "win32" ? ";" : ":";
  const exts = process.platform === "win32" ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of (process.env.PATH || "").split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = join(dir, name + ext);
      try {
        accessSync(p, constants.X_OK);
        if (statSync(p).isFile()) return p;
      } catch { /* not here */ }
    }
  }
  return null;
}

export function toolsDir(root) {
  const d = join(root, "bin");
  mkdirSync(d, { recursive: true });
  return d;
}

async function download(url, dest, onProgress) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length") || 0);
  let seen = 0;
  const tmp = dest + ".part";
  const out = createWriteStream(tmp);
  const reader = res.body;
  if (onProgress && total) {
    const counting = new TransformStream({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        onProgress(seen / total);
        controller.enqueue(chunk);
      },
    });
    await pipeline(reader.pipeThrough(counting), out);
  } else {
    await pipeline(reader, out);
  }
  renameSync(tmp, dest);
}

export function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** Pull one file out of a .zip or .tar.gz using the system's own tools (both are on every
 *  macOS and Linux). `inner` is the path of the binary inside the archive. */
function extract(archive, inner, dest) {
  const work = join(tmpdir(), `rs-extract-${process.pid}-${Date.now()}`);
  mkdirSync(work, { recursive: true });
  const r = archive.endsWith(".zip")
    ? spawnSync("unzip", ["-q", "-o", archive, inner, "-d", work], { encoding: "utf8" })
    : spawnSync("tar", ["-xzf", archive, "-C", work, inner], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`could not extract ${inner} from ${archive}: ${r.stderr}`);
  renameSync(join(work, inner), dest);
  rmSync(work, { recursive: true, force: true });
}

/**
 * Make `name` available. Returns the absolute path to use, or null when it is on the system
 * PATH already (the caller then simply relies on PATH). Throws with a plain message on a
 * checksum mismatch — a wrong hash is a reason to stop, never to proceed.
 */
export async function ensureTool(name, root, onProgress = () => {}) {
  if (onPath(name)) return null;
  const dir = toolsDir(root);
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  const dest = join(dir, exe);
  const spec = TOOLS[name];
  if (!spec) throw new Error(`no download spec for ${name}`);
  const plat = spec.platforms[platformKey()];
  if (!plat) throw new Error(`${name} has no build for ${platformKey()}`);
  const stamp = join(dir, `.${name}.version`);
  if (existsSync(dest) && existsSync(stamp) && readFileSync(stamp, "utf8").trim() === spec.version) {
    return dest;
  }
  const archive = join(dir, `.${name}-${spec.version}${plat.ext || ""}`);
  onProgress(0, `Downloading ${name} ${spec.version}`);
  await download(plat.url, archive, (f) => onProgress(f, `Downloading ${name} ${spec.version}`));
  const got = sha256(archive);
  if (got !== plat.sha256) {
    rmSync(archive, { force: true });
    throw new Error(`${name} ${spec.version}: checksum mismatch (expected ${plat.sha256.slice(0, 12)}…, got ${got.slice(0, 12)}…). Not installed.`);
  }
  if (plat.inner) {
    extract(archive, plat.inner, dest);
    rmSync(archive, { force: true });
  } else {
    renameSync(archive, dest);
  }
  chmodSync(dest, 0o755);
  writeFileSync(stamp, spec.version + "\n");
  onProgress(1, `${name} ${spec.version} ready`);
  return dest;
}

/** macOS has no flock(1); the scripts need exactly three shapes of it. Install the shim. */
export function ensureFlock(root) {
  if (onPath("flock")) return null;
  const dest = join(toolsDir(root), "flock");
  const src = join(here, "flock.py");
  if (!existsSync(dest) || statSync(dest).size !== statSync(src).size) {
    writeFileSync(dest, readFileSync(src));
    chmodSync(dest, 0o755);
  }
  return dest;
}

/** Everything the server needs, in order. Resolves to { path, missing } where `missing` lists
 *  what cannot be provided (only `claude`, by design). */
export async function ensureTools(root, onProgress = () => {}) {
  const missing = [];
  for (const must of ["python3", "bash", "git", "openssl", "curl"]) if (!onPath(must)) missing.push(must);
  if (!onPath("claude")) missing.push("claude");
  await ensureTool("gh", root, onProgress);
  await ensureTool("jq", root, onProgress);
  ensureFlock(root);
  return { binDir: toolsDir(root), missing };
}
