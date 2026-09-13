// Builds a self-contained, offline fixture for the Playwright e2e run and mints a matching
// session cookie. Two repositories are configured so the repo dimension (chips, filter, picker)
// is exercised; state lives in the per-repo layout (state/<owner>__<name>/<pr>). Run standalone (`node e2e/fixture.mjs`) — the Playwright webServer runs it
// before booting the Python server, and global-setup runs it before the workers start, so the
// server always boots against a ready fixture regardless of Playwright's setup/webServer order.
// A FIXED (non-secret) test secret keeps the server's .env and the minted cookie in agreement.
import { createHmac } from "node:crypto";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURE = join(HERE, ".fixture");
export const AUTH_STATE = join(HERE, ".auth.json");
export const SECRET = "e2e-fixed-test-secret-not-for-production";
export const USER = "acme-dev";
export const REPO = "acme/widgets";
export const REPO2 = "acme/api";
export const PR = "38849"; // in REPO
export const PR2 = "38850"; // in REPO — dedicated archive-test target — no other test touches it
export const PR3 = "7"; // in REPO2
export const PORT = 8988;

const slug = (repo: string) => repo.replace("/", "__");

function write(path: string, body: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

export function buildFixture() {
  rmSync(FIXTURE, { recursive: true, force: true });
  mkdirSync(FIXTURE, { recursive: true });

  write(
    join(FIXTURE, ".env"),
    [
      `PRBOT_SECRET=${SECRET}`,
      `REVIEWER=${USER}`,
      `REPOS=${REPO},${REPO2}`,
      "DRY_RUN=1",
      "PUBLIC_URL=https://reviewstage.example.com",
      "GITHUB_PAT=ghp_e2e_dummy_never_used",
    ].join("\n") + "\n",
  );

  write(
    join(FIXTURE, "users.json"),
    JSON.stringify({ [USER]: { name: "Acme Dev", slack_id: "U0TEST", added: 1, updated: 1 } }),
  );

  // Already in the per-repo layout: nothing for the server to migrate.
  write(join(FIXTURE, "MIGRATED"), JSON.stringify({ at: 1, note: "e2e fixture" }) + "\n");

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

  // Fake gh: every call fails, so gh_json() returns its defaults and the server renders from
  // the on-disk fixture. Placed on PATH ahead of any real gh by the webServer command.
  const gh = join(FIXTURE, "fakebin", "gh");
  write(gh, "#!/bin/sh\nexit 1\n");
  chmodSync(gh, 0o755);
}

export function mintAuthState() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const sig = createHmac("sha256", SECRET).update(`session:${USER}:${exp}`).digest("hex");
  writeFileSync(
    AUTH_STATE,
    JSON.stringify({
      cookies: [
        {
          name: "prbot_s",
          value: `${USER}:${exp}:${sig}`,
          domain: "127.0.0.1",
          path: "/",
          expires: exp,
          httpOnly: true,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [],
    }),
  );
}

// Standalone invocation (from the webServer command).
if (process.argv[1] && process.argv[1]?.endsWith("fixture.ts")) {
  buildFixture();
  mintAuthState();
  console.log("e2e fixture built at", FIXTURE);
}
