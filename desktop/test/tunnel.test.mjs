import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { TOOLS } from "../tools.js";
import { parseTunnelUrl, TUNNEL_URL_RE, stopChild, stopTunnel, startTunnel, tunnelStatus, waitTunnelHealthy } from "../tunnel.js";

// Captured from cloudflared 2026.9.3 on 10/04/26 (the first block), plus the autoupdate warning
// older builds print and the error shape a failed request takes. The tunnel URL must be found
// exactly once, on the boxed line, and nowhere in the banner, the API host or the docs link.
const REAL_OUTPUT = `2026-10-04T03:58:29Z INF Thank you for trying Cloudflare Tunnel. Doing so, without a Cloudflare account, is a quick way to experiment and try it out. However, be aware that these account-less Tunnels have no uptime guarantee, are subject to the Cloudflare Online Services Terms of Use (https://www.cloudflare.com/website-terms/), and Cloudflare reserves the right to investigate your use of Tunnels for violations of such terms. If you intend to use Tunnels in production you should use a pre-created named tunnel by following: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps
2026-10-04T03:58:29Z INF Requesting new quick Tunnel on trycloudflare.com...
2026-10-04T03:58:35Z INF +--------------------------------------------------------------------------------------------+
2026-10-04T03:58:35Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
2026-10-04T03:58:35Z INF |  https://headline-attach-along-referred.trycloudflare.com                                  |
2026-10-04T03:58:35Z INF +--------------------------------------------------------------------------------------------+
2026-10-04T03:58:35Z INF Cannot determine default configuration path. No file [config.yml config.yaml] in [~/.cloudflared ~/.cloudflare-warp ~/cloudflare-warp /etc/cloudflared /usr/local/etc/cloudflared]
2026-10-04T03:58:35Z INF Version 2026.9.3 (Checksum 5472c1a01c84bc31b3021056a73b4e5774ddddefc572124ea8fdf6c340639f32)
2026-10-04T03:58:35Z INF GOOS: darwin, GOVersion: go1.27.1, GoArch: arm64
2026-10-04T03:58:35Z INF Settings: map[ha-connections:1 no-autoupdate:true protocol:quic url:http://127.0.0.1:57956]
2026-10-04T03:58:35Z INF Generated Connector ID: 5e335c73-6de0-4a24-9424-efef20c64b17
2026-10-04T03:58:35Z INF Initial protocol quic
2026-10-04T03:58:35Z INF |  Cloudflare API    api.cloudflare.com:443     PASS    API is reachable              |
2026-10-04T03:58:35Z INF Registered tunnel connection connIndex=0 connection=2dd82381-47de-40f3-87e5-3b0270f7421c event=0 ip=2606:4700:a0::6 location=cmb01 protocol=quic`;

const AUTOUPDATE_WARNING = `2024-05-01T10:00:00Z WRN Autoupdate is disabled: --no-autoupdate was passed. You are responsible for keeping cloudflared current.
2024-05-01T10:00:00Z INF Autoupdate frequency is set autoupdateFreq=86400000`;

const FAILED_REQUEST = `2026-10-04T04:00:00Z ERR failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": dial tcp: lookup api.trycloudflare.com: no such host`;

test("the URL regex finds the tunnel address on the boxed line and nothing else", () => {
  const found = REAL_OUTPUT.split("\n").map(parseTunnelUrl).filter(Boolean);
  assert.deepEqual(found, ["https://headline-attach-along-referred.trycloudflare.com"]);
  assert.equal(AUTOUPDATE_WARNING.split("\n").map(parseTunnelUrl).filter(Boolean).length, 0);
  assert.equal(parseTunnelUrl(FAILED_REQUEST), null, "the control API host is not a tunnel");
  assert.ok(TUNNEL_URL_RE.test(FAILED_REQUEST), "the bare regex would have matched the API host; parseTunnelUrl must filter it");
  assert.equal(parseTunnelUrl("|  https://a1-b2-c3.trycloudflare.com  |"), "https://a1-b2-c3.trycloudflare.com");
  assert.equal(parseTunnelUrl("https://Upper.trycloudflare.com"), null, "quick tunnel hosts are lowercase");
});

function fakeChild({ exitOnTerm = true } = {}) {
  const c = new EventEmitter();
  c.exitCode = null;
  c.signalCode = null;
  c.signals = [];
  c.kill = (sig) => {
    c.signals.push(sig);
    if (sig === "SIGKILL" || (sig === "SIGTERM" && exitOnTerm)) {
      setTimeout(() => { c.exitCode = null; c.signalCode = sig; c.emit("exit", null, sig); }, 20);
    }
    return true;
  };
  return c;
}

test("stopChild SIGTERMs a cooperative child and resolves at once", async () => {
  const c = fakeChild();
  const t0 = Date.now();
  await stopChild(c);
  assert.deepEqual(c.signals, ["SIGTERM"]);
  assert.ok(Date.now() - t0 < 500);
});

