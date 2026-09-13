#!/usr/bin/env python3
"""demo-fixture.py ROOT [PORT] — build the offline demo data set and print a sign-in link.

A Python port of dashboard-ui/e2e/fixture.ts (the Playwright fixture): a .env with a dummy
service token and TWO demo repositories, one demo user, a queue spanning both repos with
finished reviews on disk, and a fake `gh` that fails every call so the server renders from the
on-disk state and nothing ever reaches GitHub. Playwright signs in by injecting a cookie; here
the server's own /handoff/accept route mints the session instead, from a link signed with the
fixture's PRBOT_SECRET.
"""
import hmac
import json
import os
import secrets
import stat
import sys
import time
from hashlib import sha256
from pathlib import Path

USER = "demo-reviewer"
REPO = "reviewstage/demo-repo"          # the web app
REPO2 = "reviewstage/demo-api"          # a second repo, so the UI shows the repo dimension
PR, PR2 = 101, 102                      # in REPO
PR3 = 7                                 # in REPO2


def slug(repo):
    return repo.replace("/", "__", 1)


def write(path: Path, body: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body)


def row(repo, num, title, adds, dels, files, head, created, updated):
    return {"repo": repo, "number": num, "title": title,
            "url": f"https://github.com/{repo}/pull/{num}", "additions": adds,
            "deletions": dels, "changedFiles": files, "requested": [USER],
            "author": "teammate", "isBot": False, "isDraft": False, "head": head,
            "createdAt": created, "updatedAt": updated}


def main():
    root = Path(sys.argv[1] if len(sys.argv) > 1 else os.environ.get("ROOT", "~/.claude-pr-bot"))
    root = root.expanduser()
    port = sys.argv[2] if len(sys.argv) > 2 else "8899"
    root.mkdir(parents=True, exist_ok=True)

    # Keep an existing secret so a restart does not invalidate the link printed last time.
    env_f = root / ".env"
    secret = ""
    if env_f.exists():
        for line in env_f.read_text().splitlines():
            if line.startswith("PRBOT_SECRET="):
                secret = line.split("=", 1)[1].strip()
    secret = secret or secrets.token_hex(32)

    write(env_f, "\n".join([
        f"PRBOT_SECRET={secret}",
        f"REVIEWER={USER}",
        f"REPOS={REPO},{REPO2}",
        "DRY_RUN=1",
        f"PUBLIC_URL=http://localhost:{port}",
        "GITHUB_PAT=ghp_demo_dummy_never_used",
    ]) + "\n")
    env_f.chmod(0o600)

    write(root / "users.json", json.dumps({
        USER: {"name": "Demo Reviewer", "slack_id": "", "added": 1, "updated": 1}}))
    (root / "users.json").chmod(0o600)
    for name in ("seen", "used-nonces"):
        (root / name).touch()
    (root / "state").mkdir(exist_ok=True)
    # A fresh fixture is already in the per-repo layout — nothing to migrate.
    (root / "MIGRATED").write_text(json.dumps({"at": int(time.time()), "note": "demo"}) + "\n")

    write(root / "queue.json", json.dumps([
        row(REPO, PR, "Add lead-time badge to product cards", 42, 8, 5, "deadbeefcafe",
            "2026-05-01T10:00:00Z", "2026-05-02T10:00:00Z"),
        row(REPO, PR2, "Cache vendor lead times", 12, 3, 2, "feedfacecafe",
            "2026-05-03T10:00:00Z", "2026-05-04T10:00:00Z"),
        row(REPO2, PR3, "Rate-limit the lead-time endpoint", 30, 4, 3, "0badf00dcafe",
            "2026-05-05T10:00:00Z", "2026-05-06T10:00:00Z"),
    ]))

    st = root / "state"
    write(st / slug(REPO) / str(PR2) / "status", "done")
    write(st / slug(REPO) / str(PR2) / "review.json", json.dumps({
        "event": "COMMENT", "summary": "Caches vendor lead times. Looks fine.",
        "keyPoints": ["A small, well-scoped cache.", "No blockers."],
        "explainer": "- Adds a per-vendor cache for lead times.",
        "analysis": "- Checked cache invalidation on vendor update.", "comments": []}))
    write(st / slug(REPO) / str(PR) / "status", "done")
    write(st / slug(REPO) / str(PR) / "review.json", json.dumps({
        "event": "COMMENT",
        "summary": "Adds a lead-time badge to product cards. Logic is sound; two small things.",
        "keyPoints": [
            "The badge logic is sound — no blockers.",
            "Guard a null vendor before reading its lead time.",
            "One nit: prefer const over let in the badge component."],
        "explainer": "- Shows a lead-time badge on each product card.\n"
                     "- Reads the lead time from the product's vendor.",
        "analysis": "- Verified the badge renders for products with and without a vendor.\n"
                    "- Skipped: styling and i18n.",
        "comments": [
            {"path": "app/models/Product.php", "line": 42, "severity": "should-fix",
             "title": "A product with no vendor can crash the lead-time badge",
             "impact": "A shopper viewing such a product sees the card fail instead of loading.",
             "body": "Guard against a null vendor before reading its lead time.",
             "reply_to": None, "suggestion": "if ($vendor === null) return null;",
             "confidence": "high"},
            {"path": "src/javascripts/Badge.tsx", "line": 10, "severity": "nit",
             "title": "Use const instead of let", "impact": "Style only — no effect on behavior.",
             "body": "Prefer `const` over `let` here.", "reply_to": None, "suggestion": "",
             "confidence": "medium"}]}))
    write(st / slug(REPO2) / str(PR3) / "status", "done")
    write(st / slug(REPO2) / str(PR3) / "review.json", json.dumps({
        "event": "COMMENT",
        "summary": "Adds a token bucket in front of the lead-time endpoint. One blocker.",
        "keyPoints": ["The limiter key ignores the tenant, so one tenant can starve another."],
        "explainer": "- Rate-limits GET /lead-times per API key.",
        "analysis": "- Traced the limiter key from the request to the store.",
        "comments": [
            {"path": "api/limits.py", "line": 18, "severity": "blocker",
             "title": "Two tenants share one rate-limit bucket",
             "impact": "A busy tenant can lock a quiet tenant out of lead times entirely.",
             "body": "Key the bucket on (tenant, api_key), not api_key alone.",
             "reply_to": None, "suggestion": "key = f\"{tenant}:{api_key}\"",
             "confidence": "high"}]}))

    # Fake gh: every call fails, so the server falls back to the on-disk fixture.
    gh = root / "fakebin" / "gh"
    write(gh, "#!/bin/sh\nexit 1\n")
    gh.chmod(gh.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    exp = int(time.time()) + 7 * 24 * 3600
    sig = hmac.new(secret.encode(), f"handoff:{USER}:{exp}".encode(), sha256).hexdigest()
    print("==> ReviewStage DEMO — offline fixture, nothing reaches GitHub or Claude")
    print(f"    repos: {REPO}, {REPO2}")
    print(f"    sign in here: http://localhost:{port}/handoff/accept?login={USER}&exp={exp}&sig={sig}")
    print("    (the login form is disabled in demo mode — use the link above)", flush=True)


if __name__ == "__main__":
    main()
