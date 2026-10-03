// Web push on this device: subscribe / unsubscribe helpers and the `usePush()` hook behind the
// PushDevices panel. Server side is bin/rs_push.py; the worker side is public/sw.js.
//
// A subscription is per browser profile per origin, so "this device" means "this browser on
// this device". The server keeps one row per subscription under the signed-in user and masks
// the endpoint when it lists them; the only way to tell which row is this browser is to hash
// our own endpoint the same way the server does (sha256, first 16 hex).
import { useCallback, useEffect, useState } from "react";
import { get, post } from "./api";

export interface PushDevice {
  id: string;
  device: string;
  added: number;
  ua: string;
  endpoint: string; // masked: host/…tail
}

export interface PushDevicesData {
  devices: PushDevice[];
  max: number;
  enabled: boolean;
}

export type Permission = NotificationPermission | "unsupported";

const hasWindow = () => typeof window !== "undefined" && typeof navigator !== "undefined";

/** True when this browser can do web push at all (secure context, SW, PushManager). */
export function isSupported(): boolean {
  return (
    hasWindow() &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    (window.isSecureContext ?? true)
  );
}

export function permission(): Permission {
  return isSupported() ? Notification.permission : "unsupported";
}

/** iPhone / iPad, including iPadOS pretending to be a Mac. */
export function isIOS(ua: string = hasWindow() ? navigator.userAgent : ""): boolean {
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && hasWindow() && (navigator.maxTouchPoints ?? 0) > 1;
}

/** Running as an installed (home-screen) app rather than in a browser tab. */
export function isStandalone(): boolean {
  if (!hasWindow()) return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return !!nav.standalone || (window.matchMedia?.("(display-mode: standalone)").matches ?? false);
}

/** "iPhone · Safari", "Android · Chrome", "Mac · Firefox" — a default the person can keep. */
export function deviceName(ua: string = hasWindow() ? navigator.userAgent : ""): string {
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && hasWindow() && (navigator.maxTouchPoints ?? 0) > 1)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Macintosh|Mac OS/.test(ua)
            ? "Mac"
            : /CrOS/.test(ua)
              ? "Chromebook"
              : /Linux/.test(ua)
                ? "Linux"
                : "Device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua) || /CriOS\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";
  return `${os} · ${browser}`;
}

export function urlBase64ToUint8Array(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** The server's row id for an endpoint: sha256 hex, first 16 characters. */
export async function endpointId(endpoint: string): Promise<string> {
  if (!hasWindow() || !crypto?.subtle) return "";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

async function registration(): Promise<ServiceWorkerRegistration> {
  // main.tsx registers /sw.js in production bundles; `ready` waits for it. In dev there is no
  // worker, so register it here — push needs one whatever the build.
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (!existing) await navigator.serviceWorker.register("/sw.js");
  return navigator.serviceWorker.ready;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!isSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Ask permission, subscribe this browser and register the subscription with the server. */
export async function subscribe(name: string): Promise<PushDevicesData> {
  if (!isSupported()) throw new Error("This browser cannot receive push notifications.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    throw new Error(
      perm === "denied"
        ? "Notifications are blocked for this site — allow them in the browser's site settings, then try again."
        : "Notifications were not allowed.",
    );
  }
  const { publicKey } = await get<{ publicKey: string }>("/push/key");
  const reg = await registration();
  const sub =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    }));
  return post<PushDevicesData & { ok: boolean }>("/push/subscribe", {
    subscription: sub.toJSON(),
    device: name,
  });
}

/** Drop this browser's subscription on both sides. */
export async function unsubscribe(): Promise<PushDevicesData | null> {
  const sub = await currentSubscription();
  if (!sub) return null;
  const out = await post<PushDevicesData>("/push/unsubscribe", { endpoint: sub.endpoint });
  await sub.unsubscribe().catch(() => undefined);
  return out;
}

export function removeDevice(id: string): Promise<PushDevicesData> {
  return post<PushDevicesData>("/push/unsubscribe", { id });
}

export function listDevices(): Promise<PushDevicesData> {
  return get<PushDevicesData>("/push/devices");
}

export interface TestResult {
  ok: boolean;
  sent: number;
  failed: number;
  gone: number;
  devices: number;
}

export function sendTest(): Promise<TestResult> {
  return post<TestResult>("/push/test");
}

export interface PushState {
  supported: boolean;
  permission: Permission;
  /** Server-side switch (RS_PUSH, cryptography present); null until the first load answers. */
  serverEnabled: boolean | null;
  /** This browser holds a subscription the server knows about. */
  enabled: boolean;
  currentId: string;
  devices: PushDevice[];
  max: number;
  busy: boolean;
  error: string;
  notice: string;
  iosNeedsInstall: boolean;
  enable: (name?: string) => Promise<void>;
  disable: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  test: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function usePush(): PushState {
  const supported = isSupported();
  const [perm, setPerm] = useState<Permission>(() => permission());
  const [serverEnabled, setServerEnabled] = useState<boolean | null>(null);
  const [devices, setDevices] = useState<PushDevice[]>([]);
  const [max, setMax] = useState(10);
  const [currentId, setCurrentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const apply = useCallback((d: PushDevicesData) => {
    setDevices(d.devices);
    setMax(d.max);
    setServerEnabled(d.enabled);
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply(await listDevices());
      const sub = await currentSubscription();
      setCurrentId(sub ? await endpointId(sub.endpoint) : "");
      setPerm(permission());
    } catch (e) {
      setError((e as Error).message || "Couldn't load your devices.");
    }
  }, [apply]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (fn: () => Promise<PushDevicesData | null | void>, done = "") => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const d = await fn();
      if (d) apply(d);
      const sub = await currentSubscription();
      setCurrentId(sub ? await endpointId(sub.endpoint) : "");
      setPerm(permission());
      if (done) setNotice(done);
    } catch (e) {
      setError((e as Error).message || String(e));
      setPerm(permission());
    } finally {
      setBusy(false);
    }
  };

  const enabled = !!currentId && devices.some((d) => d.id === currentId);

  return {
    supported,
    permission: perm,
    serverEnabled,
    enabled,
    currentId,
    devices,
    max,
    busy,
    error,
    notice,
    iosNeedsInstall: supported === false && isIOS() && !isStandalone(),
    enable: (name) => run(() => subscribe(name || deviceName()), "Notifications are on for this device."),
    disable: () => run(unsubscribe, "Notifications are off for this device."),
    remove: (id) => run(() => removeDevice(id)),
    test: () =>
      run(async () => {
        const r = await sendTest();
        if (!r.ok) throw new Error(`Nothing arrived: ${r.failed} failed, ${r.gone} gone — see the server log.`);
        setNotice(`Sent to ${r.sent} device${r.sent === 1 ? "" : "s"} — check your notifications.`);
      }),
    refresh,
  };
}
