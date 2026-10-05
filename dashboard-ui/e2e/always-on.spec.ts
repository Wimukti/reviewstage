// openspec/changes/desktop-always-on: the dashboard's half of the resident desktop app.
//   F4  the update banner and Settings → Desktop app, driven by a fake preload bridge (a STRING
//       init script: tsx's function init scripts inject a `__name` helper the page lacks).
//   F5  "Your Mac isn't reachable": what a phone sees when the tunnel answers 530 (Cloudflare's
//       dead-tunnel status), a 502/503/504, or nothing at all.
//   F6  the Tailscale row in Settings → Your phone, with and without the CLI.
import { expect, test, type Page } from "@playwright/test";
import { patchMe } from "./fixture";

type Bridge = {
  update?: { current: string; latest: string | null; available: boolean; dev?: boolean; error?: string | null; installOk?: boolean };
  login?: { supported: boolean; enabled: boolean; available: boolean };
  tailscale?: { installed: boolean; loggedIn: boolean; url: string | null };
};

const CHECKED = new Date(2026, 9, 5, 9, 41).getTime(); // 10/05/26 09:41 local

async function fakeBridge(page: Page, b: Bridge) {
  const u = { latest: null, available: false, dev: false, error: null, installOk: true, ...b.update };
  await page.addInitScript({
    content: `
      window.__calls = [];
      const st = ${JSON.stringify({ ...u, checkedAt: CHECKED, installing: false, installError: null })};
      const login = ${JSON.stringify(b.login ?? { supported: true, enabled: false, available: true })};
      const ts = ${JSON.stringify(b.tailscale ?? null)};
      let tsOn = false;
      window.reviewstage = {
        phone: {
          onData(fn) { window.__phonePush = fn; },
          async status() { return { enabled: tsOn, url: tsOn ? ts.url : null, via: tsOn ? "tailscale" : "tunnel" }; },
          async enable() { return { enabled: true, url: "https://x.trycloudflare.com" }; },
          async disable() { return { enabled: false, url: null }; },
          ${b.tailscale ? `tailscale: {
            async status() { window.__calls.push("ts:status"); return { ...ts, active: tsOn, preferred: tsOn }; },
            async set(on) { window.__calls.push("ts:set:" + on); tsOn = on; return { ...ts, active: on }; },
          },` : ""}
        },
        update: {
          async status() { window.__calls.push("update:status"); return { ...st }; },
          async check() { window.__calls.push("update:check"); st.checkedAt = Date.now(); return { ...st }; },
          async install() {
            window.__calls.push("update:install");
            if (!st.installOk) return { ok: false, error: "could not start npx: spawn npx ENOENT" };
            st.installing = true; window.__updatePush && window.__updatePush({ ...st }); return { ok: true };
          },
          onAvailable(fn) { window.__updatePush = fn; },
        },
        openAtLogin: {
          async status() { window.__calls.push("login:status"); return { ...login, file: "~/Library/LaunchAgents/dev.reviewstage.desktop.plist" }; },
          async set(on) { window.__calls.push("login:set:" + on); login.enabled = on; return { ...login, file: null }; },
        },
      };
    `,
  });
}

const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);

test.describe("update banner (desktop app)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("a newer version shows one slim line; Restart to update calls install and says Restarting…", async ({ page }) => {
    await fakeBridge(page, { update: { current: "1.0.0-rc.31", latest: "1.0.0-rc.40", available: true } });
    await patchMe(page, { personal: true });
    await page.goto("/?tab=reviewed");
    const banner = page.getByTestId("update-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toHaveText(/ReviewStage 1\.0\.0-rc\.40 is available\s*·\s*Restart to update/);
    await banner.getByRole("button", { name: "Restart to update" }).click();
    await expect.poll(() => calls(page)).toContain("update:install");
    await expect(banner.getByTestId("update-install")).toHaveText("Restarting…");
    await expect(banner.getByTestId("update-install")).toBeDisabled();
  });

  test("a failed spawn is said in the banner and nothing else happens", async ({ page }) => {
    await fakeBridge(page, { update: { current: "1.0.0-rc.31", latest: "1.0.0-rc.40", available: true, installOk: false } });
    await patchMe(page, { personal: true });
    await page.goto("/?tab=reviewed");
    await page.getByTestId("update-install").click();
    await expect(page.getByTestId("update-error")).toHaveText("Couldn't start the update: could not start npx: spawn npx ENOENT");
    await expect(page.getByTestId("update-install")).toHaveText("Restart to update");
  });

  test("dismissed for this version only: a reload keeps it hidden, the next version shows it again", async ({ page }) => {
    await fakeBridge(page, { update: { current: "1.0.0-rc.31", latest: "1.0.0-rc.40", available: true } });
    await patchMe(page, { personal: true });
    await page.goto("/?tab=reviewed");
    await page.getByTestId("update-dismiss").click();
    await expect(page.getByTestId("update-banner")).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { name: /review queue/i })).toBeVisible();
    await expect(page.getByTestId("update-banner")).toHaveCount(0);
    await page.evaluate(() => (window as unknown as { __updatePush: (u: unknown) => void }).__updatePush({
      current: "1.0.0-rc.31", latest: "1.0.0-rc.41", available: true, checkedAt: Date.now(), error: null, dev: false, installing: false, installError: null,
    }));
    await expect(page.getByTestId("update-banner")).toContainText("1.0.0-rc.41");
  });

  test("no banner when up to date, and none at all in a browser", async ({ page }) => {
    await fakeBridge(page, { update: { current: "1.0.0-rc.40", latest: "1.0.0-rc.40", available: false } });
    await patchMe(page, { personal: true });
    await page.goto("/?tab=reviewed");
    await expect(page.getByRole("heading", { name: /review queue/i })).toBeVisible();
    await expect(page.getByTestId("update-banner")).toHaveCount(0);
  });
});

