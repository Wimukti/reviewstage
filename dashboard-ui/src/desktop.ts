// The desktop app's own controls (openspec/changes/desktop-always-on): updates (F4) and open at
// login (F2). desktop/preload.cjs exposes them next to `phone`; in a browser, or in a desktop app
// older than this change, they are absent and nothing here renders.
import { useEffect, useState } from "react";

/** What main.js's updater reports (desktop/update.js createUpdater). */
export type UpdateState = {
  current: string;
  latest: string | null;
  available: boolean;
  checkedAt: number | null; // ms since epoch
  error: string | null;
  dev: boolean; // a local 0.0.0-dev build: never offered an update
  installing: boolean;
  installError: string | null;
};

export type UpdateBridge = {
  status(): Promise<UpdateState>;
  check(): Promise<UpdateState>;
  install(): Promise<{ ok: boolean; error?: string }>;
  onAvailable(fn: (u: UpdateState) => void): void;
};

export type OpenAtLogin = { supported: boolean; enabled: boolean; file: string | null; available: boolean; error?: string };
export type OpenAtLoginBridge = { status(): Promise<OpenAtLogin>; set(on: boolean): Promise<OpenAtLogin> };

export function updateBridge(): UpdateBridge | undefined {
  return typeof window === "undefined" ? undefined : window.reviewstage?.update;
}
export type AppShortcut = { supported: boolean; installed: boolean; file: string | null; available: boolean; error?: string };
export type AppShortcutBridge = { status(): Promise<AppShortcut>; set(on: boolean): Promise<AppShortcut> };

export function appShortcutBridge(): AppShortcutBridge | undefined {
  return typeof window === "undefined" ? undefined : window.reviewstage?.appShortcut;
}

export function openAtLoginBridge(): OpenAtLoginBridge | undefined {
  return typeof window === "undefined" ? undefined : window.reviewstage?.openAtLogin;
}

// onAvailable adds an ipcRenderer listener that cannot be removed: subscribe once, fan out here.
let current: UpdateState | null = null;
const watchers = new Set<(u: UpdateState) => void>();
let wired = false;
function publish(u: UpdateState) {
  current = u;
  watchers.forEach((w) => w(u));
}

export async function refreshUpdate(check = false): Promise<UpdateState | null> {
  const b = updateBridge();
  if (!b) return null;
  try {
    publish(await (check ? b.check() : b.status()));
  } catch {
    /* the main process is mid-quit; the next event catches up */
  }
  return current;
}

export function useUpdate(): UpdateState | null {
  const [u, setU] = useState<UpdateState | null>(current);
  useEffect(() => {
    const b = updateBridge();
    if (!b) return;
    if (!wired) {
      wired = true;
      b.onAvailable(publish);
    }
    watchers.add(setU);
    void refreshUpdate();
    return () => {
      watchers.delete(setU);
    };
  }, []);
  return u;
}

// The banner can be dismissed for one version; a newer one shows it again. Per-device, so it
// lives in this browser's storage (and a blocked storage just means the banner comes back).
const DISMISS_KEY = "rs-update-dismissed";
export function dismissedVersion(): string {
  try {
    return localStorage.getItem(DISMISS_KEY) || "";
  } catch {
    return "";
  }
}
export function dismissVersion(v: string) {
  try {
    localStorage.setItem(DISMISS_KEY, v);
  } catch {
    /* storage blocked: dismissed until reload */
  }
}

/** MM/DD/YY HH:MM for "last checked". */
export function whenText(ms: number | null): string {
  if (!ms) return "not yet";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())}/${String(d.getFullYear()).slice(-2)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
