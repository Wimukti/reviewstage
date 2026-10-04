// The npm package carries the server. This copies exactly what the Docker image copies —
// bin/*.py, bin/*.sh, bin/static/, skills/ — into desktop/server/ at pack time, after building
// the dashboard bundle so bin/static is current. Tests, fixtures and the e2e fake gh never ship.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
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

const size = execSync(`du -sk "${out}"`).toString().split("\t")[0];
console.log(`server/ assembled: ${Math.round(Number(size) / 1024)} MB`);
