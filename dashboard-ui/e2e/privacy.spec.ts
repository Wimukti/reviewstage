// Zero-by-default telemetry (openspec/changes/p0-proof/lane1-telemetry.md): through a whole
// keep / drop / post flow and the Privacy controls, NOT ONE request leaves the browser for any
// origin but the fixture server — and the server itself reports `no_consent`. The fixture has
// no RS_TELEMETRY_ENDPOINT, so even consenting changes nothing on the wire.
//
// Run from dashboard-ui: RS_E2E_PORT=4474 pnpm test:browser e2e/privacy.spec.ts
import { expect, test, type Page } from "@playwright/test";
import { PORT, PR, REPO } from "./fixture";

const ORIGIN = `http://127.0.0.1:${PORT}`;
const enc = encodeURIComponent;
const prPath = (repo: string, num: string) => `/pr?repo=${enc(repo)}&pr=${num}`;

async function settled(page: Page) {
  await expect(page.getByTestId("pr-loading")).toHaveCount(0, { timeout: 15_000 });
}

// The one thing the browser fetches from anywhere else: reviewer and repository avatars, as
// <img> loads from GitHub — the party the person already signed in with. Images only; a
// script, XHR or fetch to these hosts would still be egress.
const AVATAR_HOSTS = new Set(["github.com", "avatars.githubusercontent.com"]);

/** Every request whose origin is not the fixture server (data: and blob: never count). */
function watchEgress(page: Page) {
  const foreign: string[] = [];
  page.on("request", (r) => {
    const u = r.url();
    if (u.startsWith("data:") || u.startsWith("blob:") || u.startsWith("about:")) return;
    if (u.startsWith(ORIGIN)) return;
    if (r.resourceType() === "image" && AVATAR_HOSTS.has(new URL(u).hostname) && /\.png(\?|$)|\/u\/\d+/.test(u)) return;
    foreign.push(u);
  });
  return foreign;
}

