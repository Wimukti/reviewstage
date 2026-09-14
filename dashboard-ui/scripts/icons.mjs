// Build step: PWA icons from assets/logo-light.svg, then copy public/* next to app.js/app.css.
// Runs as part of `pnpm build` (see package.json). Output lands in ../bin/static, which the
// server serves at /static/*; the manifest, service worker, offline page and icons are also
// reachable at the root so the SW can claim the whole origin as its scope.
import { mkdir, readdir, readFile, cp, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { tile } from "./tile.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ui = join(here, "..");
const svg = await readFile(join(ui, "..", "assets", "logo-light.svg"), "utf8");
const out = join(ui, "..", "bin", "static");
const icons = join(out, "icons");

await mkdir(icons, { recursive: true });

// Plain icons: the mark on a rounded dark tile. Maskable: square tile, the mark inside the
// platform safe zone (80% of the canvas) since the launcher crops it into its own shape.
const plain = async (size, name) =>
  writeFile(join(icons, name), await tile(sharp, svg, size, { radius: Math.round(size * 0.2), inner: 0.78 }));
const maskable = async (size, name) =>
  writeFile(join(icons, name), await tile(sharp, svg, size, { radius: 0, inner: 0.62 }));

await Promise.all([
  plain(192, "icon-192.png"),
  plain(512, "icon-512.png"),
  maskable(192, "maskable-192.png"),
  maskable(512, "maskable-512.png"),
  maskable(180, "apple-touch-icon.png"),
]);

for (const f of await readdir(join(ui, "public"))) {
  await cp(join(ui, "public", f), join(out, f), { recursive: true });
}
console.log("icons + public/ -> bin/static");
