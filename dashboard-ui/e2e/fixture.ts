// Builds a self-contained, offline fixture for the Playwright e2e run and mints a matching
// session cookie. Two repositories are configured so the repo dimension (chips, filter, picker)
// is exercised; state lives in the per-repo layout (state/<owner>__<name>/<pr>). Run standalone (`node e2e/fixture.mjs`) — the Playwright webServer runs it
// before booting the Python server, and global-setup runs it before the workers start, so the
// server always boots against a ready fixture regardless of Playwright's setup/webServer order.
// A FIXED (non-secret) test secret keeps the server's .env and the minted cookie in agreement.
import type { Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { chmodSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURE = join(HERE, ".fixture");
export const AUTH_STATE = join(HERE, ".auth.json");
export const SECRET = "e2e-fixed-test-secret-not-for-production";
export const USER = "acme-dev";
// A second signed-in user, used only by the Devices tests. "Sign out everywhere" bumps that
// user's credential epoch, which invalidates their session cookie as well as their device
// tokens — correct, and fatal to a shared fixture cookie, so those tests get their own.
export const DEVICES_USER = "acme-devices";
// A user who has never seen the guided tour. The flag lives on the user record now, so "first
// run" is a property of the account, not of the browser's localStorage — and the test that
// dismisses it really does write to the server, which is the whole point of the change.
export const TOUR_USER = "acme-tourist";
export const REPO = "acme/widgets";
export const REPO2 = "acme/api";
export const REPO3 = "acme/billing"; // its profile run failed — the Skills page error state
export const PR = "38849"; // in REPO
export const PR2 = "38850"; // in REPO — dedicated archive-test target — no other test touches it
export const PR3 = "7"; // in REPO2
export const PR4 = "38851"; // in REPO — a review of this one is permanently "in flight"
export const PR5 = "38852"; // in REPO — merged on GitHub, posted here: the dead-PR row
// The stack: PR (#38849) is the parent of PR2 (#38850). PR3 lives in REPO2, whose fake gh
// answers nothing, so it is the un-stacked case.
// The timestamp of the one earlier profile version the fixture ships for REPO.
export const PROFILE_V1 = 1777900000;
export const BRANCH = "lead-time-badge";
export const BRANCH2 = "cache-lead-times";
export const PORT = 8988;

const slug = (repo: string) => repo.replace("/", "__");

function write(path: string, body: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

/** A QA guide with a GFM task list — the list a tester is meant to work through. */
export const QA_MD = [
  "# QA guide",
  "",
  "## P0 — must pass",
  "",
  "- [ ] Open a product card for a vendor with no lead time",
  "- [x] Confirm the badge is hidden rather than blank",
  "",
].join("\n");

export function buildFixture() {
  rmSync(FIXTURE, { recursive: true, force: true });
  mkdirSync(FIXTURE, { recursive: true });

  write(
    join(FIXTURE, ".env"),
    [
      `RS_SECRET=${SECRET}`,
      `REVIEWER=${USER}`,
      `REPOS=${REPO},${REPO2},${REPO3}`,
      "DRY_RUN=1",
      "PUBLIC_URL=https://reviewstage.example.com",
      "GITHUB_PAT=ghp_e2e_dummy_never_used",
      "GH_DEVICE_FLOW=0", // the device-flow specs stub /api/auth/device/* and rewrite /api/me
    ].join("\n") + "\n",
  );

  write(
    join(FIXTURE, "users.json"),
    JSON.stringify({
      // tour_seen lives on the user record now (it was per browser). The default fixture user
      // has already seen it, so it does not cover every page; the first-run specs rewrite
      // /api/me to say otherwise.
      [USER]: {
        name: "Acme Dev", slack_id: "U0TEST", discord_id: "4242",
        added: 1, updated: 1, tour_seen: true,
      },
      [DEVICES_USER]: { name: "Acme Devices", added: 1, updated: 1, tour_seen: true },
      [TOUR_USER]: { name: "Acme Tourist", added: 1, updated: 1 },
    }),
  );

  // Already in the per-repo layout: nothing for the server to migrate.
  write(join(FIXTURE, "MIGRATED"), JSON.stringify({ at: 1, note: "e2e fixture" }) + "\n");

  // Discovery has completed a cycle here — /api/me reports poller_ran from this file, and the
  // new-install setup state depends on it. The specs that want a fresh install say so by
  // rewriting /api/me.
  write(join(FIXTURE, "poller.last"), "1778000000\n");

  write(
    join(FIXTURE, "queue.json"),
    JSON.stringify([
      {
        repo: REPO,
        number: Number(PR),
        title: "Add lead-time badge to product cards",
        url: `https://github.com/${REPO}/pull/${PR}`,
        additions: 42,
        deletions: 8,
        changedFiles: 5,
        requested: [USER],
        author: "teammate",
        isBot: false,
        isDraft: false,
        head: "deadbeefcafe",
        createdAt: "2026-05-01T10:00:00Z",
        updatedAt: "2026-05-02T10:00:00Z",
      },
      {
        repo: REPO,
        number: Number(PR2),
        title: "Cache vendor lead times",
        url: `https://github.com/${REPO}/pull/${PR2}`,
        additions: 12,
        deletions: 3,
        changedFiles: 2,
        requested: [USER],
        author: "teammate",
        isBot: false,
        isDraft: false,
        head: "feedfacecafe",
        createdAt: "2026-05-03T10:00:00Z",
        updatedAt: "2026-05-04T10:00:00Z",
      },
      {
        repo: REPO,
        number: Number(PR4),
        title: "Retry the vendor sync on a 502",
        url: `https://github.com/${REPO}/pull/${PR4}`,
        additions: 20,
        deletions: 2,
        changedFiles: 1,
        requested: [USER],
        author: "teammate",
        isBot: false,
        isDraft: false,
        head: "abadcafe1234",
        createdAt: "2026-05-07T10:00:00Z",
        updatedAt: "2026-05-08T10:00:00Z",
      },
      {
        repo: REPO2,
        number: Number(PR3),
        title: "Rate-limit the lead-time endpoint",
        url: `https://github.com/${REPO2}/pull/${PR3}`,
        additions: 30,
        deletions: 4,
        changedFiles: 3,
        requested: [USER],
        author: "teammate",
        isBot: false,
        isDraft: false,
        head: "0badf00dcafe",
        createdAt: "2026-05-05T10:00:00Z",
        updatedAt: "2026-05-06T10:00:00Z",
      },
    ]),
  );

  // A review of PR4 that never finishes: a status line the server reads as in-progress and
  // no lock or pid. rs_state calls such a run live while its status file is younger than
  // STARTUP_GRACE (90 s) — so the mtime is stamped an hour ahead and it stays "reviewing" for
  // the whole Playwright run instead of aging into "stalled" mid-suite.
  const running = join(FIXTURE, "state", slug(REPO), PR4, "users", USER, "status");
  write(running, "reviewing the diff");
  const ahead = new Date(Date.now() + 3600_000);
  utimesSync(running, ahead, ahead);

  // A PR that was merged on GitHub after it was reviewed and posted here. It is no longer in
  // queue.json — rs_queue.done() removes it — so the row is rebuilt from the meta.json
  // mark_closed() persisted, which is where prState/merged come from.
  write(
    join(FIXTURE, "state", slug(REPO), PR5, "meta.json"),
    JSON.stringify({
      number: Number(PR5),
      title: "Ship the lead-time cache warmer",
      url: `https://github.com/${REPO}/pull/${PR5}`,
      additions: 60,
      deletions: 11,
      changedFiles: 4,
      author: "teammate",
      head: "5eaf00d5eaf0",
      createdAt: "2026-04-20T10:00:00Z",
      updatedAt: "2026-04-28T10:00:00Z",
      state: "merged",
      merged: true,
    }),
  );
  write(join(FIXTURE, "state", slug(REPO), PR5, "status"), "done");
  write(
    join(FIXTURE, "state", slug(REPO), PR5, "review.json"),
    JSON.stringify({
      event: "COMMENT",
      summary: "Warms the lead-time cache on boot. Nothing blocking.",
      explainer: "",
      analysis: "",
      comments: [],
    }),
  );
  write(
    join(FIXTURE, "state", slug(REPO), PR5, "users", USER, "review.json"),
    JSON.stringify({ event: "COMMENT", summary: "Nothing blocking.", comments: [] }),
  );
  write(
    join(FIXTURE, "state", slug(REPO), PR5, "users", USER, "posted.json"),
    JSON.stringify({ at: 1778000200, inline: 0, event: "COMMENT" }),
  );

  write(join(FIXTURE, "state", slug(REPO2), PR3, "status"), "done");
  write(
    join(FIXTURE, "state", slug(REPO2), PR3, "review.json"),
    JSON.stringify({
      event: "COMMENT",
      summary: "Adds a token bucket in front of the lead-time endpoint. One blocker.",
      keyPoints: ["The limiter key ignores the tenant, so one tenant can starve another."],
      explainer: "",
      analysis: "",
      comments: [
        {
          path: "api/limits.py",
          line: 18,
          severity: "blocker",
          title: "Two tenants share one rate-limit bucket",
          impact: "A busy tenant can lock a quiet tenant out of lead times entirely.",
          body: "Key the bucket on (tenant, api_key), not api_key alone.",
          reply_to: null,
          suggestion: "",
        },
      ],
    }),
  );

  write(join(FIXTURE, "state", slug(REPO), PR2, "status"), "done");
  write(
    join(FIXTURE, "state", slug(REPO), PR2, "review.json"),
    JSON.stringify({
      event: "COMMENT",
      summary: "Caches vendor lead times. Looks fine.",
      explainer: "",
      analysis: "",
      comments: [],
    }),
  );

  write(join(FIXTURE, "state", slug(REPO), PR, "status"), "done");
  write(
    join(FIXTURE, "state", slug(REPO), PR, "review.json"),
    JSON.stringify({
      event: "COMMENT",
      summary: "Adds a lead-time badge to product cards. Logic is sound; two small things.",
      keyPoints: [
        "The badge logic is sound — no blockers.",
        "Guard a null vendor before reading its lead time.",
        "One nit: prefer const over let in the badge component.",
      ],
      explainer: "A COMMENT review — nothing here blocks the merge.",
      analysis: "",
      comments: [
        {
          path: "app/models/Product.php",
          line: 42,
          severity: "should-fix",
          title: "A product with no vendor can crash the lead-time badge",
          impact: "A shopper viewing such a product would see the card fail instead of loading.",
          body: "Guard against a null vendor before reading its lead time.",
          reply_to: null,
          suggestion: "if ($vendor === null) return null;",
        },
        {
          path: "src/javascripts/Badge.tsx",
          line: 10,
          severity: "nit",
          title: "Use const instead of let",
          impact: "Style only — no effect on behavior.",
          body: "Prefer `const` over `let` here.",
          reply_to: null,
          suggestion: "",
        },
      ],
    }),
  );

  // A QA guide on disk whose last regenerate failed. The server keeps the state at "done" —
  // a bad attempt must never hide a good guide — and reports the failure alongside, with the
  // agent's own last words in qa_agent.log.
  write(join(FIXTURE, "state", slug(REPO), PR2, "qa.md"), QA_MD);
  write(
    join(FIXTURE, "state", slug(REPO), PR2, "qa_meta.json"),
    JSON.stringify({ title: "Cache vendor lead times", url: `https://github.com/${REPO}/pull/${PR2}` }),
  );
  write(
    join(FIXTURE, "state", slug(REPO), PR2, "qa.status"),
    "failed: the guide is incomplete — missing the P1 section",
  );
  write(
    join(FIXTURE, "state", slug(REPO), PR2, "qa_agent.log"),
    ["reading the diff…", "error: the model stopped mid-section", ""].join("\n"),
  );
  write(
    join(FIXTURE, "state", slug(REPO), PR2, "qa_usage.json"),
    JSON.stringify({
      model: "claude-sonnet-4-5",
      input_tokens: 24000,
      output_tokens: 3100,
      cache_read_input_tokens: 1200,
      cost_usd: 0.14,
      duration_ms: 92000,
    }),
  );

  // A repository profile for REPO so the Skills page's "Repository profile" section renders as
  // profiled (status line, counts, editor) — REPO2 stays "never run".
  const profile = {
    summary: "A storefront: product cards read vendor lead times; payments and auth are the sharp edges.",
    critical_paths: [
      {
        path_glob: "app/payments/**",
        why: "Charges real cards; a silent bug double-bills or under-bills a shopper.",
        checks: ["Every amount is in minor units end to end", "Refund paths mirror the charge path"],
      },
      {
        path_glob: "app/models/Product.php",
        why: "Every product card and order line reads this model.",
        checks: ["Callers handle a null vendor", "Lead-time cache is invalidated on vendor change"],
      },
    ],
    risk_paths: [
      { label: "payments", pattern: "app/payments/" },
      { label: "auth", pattern: "app/auth/" },
    ],
    review_rules: ["Money is always integer cents; flag any float arithmetic on amounts."],
    do_not_flag: ["The committed pnpm-lock.yaml is intentional."],
    meta: {
      generated_at: 1778000000,
      model: "claude-sonnet-4-5",
      dropped_globs: ["app/billing/**"],
      head: "deadbeefcafe0000",
      edited_at: null,
      edited_by: "",
    },
  };
  write(join(FIXTURE, "profiles", slug(REPO), "profile.json"), JSON.stringify(profile, null, 1) + "\n");
  write(
    join(FIXTURE, "profiles", slug(REPO), "profile.md"),
    [
      "# Repository profile",
      "",
      "## Summary",
      "",
      profile.summary,
      "",
      "## Critical paths",
      "",
      ...profile.critical_paths.flatMap((cp) => [
        `### \`${cp.path_glob}\``,
        "",
        `Why: ${cp.why}`,
        "",
        ...cp.checks.map((c) => `- check: ${c}`),
        "",
      ]),
      "## Risk paths",
      "",
      ...profile.risk_paths.map((r) => `- ${r.label}: ${r.pattern}`),
      "",
      "## Review rules",
      "",
      ...profile.review_rules.map((r) => `- ${r}`),
      "",
      "## Do not flag",
      "",
      ...profile.do_not_flag.map((r) => `- ${r}`),
      "",
    ].join("\n"),
  );
  // One earlier version on disk, so the "N earlier versions" the card counts is reachable
  // without a save first: save_profile keeps the profile it replaces as profile.<ts>.json.
  write(
    join(FIXTURE, "profiles", slug(REPO), `profile.${PROFILE_V1}.json`),
    JSON.stringify(
      {
        ...profile,
        review_rules: ["Money is always integer cents."],
        do_not_flag: [],
        meta: { ...profile.meta, generated_at: PROFILE_V1 },
      },
      null,
      1,
    ) + "\n",
  );
  write(join(FIXTURE, "profiles", slug(REPO), "status"), "done");
  write(join(FIXTURE, "profiles", slug(REPO), "runner"), USER);
  write(
    join(FIXTURE, "profiles", slug(REPO), "usage.json"),
    JSON.stringify({
      model: "claude-sonnet-4-5",
      input_tokens: 9120,
      output_tokens: 1840,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      cost_usd: 0.055,
      duration_ms: 48000,
    }),
  );

  // A base clone for REPO. Without one nothing can compare the profile's meta.head against a
  // real tree, and the server correctly answers "cannot tell" rather than "fresh" — so the
  // stale badge is only reachable with a checkout on the box. Its HEAD is a real commit and the
  // profile's stored head is not, which is exactly the drift the badge is for. Every critical
  // path glob still matches a tracked file, so saving an edit drops nothing.
  const base = join(FIXTURE, "repos", slug(REPO));
  for (const f of [
    "README.md",
    "app/models/Product.php",
    "app/payments/charge.php",
    "app/payments/refund.php",
    "app/auth/session.php",
    "src/javascripts/Badge.tsx",
    "src/javascripts/Card.tsx",
    "api/limits.py",
    "docs/overview.md",
    "package.json",
  ]) {
    write(join(base, f), `// ${f}\n`);
  }
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", base, ...args], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "e2e", GIT_AUTHOR_EMAIL: "e2e@example.com",
        GIT_COMMITTER_NAME: "e2e", GIT_COMMITTER_EMAIL: "e2e@example.com",
      },
      stdio: "ignore",
    });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-qm", "e2e base clone");

  // REPO3's last profile run failed before the model answered anything usable: a status line
  // beginning "failed:" and an agent.log holding the CLI error (state failed, log tail, Retry).
  write(
    join(FIXTURE, "profiles", slug(REPO3), "status"),
    `failed: the model produced no result (see ${join(FIXTURE, "profiles", slug(REPO3), "agent.log")})`,
  );
  write(
    join(FIXTURE, "profiles", slug(REPO3), "agent.log"),
    ["error: unknown option '---'", "", "(Did you mean --add-dir?)", ""].join("\n"),
  );

  // Learnings: four drops of the same complaint across three PRs — enough evidence for one
  // rule suggestion on the Skills page. The proposal is pre-cached (keyed by the cluster
  // signature rs_learn computes, asked for here rather than hard-coded) so the page renders a
  // drafted sentence with no Claude account and no model call.
  const drops = [
    ["38849", "Prefer const over let for this binding"],
    ["38850", "Use const rather than let here — the binding is never reassigned"],
    ["38851", "Prefer a const binding over let in the badge component"],
    ["38851", "This let is never reassigned; a const binding would be preferable"],
  ];
  write(
    join(FIXTURE, "learnings.jsonl"),
    drops
      .map(([pr, gist], i) =>
        JSON.stringify({
          at: 1778000000 + i,
          repo: REPO,
          pr,
          user: USER,
          skill: "global",
          path: "src/javascripts/Badge.tsx",
          line: 10 + i,
          severity: "nit",
          gist,
          outcome: "dropped",
        }),
      )
      .join("\n") + "\n",
  );
  const sig = execFileSync(
    "python3",
    ["-c", "import rs_learn; print(rs_learn.clusters('dropped')[0]['signature'])"],
    { cwd: join(HERE, "..", "..", "bin"), env: { ...process.env, ROOT: FIXTURE } },
  )
    .toString()
    .trim();
  write(
    join(FIXTURE, "rule_proposals.json"),
    JSON.stringify(
      {
        [sig]: {
          rule: "Do not raise const-over-let style nits; the linter owns that.",
          rationale: "Dropped four times across three PRs — the team has never wanted it.",
          at: 1778000100,
          model: "haiku",
        },
      },
      null,
      1,
    ) + "\n",
  );

  // Fake gh: every call fails, so gh_json() returns its defaults and the server renders from
  // the on-disk fixture — except the files API for PR, which answers a one-file diff so the
  // server can work out which findings can be anchored inline. Product.php:42 is inside the
  // hunk; Badge.tsx is not in the PR at all, so its finding is an "in summary" one.
  const files = [
    [
      {
        filename: "app/models/Product.php",
        status: "modified",
        patch: "@@ -40,3 +40,4 @@\n ctx\n+$leadTime = $vendor->leadTime();\n ctx2\n ctx3\n",
      },
    ],
  ];
  // The open PRs of REPO, as `gh pr list --json number,title,baseRefName,headRefName,url`
  // answers them: #38849 (main <- lead-time-badge) is the parent of #38850. REPO2 answers
  // nothing, so its PRs are the un-stacked case.
  const openPrs = [
    { number: Number(PR), title: "Add lead-time badge to product cards", baseRefName: "main",
      headRefName: BRANCH, url: `https://github.com/${REPO}/pull/${PR}` },
    { number: Number(PR2), title: "Cache vendor lead times", baseRefName: BRANCH,
      headRefName: BRANCH2, url: `https://github.com/${REPO}/pull/${PR2}` },
  ];
  const gh = join(FIXTURE, "fakebin", "gh");
  write(
    gh,
    [
      "#!/bin/sh",
      `case "$*" in`,
      `  *"pulls/${PR}/files"*) cat <<'RSJSON'`,
      JSON.stringify(files),
      "RSJSON",
      "  exit 0;;",
      `  *"pr list"*"--repo ${REPO}"*baseRefName*) cat <<'RSSTACK'`,
      JSON.stringify(openPrs),
      "RSSTACK",
      "  exit 0;;",
      "esac",
      "exit 1",
      "",
    ].join("\n"),
  );
  chmodSync(gh, 0o755);
}

