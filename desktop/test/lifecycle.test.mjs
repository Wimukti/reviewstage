// openspec/changes/desktop-always-on: the parts of the resident app that do not need Electron —
// the detach decision, the single-instance retry, version comparison, the open-at-login files,
// ROOT/desktop.json, the update check and install command, and the Tailscale commands.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireLock, autostartDesktopEntry, autostartFile, autostartStatus, compareVersions, isDevVersion,
  launchAgentPlist, readDesktopState, setAutostart, shouldDetach, updateAvailable, writeDesktopState,
} from "../lifecycle.js";
import { createUpdater, fetchLatest, installCommand, registryUrl, spawnInstall } from "../update.js";
import { findTailscale, parseStatus, serveArgs, serveOff, serveOffArgs, serveOn, statusArgs, tailscaleStatus } from "../tailscale.js";

// ---- F1 ---------------------------------------------------------------------------------------

test("the launcher detaches by default and stays in the foreground for the smoke test, --foreground and --doctor", () => {
  assert.equal(shouldDetach([], {}), true);
  assert.equal(shouldDetach(["--wait-for-lock"], {}), true, "an update's new instance detaches too");
  assert.equal(shouldDetach([], { RS_SMOKE: "1" }), false);
  assert.equal(shouldDetach([], { RS_SMOKE: "0" }), true);
  assert.equal(shouldDetach(["--foreground"], {}), false);
  assert.equal(shouldDetach(["--doctor"], {}), false);
});

test("single instance: one try without --wait-for-lock, retries up to 20 s with it", async () => {
  let calls = 0;
  assert.equal(await acquireLock(() => (++calls, false)), false);
  assert.equal(calls, 1, "no wait: a second instance gives up at once (and the first comes forward)");

  // The old instance lets go on the 4th try.
  let t = 0;
  calls = 0;
  const clock = { now: () => t, sleep: async (ms) => { t += ms; } };
  assert.equal(await acquireLock(() => ++calls >= 4, { wait: true, ...clock }), true);
  assert.equal(calls, 4);
  assert.equal(t, 1500, "every 500 ms");

  // It never lets go: give up after 20 s.
  t = 0;
  calls = 0;
  assert.equal(await acquireLock(() => (++calls, false), { wait: true, ...clock }), false);
  assert.equal(t, 20_000);
  assert.equal(calls, 41);
});

// ---- F4 ---------------------------------------------------------------------------------------

test("version comparison is semver precedence, prerelease-aware", () => {
  const ordered = ["0.9.9", "1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0-rc.9", "1.0.0-rc.10", "1.0.0-rc.31", "1.0.0", "1.0.1", "1.1.0", "2.0.0"];
  for (let i = 0; i < ordered.length - 1; i++) {
    assert.equal(compareVersions(ordered[i], ordered[i + 1]), -1, `${ordered[i]} < ${ordered[i + 1]}`);
    assert.equal(compareVersions(ordered[i + 1], ordered[i]), 1);
  }
  assert.equal(compareVersions("1.0.0-rc.31", "v1.0.0-rc.31"), 0, "a leading v is the tag, not the version");
  assert.equal(compareVersions("1.0.0+build.5", "1.0.0"), 0, "build metadata does not count");
  assert.equal(compareVersions("not-a-version", "1.0.0"), 0);
});

test("updates are offered only to a published version, and only for a newer one", () => {
  assert.equal(updateAvailable("1.0.0-rc.31", "1.0.0-rc.32"), true);
  assert.equal(updateAvailable("1.0.0-rc.31", "1.0.0"), true);
  assert.equal(updateAvailable("1.0.0", "1.0.0-rc.32"), false, "never 'up' to a prerelease of the same version");
  assert.equal(updateAvailable("1.0.0-rc.31", "1.0.0-rc.31"), false);
  assert.equal(updateAvailable("1.0.0-rc.32", "1.0.0-rc.31"), false, "never a downgrade");
  assert.equal(isDevVersion("0.0.0-dev"), true);
  assert.equal(updateAvailable("0.0.0-dev", "9.9.9"), false, "a local checkout is never offered an update");
  assert.equal(updateAvailable("1.0.0", "garbage"), false);
});

