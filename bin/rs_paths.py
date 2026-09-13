"""rs_paths.py — the ONE place that knows the on-disk layout and the repo dimension.

One ReviewStage install reviews many repositories. A PR is identified by (repo, number) where
repo is `owner/name`. On disk a repo is a slug, `owner__name` (GitHub owners cannot contain `_`,
so the first `__` is always the separator and the mapping is reversible):

    $ROOT/repos/<owner>__<name>/            blobless base clone; review worktrees branch off it
    $ROOT/state/<owner>__<name>/<pr>/       per-PR state (meta.json, qa.*, agreement/, users/)
    $ROOT/state/<owner>__<name>/<pr>/users/<login>/   one reviewer's run + markers

Legacy (single-repo) installs kept the clone at $ROOT/repo and state at $ROOT/state/<pr>;
migrate_legacy() moves them into the new layout once, on server start.

Imported by server.py, rs_learn.py and rs_rollup.py; the bash side (lib-common.sh)
mirrors repo_slug / base_dir / prdir / udir.
"""
import json
import os
import re
import shutil
import time
from pathlib import Path

ROOT = Path(os.environ.get("ROOT", Path.home() / ".claude-pr-bot"))
STATE = ROOT / "state"
REPOS_DIR = ROOT / "repos"
MIGRATED = ROOT / "MIGRATED"
LEGACY_BASE = ROOT / "repo"

# owner: alphanumerics + hyphens; name: alphanumerics, `_`, `.`, `-`.
REPO_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?/[A-Za-z0-9_.-]+$")
_SPLIT = re.compile(r"[,\s]+")


def valid_repo(repo):
    return bool(repo) and bool(REPO_RE.match(repo)) and not repo.endswith(".git")


def parse_repos(env):
    """The configured repositories: REPOS (comma / space / newline separated) unioned with the
    single-entry alias REPO. Order preserved, duplicates dropped (case-insensitive — GitHub
    repo names are). Invalid entries are returned too so the caller can refuse to start."""
    out, seen = [], set()
    raw = " ".join([env.get("REPOS", "") or "", env.get("REPO", "") or ""])
    for r in _SPLIT.split(raw):
        r = r.strip().strip("/")
        if r.startswith("https://github.com/"):
            r = r[len("https://github.com/"):]
        if not r or r.lower() in seen:
            continue
        seen.add(r.lower())
        out.append(r)
    return out


def allow_org(env):
    """REPO_ALLOW_ORG: an org whose repos are accepted dynamically (see repo_allowed)."""
    return (env.get("REPO_ALLOW_ORG", "") or "").strip().strip("/")


def repo_allowed(repo, repos, org=""):
    """May this install review `repo`? Either explicitly configured, or under REPO_ALLOW_ORG."""
    if not valid_repo(repo):
        return False
    low = repo.lower()
    if any(low == r.lower() for r in repos):
        return True
    return bool(org) and low.split("/", 1)[0] == org.lower()


def canonical_repo(repo, repos):
    """The configured spelling of `repo` (case-insensitive match), else `repo` as given."""
    low = (repo or "").lower()
    for r in repos:
        if r.lower() == low:
            return r
    return repo


def repo_slug(repo):
    return repo.replace("/", "__", 1)


def slug_repo(slug):
    return slug.replace("__", "/", 1)


def is_slug(name):
    return "__" in name and valid_repo(slug_repo(name))


def base_dir(repo):
    return REPOS_DIR / repo_slug(repo)


def prdir(repo, pr):
    return STATE / repo_slug(repo) / str(pr)


def udir(repo, pr, user):
    return prdir(repo, pr) / "users" / user


def known_repos(repos):
    """Configured repos plus any repo that already has state or a clone on disk (accepted
    dynamically via REPO_ALLOW_ORG). Order: configured first, then discovered, alphabetical."""
    out = list(repos)
    low = {r.lower() for r in out}
    found = set()
    for d in (STATE, REPOS_DIR):
        if d.is_dir():
            for sub in d.iterdir():
                if sub.is_dir() and is_slug(sub.name):
                    found.add(slug_repo(sub.name))
    for r in sorted(found):
        if r.lower() not in low:
            out.append(r)
            low.add(r.lower())
    return out


def iter_prdirs():
    """Yield (repo, pr_number_str, path) for every per-PR state dir in the new layout."""
    if not STATE.is_dir():
        return
    for rd in sorted(STATE.iterdir()):
        if not (rd.is_dir() and is_slug(rd.name)):
            continue
        repo = slug_repo(rd.name)
        for pd in sorted(rd.iterdir()):
            if pd.is_dir() and pd.name.isdigit():
                yield repo, pd.name, pd


def repos_with_pr(pr):
    """Every repo on disk that has state for PR number `pr` — lets a legacy `/pr?pr=N` link
    resolve when the number is unique across repos."""
    return [repo for repo, num, _ in iter_prdirs() if num == str(pr)]


