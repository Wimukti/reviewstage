// Build step: PWA icons from assets/logo.png, then copy public/* next to app.js/app.css.
// Runs as part of `pnpm build` (see package.json). Output lands in ../bin/static, which the
// server serves at /static/*; the manifest, service worker, offline page and icons are also
// reachable at the root so the SW can claim the whole origin as its scope.
import { cp, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const ui = join(here, "..");
const logo = join(ui, "..", "assets", "logo.png");
const out = join(ui, "..", "bin", "static");
const icons = join(out, "icons");
// Same as --bg in src/styles.css: the maskable variants need an opaque ground because the
// platform crops them into its own shape.
const BG = "#0a0b12";

await mkdir(icons, { recursive: true });

const plain = async (size, name) =>
  sharp(logo).resize(size, size).png().toFile(join(icons, name));
// Maskable: the logo sits inside the safe zone (80% of the canvas) on a solid background.
const maskable = async (size, name) => {
  const inner = Math.round(size * 0.72);
  const glyph = await sharp(logo).resize(inner, inner).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: glyph, gravity: "centre" }])
    .png()
    .toFile(join(icons, name));
};

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