test("the check reads the latest dist-tag from the registry npx will install from", async () => {
  assert.equal(registryUrl({}), "https://registry.npmjs.org/reviewstage");
  assert.equal(registryUrl({ npm_config_registry: "https://npm.example.com/mirror/" }), "https://npm.example.com/mirror/reviewstage");
  const seen = [];
  const fetchImpl = async (url, opts) => {
    seen.push([url, opts.headers.Accept]);
    return { ok: true, status: 200, json: async () => ({ name: "reviewstage", "dist-tags": { latest: "1.0.0-rc.40", next: "1.1.0-beta.1" } }) };
  };
  assert.deepEqual(await fetchLatest({ env: {}, fetchImpl }), { latest: "1.0.0-rc.40" });
  assert.match(seen[0][1], /application\/vnd\.npm\.install-v1\+json/, "the abbreviated document, not every version's README");

  let t = 1_000;
  const changes = [];
  const u = createUpdater({ current: "1.0.0-rc.31", env: {}, fetchImpl, now: () => t, onChange: (s) => changes.push(s) });
  const s = await u.check();
  assert.equal(s.available, true);
  assert.equal(s.latest, "1.0.0-rc.40");
  assert.equal(s.checkedAt, 1_000);
  assert.equal(changes.length, 1);

  // A failed check keeps the last good answer, records why and when, and never throws.
  t = 2_000;
  const down = createUpdater({ current: "1.0.0-rc.31", env: {}, fetchImpl: async () => ({ ok: false, status: 503 }), now: () => t });
  const d = await down.check();
  assert.equal(d.available, false);
  assert.equal(d.error, "the registry answered HTTP 503");
  assert.equal(d.checkedAt, 2_000);
  const offline = createUpdater({ current: "1.0.0", env: {}, fetchImpl: async () => { throw new Error("getaddrinfo ENOTFOUND registry.npmjs.org"); } });
  assert.match((await offline.check()).error, /ENOTFOUND/);

  // A dev build never asks the network at all.
  let asked = false;
  const dev = createUpdater({ current: "0.0.0-dev", env: {}, fetchImpl: async () => { asked = true; } });
  const ds = await dev.check();
  assert.equal(ds.dev, true);
  assert.equal(ds.available, false);
  assert.equal(asked, false);
});

test("install is the launcher's own npx, detached, with the launcher's PATH and ROOT", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rs-npx-"));
  writeFileSync(join(dir, "npx"), "#!/bin/sh\n");
  assert.deepEqual(installCommand("1.0.0-rc.40", { RS_LAUNCH_NODE: join(dir, "node") }), { cmd: join(dir, "npx"), args: ["-y", "reviewstage@1.0.0-rc.40", "--wait-for-lock"] });
  assert.equal(installCommand("1.0.0", { RS_LAUNCH_NODE: "/nowhere/node" }).cmd, "npx", "no sibling npx: the one on PATH");
  assert.equal(installCommand("1.0.0", {}).cmd, "npx");

  const calls = [];
  const fakeSpawn = (cmd, args, opts) => {
    const c = new EventEmitter();
    c.pid = 4242;
    c.unref = () => calls.push("unref");
    calls.push({ cmd, args, opts });
    setTimeout(() => c.emit("spawn"), 5);
    return c;
  };
  const env = { RS_LAUNCH_NODE: join(dir, "node"), RS_LAUNCH_PATH: "/Users/a/.nvm/bin:/opt/homebrew/bin:/usr/bin", PATH: "/usr/bin", ROOT: "/tmp/r", ELECTRON_RUN_AS_NODE: "1" };
  const r = await spawnInstall("1.0.0-rc.40", { env, spawnImpl: fakeSpawn, logFile: join(dir, "update.log") });
  assert.equal(r.pid, 4242);
  const { cmd, args, opts } = calls[0];
  assert.equal(cmd, join(dir, "npx"));
  assert.deepEqual(args, ["-y", "reviewstage@1.0.0-rc.40", "--wait-for-lock"]);
  assert.equal(opts.detached, true);
  assert.equal(opts.env.PATH, env.RS_LAUNCH_PATH, "the PATH the person's shell had");
  assert.equal(opts.env.ROOT, "/tmp/r", "the same ROOT");
  assert.equal(opts.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(typeof opts.stdio[1], "number", "output to ROOT/update.log");
  assert.equal(calls[1], "unref");

  // The process could not start: rejects, so the app does not quit.
  const failing = () => { const c = new EventEmitter(); setTimeout(() => c.emit("error", new Error("spawn npx ENOENT")), 5); return c; };
  await assert.rejects(spawnInstall("1.0.0", { env: {}, spawnImpl: failing }), /could not start npx: spawn npx ENOENT/);
});

