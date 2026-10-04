// A second, separate offline fixture: a PERSONAL-mode install (`npx reviewstage`) with a .env
// that names no repository and holds no service token, one user whose stored GitHub token is a
// dummy, and a fake `gh` that answers the two calls personal mode makes with that token —
// `gh api --paginate user/repos…` (the wizard's repository picker) and `gh pr list` (the
// in-process poller). welcome.spec.ts boots its own server on this fixture, on its own port, so
// the main fixture and its 232 tests are untouched. Run standalone to (re)build it:
//   node --import tsx e2e/personal-fixture.ts
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PORT, SECRET } from "./fixture";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PERSONAL_FIXTURE = join(HERE, ".fixture-personal");
export const PERSONAL_PORT = Number(process.env.RS_E2E_PERSONAL_PORT || PORT + 1);
export const PERSONAL_ORIGIN = `http://127.0.0.1:${PERSONAL_PORT}`;
export const PERSONAL_USER = "acme-solo";
// The dummy token the user "signed in" with. It never leaves the box: the fake gh ignores it.
export const PERSONAL_TOKEN = "ghp_e2e_personal_dummy_never_used_000000";

export const PERSONAL_REPOS = [
  { full_name: "acme-solo/widgets", private: false, pushed_at: "2026-10-03T09:00:00Z",
    owner: { avatar_url: "https://avatars.example.test/acme-solo.png" } },
  { full_name: "acme/api", private: true, pushed_at: "2026-10-01T09:00:00Z",
    owner: { avatar_url: "https://avatars.example.test/acme.png" } },
  { full_name: "acme/billing", private: true, pushed_at: "2026-09-04T09:00:00Z",
    owner: { avatar_url: "https://avatars.example.test/acme.png" } },
];

function write(path: string, body: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

export function buildPersonalFixture() {
  rmSync(PERSONAL_FIXTURE, { recursive: true, force: true });
  mkdirSync(PERSONAL_FIXTURE, { recursive: true });
  write(
    join(PERSONAL_FIXTURE, ".env"),
    [
      `RS_SECRET=${SECRET}`,
      "RS_PERSONAL=1",
      "GH_DEVICE_FLOW=0", // the device flow is covered by device-flow.spec.ts; here the token form
      "DRY_RUN=1",
      `PUBLIC_URL=${PERSONAL_ORIGIN}`,
      "NOTIFY_BACKENDS=none",
      // deliberately: no REPOS, no REPO, no GITHUB_PAT, no REVIEWER
    ].join("\n") + "\n",
  );
  write(join(PERSONAL_FIXTURE, "MIGRATED"), JSON.stringify({ at: 1, note: "e2e personal fixture" }) + "\n");
  // The stored token is encrypted under RS_SECRET exactly as the server does it (server.enc),
  // so GET /api/github/repos can decrypt it and hand it to the fake gh.
  const patEnc = execFileSync(
    "python3",
    ["-c", "import server, sys; print(server.enc(sys.argv[1]))", PERSONAL_TOKEN],
    { cwd: join(HERE, "..", "..", "bin"), env: { ...process.env, ROOT: PERSONAL_FIXTURE } },
  )
    .toString()
    .trim();
  write(
    join(PERSONAL_FIXTURE, "users.json"),
    JSON.stringify({
      [PERSONAL_USER]: { name: "Acme Solo", pat_enc: patEnc, added: 1, updated: 1, tour_seen: true },
    }),
  );
  const gh = join(PERSONAL_FIXTURE, "fakebin", "gh");
  write(
    gh,
    [
      "#!/bin/sh",
      `case "$*" in`,
      `  *"user/repos"*) cat <<'RSJSON'`,
      JSON.stringify(PERSONAL_REPOS),
      "RSJSON",
      "  exit 0;;",
      `  *"pr list"*) echo '[]'; exit 0;;`,
      "esac",
      "exit 1",
      "",
    ].join("\n"),
  );
  chmodSync(gh, 0o755);
}

if (process.argv[1]?.endsWith("personal-fixture.ts")) {
  buildPersonalFixture();
  console.log("e2e personal fixture built at", PERSONAL_FIXTURE);
}
