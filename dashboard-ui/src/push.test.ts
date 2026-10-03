// Unit tests for push.ts and a static render of the PushDevices panel. No browser: the push
// APIs are stubbed on globalThis per case, and fetch is stubbed like api.test.ts does.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  deviceName,
  isIOS,
  isSupported,
  permission,
  subscribe,
  unsubscribe,
  urlBase64ToUint8Array,
} from "./push";
import { PushDevices } from "./PushDevices";

type Call = { url: string; body?: unknown };
let calls: Call[] = [];

function stubFetch(answers: Record<string, unknown>) {
  calls = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^\/api/, "");
    calls.push({ url: path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const data = answers[path] ?? {};
    return {
      ok: true,
      status: 200,
      json: async () => data,
    } as Response;
  }) as typeof fetch;
}

const g = globalThis as Record<string, unknown>;
const saved = { window: g.window, navigator: g.navigator, Notification: g.Notification, fetch: g.fetch };

afterEach(() => {
  Object.assign(g, saved);
});

/** A browser that supports push: SW registration whose pushManager hands out `sub`. */
function fakeBrowser(opts: { permission?: NotificationPermission; existing?: boolean } = {}) {
  const sub = {
    endpoint: "https://push.example.net/send/abc",
    toJSON: () => ({ endpoint: "https://push.example.net/send/abc", keys: { p256dh: "P", auth: "A" } }),
    unsubscribe: async () => true,
  };
  const pushManager = {
    subscribed: !!opts.existing,
    subscribeArgs: null as unknown,
    async getSubscription() {
      return this.subscribed ? sub : null;
    },
    async subscribe(args: unknown) {
      this.subscribeArgs = args;
      this.subscribed = true;
      return sub;
    },
  };
  const reg = { pushManager };
  let perm: NotificationPermission = opts.permission ?? "default";
  g.Notification = {
    get permission() {
      return perm;
    },
    requestPermission: async () => {
      if (perm === "default") perm = "granted";
      return perm;
    },
  };
  g.navigator = {
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1",
    maxTouchPoints: 5,
    serviceWorker: {
      getRegistration: async () => reg,
      register: async () => reg,
      ready: Promise.resolve(reg),
    },
  };
  g.window = { PushManager: function PushManager() {}, Notification: g.Notification, isSecureContext: true };
  return { pushManager, sub };
}

test("isSupported is false outside a browser and true with the three APIs", () => {
  delete g.window;
  delete g.navigator;
  assert.equal(isSupported(), false);
  assert.equal(permission(), "unsupported");
  fakeBrowser();
  assert.equal(isSupported(), true);
  assert.equal(permission(), "default");
});

test("deviceName reads the OS and browser from the UA", () => {
  delete g.window;
  delete g.navigator;
  assert.equal(
    deviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1"),
    "iPhone · Safari",
  );
  assert.equal(
    deviceName("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36"),
    "Android · Chrome",
  );
  assert.equal(
    deviceName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36 Edg/124.0"),
    "Mac · Edge",
  );
  assert.equal(deviceName("Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0"), "Linux · Firefox");
  assert.equal(deviceName("curl/8.0"), "Device · Browser");
  assert.equal(isIOS("Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X)"), true);
  assert.equal(isIOS("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), false);
});

test("urlBase64ToUint8Array decodes the VAPID key format", () => {
  const bytes = urlBase64ToUint8Array("BAQI-_8"); // 0x04 0x04 0x08 0xfb 0xff
  assert.deepEqual(Array.from(bytes), [4, 4, 8, 251, 255]);
});

test("subscribe asks permission, fetches the key, subscribes and posts the subscription", async () => {
  const { pushManager } = fakeBrowser();
  stubFetch({
    "/push/key": { enabled: true, publicKey: "BAQI-_8" },
    "/push/subscribe": { ok: true, devices: [{ id: "x", device: "iPhone · Safari" }], max: 10, enabled: true },
  });
  const out = await subscribe("iPhone · Safari");
  assert.equal(out.devices[0].device, "iPhone · Safari");
  const args = pushManager.subscribeArgs as { userVisibleOnly: boolean; applicationServerKey: Uint8Array };
  assert.equal(args.userVisibleOnly, true);
  assert.deepEqual(Array.from(args.applicationServerKey), [4, 4, 8, 251, 255]);
  assert.deepEqual(
    calls.map((c) => c.url),
    ["/push/key", "/push/subscribe"],
  );
  assert.deepEqual(calls[1].body, {
    subscription: { endpoint: "https://push.example.net/send/abc", keys: { p256dh: "P", auth: "A" } },
    device: "iPhone · Safari",
  });
});

test("subscribe refuses when permission is denied, before touching the server", async () => {
  fakeBrowser({ permission: "denied" });
  stubFetch({});
  await assert.rejects(subscribe("x"), /blocked for this site/);
  assert.equal(calls.length, 0);
});

test("subscribe reuses an existing browser subscription instead of making a second one", async () => {
  const { pushManager } = fakeBrowser({ existing: true, permission: "granted" });
  stubFetch({ "/push/key": { publicKey: "BAQI-_8" }, "/push/subscribe": { devices: [], max: 10, enabled: true } });
  await subscribe("x");
  assert.equal(pushManager.subscribeArgs, null);
});

test("unsubscribe tells the server about this endpoint, then drops the browser subscription", async () => {
  fakeBrowser({ existing: true, permission: "granted" });
  stubFetch({ "/push/unsubscribe": { devices: [], max: 10, enabled: true } });
  const out = await unsubscribe();
  assert.ok(out);
  assert.deepEqual(calls, [{ url: "/push/unsubscribe", body: { endpoint: "https://push.example.net/send/abc" } }]);
});

test("unsubscribe with nothing subscribed is a no-op", async () => {
  fakeBrowser({ permission: "granted" });
  stubFetch({});
  assert.equal(await unsubscribe(), null);
  assert.equal(calls.length, 0);
});

test("the PushDevices panel renders its title, switch and test button", () => {
  delete g.window;
  delete g.navigator;
  const html = renderToStaticMarkup(createElement(PushDevices));
  assert.match(html, /Notifications on this device/);
  assert.match(html, /role="switch"/);
  assert.match(html, /Send a test/);
  // outside a browser there is no push: the panel says so instead of showing a dead switch
  assert.match(html, /cannot receive push notifications/);
  assert.match(html, /data-testid="push-devices"/);
});
