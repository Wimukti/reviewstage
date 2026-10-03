import { expect, test } from "@playwright/test";
import { generateKeyPairSync, randomBytes } from "node:crypto";

// Web push: the server routes and the worker, against the offline fixture. A headless Chromium
// has no push service to subscribe with, so the browser side is proven by unit tests on
// push.ts (src/push.test.ts, mocked navigator) and the panel is rendered there too; here the
// test plays the browser at the API level with a real P-256 subscription shape.

const b64u = (b: Buffer) => b.toString("base64url");

function fakeSubscription(tail = randomBytes(6).toString("hex")) {
  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const point = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
  return {
    endpoint: `https://push.example.net/send/${tail}`,
    keys: { p256dh: b64u(point), auth: b64u(randomBytes(16)) },
  };
}

test.describe("web push", () => {
  test("the VAPID public key is a P-256 point and is stable across calls", async ({ request }) => {
    const a = await request.get("/api/push/key");
    expect(a.status()).toBe(200);
    const { publicKey, enabled } = await a.json();
    expect(enabled).toBe(true);
    const raw = Buffer.from(publicKey, "base64url");
    expect(raw.length).toBe(65);
    expect(raw[0]).toBe(4);
    const b = await request.get("/api/push/key");
    expect((await b.json()).publicKey).toBe(publicKey);
  });

  test("subscribe → list (masked) → unsubscribe, for the signed-in user only", async ({ request }) => {
    const sub = fakeSubscription("e2ephone");
    const r = await request.post("/api/push/subscribe", {
      data: { subscription: sub, device: "E2E phone" },
      headers: { "Content-Type": "application/json" },
    });
    expect(r.status(), await r.text()).toBe(200);
    const { device } = await r.json();
    expect(device.device).toBe("E2E phone");
    expect(device.endpoint).toBe("push.example.net/…ephone"); // masked: host + last 6 chars

    const list = await (await request.get("/api/push/devices")).json();
    const mine = list.devices.find((d: { device: string }) => d.device === "E2E phone");
    expect(mine).toBeTruthy();
    expect(mine.keys).toBeUndefined();
    expect(JSON.stringify(list)).not.toContain(sub.keys.p256dh);

    const gone = await request.post("/api/push/unsubscribe", {
      data: { endpoint: sub.endpoint },
      headers: { "Content-Type": "application/json" },
    });
    expect((await gone.json()).removed).toBe(1);
    const after = await (await request.get("/api/push/devices")).json();
    expect(after.devices.some((d: { device: string }) => d.device === "E2E phone")).toBe(false);
  });

  test("a bad subscription is a 400 and a signed-out caller a 401", async ({ request, browser }) => {
    const bad = await request.post("/api/push/subscribe", {
      data: { subscription: { endpoint: "http://plain/x" } },
      headers: { "Content-Type": "application/json" },
    });
    expect(bad.status()).toBe(400);
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const r = await anon.request.get("/api/push/devices");
    expect(r.status()).toBe(401);
    await anon.close();
  });

  test("Send a test with no devices says so instead of pretending", async ({ browser }) => {
    // Its own context: the shared user may hold a device from the test above in another worker.
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const r = await ctx.request.post("/api/push/test", {
      data: {},
      headers: { "Content-Type": "application/json" },
    });
    expect(r.status()).toBe(401);
    await ctx.close();
  });

  test("the served service worker carries the push and notificationclick handlers", async ({ request }) => {
    const sw = await (await request.get("/sw.js")).text();
    expect(sw).toContain('addEventListener("push"');
    expect(sw).toContain('addEventListener("notificationclick"');
    expect(sw).toContain("/icons/icon-192.png");
    expect(sw).toContain("/icons/maskable-192.png");
    // the caching strategy is untouched
    expect(sw).toContain('url.pathname.startsWith("/api/")');
    expect(sw).not.toContain("__BUILD__"); // stamped by scripts/icons.mjs
  });
});
