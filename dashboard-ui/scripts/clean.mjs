// Clear the previous build's fingerprinted bundle and its manifest from ../bin/static before
// esbuild writes the new app.js/app.css. Both build scripts run this.
//
// For `pnpm build` it keeps the directory from accumulating dead app-<hash>.* files (nothing
// downstream — bootstrap.sh's `install`, a local rebuild — ever cleans it). For `pnpm dev` it
// matters more than that: the watch build writes unhashed app.js and never runs icons.mjs, so
// a manifest left behind by an earlier production build would point the server at the stale
// fingerprinted bundle and none of the day's edits would show up.
import { readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "static");
let names = [];
try {
  names = await readdir(out);
} catch {
  process.exit(0); // nothing built yet
}
for (const f of names) {
  if (f === "assets.json" || /^app-[0-9a-f]{8,}\.(js|css)$/.test(f)) await rm(join(out, f));
}
