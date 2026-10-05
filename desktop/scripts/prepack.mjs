// The npm package carries the server. This copies exactly what the Docker image copies —
// bin/*.py, bin/*.sh, bin/static/, skills/ — into desktop/server/ at pack time, after building
// the dashboard bundle so bin/static is current. Tests, fixtures and the e2e fake gh never ship.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const out = join(here, "..", "server");

if (!process.env.RS_SKIP_UI_BUILD) {
  execSync("pnpm build", { cwd: join(repo, "dashboard-ui"), stdio: "inherit" });
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "bin"), { recursive: true });

const skip = (name) => /^test_.*\.py$|^test-.*\.sh$|_test\.py$/.test(name);
for (const f of readdirSync(join(repo, "bin"))) {
  const p = join(repo, "bin", f);
  if (statSync(p).isDirectory()) continue;
  if (!/\.(py|sh)$/.test(f) || skip(f)) continue;
  cpSync(p, join(out, "bin", f));
}
cpSync(join(repo, "bin", "static"), join(out, "bin", "static"), { recursive: true });
cpSync(join(repo, "skills"), join(out, "skills"), { recursive: true, filter: (src) => !/\/examples\//.test(src) || true });
for (const f of ["LICENSE"]) if (existsSync(join(repo, f))) cpSync(join(repo, f), join(out, "..", f));

// The menu-bar icon (openspec/changes/desktop-always-on F2): a macOS template image — black on
// transparent, the `Template` suffix tells AppKit to tint it for a light or dark menu bar —
// rendered from the app mark at 16 px and 32 px (@2x). sharp is the dashboard's dev dependency
// (it renders the PWA icons the same way); the desktop package itself does not depend on it.
const sharp = createRequire(join(repo, "dashboard-ui", "package.json"))("sharp");
const mark = readFileSync(join(repo, "assets", "logo-mark.svg"), "utf8").replace(/fill="url\(#[a-z]+\)"/g, 'fill="#000"');
const assets = join(here, "..", "assets");
mkdirSync(assets, { recursive: true });
for (const [name, px] of [["trayTemplate.png", 16], ["trayTemplate@2x.png", 32]]) {
  const inner = Math.round(px * 0.875);
  const glyph = await sharp(Buffer.from(mark), { density: 72 * (inner / 640) * 8 }).resize(inner, inner).png().toBuffer();
  const pad = Math.floor((px - inner) / 2);
  writeFileSync(join(assets, name), await sharp({ create: { width: px, height: px, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: glyph, left: pad, top: pad }]).png().toBuffer());
}

const size = execSync(`du -sk "${out}"`).toString().split("\t")[0];
console.log(`server/ assembled: ${Math.round(Number(size) / 1024)} MB`);