# --- legacy migration ------------------------------------------------------------------------
def _legacy_present():
    """What single-repo remnants exist: (has_clone, [numeric state dirs])."""
    nums = []
    if STATE.is_dir():
        nums = sorted(d.name for d in STATE.iterdir() if d.is_dir() and d.name.isdigit())
    return (LEGACY_BASE / ".git").exists(), nums


def _merge_move(src, dst):
    """Move src into dst. If dst already exists (a poller touched the new path before the server
    migrated), move src's children into it one by one and never overwrite an existing file."""
    if not dst.exists():
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dst))
        return
    for child in list(src.iterdir()):
        target = dst / child.name
        if child.is_dir() and target.is_dir():
            _merge_move(child, target)
        elif not target.exists():
            shutil.move(str(child), str(target))
        # else: keep the newer file already at the destination; the legacy one stays behind
    try:
        src.rmdir()
    except OSError:
        pass


def _rewrite_jsonl(path, repo):
    if not path.exists():
        return 0
    rows, changed = [], 0
    for line in path.read_text().splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if isinstance(row, dict) and not row.get("repo"):
            row["repo"] = repo
            changed += 1
        rows.append(row)
    if changed:
        tmp = path.with_suffix(".tmp")
        tmp.write_text("".join(json.dumps(r) + "\n" for r in rows))
        try:
            os.chmod(tmp, 0o600)
        except OSError:
            pass
        tmp.replace(path)
    return changed


def migrate_legacy(repos, log=print):
    """Move a single-repo install into the per-repo layout, once. Returns a summary dict, or
    None when there was nothing to do. Raises SystemExit with an operator-facing message when
    legacy state exists but the configured repo is ambiguous — never guesses, never loses data."""
    if MIGRATED.exists():
        return None
    has_clone, nums = _legacy_present()
    queue_f = ROOT / "queue.json"
    queue_rows = []
    if queue_f.exists():
        try:
            queue_rows = json.loads(queue_f.read_text()) or []
        except ValueError:
            queue_rows = []
    queue_legacy = [r for r in queue_rows if isinstance(r, dict) and not r.get("repo")]
    if not (has_clone or nums or queue_legacy):
        MIGRATED.write_text(json.dumps({"at": int(time.time()), "note": "fresh install"}) + "\n")
        return None
    if len(repos) != 1:
        found = []
        if has_clone:
            found.append("repo/")
        if nums:
            found.append(f"state/ ({len(nums)} numeric PR dirs)")
        if queue_legacy:
            found.append(f"queue.json ({len(queue_legacy)} rows without a repo)")
        raise SystemExit(
            f"FATAL: legacy single-repo state found under {ROOT} ({', '.join(found)}) but "
            f"{len(repos)} repositories are configured ({', '.join(repos) or 'none'}). "
            "Migration needs to know which repository that state belongs to: start ONCE with "
            "exactly one repo — set REPO=<owner/name> and leave REPOS empty — then add the "
            "others and restart. Nothing has been moved.")
    repo = repos[0]
    summary = {"at": int(time.time()), "repo": repo, "clone": False, "prs": 0,
               "queue_rows": 0, "seen_lines": 0, "learnings_rows": 0}
    log(f"==> migrating legacy single-repo state to the per-repo layout for {repo}")
    if has_clone:
        dst = base_dir(repo)
        if (dst / ".git").exists():
            log(f"    base clone already at {dst}; leaving legacy {LEGACY_BASE} in place")
        else:
            REPOS_DIR.mkdir(parents=True, exist_ok=True)
            shutil.move(str(LEGACY_BASE), str(dst))
            summary["clone"] = True
            log(f"    moved {LEGACY_BASE} -> {dst}")
    for n in nums:
        _merge_move(STATE / n, prdir(repo, n))
        summary["prs"] += 1
    if nums:
        log(f"    moved {len(nums)} PR state dir(s) -> {STATE / repo_slug(repo)}/")
    if queue_legacy:
        for r in queue_legacy:
            r["repo"] = repo
        tmp = queue_f.with_suffix(".tmp")
        tmp.write_text(json.dumps(queue_rows))
        tmp.replace(queue_f)
        summary["queue_rows"] = len(queue_legacy)
        log(f"    stamped repo on {len(queue_legacy)} queue.json row(s)")
    seen = ROOT / "seen"
    if seen.exists():
        lines, changed = [], 0
        for line in seen.read_text().splitlines():
            s = line.strip()
            if s and "/" not in s:
                s = f"{repo}:{s}"
                changed += 1
            if s:
                lines.append(s)
        if changed:
            seen.write_text("\n".join(lines) + "\n")
            summary["seen_lines"] = changed
            log(f"    prefixed {changed} seen line(s) with the repo")
    summary["learnings_rows"] = _rewrite_jsonl(ROOT / "learnings.jsonl", repo)
    if summary["learnings_rows"]:
        log(f"    stamped repo on {summary['learnings_rows']} learnings row(s)")
    MIGRATED.write_text(json.dumps(summary) + "\n")
    log(f"    done; marker written to {MIGRATED}")
    return summary