test("stopTunnel escalates to SIGKILL and resolves within 4 s on a child that ignores SIGTERM", async () => {
  const c = fakeChild({ exitOnTerm: false });
  const t0 = Date.now();
  await stopTunnel(c);
  const took = Date.now() - t0;
  assert.deepEqual(c.signals, ["SIGTERM", "SIGKILL"]);
  assert.ok(took >= 2_900 && took < 4_000, `took ${took} ms`);
  assert.deepEqual(tunnelStatus(), { enabled: false, url: null, port: null });
});

test("stopTunnel on nothing is a no-op", async () => {
  await stopTunnel();
  await stopTunnel(null);
  assert.equal(tunnelStatus().enabled, false);
});

test("waitTunnelHealthy waits for the edge record, then for ok, and gives up with a reason", async () => {
  let dns = 0, probes = 0;
  const resolve = async () => { dns++; if (dns < 2) { const e = new Error("queryA ENOTFOUND"); e.code = "ENOTFOUND"; throw e; } return "104.16.0.1"; };
  const probe = async (url, ip) => { probes++; assert.equal(ip, "104.16.0.1"); if (probes < 2) return { status: 530, body: "Argo Tunnel error" }; return { status: 200, body: "ok" }; };
  assert.equal(await waitTunnelHealthy("https://x.trycloudflare.com", 10_000, { resolve, probe }), true);
  assert.equal(dns, 2, "resolved once it existed, then cached");
  assert.equal(probes, 2);
  const never = async () => ({ status: 530, body: "Argo Tunnel error" });
  await assert.rejects(waitTunnelHealthy("https://x.trycloudflare.com", 1_000, { resolve: async () => "1.2.3.4", probe: never }), /did not answer within 1 s \(HTTP 530\)/);
  const noDns = async () => { const e = new Error("x"); e.code = "ENOTFOUND"; throw e; };
  await assert.rejects(waitTunnelHealthy("https://x.trycloudflare.com", 1_000, { resolve: noDns, probe: never }), /\(DNS: ENOTFOUND\)/);
});

test("cloudflared is pinned for four platforms with valid hashes and GitHub release URLs", () => {
  const spec = TOOLS.cloudflared;
  assert.ok(spec, "tools.json has cloudflared");
  assert.match(spec.version, /^\d{4}\.\d{1,2}\.\d{1,2}$/, "cloudflared versions are YYYY.M.N");
  const keys = Object.keys(spec.platforms).sort();
  assert.deepEqual(keys, ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"]);
  const seen = new Set();
  for (const [k, p] of Object.entries(spec.platforms)) {
    assert.match(p.sha256, /^[0-9a-f]{64}$/, `${k} sha256`);
    assert.ok(!seen.has(p.sha256), `${k} shares a hash with another platform`);
    seen.add(p.sha256);
    assert.match(p.url, /^https:\/\/github\.com\/cloudflare\/cloudflared\/releases\/download\//, `${k} url`);
    assert.ok(p.url.includes(spec.version), `${k} url carries the pinned version`);
    if (k.startsWith("darwin")) {
      assert.equal(p.ext, ".tgz");
      assert.equal(p.inner, "cloudflared", "the macOS tgz has the binary at the archive root");
    } else {
      assert.equal(p.inner, undefined, "the Linux assets are bare binaries");
    }
  }
});

// The real thing: a quick tunnel to a tiny local server. Needs network and ~30 s, so it runs
// only on request. The binary is provisioned through tools.json into a temp ROOT, so the pin
// and the checksum are exercised too (or ROOT is pointed at an existing one to skip the fetch).
test("live: a quick tunnel serves /health from a local server", { skip: process.env.RS_TUNNEL_LIVE !== "1" && "set RS_TUNNEL_LIVE=1" }, async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = process.env.ROOT || mkdtempSync(join(tmpdir(), "rs-tunnel-"));
  const srv = createServer((q, s) => { s.setHeader("Content-Type", "text/plain"); s.end(q.url === "/health" ? "ok" : "not found"); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  const t0 = Date.now();
  const lines = [];
  let child;
  try {
    const started = await startTunnel(port, { root, onLog: (l) => lines.push(l) });
    child = started.child;
    const url = started.url;
    const upMs = Date.now() - t0;
    assert.match(url, /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/);
    assert.deepEqual(tunnelStatus(), { enabled: true, url, port });
    const t1 = Date.now();
    const r = await fetch(`${url}/health`);
    const rtt = Date.now() - t1;
    assert.equal(r.status, 200);
    assert.equal((await r.text()).trim(), "ok");
    console.log(`RS_TUNNEL_LIVE url=${url} up_ms=${upMs} health_rtt_ms=${rtt}`);
  } finally {
    await stopTunnel();
    srv.closeAllConnections();
    srv.close();
  }
  assert.equal(tunnelStatus().enabled, false);
  assert.ok(child && (child.exitCode !== null || child.signalCode), "cloudflared exited");
});
