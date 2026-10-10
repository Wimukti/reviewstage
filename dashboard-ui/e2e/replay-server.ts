// Serves the built replay (replay-dist/) the way the website will: under /try/app/ on a plain
// static origin with no /api at all. The Playwright config boots it beside the Python fixture
// server so the replay spec can prove the shipped PR page runs with no server behind it.
// Standalone: `pnpm serve:replay` (builds first unless RS_REPLAY_SKIP_BUILD=1).
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { PORT } from "./fixture";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
export const DIST = join(ROOT, "replay-dist");
// PORT + 1 belongs to the personal-mode server welcome.spec.ts boots (personal-fixture.ts).
export const REPLAY_PORT = Number(process.env.RS_REPLAY_PORT || PORT + 2);
export const REPLAY_ORIGIN = `http://127.0.0.1:${REPLAY_PORT}`;
export const REPLAY_PATH = "/try/app/";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

export function serveReplay(port = REPLAY_PORT) {
  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", REPLAY_ORIGIN);
    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }
    if (!url.pathname.startsWith(REPLAY_PATH)) {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    let rel = url.pathname.slice(REPLAY_PATH.length);
    if (rel === "" || rel === "index.html") rel = "index.html";
    const file = normalize(join(DIST, rel));
    if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    createReadStream(file).pipe(res);
  });
  server.listen(port, "127.0.0.1", () => console.log(`replay served at ${REPLAY_ORIGIN}${REPLAY_PATH}`));
  return server;
}

if (process.argv[1]?.endsWith("replay-server.ts")) {
  if (process.env.RS_REPLAY_SKIP_BUILD !== "1") {
    execFileSync("pnpm", ["build:replay"], { cwd: ROOT, stdio: "inherit" });
  }
  serveReplay();
}
