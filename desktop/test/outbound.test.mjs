// Zero-by-default telemetry (openspec/changes/p0-proof/lane1-telemetry.md): the desktop app
// makes exactly the outbound calls named here and no other. Every shipped JavaScript file is
// scanned for fetch / https.request / http.request / net.request; a new caller has to be added
// to this list by hand, with its reason, so an unasked-for network call cannot slip in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

// file → why it talks to the network. Only update.js runs without a click.
const KNOWN = {
  "server.js": "polls the local server's /health on 127.0.0.1 while it boots",
  "main.js": "the local server's /api/queue, /api/public-url, /api/pair, /api/me and /health over loopback or the person's own tunnel",
  "tools.js": "downloads gh, jq and cloudflared once, pinned by checksum, when the person installs",
  "tunnel.js": "probes the person's own Cloudflare quick-tunnel address",
  "update.js": "the npm registry's dist-tags, every 6 hours, for the update banner",
};

function shipped() {
  const out = [];
  const walk = (p) => {
    for (const f of readdirSync(p)) {
      const full = join(p, f);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(js|cjs|mjs)$/.test(f)) out.push(full);
    }
  };
  for (const entry of pkg.files) {
    const full = join(root, entry);
    try {
      if (statSync(full).isDirectory()) {
        if (entry === "server/") continue; // the Python server; its egress is bin/test_rs_telemetry.py's job
        walk(full);
      } else out.push(full);
    } catch {
      /* not built here (e.g. server/) */
    }
  }
  return out;
}

test("every outbound caller in the shipped desktop files is named, with its reason", () => {
  const callers = new Set();
  for (const f of shipped()) {
    const src = readFileSync(f, "utf8");
    if (/\bfetch(?:Impl)?\(|https\.request\(|http\.request\(|net\.request\(|\.get\(\s*["'`]https?:/.test(src)) callers.add(relative(root, f));
  }
  assert.deepEqual([...callers].sort(), Object.keys(KNOWN).sort());
});

test("no shipped desktop file imports a telemetry or analytics SDK", () => {
  for (const f of shipped()) {
    const src = readFileSync(f, "utf8").toLowerCase();
    for (const bad of ["segment", "posthog", "mixpanel", "@sentry", "amplitude", "google-analytics", "gtag("]) {
      assert.ok(!src.includes(bad), `${relative(root, f)} mentions ${bad}`);
    }
  }
});
