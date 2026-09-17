import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

// The upgrade path, in a real browser with a real service worker.
//
// What went wrong in the field: `git pull && docker compose up -d --build` left users on the
// previous release's interface until they hard-reloaded. Two causes, both covered here.
//   1. sw.js hardcoded `const VERSION = "rs-v1"`, unchanged since it was written, so the
//      activate handler that drops "old caches" never found one to drop.
//   2. /static/* was cache-first and the bundle had fixed names (app.js, app.css), so the
//      same URL returned the same bytes for ever.
// The fix fingerprints the bundle (app-<hash>.js), derives the worker's cache version from
// that same hash, and serves anything NOT fingerprinted network-first.

const STATIC = fileURLToPath(new URL("../../bin/static", import.meta.url));

/**
 * Leave the page in the state every visit after the first is in: a service worker installed,
 * activated, and already in control when the bundle starts running. The final reload matters —
 * on the very first load the worker claims a page that started life uncontrolled, and the app
 * deliberately does not reload in that case (there is nothing stale to replace).
 */
async function controlled(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((r) =>
        navigator.serviceWorker.addEventListener("controllerchange", () => r(), { once: true }));
    }
  });
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}


/**
 * Publish a second "release" into bin/static the way a rebuild would: a bundle under a new
 * fingerprint, a manifest naming it, and a service worker stamped with the new version.
 * Returns a restore function — the directory is the one the running server reads from.
 */
async function publishNextRelease() {
  const manifest = JSON.parse(await readFile(join(STATIC, "assets.json"), "utf8"));
  const sw = await readFile(join(STATIC, "sw.js"), "utf8");
  const js = await readFile(join(STATIC, manifest.js));
  const css = await readFile(join(STATIC, manifest.css));
  const next = createHash("sha256").update(js).update(css).update("next").digest("hex").slice(0, 12);

  await writeFile(join(STATIC, `app-${next}.js`), Buffer.concat([js, Buffer.from("\n//next\n")]));
  await writeFile(join(STATIC, `app-${next}.css`), css);
  await writeFile(join(STATIC, "assets.json"),
    JSON.stringify({ build: next, js: `app-${next}.js`, css: `app-${next}.css` }));
  await writeFile(join(STATIC, "sw.js"), sw.replace(/rs-[0-9a-f]{8,}/, `rs-${next}`));

  return async () => {
    await writeFile(join(STATIC, "assets.json"), JSON.stringify(manifest));
    await writeFile(join(STATIC, "sw.js"), sw);
    await rm(join(STATIC, `app-${next}.js`), { force: true });
    await rm(join(STATIC, `app-${next}.css`), { force: true });
  };
}

test.describe("service worker upgrades", () => {
  test("the served sw.js carries a version derived from the built bundle", async ({ request }) => {
    const shell = await (await request.get("/")).text();
    const js = shell.match(/src='(\/static\/app-([0-9a-f]{8,})\.js)'/);
    const css = shell.match(/href='(\/static\/app-([0-9a-f]{8,})\.css)'/);
    expect(js, "the shell must link a fingerprinted bundle, not /static/app.js").toBeTruthy();
    expect(css).toBeTruthy();
    const hash = js![2];
    expect(css![2]).toBe(hash);

    // Honest fingerprint: the name is the hash of the bytes actually served under it.
    const h = createHash("sha256")
      .update(Buffer.from(await (await request.get(js![1])).body()))
      .update(Buffer.from(await (await request.get(css![1])).body()))
      .digest("hex")
      .slice(0, 12);
    expect(h).toBe(hash);

    const sw = await (await request.get("/sw.js")).text();
    expect(sw).toContain(`const VERSION = "rs-${hash}"`);
    // The regression itself: a constant that no build could ever change.
    expect(sw).not.toContain('"rs-v1"');
    expect(sw).not.toContain("__BUILD__");
  });

  test("a fingerprinted bundle is cached for a year, sw.js never is", async ({ request }) => {
    const shell = await (await request.get("/")).text();
    const js = shell.match(/src='(\/static\/app-[0-9a-f]{8,}\.js)'/)![1];
    const r = await request.get(js);
    expect(r.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
    const sw = await request.get("/sw.js");
    expect(sw.headers()["cache-control"]).toContain("no-cache");
  });

  test.describe("under an installed worker", () => {
    test.describe.configure({ mode: "serial" });

    const stable = join(STATIC, "upgrade-probe.js");
    const hashed = join(STATIC, "app-deadbeefcafe.js");
    test.afterAll(async () => {
      await rm(stable, { force: true });
      await rm(hashed, { force: true });
    });

    test("a changed asset at a stable URL is fetched, not served from cache", async ({ page }) => {
      // This is the bug, reduced: one URL, two releases' worth of bytes. Under the old
      // cache-first rule the second read returned the first release for ever.
      await writeFile(stable, "export const release = 1;\n");
      await controlled(page);

      const read = () =>
        page.evaluate(async () => (await fetch("/static/upgrade-probe.js")).text());
      expect(await read()).toContain("release = 1");

      await writeFile(stable, "export const release = 2;\n");
      expect(await read()).toContain("release = 2");
    });

    test("a fingerprinted asset is served from cache without asking the server", async ({
      page,
    }) => {
      // The deliberate other half of the split: app-<hash>.js cannot change under its own
      // URL, so it is worth keeping cache-first. Proven by deleting the file from disk after
      // the first read — a network-first rule would now fail, cache-first still answers.
      await writeFile(hashed, "export const pinned = true;\n");
      await controlled(page);

      const read = () =>
        page.evaluate(async () => (await fetch("/static/app-deadbeefcafe.js")).text());
      expect(await read()).toContain("pinned = true");

      await rm(hashed, { force: true });
      expect(await read()).toContain("pinned = true");
    });

    test("a tab left open moves itself onto the next release", async ({ page }) => {
      // The reviewer who never closes the tab. A browser only re-checks /sw.js on a navigation
      // or an explicit update(), and this is a single-page app — so the app asks on every
      // return to the tab. Here update() stands in for that focus, and what follows is the
      // part being tested: the new worker skipWaiting()s, claims the page, and the page
      // reloads itself onto the new bundle instead of running the old one until someone
      // presses ctrl-shift-R.
      await controlled(page);
      const before = await page.evaluate(() =>
        (document.querySelector("script[src]") as HTMLScriptElement).src);

      const restore = await publishNextRelease();
      try {
        const reloaded = page.waitForEvent("load");
        await page.evaluate(() => navigator.serviceWorker.ready.then((r) => r.update()));
        await reloaded;
        await expect
          .poll(() => page.evaluate(() =>
            (document.querySelector("script[src]") as HTMLScriptElement).src))
          .not.toBe(before);
      } finally {
        await restore();
      }
    });

    test("activating drops the previous release's cache", async ({ page }) => {
      const sw = await readFile(join(STATIC, "sw.js"), "utf8");
      const version = sw.match(/const VERSION = "(rs-[0-9a-f]{8,})"/)![1];
      expect(version).not.toBe("rs-v1");

      // offline.html is plain HTML with no bundle, so nothing registers a worker yet. Seed the
      // cache the shipped releases all wrote to — the one the constant VERSION made permanent.
      await page.goto("/offline.html");
      await page.evaluate(async () => {
        const c = await caches.open("rs-v1");
        await c.put("/static/app.js", new Response("the previous release"));
      });
      expect(await page.evaluate(() => caches.keys())).toEqual(["rs-v1"]);

      await controlled(page);
      await expect.poll(() => page.evaluate(() => caches.keys())).toEqual([version]);
    });

  });
});
