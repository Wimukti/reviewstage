// The consent card and the Privacy section (openspec/changes/p0-proof/lane1-telemetry.md):
// both list the exact shipped schema and the never-list, the card offers two equal choices with
// "Keep it local" first, and the section states the decision and why. Rendered with
// react-dom/server, so no browser and no API: PrivacyRows takes its data as a prop.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Me, TelemetryData } from "./api";
import { ConsentCard, EVENT_ROWS, NEVER, PrivacyRows, TelemetrySchema } from "./Privacy";
import { welcomeRedirect, welcomeStep } from "./welcomeFlow";

const me: Me = {
  authed: true, login: "acme-solo", brand: "ReviewStage", dry_run: true, repo: "", repos: ["acme/api"],
  allowOrg: "", oauth: false, personal: true, telemetry_decided: false,
};

const base: TelemetryData = {
  state: "no_consent", reason: "Off: you have not opted in. Counters stay on this machine.",
  consented: false, decided: false, counters: { "2026-10-10": { findings_kept: 2, "post_attempted|dry=1": 1 } },
  outbox: [], endpointSet: false, adminDisabled: false, killSwitch: false,
  schema: {}, derived: ["return_7d", "return_28d"],
};

// The schema the server ships (bin/rs_telemetry.py SCHEMA). The card must name every class.
const SHIPPED = [
  "install_completed", "connect_result", "review_started", "review_completed", "run_duration_bucket",
  "findings_shown", "findings_kept", "findings_edited", "findings_dropped", "dismissal_reason",
  "post_attempted", "post_succeeded", "return_7d", "return_28d",
];

test("the schema table names every shipped event class and the never-list", () => {
  const html = renderToStaticMarkup(createElement(TelemetrySchema, { endpointSet: false }));
  for (const ev of SHIPPED) assert.match(html, new RegExp(ev), ev);
  for (const n of NEVER) assert.ok(html.includes(n.replace(/'/g, "&#x27;")), n);
  assert.match(html, /No endpoint is configured on this server — nothing is sent either way/);
  assert.equal(EVENT_ROWS.length, 10);
  const withEndpoint = renderToStaticMarkup(createElement(TelemetrySchema, { endpointSet: true }));
  assert.match(withEndpoint, /An endpoint is configured on this server/);
});

test("the consent card: two equal choices, Keep it local first and focused, the schema inline", () => {
  const html = renderToStaticMarkup(createElement(ConsentCard, { me, onDone: () => {} }));
  assert.match(html, /data-testid="welcome-privacy"/);
  const local = html.indexOf('data-testid="telemetry-keep-local"');
  const share = html.indexOf('data-testid="telemetry-share"');
  assert.ok(local > 0 && share > local, "Keep it local is the first button");
  assert.match(html, /autofocus=""[^>]*data-testid="telemetry-keep-local"|data-testid="telemetry-keep-local"[^>]*autofocus/i);
  assert.match(html, />Keep it local</);
  assert.match(html, />Share anonymous product events</);
  // Both are the same variant: neither is the primary call to action.
  const variants = [...html.matchAll(/data-variant="([a-z]+)"[^>]*data-testid="telemetry-(keep-local|share)"/g)].map((m) => m[1]);
  assert.deepEqual(variants, ["outline", "outline"]);
  assert.match(html, /data-testid="telemetry-schema-table"/);
  for (const ev of SHIPPED) assert.match(html, new RegExp(ev), ev);
  assert.match(html, /off unless you say otherwise/);
  assert.match(html, /Settings → Privacy/);
});

test("the Privacy section states the decision and why, and carries every control", () => {
  const html = renderToStaticMarkup(createElement(PrivacyRows, { initial: base }));
  assert.match(html, /data-testid="telemetry-state"[^>]*data-state="no_consent"|data-state="no_consent"[^>]*data-testid="telemetry-state"/);
  assert.match(html, /Off: you have not opted in/);
  assert.match(html, /data-testid="telemetry-consent"/);
  assert.match(html, /data-testid="telemetry-view-queued"/);
  assert.match(html, /data-testid="telemetry-export"[^>]*href="\/api\/telemetry\/export"|href="\/api\/telemetry\/export"[^>]*data-testid="telemetry-export"/);
  assert.match(html, /data-testid="telemetry-clear"/);
  assert.match(html, /1 day on this machine, 3 events in all/);
  assert.match(html, /data-testid="telemetry-schema-table"/);
});

test("the consent switch is locked, with the reason, under the kill switch and the admin switch", () => {
  const killed = renderToStaticMarkup(createElement(PrivacyRows, { initial: { ...base, state: "killed", reason: "Off: RS_TELEMETRY=0 is set on this server.", killSwitch: true } }));
  assert.match(killed, /Off: RS_TELEMETRY=0/);
  assert.match(killed, /Locked off by <code>RS_TELEMETRY=0<\/code>/);
  assert.match(killed, /data-testid="telemetry-consent"[^>]*disabled|disabled[^>]*data-testid="telemetry-consent"/);
  const admin = renderToStaticMarkup(createElement(PrivacyRows, { initial: { ...base, state: "disabled_by_admin", adminDisabled: true } }));
  assert.match(admin, /Locked off: the admin disabled telemetry/);
  const active = renderToStaticMarkup(createElement(PrivacyRows, { initial: { ...base, state: "active", consented: true, endpointSet: true } }));
  assert.match(active, />Sharing</);
  const adminRow = renderToStaticMarkup(createElement(PrivacyRows, { initial: base, adminRow: createElement("div", { "data-testid": "admin-row" }) }));
  assert.match(adminRow, /data-testid="admin-row"/);
});

test("the wizard asks the question once, after the repositories step, and never on older servers", () => {
  assert.equal(welcomeStep("/welcome/privacy"), 3);
  assert.equal(welcomeStep("/welcome/repos"), 2);
  assert.equal(welcomeRedirect(me, "/"), "/welcome/privacy");
  assert.equal(welcomeRedirect({ ...me, telemetry_decided: true }, "/"), null);
  assert.equal(welcomeRedirect({ ...me, telemetry_decided: undefined }, "/"), null, "older server: no flag, no card");
  assert.equal(welcomeRedirect({ ...me, repos: [] }, "/"), "/welcome", "setup comes first");
  assert.equal(welcomeRedirect({ ...me, personal: false }, "/"), null, "team mode never prompts");
  assert.equal(welcomeRedirect(me, "/welcome/privacy"), null, "already there");
});
