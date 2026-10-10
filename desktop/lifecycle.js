// The pieces of "always on" that do not need Electron, so they can be tested with node --test:
// when the launcher detaches, the single-instance retry, version comparison for updates, the
// open-at-login files, and ROOT/desktop.json (what the app remembers between launches).
// See openspec/changes/desktop-always-on/design.md.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// ---- F1: detach --------------------------------------------------------------------------

/** The launcher detaches unless something needs its stdout: the smoke test (RS_SMOKE=1),
 *  `--foreground`, or `--doctor` (which never starts Electron at all). */
export function shouldDetach(argv, env) {
  if (env.RS_SMOKE === "1") return false;
  return !argv.some((a) => a === "--foreground" || a === "--doctor");
}

/**
 * Take the single-instance lock. `request` is app.requestSingleInstanceLock (each failed call
 * also tells the running instance to come forward). Without `wait` it is one try. With it —
 * the update path, where the old instance is still shutting down — retry every `everyMs` for
 * up to `timeoutMs`. Resolves to true once the lock is ours.
 */
export async function acquireLock(request, { wait = false, timeoutMs = 20_000, everyMs = 500, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now } = {}) {
  if (request()) return true;
  if (!wait) return false;
  const until = now() + timeoutMs;
  while (now() < until) {
    await sleep(everyMs);
    if (request()) return true;
  }
  return false;
}

// ---- F4: versions ------------------------------------------------------------------------

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(v) {
  const m = SEMVER.exec(String(v || "").trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split(".") : [] };
}

/** semver precedence: -1, 0 or 1. A release outranks its prereleases; prerelease identifiers
 *  compare numerically when both are numbers (rc.10 > rc.9), else as strings, and a longer
 *  list wins when one is a prefix of the other. Unparseable versions compare as equal. */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (const k of ["major", "minor", "patch"]) if (x[k] !== y[k]) return x[k] > y[k] ? 1 : -1;
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) { if (+p !== +q) return +p > +q ? 1 : -1; continue; }
    if (pn !== qn) return pn ? -1 : 1;
    if (p !== q) return p > q ? 1 : -1;
  }
  return 0;
}

/** A local checkout runs as 0.0.0-dev (CI stamps the real version from the tag). Such a run
 *  is never offered an update: it is somebody working on the app, not using it. */
export const isDevVersion = (v) => !parseVersion(v) || /^0\.0\.0(-|$)/.test(String(v));

export function updateAvailable(current, latest) {
  if (isDevVersion(current) || !parseVersion(latest)) return false;
  return compareVersions(latest, current) > 0;
}

// ---- F2: open at login -------------------------------------------------------------------

export const LAUNCH_AGENT_LABEL = "dev.reviewstage.desktop";

const xml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));

/** What launches the app at login: the node that ran the launcher, its sibling npx, and the
 *  latest published package (so login also picks up updates). `root` is carried only when the
 *  app runs on a non-default ROOT. */
export function loginCommand({ node, root }) {
  const npx = join(dirname(node), "npx");
  return { program: node, args: [npx, "-y", "reviewstage@latest"], env: root ? { ROOT: root } : {} };
}

/** ~/Library/LaunchAgents/dev.reviewstage.desktop.plist. launchd starts agents with a bare
 *  PATH (/usr/bin:/bin:/usr/sbin:/sbin), which has neither nvm's node nor Homebrew's python3,
 *  so the PATH the app was started with is written in. */
export function launchAgentPlist({ node, path, root, logFile }) {
  const { program, args, env } = loginCommand({ node, root });
  const envXml = Object.entries({ PATH: path, ...env })
    .map(([k, v]) => `\t\t<key>${xml(k)}</key>\n\t\t<string>${xml(v)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Label</key>
\t<string>${LAUNCH_AGENT_LABEL}</string>
\t<key>ProgramArguments</key>
\t<array>
${[program, ...args].map((a) => `\t\t<string>${xml(a)}</string>`).join("\n")}
\t</array>
\t<key>EnvironmentVariables</key>
\t<dict>
${envXml}
\t</dict>
\t<key>RunAtLoad</key>
\t<true/>
\t<key>ProcessType</key>
\t<string>Interactive</string>
\t<key>StandardOutPath</key>
\t<string>${xml(logFile)}</string>
\t<key>StandardErrorPath</key>
\t<string>${xml(logFile)}</string>
</dict>
</plist>
`;
}

const shq = (s) => (/^[A-Za-z0-9_\/.:@=+-]+$/.test(s) ? s : `"${String(s).replace(/(["\\$`])/g, "\\$1")}"`);