export const ORIGIN = `http://127.0.0.1:${PORT}`;

// A signed session cookie, the shape Playwright's storageState wants. `epoch` is the user's
// credential counter and is inside the HMAC (server.py session_sig) so that "Sign out
// everywhere" can invalidate outstanding cookies; a fixture user that has never bumped it is
// at 0.
export function sessionCookie(login = USER, epoch = 0) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const sig = createHmac("sha256", SECRET)
    .update(`session:${login}:${exp}:${epoch}`)
    .digest("hex");
  return {
    name: "rs_session",
    value: `${login}:${exp}:${sig}`,
    domain: "127.0.0.1",
    path: "/",
    expires: exp,
    httpOnly: true,
    secure: false,
    sameSite: "Lax" as const,
  };
}

// The default storage state: signed in as a user whose record already says the guided tour was
// dismissed, so it does not cover the page in every test. The first-run spec signs in as
// TOUR_USER instead, who has never seen it.
export function mintAuthState() {
  writeFileSync(AUTH_STATE, JSON.stringify({ cookies: [sessionCookie()], origins: [] }));
}

// Standalone invocation (from the webServer command).
if (process.argv[1] && process.argv[1]?.endsWith("fixture.ts")) {
  buildFixture();
  mintAuthState();
  console.log("e2e fixture built at", FIXTURE);
}

// ---- helpers for specs that need a state the on-disk fixture cannot produce ----------------
// The fixture has no Claude token (nothing in this suite may reach Anthropic) and its poller has
// run, so the QA generate button and the unconfigured-install queue are only reachable by
// rewriting the server's answer. Everything else in the suite runs against the real server.

/** Merge `patch` into whatever /api/me answers. */
export async function patchMe(page: Page, patch: Record<string, unknown>) {
  await patchJson(page, "**/api/me", patch);
}

/**
 * Merge a patch into whatever the real server answers for `glob`, leaving everything else
 * intact. For the handful of states the offline fixture cannot produce — a review replaced
 * between render and post, a branch that moved, a Claude account this suite must never have —
 * where the point of the test is what the page does with the field, not how it was computed.
 * `patch` may be a function so it can read the real body first.
 */
export async function patchJson(
  page: Page,
  glob: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  patch: Record<string, unknown> | ((body: any) => Record<string, unknown>),
) {
  await page.route(glob, async (route) => {
    const r = await route.fetch();
    const body = await r.json();
    const extra = typeof patch === "function" ? patch(body) : patch;
    await route.fulfill({ response: r, json: { ...body, ...extra } });
  });
}
