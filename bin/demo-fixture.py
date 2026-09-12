#!/usr/bin/env python3
"""demo-fixture.py ROOT [PORT] — build the offline demo data set and print a sign-in link.

A Python port of dashboard-ui/e2e/fixture.ts (the Playwright fixture): a .env with a dummy
service token, one demo user, a two-PR queue with finished reviews on disk, and a fake `gh`
that fails every call so the server renders from the on-disk state and nothing ever reaches
GitHub. Playwright signs in by injecting a cookie; here the server's own /handoff/accept route
mints the session instead, from a link signed with the fixture's PRBOT_SECRET.
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
REPO = "reviewstage/demo-repo"
PR, PR2 = 101, 102


def write(path: Path, body: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body)


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
        f"REPO={REPO}",
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

    write(root / "queue.json", json.dumps([
        {"number": PR, "title": "Add lead-time badge to product cards",
         "url": f"https://github.com/{REPO}/pull/{PR}", "additions": 42, "deletions": 8,
         "changedFiles": 5, "requested": [USER], "author": "teammate", "isBot": False,
         "isDraft": False, "head": "deadbeefcafe", "createdAt": "2026-05-01T10:00:00Z",
         "updatedAt": "2026-05-02T10:00:00Z"},
        {"number": PR2, "title": "Cache vendor lead times",
         "url": f"https://github.com/{REPO}/pull/{PR2}", "additions": 12, "deletions": 3,
         "changedFiles": 2, "requested": [USER], "author": "teammate", "isBot": False,
         "isDraft": False, "head": "feedfacecafe", "createdAt": "2026-05-03T10:00:00Z",
         "updatedAt": "2026-05-04T10:00:00Z"},
    ]))

    st = root / "state"
    write(st / str(PR2) / "status", "done")
    write(st / str(PR2) / "review.json", json.dumps({
        "event": "COMMENT", "summary": "Caches vendor lead times. Looks fine.",
        "keyPoints": ["A small, well-scoped cache.", "No blockers."],
        "explainer": "- Adds a per-vendor cache for lead times.",
        "analysis": "- Checked cache invalidation on vendor update.", "comments": []}))
    write(st / str(PR) / "status", "done")
    write(st / str(PR) / "review.json", json.dumps({
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

    # Fake gh: every call fails, so the server falls back to the on-disk fixture.
    gh = root / "fakebin" / "gh"
    write(gh, "#!/bin/sh\nexit 1\n")
    gh.chmod(gh.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    exp = int(time.time()) + 7 * 24 * 3600
    sig = hmac.new(secret.encode(), f"handoff:{USER}:{exp}".encode(), sha256).hexdigest()
    print("==> ReviewStage DEMO — offline fixture, nothing reaches GitHub or Claude")
    print(f"    sign in here: http://localhost:{port}/handoff/accept?login={USER}&exp={exp}&sig={sig}")
    print("    (the login form is disabled in demo mode — use the link above)", flush=True)


if __name__ == "__main__":
    main()