// ---- F2 ---------------------------------------------------------------------------------------

const NODE = "/Users/ann/.nvm/versions/node/v24.3.0/bin/node";
const PATHV = "/Users/ann/.nvm/versions/node/v24.3.0/bin:/opt/homebrew/bin:/usr/bin:/bin";

test("the LaunchAgent runs the launcher's node and its sibling npx with the captured PATH", () => {
  const plist = launchAgentPlist({ node: NODE, path: PATHV, root: null, logFile: "/Users/ann/.reviewstage/login.log" });
  assert.match(plist, /<key>Label<\/key>\n\t<string>dev\.reviewstage\.desktop<\/string>/);
  assert.ok(plist.includes(`\t<array>\n\t\t<string>${NODE}</string>\n\t\t<string>/Users/ann/.nvm/versions/node/v24.3.0/bin/npx</string>\n\t\t<string>-y</string>\n\t\t<string>reviewstage@latest</string>\n\t</array>`), plist);
  assert.ok(plist.includes(`<key>PATH</key>\n\t\t<string>${PATHV}</string>`));
  assert.doesNotMatch(plist, /<key>ROOT<\/key>/, "the default ROOT is not written");
  assert.match(plist, /<key>RunAtLoad<\/key>\n\t<true\/>/);
  assert.match(plist, /<key>StandardOutPath<\/key>\n\t<string>\/Users\/ann\/\.reviewstage\/login\.log<\/string>/);
  assert.doesNotMatch(plist, /KeepAlive/, "quitting from the menu bar stays quit until the next login");
  // A custom root is carried, and XML specials are escaped.
  const odd = launchAgentPlist({ node: "/opt/a&b/node", path: "/x", root: "/tmp/r<1>", logFile: "/tmp/l" });
  assert.match(odd, /<string>\/opt\/a&amp;b\/node<\/string>/);
  assert.match(odd, /<key>ROOT<\/key>\n\t\t<string>\/tmp\/r&lt;1&gt;<\/string>/);
});

test("the XDG autostart entry says the same thing", () => {
  const entry = autostartDesktopEntry({ node: NODE, path: PATHV, root: "/home/ann/my root" });
  assert.match(entry, /^\[Desktop Entry\]\nType=Application\nName=ReviewStage\n/);
  assert.ok(entry.includes(`Exec=env PATH=${PATHV} ROOT="/home/ann/my root" ${NODE} /Users/ann/.nvm/versions/node/v24.3.0/bin/npx -y reviewstage@latest\n`), entry);
});

test("open at login writes the file on, removes it off, and needs the launcher's node", () => {
  const home = mkdtempSync(join(tmpdir(), "rs-home-"));
  assert.equal(autostartFile("darwin", home), join(home, "Library", "LaunchAgents", "dev.reviewstage.desktop.plist"));
  assert.equal(autostartFile("linux", home), join(home, ".config", "autostart", "reviewstage.desktop"));
  assert.equal(autostartFile("win32", home), null);
  assert.deepEqual(autostartStatus({ platform: "darwin", home }), { supported: true, enabled: false, file: autostartFile("darwin", home) });
  const opts = { platform: "darwin", home, node: NODE, path: PATHV, root: null, logFile: "/tmp/login.log" };
  assert.equal(setAutostart(true, opts).enabled, true);
  assert.match(readFileSync(autostartFile("darwin", home), "utf8"), /reviewstage@latest/);
  assert.equal(setAutostart(false, opts).enabled, false);
  assert.equal(existsSync(autostartFile("darwin", home)), false);
  assert.equal(setAutostart(false, opts).enabled, false, "off twice is fine");
  assert.throws(() => setAutostart(true, { ...opts, node: "" }), /npx reviewstage/);
  assert.equal(setAutostart(true, { ...opts, platform: "linux" }).enabled, true);
  assert.throws(() => setAutostart(true, { ...opts, platform: "win32" }), /macOS and Linux/);
});

