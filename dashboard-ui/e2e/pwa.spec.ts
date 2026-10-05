import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Page } from "@playwright/test";
import { PORT, PR } from "./fixture";

// The PWA surface: root-scoped files with the right content types, and no horizontal overflow
// at phone width on the three pages people actually open from a notification.
test.describe("pwa", () => {
  test("manifest, service worker and icons are served from the root", async ({ request }) => {
    const manifest = await request.get("/manifest.webmanifest");
    expect(manifest.status()).toBe(200);
    expect(manifest.headers()["content-type"]).toContain("application/manifest+json");
    const m = await manifest.json();
    expect(m.name).toBe("ReviewStage");
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
    expect(m.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);

    const sw = await request.get("/sw.js");
    expect(sw.status()).toBe(200);
    expect(sw.headers()["content-type"]).toContain("javascript");
    expect(sw.headers()["cache-control"]).toContain("no-cache");

    for (const icon of ["/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"]) {
      const r = await request.get(icon);
      expect(r.status(), icon).toBe(200);
      expect(r.headers()["content-type"], icon).toBe("image/png");
      expect((await r.body()).subarray(1, 4).toString()).toBe("PNG");
    }

    const offline = await request.get("/offline.html");
    expect(offline.headers()["content-type"]).toContain("text/html");
    const html = await offline.text();
    expect(html).toContain("Your Mac isn't reachable");
    expect(html).toContain("Try again");
  });

  test("the SPA shell links the manifest and the apple touch icon", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("link[rel=manifest]")).toHaveAttribute("href", "/manifest.webmanifest");
    await expect(page.locator("link[rel=apple-touch-icon]")).toHaveCount(1);
    // Dark is the default; the inline shell script flips this to the light paper when light renders.
    await expect(page.locator("meta[name=theme-color]")).toHaveAttribute("content", "#0B0C10");
  });

  test.describe("phone width", () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    for (const [name, path, heading] of [
      ["queue", "/?tab=reviewed", /review queue/i],
      ["pr page", `/pr?pr=${PR}`, null],
      ["integrations", "/integrations", /integrations/i],
    ] as const) {
      test(`${name} does not scroll horizontally at 390px`, async ({ page }) => {
        await page.goto(path);
        if (heading) await expect(page.getByRole("heading", { name: heading })).toBeVisible();
        else await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        // Sign out must be reachable: it lives in the More sheet on the phone.
        await page.getByTestId("more-tab").click();
        await expect(page.getByRole("button", { name: /sign out/i })).toBeInViewport();
        await page.getByRole("button", { name: /^close$/i }).click();
        const { scrollWidth, innerWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: Math.round(window.visualViewport?.width ?? window.innerWidth),
        }));
        expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
      });
    }
  });

  // desktop-always-on F5: a quick tunnel whose Mac is asleep (or whose app quit) answers 530 —
  // Cloudflare's error 1033 page. The worker treats that, and 502/503/504, on a navigation like
  // no answer at all: the cached shell (whose /api/me then shows "Your Mac isn't reachable"),
  // else offline.html. Playwright's request routing makes Chromium bypass service workers, so
  // the dead tunnel here is a real one: a small proxy in front of the fixture server that can be
  // switched to answer every request with a gateway status. Its port is its own origin, so the
  // worker under test is the one registered through it.
  test.describe("service worker, dead tunnel", () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    let proxy: Server;
    let base = "";
    let deadStatus = 0;
    test.beforeAll(async () => {
      proxy = createServer((req, res) => {
        if (deadStatus) {
          res.writeHead(deadStatus, { "Content-Type": "text/html" });
          res.end(`<title>error code: 1033</title><h1>Error ${deadStatus}</h1>`);
          return;
        }
        const up = request({ host: "127.0.0.1", port: PORT, path: req.url, method: req.method, headers: req.headers }, (r) => {
          res.writeHead(r.statusCode || 502, r.headers);
          r.pipe(res);
        });
        up.on("error", () => { res.writeHead(502); res.end(); });
        req.pipe(up);
      });
      await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
      base = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
    });
    test.afterAll(() => new Promise<void>((r) => proxy.close(() => r())));
    test.beforeEach(() => { deadStatus = 0; });

    async function controlled(page: Page) {
      await page.goto(`${base}/?tab=reviewed`);
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) {
          await new Promise<void>((r) => navigator.serviceWorker.addEventListener("controllerchange", () => r(), { once: true }));
        }
      });
      await page.reload();
      await expect(page.getByRole("heading", { name: /review queue/i })).toBeVisible();
      expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    }

    for (const status of [530, 502, 503, 504]) {
      test(`a ${status} navigation gets the cached shell, which says the Mac isn't reachable`, async ({ page }) => {
        await controlled(page);
        deadStatus = status;
        const res = await page.goto(`${base}/?tab=reviewed`);
        expect(res?.status(), "the worker answered, not the dead tunnel").toBe(200);
        await expect(page.getByTestId("unreachable")).toBeVisible();
        await expect(page.getByRole("heading", { name: "Your Mac isn't reachable" })).toBeVisible();
        await expect(page.getByText(/1033/)).toHaveCount(0);
        // The Mac wakes: the state's Try again brings the app back without a reload.
        deadStatus = 0;
        await page.getByTestId("unreachable-retry").click();
        await expect(page.getByRole("heading", { name: /review queue/i })).toBeVisible();
      });
    }

    test("with no cached shell, a 530 navigation gets offline.html, and Try again reloads", async ({ page }) => {
      await controlled(page);
      await page.evaluate(async () => {
        for (const k of await caches.keys()) await (await caches.open(k)).delete("/");
      });
      deadStatus = 530;
      await page.goto(`${base}/settings`);
      await expect(page.getByTestId("offline")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Your Mac isn't reachable" })).toBeVisible();
      await expect(page.getByText("The phone reaches ReviewStage on your Mac. Open it there — or wake the Mac — and try again.")).toBeVisible();
      await expect(page.getByText(/open the newest link from your notifications/)).toBeVisible();
      await expect(page.getByText(/1033/)).toHaveCount(0);
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
      expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
      deadStatus = 0;
      await page.getByRole("button", { name: "Try again" }).click();
      await expect(page.getByTestId("settings-form")).toBeVisible();
    });

    test("a 404 navigation is passed through — only gateway answers mean the Mac is gone", async ({ page }) => {
      await controlled(page);
      deadStatus = 404;
      const res = await page.goto(`${base}/settings`);
      expect(res?.status()).toBe(404);
      await expect(page.getByText("Error 404")).toBeVisible();
    });
  });
});
