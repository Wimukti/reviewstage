// Builds the public replay (dashboard-ui/src/replay, see openspec/changes/p0-proof/recon.md
// lane 4) and copies it to public/try/app/, where the /try/ page embeds it. Runs in
// `pnpm build` before `astro build`, so the site always ships the replay built from the same
// checkout. dashboard-ui needs its own `pnpm install` first — CI does that in website.yml.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..", "..", "dashboard-ui");
const dist = join(app, "replay-dist");
const out = join(here, "..", "public", "try", "app");
const PUBLIC_PATH = "/try/app/";

if (!existsSync(join(app, "node_modules"))) {
  console.error(`build-replay: ${app}/node_modules is missing — run \`pnpm install --frozen-lockfile\` in dashboard-ui first.`);
  process.exit(1);
}
execFileSync("pnpm", ["build:replay"], {
  cwd: app, stdio: "inherit", env: { ...process.env, RS_REPLAY_PUBLIC_PATH: PUBLIC_PATH },
});
rmSync(join(here, "..", "public", "try"), { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(dist, out, { recursive: true });
console.log(`replay copied → public/try/app/ (${readdirSync(out).length} files, served from ${PUBLIC_PATH})`);