// ---- F3 ---------------------------------------------------------------------------------------

test("ROOT/desktop.json remembers phone access, and a broken file reads as nothing remembered", () => {
  const root = mkdtempSync(join(tmpdir(), "rs-state-"));
  assert.deepEqual(readDesktopState(root), {});
  writeDesktopState(root, { phone: true });
  writeDesktopState(root, { phoneVia: "tailscale" });
  assert.deepEqual(readDesktopState(root), { phone: true, phoneVia: "tailscale" });
  writeFileSync(join(root, "desktop.json"), "{not json");
  assert.deepEqual(readDesktopState(root), {});
  writeFileSync(join(root, "desktop.json"), "[1,2]");
  assert.deepEqual(readDesktopState(root), {});
});

// ---- F6 ---------------------------------------------------------------------------------------

test("tailscale: found on PATH or in the Mac app, and the serve commands are exact", () => {
  assert.equal(findTailscale({ which: () => "/opt/homebrew/bin/tailscale" }), "/opt/homebrew/bin/tailscale");
  assert.equal(findTailscale({ platform: "darwin", which: () => null, exists: () => true }), "/Applications/Tailscale.app/Contents/MacOS/Tailscale");
  assert.equal(findTailscale({ platform: "linux", which: () => null, exists: () => true }), null);
  assert.equal(findTailscale({ platform: "darwin", which: () => null, exists: () => false }), null);
  assert.deepEqual(serveArgs(51234), ["serve", "--bg", "--https=443", "http://127.0.0.1:51234"]);
  assert.deepEqual(serveArgs("51234; rm -rf /"), ["serve", "--bg", "--https=443", "http://127.0.0.1:NaN"], "the port is a number, never text");
  assert.deepEqual(serveOffArgs(), ["serve", "--https=443", "off"]);
  assert.deepEqual(statusArgs(), ["status", "--json"]);
});

test("tailscale: status reads login and the MagicDNS name; serve runs only when signed in", async () => {
  const running = JSON.stringify({ BackendState: "Running", Self: { DNSName: "anns-mbp.tail1234.ts.net." } });
  assert.deepEqual(parseStatus(running), { loggedIn: true, url: "https://anns-mbp.tail1234.ts.net" });
  assert.deepEqual(parseStatus({ BackendState: "NeedsLogin", Self: { DNSName: "" } }), { loggedIn: false, url: null });
  assert.deepEqual(parseStatus("not json"), { loggedIn: false, url: null });

  assert.deepEqual(await tailscaleStatus({ find: () => null }), { installed: false, loggedIn: false, url: null });
  const calls = [];
  const runImpl = async (exe, args) => { calls.push([exe, ...args]); return args[0] === "status" ? running : ""; };
  const find = () => "/usr/bin/tailscale";
  assert.equal(await serveOn(51234, { runImpl, find }), "https://anns-mbp.tail1234.ts.net");
  assert.deepEqual(calls, [["/usr/bin/tailscale", "status", "--json"], ["/usr/bin/tailscale", "serve", "--bg", "--https=443", "http://127.0.0.1:51234"]]);
  await serveOff({ runImpl, find });
  assert.deepEqual(calls.at(-1), ["/usr/bin/tailscale", "serve", "--https=443", "off"]);

  const loggedOut = async () => JSON.stringify({ BackendState: "NeedsLogin" });
  await assert.rejects(serveOn(1, { runImpl: loggedOut, find }), /not signed in/);
  await assert.rejects(serveOn(1, { find: () => null }), /not installed/);
  const broken = async () => { throw new Error("tailscaled not running"); };
  assert.deepEqual(await tailscaleStatus({ runImpl: broken, find }), { installed: true, loggedIn: false, url: null });
  await serveOff({ runImpl: broken, find }); // never throws
});

