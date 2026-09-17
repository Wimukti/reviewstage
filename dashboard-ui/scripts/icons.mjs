// Build step: fingerprint the bundle, render the PWA icons from assets/logo-light.svg, then
// copy public/* next to the bundle. Runs as the tail of `pnpm build` (see package.json).
// Output lands in ../bin/static, which the server serves at /static/*; the manifest, service
// worker, offline page and icons are also reachable at the root so the SW can claim the whole
// origin as its scope.
//
// The fingerprint is the one thing an upgrade depends on. esbuild writes fixed `app.js` /
// `app.css` names, so before this step every release served the same two URLs with different
// bytes — an HTTP cache or a service worker cache had no way to tell the releases apart, and
// upgraded users kept the old interface until they hard-reloaded. Here the two files are
// renamed to `app-<hash>.js` / `app-<hash>.css` (one hash over both, so one build = one id),
// the names are published in `assets.json` for the server to read, and the same id is baked
// into the copied `sw.js` as its cache version. New bytes therefore always mean new URLs and
// a new cache, with no human remembering to bump anything.
import { mkdir, readdir, readFile, cp, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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

// -- bundle fingerprint ------------------------------------------------------------------
const read = async (name) => {
  try {
    return await readFile(join(out, name));
  } catch {
    return null;
  }
};

const js = await read("app.js");
const css = await read("app.css");
let build = "";

if (js && css) {
  build = createHash("sha256").update(js).update(css).digest("hex").slice(0, 12);
  await rename(join(out, "app.js"), join(out, `app-${build}.js`));
  await rename(join(out, "app.css"), join(out, `app-${build}.css`));
  await writeFile(
    join(out, "assets.json"),
    JSON.stringify({ build, js: `app-${build}.js`, css: `app-${build}.css` }, null, 2) + "\n"
  );
} else {
  // `pnpm icons` on its own, after a build: the bundle has already been renamed, so reuse the
  // id that build published rather than inventing a new one.
  try {
    const m = JSON.parse(await readFile(join(out, "assets.json"), "utf8"));
    if (/^[0-9a-f]{8,}$/.test(m.build ?? "")) build = m.build;
  } catch {
    /* no previous build to reuse; handled below */
  }
}

if (!build) {
  throw new Error("no bundle to fingerprint in bin/static — run esbuild (`pnpm build`) first; " +
    "sw.js cannot be stamped with a cache version without one");
}

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

// sw.js ships as a template with a `__BUILD__` placeholder; stamp the copy, never the source.
const swFile = join(out, "sw.js");
const sw = await readFile(swFile, "utf8");
if (!sw.includes("__BUILD__")) {
  throw new Error("public/sw.js no longer carries the __BUILD__ placeholder — the service " +
    "worker would keep one cache version for ever and upgrades would serve the old bundle");
}
await writeFile(swFile, sw.replaceAll("__BUILD__", build));

console.log(`bundle app-${build}.{js,css} + icons + public/ -> bin/static`);