// Same-origin fetch from the page itself, so the session cookie rides along (the Playwright
// request context does not send the fixture's Secure cookie over plain http).
async function apiJson(page: Page, path: string, body?: unknown): Promise<any> {
  return page.evaluate(
    async ([p, b]) => {
      const r = await fetch(p as string, b === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
      return r.json();
    },
    [path, body] as const,
  );
}

// Stubbed, like pr-page.spec.ts: a real dry-run post records learnings that the Learnings and
// Insights specs count. The server-side counters on the post path are proven in
// bin/test_rs_telemetry.py (ServerHooks), with urlopen replaced by a function that raises.
const DRY_RUN_BANNER =
  "<div class='banner warn'><span class='status is-amber' aria-hidden='true'><i></i></span>" +
  "<div><b>DRY RUN — nothing was sent to GitHub.</b><br>Your review would post as <code>COMMENT</code> — " +
  "1 inline comment. Set <code>DRY_RUN=0</code> and restart the <code>reviewstage</code> service to post for real.</div></div>";

test.describe.configure({ mode: "serial" });

test.afterEach(async ({ page }) => {
  // Leave the shared fixture as it was: consent off. (The phone test used its own context, so
  // this page may still be about:blank — give the fetch an origin first.)
  if (page.url() === "about:blank") await page.goto("/settings#privacy");
  await apiJson(page, "/api/telemetry/consent", { consented: false });
});

test("keep / drop / post, then Settings → Privacy and Export: no request leaves the fixture origin", async ({ page }) => {
  const foreign = watchEgress(page);
  await page.route("**/api/post", (route) => route.fulfill({ json: { bannerHtml: DRY_RUN_BANNER } }));

  await page.goto(prPath(REPO, PR));
  await settled(page);
  const cards = page.locator(".finding");
  await expect(cards).toHaveCount(2);
  // keep the first as is, drop the second, post
  await cards.nth(1).getByTestId("finding-select").uncheck();
  await expect(page.getByTestId("commit-bar")).toContainText("1 staged");
  await page.getByTestId("commit-bar").getByRole("button", { name: /post selected/i }).click();
  await expect(page.locator(".banner.warn")).toContainText(/dry run/i);

  // The Privacy section: state, reason, the schema, and the controls.
  await page.goto("/settings#privacy");
  const card = page.getByTestId("privacy-card");
  await expect(card).toBeVisible();
  await expect(card.getByTestId("telemetry-state")).toHaveAttribute("data-state", "no_consent");
  await expect(card.getByTestId("telemetry-reason")).toContainText("not opted in");
  await expect(card.getByTestId("telemetry-consent")).not.toBeChecked();
  await expect(card.getByTestId("telemetry-schema-table")).toContainText("review_started");
  await expect(card.getByTestId("telemetry-never")).toContainText("repository names");
  await expect(card.getByTestId("telemetry-endpoint")).toContainText("No endpoint is configured");
  await card.getByTestId("telemetry-view-queued").click();
  await expect(card.getByTestId("telemetry-queued")).toContainText('"outbox": []');
  await expect(card.getByTestId("telemetry-export")).toHaveAttribute("href", "/api/telemetry/export");

  // Export is a real download of the three files, from the fixture origin.
  const exported = await page.evaluate(async () => {
    const r = await fetch("/api/telemetry/export");
    return { ok: r.ok, status: r.status, disposition: r.headers.get("content-disposition") || "", body: await r.json() };
  });
  expect(exported.ok, `${exported.status}`).toBe(true);
  expect(exported.disposition).toContain("reviewstage-telemetry.json");
  const bundle = exported.body;
  expect(bundle.state).toBe("no_consent");
  expect(bundle.consent.consented).toBe(false);
  expect(bundle.outbox).toEqual([]);

  // The server agrees, and nothing left.
  const t = await apiJson(page, "/api/telemetry");
  expect(t.state).toBe("no_consent");
  expect(t.endpointSet).toBe(false);
  expect(t.outbox).toEqual([]);
  expect(foreign, `requests to other origins: ${foreign.join(", ")}`).toEqual([]);
});

test("consent on: the state becomes no_endpoint, still nothing leaves; Clear and revoke work", async ({ page }) => {
  const foreign = watchEgress(page);
  await page.goto("/settings#privacy");
  const card = page.getByTestId("privacy-card");
  await card.getByTestId("telemetry-consent").click();
  await expect(card.getByTestId("telemetry-consent")).toBeChecked();
  await expect(card.getByTestId("telemetry-state")).toHaveAttribute("data-state", "no_endpoint");
  await expect(card.getByTestId("telemetry-reason")).toContainText("no endpoint is configured");
  let t = await apiJson(page, "/api/telemetry");
  expect(t.consented).toBe(true);
  expect(t.state).toBe("no_endpoint");

  // Clear asks first, then empties the store.
  page.once("dialog", (d) => d.accept());
  await card.getByTestId("telemetry-clear").click();
  await expect(card.getByText("0 days on this machine, 0 events in all")).toBeVisible();
  t = await apiJson(page, "/api/telemetry");
  expect(t.counters).toEqual({});
  expect(t.outbox).toEqual([]);

  // Revocable: the switch goes off and the install id is gone with it.
  await card.getByTestId("telemetry-consent").click();
  await expect(card.getByTestId("telemetry-state")).toHaveAttribute("data-state", "no_consent");
  const bundle = await apiJson(page, "/api/telemetry/export");
  expect(bundle.consent.consented).toBe(false);
  expect(bundle.consent.install_id).toBeNull();
  expect(foreign, `requests to other origins: ${foreign.join(", ")}`).toEqual([]);
});

test("the admin's server-wide switch disables telemetry for everyone and locks the consent switch", async ({ page }) => {
  await page.goto("/settings#privacy");
  const card = page.getByTestId("privacy-card");
  // The fixture user is REVIEWER, so the admin row is live and goes through the save bar.
  const admin = card.getByTestId("telemetry-admin");
  await expect(admin).toBeChecked();
  await admin.click();
  await expect(page.getByTestId("settings-dirty")).toBeVisible();
  const saved = page.waitForResponse((r) => r.url().endsWith("/api/settings") && r.request().method() === "PUT");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect((await (await saved).json()).settings.telemetry_enabled).toBe(false);
  // The section re-reads its state on the next load.
  await page.reload();
  await expect(card.getByTestId("telemetry-state")).toHaveAttribute("data-state", "disabled_by_admin");
  await expect(card.getByTestId("telemetry-locked")).toContainText("admin disabled telemetry");
  await expect(card.getByTestId("telemetry-consent")).toBeDisabled();
  // Put it back.
  await card.getByTestId("telemetry-admin").click();
  const restored = page.waitForResponse((r) => r.url().endsWith("/api/settings") && r.request().method() === "PUT");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect((await (await restored).json()).settings.telemetry_enabled).toBe(true);
  await page.reload();
  await expect(card.getByTestId("telemetry-state")).toHaveAttribute("data-state", "no_consent");
});

test("the phone reaches the section from the You tab", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: "./e2e/.auth.json" });
  const page = await ctx.newPage();
  await page.goto("/you");
  await page.getByRole("link", { name: /^Privacy/ }).click();
  await expect(page).toHaveURL(/\/you\/privacy$/);
  await expect(page.getByTestId("privacy-card")).toBeVisible();
  await expect(page.getByTestId("telemetry-state")).toHaveAttribute("data-state", "no_consent");
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: Math.round(window.visualViewport?.width ?? window.innerWidth),
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
  await ctx.close();
});