test.describe("Settings → Desktop app", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  const sections = (page: Page) => page.getByRole("navigation", { name: "Settings sections" });

  test("the section lists the version, checks now, shows the last check, and toggles open at login", async ({ page }) => {
    await fakeBridge(page, { update: { current: "1.0.0-rc.31", latest: "1.0.0-rc.40", available: true } });
    await patchMe(page, { personal: true });
    await page.goto("/settings#desktop");
    const card = page.locator("#desktop");
    await expect(card.getByRole("heading", { name: "Desktop app" })).toBeVisible();
    await expect(sections(page).getByRole("link", { name: "Desktop app" })).toHaveAttribute("aria-current", "page");
    // In the "This device" group, right after Your phone.
    await expect(sections(page).getByRole("link")).toHaveText([/Your phone/, /Desktop app/, /Appearance/, /Repositories/, /Poller/, /PR filters/, /Notifications/, /Webhooks/, /Devices/]);
    await expect(card.getByTestId("desktop-version")).toContainText("1.0.0-rc.31");
    await expect(card.getByTestId("desktop-version")).toContainText("1.0.0-rc.40 available");
    await expect(card.getByTestId("desktop-checked")).toHaveText("Checked at launch and every 6 hours. Last checked 10/05/26 09:41.");
    await card.getByTestId("desktop-check").click();
    await expect.poll(() => calls(page)).toContain("update:check");
    await expect(card.getByTestId("desktop-checked")).not.toContainText("10/05/26 09:41");
    await expect(card.getByTestId("desktop-install")).toHaveText("Restart to update");

    const sw = card.getByTestId("open-at-login");
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await card.getByText("Open at login", { exact: true }).click();
    await expect(sw).toHaveAttribute("aria-checked", "true");
    expect(await calls(page)).toContain("login:set:true");
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "false");
    expect(await calls(page)).toContain("login:set:false");
    await expect(page.getByTestId("settings-save")).toBeHidden(); // acts at once, never dirty
  });

  test("a development build says updates are off; a run not started by npx cannot turn on open at login", async ({ page }) => {
    await fakeBridge(page, { update: { current: "0.0.0-dev", latest: null, available: false, dev: true }, login: { supported: true, enabled: false, available: false } });
    await patchMe(page, { personal: true });
    await page.goto("/settings#desktop");
    const card = page.locator("#desktop");
    await expect(card.getByTestId("desktop-version")).toContainText("Development build");
    await expect(card.getByTestId("desktop-checked")).toContainText("this one runs from a checkout");
    await expect(card.getByTestId("desktop-install")).toHaveCount(0);
    await expect(card.getByTestId("open-at-login")).toBeDisabled();
    await expect(card).toContainText("Start ReviewStage with npx reviewstage to turn this on.");
  });

  test("absent in a browser and in team mode", async ({ page }) => {
    await patchMe(page, { personal: true });
    await page.goto("/settings#desktop");
    await expect(page.locator("#appearance")).toBeVisible();
    await expect(sections(page).getByRole("link", { name: "Desktop app" })).toHaveCount(0);

    const team = await page.context().newPage();
    await fakeBridge(team, { update: { current: "1.0.0", latest: "1.0.0", available: false } });
    await team.goto("/settings#desktop");
    await expect(team.locator("#appearance")).toBeVisible();
    await expect(team.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Desktop app" })).toHaveCount(0);
  });
});

