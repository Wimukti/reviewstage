// Builds the public replay (src/replay/main.tsx) into replay-dist/: the shipped PR page over an
// in-memory server, as one bundle plus its stylesheet, fonts and a static HTML shell. The site
// copies the directory to website/public/try/app/ (website/scripts/build-replay.mjs), so
// RS_REPLAY_PUBLIC_PATH is where the files will be served from. Run: pnpm build:replay.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = join(ROOT, "replay-dist");
const PUBLIC_PATH = (process.env.RS_REPLAY_PUBLIC_PATH || "/try/app/").replace(/\/?$/, "/");

// The Tailwind output is gitignored and rebuilt on every build (same as `pnpm build`).
execFileSync(join(ROOT, "node_modules", ".bin", "tailwindcss"),
  ["-i", "src/tw.css", "-o", "src/generated/tw.css", "--minify"], { cwd: ROOT, stdio: "inherit" });

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

await build({
  entryPoints: { replay: join(ROOT, "src", "replay", "main.tsx") },
  bundle: true,
  minify: true,
  sourcemap: false,
  legalComments: "none",
  jsx: "automatic",
  outdir: OUT,
  publicPath: PUBLIC_PATH,
  assetNames: "[name]-[hash]",
  alias: { "@": join(ROOT, "src") },
  loader: { ".png": "dataurl", ".svg": "dataurl", ".woff2": "file", ".woff": "empty", ".json": "json" },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "info",
});

// The shell: the server's index_html (bin/server.py) minus the service worker, manifest and
// home-screen metadata — a static page, not an installable app. The theme is the site's
// (localStorage["starlight-theme"]), stamped before first paint so the iframe never flashes.
//
// The Content-Security-Policy is the "nothing leaves this page" promise, enforced by the
// browser rather than by the fetch shim alone: no connection to anywhere (connect-src 'none'),
// and images, fonts, scripts and styles only from the replay's own files. The one thing it
// catches today is the avatar <img> the PR header renders for the author and the repository
// owner — a real request to github.com for a fictional login, which the shim could never see.
// Blocked, the avatar falls back to initials (Radix Avatar). The theme script is a file rather
// than inline so script-src needs no 'unsafe-inline'; styles do (React and Radix set style
// attributes).
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");
const themeBoot = `(function(){try{var s=localStorage.getItem('starlight-theme');var t=s==='light'?'light':(s==='auto'||s==='')?'system':'dark';
var d=document.documentElement;d.setAttribute('data-theme',t);
var m=document.querySelector('meta[name=color-scheme]');if(m)m.content=t==='system'?'light dark':t;}catch(e){}})();
`;
writeFileSync(join(OUT, "theme-boot.js"), themeBoot);
const html = `<!doctype html><html lang=en data-theme=dark><head><meta charset=utf-8>
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name=viewport content='width=device-width,initial-scale=1,viewport-fit=cover'>
<title>ReviewStage — example review (precomputed)</title>
<meta name=robots content='noindex'>
<meta name=color-scheme content='dark'>
<script src='${PUBLIC_PATH}theme-boot.js'></script>
<link rel=stylesheet href='${PUBLIC_PATH}replay.css'>
</head><body><div id=root></div>
<noscript><p style="font-family:system-ui;padding:16px">This example needs JavaScript. <a href="/examples/">Read the examples as pages instead.</a></p></noscript>
<script src='${PUBLIC_PATH}replay.js'></script></body></html>
`;
writeFileSync(join(OUT, "index.html"), html);
console.log(`replay built → ${OUT}: ${readdirSync(OUT).join(", ")} (served from ${PUBLIC_PATH})`);
