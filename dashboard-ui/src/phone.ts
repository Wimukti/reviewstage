// Phone access from inside the app. The desktop preload exposes `window.reviewstage.phone`
// (desktop/preload.cjs); its presence is how the SPA knows it is running in the desktop app.
// In a browser the bridge is absent and nothing here renders.
import { useEffect, useState } from "react";
import S from "../../desktop/pages/phone-strings.cjs";

export const PHONE_STRINGS = S;

/** What main.js sends on the "phone" channel (presentPhone / sendPhoneData). */
export type PhoneData = {
  url?: string;
  dataUrl?: string;
  warning?: string | null;
  notice?: string;
  check?: "ok" | "checking" | "slow";
  checkDetail?: string;
  pair?: { login: string; exp: number } | null;
  stopped?: string;
};

export type PhoneStatus = { enabled: boolean; url: string | null; via?: "tunnel" | "tailscale" };
type EnableResult = PhoneStatus & { warning?: string | null; error?: string; busy?: boolean };

/** Tailscale as the phone's path (desktop-always-on F6): present and signed in, and whether
 *  phone access runs over it now. */
export type TailscaleStatus = { installed: boolean; loggedIn: boolean; url: string | null; active?: boolean; preferred?: boolean; error?: string };

export type PhoneBridge = {
  enable(): Promise<EnableResult>;
  disable(): Promise<PhoneStatus & { busy?: boolean }>;
  status(): Promise<PhoneStatus>;
  onData(fn: (p: PhoneData) => void): void;
  // Absent on a desktop app older than desktop-always-on.
  tailscale?: { status(): Promise<TailscaleStatus>; set(on: boolean): Promise<TailscaleStatus> };
};

declare global {
  interface Window {
    reviewstage?: { phone?: PhoneBridge; update?: import("./desktop").UpdateBridge; openAtLogin?: import("./desktop").OpenAtLoginBridge };
  }
}

export function phoneBridge(): PhoneBridge | undefined {
  return typeof window === "undefined" ? undefined : window.reviewstage?.phone;
}

// onData adds an ipcRenderer listener with no way to remove it, so the bridge is subscribed
// once and fanned out from here.
const listeners = new Set<(p: PhoneData) => void>();
let wired = false;
export function onPhoneData(fn: (p: PhoneData) => void): () => void {
  const bridge = phoneBridge();
  if (bridge && !wired) {
    wired = true;
    bridge.onData((p) => listeners.forEach((l) => l(p)));
  }
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const POLL_MS = 30_000;

// One status for the whole app, however many places show it: polled every 30 s while anything
// does, refreshed on every phone event and after an enable or disable this page made.
let current: PhoneStatus | null = null;
const watchers = new Set<(s: PhoneStatus | null) => void>();
let poll: number | undefined;
let unhook: (() => void) | undefined;

export async function refreshPhoneStatus(): Promise<void> {
  const bridge = phoneBridge();
  if (!bridge) return;
  try {
    current = await bridge.status();
  } catch {
    return;
  }
  watchers.forEach((w) => w(current));
}

export function usePhoneStatus(): PhoneStatus | null {
  const [status, setStatus] = useState<PhoneStatus | null>(current);
  useEffect(() => {
    if (!phoneBridge()) return;
    watchers.add(setStatus);
    if (watchers.size === 1) {
      poll = window.setInterval(refreshPhoneStatus, POLL_MS);
      unhook = onPhoneData(() => void refreshPhoneStatus());
    }
    void refreshPhoneStatus();
    return () => {
      watchers.delete(setStatus);
      if (watchers.size === 0) {
        window.clearInterval(poll);
        unhook?.();
        unhook = undefined;
      }
    };
  }, []);
  return status;
}