/** ~/.config/autostart/reviewstage.desktop (XDG autostart). `env` carries PATH the same way. */
export function autostartDesktopEntry({ node, path, root }) {
  const { program, args, env } = loginCommand({ node, root });
  const vars = Object.entries({ PATH: path, ...env }).map(([k, v]) => `${k}=${shq(v)}`).join(" ");
  return `[Desktop Entry]
Type=Application
Name=ReviewStage
Comment=Stage your PR review. Post it as yourself.
Exec=env ${vars} ${[program, ...args].map(shq).join(" ")}
X-GNOME-Autostart-enabled=true
NoDisplay=false
`;
}

/** Where the open-at-login file lives on this platform, or null where it is not supported. */
export function autostartFile(platform, home) {
  if (platform === "darwin") return join(home, "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`);
  if (platform === "linux") return join(home, ".config", "autostart", "reviewstage.desktop");
  return null;
}

export function autostartStatus({ platform, home }) {
  const file = autostartFile(platform, home);
  return { supported: !!file, enabled: !!file && existsSync(file), file };
}

/** Write (on) or remove (off) the open-at-login file. Needs the launcher's node: an Electron
 *  started some other way has no npx to point at, so turning it on then is refused. */
export function setAutostart(on, { platform, home, node, path, root, logFile }) {
  const file = autostartFile(platform, home);
  if (!file) throw new Error("Open at login is available on macOS and Linux.");
  if (!on) {
    rmSync(file, { force: true });
    return autostartStatus({ platform, home });
  }
  if (!node) throw new Error("Start ReviewStage with `npx reviewstage` to turn this on.");
  mkdirSync(dirname(file), { recursive: true });
  const body = platform === "darwin"
    ? launchAgentPlist({ node, path, root, logFile })
    : autostartDesktopEntry({ node, path, root });
  writeFileSync(file, body, { mode: 0o644 });
  return autostartStatus({ platform, home });
}

// ---- In Applications: so Spotlight, Launchpad and the app launcher find ReviewStage ----------
// `npx reviewstage` runs Electron out of the npm cache, which no launcher indexes. On first run
// the app writes a small launcher of its own — a ~/Applications bundle on macOS, a .desktop
// entry on Linux — that starts the newest published version the same way open-at-login does.

const APP_SHORTCUT_VERSION = 1;

/** Where the launcher lives, or null where it is not supported. */
export function appShortcutPath(platform, home) {
  if (platform === "darwin") return join(home, "Applications", "ReviewStage.app");
  if (platform === "linux") return join(home, ".local", "share", "applications", "reviewstage.desktop");
  return null;
}

/** The shell script inside the macOS bundle. It hands off to the launcher, which detaches. */
export function appLauncherScript({ node, path, root, logFile }) {
  const { program, args, env } = loginCommand({ node, root });
  const vars = Object.entries({ PATH: path, ...env }).map(([k, v]) => `${k}=${shq(v)}`).join(" ");
  return `#!/bin/sh
# Written by ReviewStage. Starts the newest published version; running it again focuses the
# open window. Delete this app, or turn off "Show in Applications", to remove it.
exec env ${vars} ${[program, ...args].map(shq).join(" ")} >>${shq(logFile)} 2>&1
`;
}

export function appInfoPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleName</key>
	<string>ReviewStage</string>
	<key>CFBundleDisplayName</key>
	<string>ReviewStage</string>
	<key>CFBundleIdentifier</key>
	<string>dev.reviewstage.launcher</string>
	<key>CFBundleExecutable</key>
	<string>ReviewStage</string>
	<key>CFBundleIconFile</key>
	<string>ReviewStage</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>${APP_SHORTCUT_VERSION}</string>
	<key>LSUIElement</key>
	<true/>
	<key>LSMinimumSystemVersion</key>
	<string>12.0</string>
</dict>
</plist>
`;
}

export function appDesktopEntry({ node, path, root, icon }) {
  const { program, args, env } = loginCommand({ node, root });
  const vars = Object.entries({ PATH: path, ...env }).map(([k, v]) => `${k}=${shq(v)}`).join(" ");
  return `[Desktop Entry]
Type=Application
Name=ReviewStage
Comment=Stage your PR review. Post it as yourself.
Exec=env ${vars} ${[program, ...args].map(shq).join(" ")}
${icon ? `Icon=${icon}\n` : ""}Terminal=false
Categories=Development;
StartupWMClass=ReviewStage
`;
}

/** What was written last time, so a changed node path rewrites the launcher. */
const stampOf = ({ node, path, root }) => JSON.stringify({ v: APP_SHORTCUT_VERSION, node, path, root: root || null });

export function appShortcutStatus({ platform, home }) {
  const file = appShortcutPath(platform, home);
  return { supported: !!file, installed: !!file && existsSync(file), file };
}

/**
 * Write the launcher. Returns the status. `icns` (macOS) and `png` (Linux) are the app icon
 * to copy in; `run(cmd, args)` runs a system tool (codesign, lsregister) and may be a no-op in
 * tests. Unchanged inputs and an existing launcher → nothing is rewritten.
 */
export function writeAppShortcut({ platform, home, node, path, root, logFile, icns, png, run = () => {} }) {
  const file = appShortcutPath(platform, home);
  if (!file) throw new Error("Adding ReviewStage to your applications works on macOS and Linux.");
  if (!node) throw new Error("Start ReviewStage with `npx reviewstage` to add it to your applications.");
  const stamp = stampOf({ node, path, root });
  if (platform === "darwin") {
    const stampFile = join(file, "Contents", "Resources", "reviewstage-launcher.json");
    if (existsSync(stampFile) && readFileSync(stampFile, "utf8") === stamp) return appShortcutStatus({ platform, home });
    rmSync(file, { recursive: true, force: true });
    mkdirSync(join(file, "Contents", "MacOS"), { recursive: true });
    mkdirSync(join(file, "Contents", "Resources"), { recursive: true });
    writeFileSync(join(file, "Contents", "Info.plist"), appInfoPlist());
    const exe = join(file, "Contents", "MacOS", "ReviewStage");
    writeFileSync(exe, appLauncherScript({ node, path, root, logFile }));
    chmodSync(exe, 0o755);
    if (icns && existsSync(icns)) copyFileSync(icns, join(file, "Contents", "Resources", "ReviewStage.icns"));
    writeFileSync(stampFile, stamp);
    run("codesign", ["--force", "--sign", "-", file]);
    run("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister", ["-f", file]);
    return appShortcutStatus({ platform, home });
  }
  let icon = "";
  if (png && existsSync(png)) {
    icon = join(home, ".local", "share", "icons", "reviewstage.png");
    mkdirSync(dirname(icon), { recursive: true });
    copyFileSync(png, icon);
  }
  const body = appDesktopEntry({ node, path, root, icon });
  if (existsSync(file) && readFileSync(file, "utf8") === body) return appShortcutStatus({ platform, home });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body, { mode: 0o644 });
  return appShortcutStatus({ platform, home });
}

export function removeAppShortcut({ platform, home }) {
  const file = appShortcutPath(platform, home);
  if (file) rmSync(file, { recursive: true, force: true });
  return appShortcutStatus({ platform, home });
}

// ---- F3: what the app remembers ----------------------------------------------------------

/** ROOT/desktop.json: { phone: bool, phoneVia: "tunnel" | "tailscale", port: number }. `port` is
 *  the loopback port the last launch chose, written by main.js once the server is up so the
 *  doctor can find the running app. Unknown or broken files read as {} — a missing preference
 *  is "off", never a crash. */
export function readDesktopState(root) {
  try {
    const d = JSON.parse(readFileSync(join(root, "desktop.json"), "utf8"));
    return d && typeof d === "object" && !Array.isArray(d) ? d : {};
  } catch {
    return {};
  }
}

export function writeDesktopState(root, patch) {
  const next = { ...readDesktopState(root), ...patch };
  mkdirSync(root, { recursive: true });
  const f = join(root, "desktop.json");
  writeFileSync(`${f}.tmp`, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  renameSync(`${f}.tmp`, f);
  return next;
}