test.describe("Settings → Your phone → Use Tailscale (F6)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("without Tailscale: one line and a link, no switch", async ({ page }) => {
    await fakeBridge(page, { tailscale: { installed: false, loggedIn: false, url: null } });
    await patchMe(page, { personal: true });
    await page.goto("/settings#phone");
    const row = page.getByTestId("phone-tailscale");
    await expect(row).toContainText("For an address that never changes, install Tailscale on this computer and your phone and sign in.");
    await expect(row.getByRole("link", { name: "Get Tailscale" })).toHaveAttribute("href", "https://tailscale.com/download");
    await expect(row.getByRole("switch")).toHaveCount(0);
  });

  test("signed in: the stable address and a switch that turns it on", async ({ page }) => {
    await fakeBridge(page, { tailscale: { installed: true, loggedIn: true, url: "https://anns-mbp.tail1234.ts.net" } });
    await patchMe(page, { personal: true });
    await page.goto("/settings#phone");
    const row = page.getByTestId("phone-tailscale");
    await expect(row).toContainText("https://anns-mbp.tail1234.ts.net");
    await row.getByRole("switch").click();
    await expect.poll(() => calls(page)).toContain("ts:set:true");
    await expect(row.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("phone-state")).toContainText("https://anns-mbp.tail1234.ts.net");
  });

  test("a desktop app older than this change shows no Tailscale row", async ({ page }) => {
    await fakeBridge(page, {});
    await patchMe(page, { personal: true });
    await page.goto("/settings#phone");
    await expect(page.locator("#phone")).toBeVisible();
    await expect(page.getByTestId("phone-tailscale")).toHaveCount(0);
  });
});

test.describe("Your Mac isn't reachable (F5)", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  for (const status of [530, 502, 503, 504]) {
    test(`/api/me answering ${status} is the full-screen state, never an error banner`, async ({ page }) => {
      await page.route("**/api/me", (r) => r.fulfill({ status, contentType: "text/html", body: "<h1>error code: 1033</h1>" }));
      await page.goto("/");
      const s = page.getByTestId("unreachable");
      await expect(s).toBeVisible();
      await expect(s.getByRole("heading", { name: "Your Mac isn't reachable" })).toBeVisible();
      await expect(s).toContainText("The phone reaches ReviewStage on your Mac. Open it there — or wake the Mac — and try again.");
      await expect(s).toContainText("If ReviewStage was restarted, open the newest link from your notifications or scan a new code.");
      await expect(page.getByText(/1033|error code/)).toHaveCount(0);
    });
  }

  test("no answer at all is the same state; Try again brings the app back when the Mac does", async ({ page }) => {
    await page.route("**/api/me", (r) => r.abort("connectionrefused"));
    await page.goto("/?tab=reviewed");
    await expect(page.getByTestId("unreachable")).toBeVisible();
    await page.unroute("**/api/me");
    await page.getByTestId("unreachable-retry").click();
    await expect(page.getByTestId("unreachable")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /review queue/i })).toBeVisible();
  });

  test("the queue failing with 530 after the shell loaded switches to the state too", async ({ page }) => {
    await page.route("**/api/queue**", (r) => r.fulfill({ status: 530, body: "error code: 1033" }));
    await page.goto("/?tab=reviewed");
    await expect(page.getByTestId("unreachable")).toBeVisible();
    await expect(page.getByTestId("queue-error")).toHaveCount(0);
  });

  test("a real refusal (a 500) is still an error banner, not this state", async ({ page }) => {
    await page.route("**/api/queue**", (r) => r.fulfill({ status: 500, json: { error: "boom" } }));
    await page.goto("/?tab=reviewed");
    await expect(page.getByTestId("queue-error")).toContainText("boom");
    await expect(page.getByTestId("unreachable")).toHaveCount(0);
  });

  test("while visible it retries by itself every 15 s", async ({ page }) => {
    await page.clock.install();
    let calls = 0;
    await page.route("**/api/me", (r) => (++calls <= 2 ? r.fulfill({ status: 530, body: "" }) : r.fallback()));
    await page.goto("/?tab=reviewed");
    await expect(page.getByTestId("unreachable")).toBeVisible();
    await page.clock.runFor(15_000);
    await expect.poll(() => calls).toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId("unreachable")).toBeVisible();
    await page.clock.runFor(15_000);
    await expect(page.getByTestId("unreachable")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /review queue/i })).toBeVisible();
  });
});
