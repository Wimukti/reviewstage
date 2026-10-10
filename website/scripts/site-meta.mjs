// Build-time facts the pages and the sitemap read from git: when a page's source last changed
// (the sitemap's <lastmod>) and which version the JSON-LD names. Both fall back quietly — to the
// build time and to desktop/package.json — so a shallow checkout still builds.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const siteRoot = resolve(here, "..");
export const repoRoot = resolve(siteRoot, "..");
const buildTime = new Date().toISOString();

const git = (args) => {
  try { return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return ""; }
};

// The newest commit touching any of the given paths (relative to website/), as ISO 8601.
export function lastCommitDate(paths) {
  const existing = paths.map((p) => resolve(siteRoot, p)).filter((p) => existsSync(p));
  if (!existing.length) return buildTime;
  return git(["log", "-1", "--format=%cI", "--", ...existing]) || buildTime;
}

// Which source files render a URL path: the marketing home is its page plus every home
// component and the layout; a docs URL is its content file (a/b.mdx or a/b/index.mdx).
export function sourcesFor(pathname) {
  const p = pathname.replace(/^\/|\/$/g, "");
  if (p === "") return ["src/pages/index.astro", "src/components/home", "src/components/marketing", "src/layouts/MarketingLayout.astro", "src/content/brand.ts"];
  const candidates = [];
  for (const ext of ["md", "mdx"]) candidates.push(`src/content/docs/${p}.${ext}`, `src/content/docs/${p}/index.${ext}`);
  const page = `src/pages/${p}.astro`;
  if (existsSync(resolve(siteRoot, page))) candidates.push(page);
  return candidates.filter((c) => existsSync(resolve(siteRoot, c)));
}

export function lastmodFor(url) {
  const pathname = new URL(url).pathname;
  const sources = sourcesFor(pathname);
  return sources.length ? lastCommitDate(sources) : buildTime;
}

// desktop/package.json carries the real version once the release workflow has stamped it from
// the tag; a checkout still reads 0.0.0-dev, so the latest v* tag stands in.
export function softwareVersion() {
  let pkgVersion = "";
  try { pkgVersion = JSON.parse(readFileSync(join(repoRoot, "desktop", "package.json"), "utf8")).version ?? ""; } catch {}
  if (pkgVersion && !pkgVersion.startsWith("0.0.0")) return pkgVersion;
  const tag = git(["describe", "--tags", "--abbrev=0", "--match", "v*"]);
  return tag ? tag.replace(/^v/, "") : pkgVersion || "1.0.0";
}