// ---- In Applications -------------------------------------------------------------------------
import { appShortcutPath, appShortcutStatus, removeAppShortcut, writeAppShortcut } from "../lifecycle.js";

test("macOS: a ~/Applications bundle that runs the newest version, signed and registered", () => {
  const home = mkdtempSync(join(tmpdir(), "rs-apps-"));
  const icns = join(home, "x.icns"); writeFileSync(icns, "icns");
  const ran = [];
  const opts = { platform: "darwin", home, node: "/Users/ann/.nvm/versions/node/v24.3.0/bin/node",
    path: "/Users/ann/.nvm/versions/node/v24.3.0/bin:/opt/homebrew/bin:/usr/bin:/bin", root: null,
    logFile: "/Users/ann/.reviewstage/launcher.log", icns, run: (c, a) => ran.push([c, ...a]) };
  const st = writeAppShortcut(opts);
  const app = join(home, "Applications", "ReviewStage.app");
  assert.deepEqual(st, { supported: true, installed: true, file: app });
  const script = readFileSync(join(app, "Contents", "MacOS", "ReviewStage"), "utf8");
  assert.match(script, /^#!\/bin\/sh/);
  assert.match(script, /exec env PATH=\/Users\/ann\/\.nvm\/versions\/node\/v24\.3\.0\/bin:\/opt\/homebrew\/bin:\/usr\/bin:\/bin \/Users\/ann\/\.nvm\/versions\/node\/v24\.3\.0\/bin\/node \/Users\/ann\/\.nvm\/versions\/node\/v24\.3\.0\/bin\/npx -y reviewstage@latest >>\/Users\/ann\/\.reviewstage\/launcher\.log 2>&1/);
  assert.equal(statSync(join(app, "Contents", "MacOS", "ReviewStage")).mode & 0o111, 0o111);
  const plist = readFileSync(join(app, "Contents", "Info.plist"), "utf8");
  for (const s of ["<string>ReviewStage</string>", "<string>dev.reviewstage.launcher</string>", "<key>LSUIElement</key>"]) assert.ok(plist.includes(s), s);
  assert.equal(readFileSync(join(app, "Contents", "Resources", "ReviewStage.icns"), "utf8"), "icns");
  assert.deepEqual(ran.map((r) => r[0].split("/").pop()), ["codesign", "lsregister"]);
  // Same inputs: nothing is rewritten or re-signed.
  writeAppShortcut(opts);
  assert.equal(ran.length, 2);
  // A different node (nvm switched versions): rewritten.
  writeAppShortcut({ ...opts, node: "/opt/homebrew/bin/node" });
  assert.match(readFileSync(join(app, "Contents", "MacOS", "ReviewStage"), "utf8"), /\/opt\/homebrew\/bin\/npx -y reviewstage@latest/);
  assert.equal(ran.length, 4);
  assert.deepEqual(removeAppShortcut(opts), { supported: true, installed: false, file: app });
});

test("Linux: a launcher entry with the app icon", () => {
  const home = mkdtempSync(join(tmpdir(), "rs-apps-l-"));
  const png = join(home, "i.png"); writeFileSync(png, "png");
  writeAppShortcut({ platform: "linux", home, node: "/usr/bin/node", path: "/usr/bin:/bin", root: null, logFile: "/tmp/l.log", png });
  const entry = readFileSync(appShortcutPath("linux", home), "utf8");
  assert.match(entry, /^Exec=env PATH=\/usr\/bin:\/bin \/usr\/bin\/node \/usr\/bin\/npx -y reviewstage@latest$/m);
  assert.match(entry, new RegExp(`^Icon=${join(home, ".local", "share", "icons", "reviewstage.png").replace(/[.]/g, "\\.")}$`, "m"));
  assert.equal(appShortcutStatus({ platform: "linux", home }).installed, true);
});

test("without the launcher's node there is nothing to point at", () => {
  assert.throws(() => writeAppShortcut({ platform: "darwin", home: tmpdir(), node: "" }), /npx reviewstage/);
  assert.equal(appShortcutPath("win32", tmpdir()), null);
});
