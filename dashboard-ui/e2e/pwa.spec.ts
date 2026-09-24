import { expect, test } from "@playwright/test";
import { PR } from "./fixture";

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
    expect(await offline.text()).toContain("needs a connection to your server");
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
        else await expect(page.locator("h1.prtitle")).toBeVisible();
        // Sign out must be reachable: it lives in the More sheet on the phone.
        await page.getByTestId("more-tab").click();
        await expect(page.getByRole("button", { name: /sign out/i })).toBeInViewport();
        await page.getByRole("button", { name: /^close$/i }).click();
        const { scrollWidth, innerWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        }));
        expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
      });
    }
  });
});
