"""rs_profile.py — the repository profile: what a repo's critical paths are, and how a review
should walk them.

A profile is built once per repository by bin/profile-repo.sh (deterministic signals gathered
here, one model call on top) and then read by every review: run-review.sh merges its risk paths
into the RISK_PATHS banners and, for Standard and Deep runs, appends a "Critical paths for this
repository" section listing only the paths the PR actually touches.

On disk ($ROOT/profiles/<owner>__<name>/):
    profile.json         the machine copy (schema below), with generation metadata
    profile.md           the human copy — editable in the dashboard, parsed back into JSON
    profile.<ts>.json    prior versions, kept when a new one is written
    signals.json         what the model saw (deterministic, no model output)
    status / pid / .lock / usage.json / agent.log   the detached job's state

Schema (profile.json):
    {"summary": str,
     "critical_paths": [{"path_glob": str, "why": str, "checks": [str]}],
     "risk_paths":     [{"label": str, "pattern": str}],
     "review_rules":   [str],
     "do_not_flag":    [str],
     "meta": {"generated_at", "model", "usage", "dropped_globs", "edited_at", "edited_by"}}

Imported by server.py, rs_rollup.py; profile-repo.sh and run-review.sh call it as
`python3 rs_profile.py <command>` (see main at the bottom). No third-party imports.
"""
import fnmatch
import json
import os
import re
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path

import rs_paths as P

ROOT = Path(os.environ.get("ROOT", Path.home() / ".claude-pr-bot"))
PROFILES = ROOT / "profiles"

MAX_MATCHED = 12          # critical paths listed per review, at most
WHY_LIMIT = 200           # chars of `why` kept per path in the prompt
TOP_N = 40                # churn / in-degree rows gathered
TREE_DEPTH = 3            # directory depth shown to the model
TREE_CAP = 400            # tree entries shown to the model
CHURN_MONTHS = 12

# Directory names that are critical in most codebases. Matched against every path segment.
CRITICAL_DIR_NAMES = (
    "auth", "authn", "authz", "oauth", "session", "sessions", "login",
    "payment", "payments", "billing", "checkout", "invoice", "invoices", "pay",
    "migration", "migrations", "schema", "schemas",
    "api", "public", "webhook", "webhooks",
    "crypto", "secrets", "security",
    "permission", "permissions", "admin", "acl", "rbac",
)

MANIFESTS = (
    "package.json", "pnpm-lock.yaml", "yarn.lock", "package-lock.json", "composer.json",
    "pyproject.toml", "requirements.txt", "setup.py", "Pipfile", "go.mod", "Cargo.toml",
    "pom.xml", "build.gradle", "build.gradle.kts", "Gemfile", "mix.exs", "Makefile",
    "Dockerfile", "docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml",
)
CI_GLOBS = (
    ".github/workflows/*.yml", ".github/workflows/*.yaml", ".circleci/config.yml",
    ".gitlab-ci.yml", "Jenkinsfile", ".travis.yml", "azure-pipelines.yml",
    "bitbucket-pipelines.yml", ".buildkite/*.yml", ".drone.yml", "cloudbuild.yaml",
)
CODEOWNERS_PATHS = ("CODEOWNERS", ".github/CODEOWNERS", "docs/CODEOWNERS")

# Language by extension — only code counts toward the dominant language.
LANG_EXT = {
    ".py": "python", ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript",
    ".cjs": "javascript", ".ts": "typescript", ".tsx": "typescript", ".php": "php",
    ".go": "go", ".rb": "ruby", ".java": "java", ".kt": "kotlin", ".rs": "rust",
    ".cs": "csharp", ".swift": "swift", ".scala": "scala", ".sh": "shell", ".bash": "shell",
    ".c": "c", ".h": "c", ".cc": "cpp", ".cpp": "cpp", ".hpp": "cpp", ".m": "objc",
}
MAX_IMPORT_FILE_BYTES = 200_000
MAX_IMPORT_FILES = 4000


def profile_dir(repo):
    return PROFILES / P.repo_slug(repo)


def profile_path(repo):
    return profile_dir(repo) / "profile.json"


# --- deterministic signals -------------------------------------------------------------------
def _git(base, *args, timeout=120):
    r = subprocess.run(["git", "-C", str(base), *args], capture_output=True, text=True,
                       timeout=timeout)
    return r.stdout if r.returncode == 0 else ""


def _tree(files, depth=TREE_DEPTH, cap=TREE_CAP):
    """A depth-limited directory listing: dirs with their file counts, files at the top levels.
    Bounded so the model sees the shape of the repo, not every path."""
    dirs = Counter()
    top_files = []
    for f in files:
        parts = f.split("/")
        for i in range(1, min(len(parts), depth + 1)):
            dirs["/".join(parts[:i]) + "/"] += 1
        if len(parts) <= depth:
            top_files.append(f)
    rows = sorted(dirs.items())
    out = [f"{d} ({n} files)" for d, n in rows]
    out += [f for f in top_files if f.count("/") < 1]      # root files only, dirs carry the rest
    return out[:cap], len(files)


def _languages(files):
    c = Counter()
    for f in files:
        ext = os.path.splitext(f)[1].lower()
        if ext in LANG_EXT:
            c[LANG_EXT[ext]] += 1
    return [{"language": k, "files": n} for k, n in c.most_common(8)]


def _churn(base, files):
    """Top files by number of commits touching them in the last CHURN_MONTHS months."""
    out = _git(base, "log", f"--since={CHURN_MONTHS}.months", "--name-only", "--format=",
               "--no-renames", timeout=300)
    present = set(files)
    c = Counter(line for line in out.splitlines() if line and line in present)
    return [{"path": p, "commits": n} for p, n in c.most_common(TOP_N)]


_IMPORT_RE = {
    "python": [re.compile(r"^\s*from\s+([\w.]+)\s+import\s+([\w, ]+)", re.M),
               re.compile(r"^\s*import\s+([\w.]+)", re.M)],
    "javascript": [re.compile(r"""(?:from|import|require\()\s*['"]([^'"]+)['"]""")],
    "typescript": [re.compile(r"""(?:from|import|require\()\s*['"]([^'"]+)['"]""")],
    "go": [re.compile(r'"([\w./-]+)"')],
    "php": [re.compile(r"^\s*use\s+([\w\\]+)", re.M),
            re.compile(r"(?:require|include)(?:_once)?\s*\(?\s*['\"]([^'\"]+)['\"]")],
    "ruby": [re.compile(r"""^\s*require(?:_relative)?\s+['"]([^'"]+)['"]""", re.M)],
    "java": [re.compile(r"^\s*import\s+(?:static\s+)?([\w.]+)", re.M)],
    "kotlin": [re.compile(r"^\s*import\s+([\w.]+)", re.M)],
    "rust": [re.compile(r"^\s*(?:pub\s+)?(?:use|mod)\s+([\w:]+)", re.M)],
    "csharp": [re.compile(r"^\s*using\s+([\w.]+)", re.M)],
}
_JS_EXTS = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs")


def _resolve_import(spec, src, lang, files, by_stem, by_base):
    """Best-effort: map one import target to a repo file path (or None)."""
    d = os.path.dirname(src)
    if lang in ("javascript", "typescript"):
        if not spec.startswith("."):
            return None
        tgt = os.path.normpath(os.path.join(d, spec))
        for cand in [tgt] + [tgt + e for e in _JS_EXTS] + [tgt + "/index" + e for e in _JS_EXTS]:
            if cand in files:
                return cand
        return None
    if lang == "python":
        parts = spec.split(".")
        for i in range(len(parts), 0, -1):
            rel = "/".join(parts[:i])
            for cand in (rel + ".py", rel + "/__init__.py"):
                if cand in files:
                    return cand
                loc = os.path.normpath(os.path.join(d, cand))
                if loc in files:
                    return loc
        return None
    if lang == "ruby":
        tgt = os.path.normpath(os.path.join(d, spec)) if spec.startswith(".") else spec
        for cand in (tgt + ".rb", tgt, "lib/" + tgt + ".rb"):
            if cand in files:
                return cand
        return None
    if lang == "go":
        hit = by_base.get(spec.rsplit("/", 1)[-1])
        return hit if hit and spec.rsplit("/", 1)[-1] in hit else None
    # php / java / kotlin / csharp / rust: last segment of the symbol is the class = file stem
    stem = re.split(r"[\\.:]", spec.strip("\\"))[-1]
    return by_stem.get(stem)


def _specs(m):
    """Import targets from one regex match. `from X import a, b` yields X.a and X.b (a module
    each, if they resolve) before X itself; every other pattern yields its single group."""
    if m.lastindex == 2:
        base = m.group(1)
        names = [n.strip() for n in m.group(2).split(",") if n.strip()]
        return [f"{base}.{n}" for n in names] + [base]
    return [m.group(1)]


def _indegree(base, files, languages):
    """Top files by how many other files import them, for the dominant language. Reads files
    from the checkout (a blobless clone fetches lazily — bounded by MAX_IMPORT_FILES)."""
    if not languages:
        return {"language": "", "rows": []}
    lang = languages[0]["language"]
    pats = _IMPORT_RE.get(lang)
    if not pats:
        return {"language": lang, "rows": []}
    exts = {e for e, l in LANG_EXT.items() if l == lang}
    if lang in ("javascript", "typescript"):
        exts = set(_JS_EXTS)
    code = [f for f in files if os.path.splitext(f)[1].lower() in exts][:MAX_IMPORT_FILES]
    fileset = set(files)
    stems = Counter(os.path.splitext(os.path.basename(f))[0] for f in code)
    by_stem = {os.path.splitext(os.path.basename(f))[0]: f for f in code
               if stems[os.path.splitext(os.path.basename(f))[0]] == 1}
    by_base = {os.path.basename(os.path.dirname(f)): os.path.dirname(f) for f in code}
    deg = Counter()
    for f in code:
        p = Path(base, f)
        try:
            if p.stat().st_size > MAX_IMPORT_FILE_BYTES:
                continue
            text = p.read_text(errors="replace")
        except OSError:
            continue
        seen = set()
        for rx in pats:
            for m in rx.finditer(text):
                for spec in _specs(m):
                    tgt = _resolve_import(spec, f, lang, fileset, by_stem, by_base)
                    if tgt and tgt != f and tgt not in seen:
                        seen.add(tgt)
                        deg[tgt] += 1
    return {"language": lang,
            "rows": [{"path": p, "imported_by": n} for p, n in deg.most_common(TOP_N)]}


def _critical_dirs(files):
    hits = {}
    for f in files:
        parts = f.split("/")[:-1]
        for i, seg in enumerate(parts):
            if seg.lower() in CRITICAL_DIR_NAMES:
                d = "/".join(parts[:i + 1]) + "/"
                hits[d] = hits.get(d, 0) + 1
    return [{"dir": d, "files": n, "matched": d.rstrip("/").rsplit("/", 1)[-1].lower()}
            for d, n in sorted(hits.items(), key=lambda kv: (-kv[1], kv[0]))[:60]]


def _read_head(base, rel, lines=60):
    p = Path(base, rel)
    try:
        return "\n".join(p.read_text(errors="replace").splitlines()[:lines])
    except OSError:
        return ""


def gather_signals(base, repo=""):
    """Every deterministic input the model sees. No model call, no network beyond git."""
    base = Path(base)
    t0 = time.time()
    files = [f for f in _git(base, "ls-files").splitlines() if f]
    tree, total = _tree(files)
    langs = _languages(files)
    codeowners = next((rel for rel in CODEOWNERS_PATHS if Path(base, rel).exists()), "")
    ci = sorted(f for f in files if any(fnmatch.fnmatch(f, g) for g in CI_GLOBS))
    manifests = sorted(f for f in files if os.path.basename(f) in MANIFESTS and f.count("/") <= 1)
    churn = _churn(base, files)
    indeg = _indegree(base, files, langs)
    head = _git(base, "rev-parse", "HEAD").strip()
    commits = _git(base, "rev-list", "--count", f"--since={CHURN_MONTHS}.months", "HEAD").strip()
    return {
        "repo": repo,
        "head": head,
        "gathered_at": int(time.time()),
        "duration_ms": int((time.time() - t0) * 1000),
        "file_count": total,
        "tree": tree,
        "languages": langs,
        "manifests": manifests,
        "ci_configs": ci,
        "codeowners_path": codeowners,
        "codeowners": _read_head(base, codeowners) if codeowners else "",
        "commits_last_12mo": int(commits) if commits.isdigit() else 0,
        "churn_top": churn,
        "indegree_top": indeg,
        "critical_dirs": _critical_dirs(files),
    }


# --- prompt assembly ------------------------------------------------------------------------
OUTPUT_CONTRACT = (
    'Reply with ONLY one JSON object and nothing else — no prose, no code fence: '
    '{"summary": "2-4 sentences: what this repository is and where its risk concentrates", '
    '"critical_paths": [{"path_glob": "a glob that matches files that EXIST in the tree above", '
    '"why": "one sentence, under 200 chars: why breaking this hurts and who it hurts", '
    '"checks": ["2-5 concrete things a reviewer must verify when a PR touches it"]}], '
    '"risk_paths": [{"label": "short_label", "pattern": "glob or substring"}], '
    '"review_rules": ["repo-specific rules every review should apply"], '
    '"do_not_flag": ["things that look wrong here but are deliberate — do not raise them"]}. '
    "Between 4 and 12 critical_paths; only paths you can point at in the signals. Labels are "
    "[A-Za-z0-9_-] only.")


def build_prompt(signals, skill_text):
    """The single model call's prompt: the repo-profile skill, then the signals, then the
    contract. Bounded JSON so the call stays one Sonnet-sized turn."""
    sig = dict(signals)
    sig.pop("gathered_at", None)
    sig.pop("duration_ms", None)
    return (f"{skill_text.strip()}\n\n"
            f"## Signals gathered from {signals.get('repo') or 'the repository'} "
            f"(deterministic, from git — no guessing needed)\n\n"
            f"```json\n{json.dumps(sig, indent=1)}\n```\n\n{OUTPUT_CONTRACT}")


def parse_model_output(text):
    """The JSON object in a model reply, tolerating a code fence or stray prose. None if none."""
    if not text:
        return None
    t = text.strip()
    m = re.search(r"```(?:json)?\s*(\{.*\})\s*```", t, re.S)
    if m:
        t = m.group(1)
    start, end = t.find("{"), t.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        d = json.loads(t[start:end + 1])
    except ValueError:
        return None
    return d if isinstance(d, dict) else None


# --- validation -----------------------------------------------------------------------------
_LABEL_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")


def _glob_matches(glob, files):
    """Does `glob` match at least one tracked file? A bare directory (`app/auth/`, `app/auth`,
    `app/auth/**`) counts when any file lives under it."""
    g = glob.strip().lstrip("./")
    if not g:
        return False
    if any(fnmatch.fnmatch(f, g) for f in files):
        return True
    d = g.rstrip("*").rstrip("/")
    if d and not any(ch in d for ch in "*?["):
        return any(f == d or f.startswith(d + "/") for f in files)
    if g.endswith("/**"):
        return _glob_matches(g[:-3] + "/*", files) or _glob_matches(g[:-3] + "/*/*", files)
    return False


def _strs(v, limit=12, each=300):
    if isinstance(v, str):
        v = [v]
    if not isinstance(v, list):
        return []
    out = []
    for x in v:
        s = re.sub(r"\s+", " ", str(x)).strip()
        if s and s[:each] not in out:
            out.append(s[:each])
    return out[:limit]


def validate_profile(raw, files):
    """Coerce a model (or edited) profile into the schema and drop every path_glob that matches
    nothing in the tree. Returns (clean, dropped_globs, error). `files` is the tracked list;
    pass None to skip the tree check (an edit with no clone at hand)."""
    if not isinstance(raw, dict):
        return None, [], "profile must be a JSON object"
    clean = {"summary": re.sub(r"\s+", " ", str(raw.get("summary") or "")).strip()[:1200],
             "critical_paths": [], "risk_paths": [], "review_rules": [], "do_not_flag": []}
    dropped = []
    seen = set()
    for cp in raw.get("critical_paths") or []:
        if not isinstance(cp, dict):
            continue
        glob = str(cp.get("path_glob") or cp.get("glob") or cp.get("path") or "").strip()
        glob = glob.lstrip("./")
        if not glob or glob in seen or len(glob) > 200:
            continue
        seen.add(glob)
        if files is not None and not _glob_matches(glob, files):
            dropped.append(glob)
            continue
        clean["critical_paths"].append({
            "path_glob": glob,
            "why": re.sub(r"\s+", " ", str(cp.get("why") or "")).strip()[:600],
            "checks": _strs(cp.get("checks"), limit=8)})
    for rp in raw.get("risk_paths") or []:
        if not isinstance(rp, dict):
            continue
        label = re.sub(r"[^A-Za-z0-9_-]", "_", str(rp.get("label") or "").strip())[:40]
        pattern = str(rp.get("pattern") or "").strip()
        if label and pattern and _LABEL_RE.match(label) and "," not in pattern \
                and ":" not in pattern:
            clean["risk_paths"].append({"label": label, "pattern": pattern[:200]})
    clean["risk_paths"] = clean["risk_paths"][:20]
    clean["review_rules"] = _strs(raw.get("review_rules"), limit=20)
    clean["do_not_flag"] = _strs(raw.get("do_not_flag"), limit=20)
    if isinstance(raw.get("meta"), dict):
        clean["meta"] = raw["meta"]
    if not clean["critical_paths"] and not clean["review_rules"] and not clean["summary"]:
        return None, dropped, "profile has no critical paths, rules or summary"
    return clean, dropped, None


# --- feeding reviews ------------------------------------------------------------------------
def risk_rules(profile):
    """The profile's risk_paths as the `label:pattern,...` string run-review.sh already parses."""
    return ",".join(f"{r['label']}:{r['pattern']}" for r in (profile or {}).get("risk_paths", [])
                    if r.get("label") and r.get("pattern"))


def merge_risk_rules(env_rules, profile):
    """RISK_PATHS (or the per-repo override) plus the profile's rules, de-duplicated by label —
    the operator's rule wins when both define a label."""
    out, labels = [], set()
    for rule in (env_rules or "").split(","):
        rule = rule.strip()
        if not rule:
            continue
        label = rule.split(":", 1)[0] if ":" in rule else rule
        labels.add(label)
        out.append(rule)
    for r in (profile or {}).get("risk_paths", []):
        if r.get("label") and r.get("pattern") and r["label"] not in labels:
            labels.add(r["label"])
            out.append(f"{r['label']}:{r['pattern']}")
    return ",".join(out)


def match_critical(profile, changed_paths, cap=MAX_MATCHED):
    """The critical_paths whose glob matches a changed file, in profile order, capped."""
    out = []
    for cp in (profile or {}).get("critical_paths", []):
        g = cp.get("path_glob", "")
        if g and _glob_matches(g, changed_paths):
            out.append(cp)
            if len(out) >= cap:
                break
    return out


def render_block(profile, changed_paths, effort="standard"):
    """The prompt section for one review, or "" when nothing applies (Quick never gets it)."""
    if not profile or effort == "quick":
        return ""
    matched = match_critical(profile, changed_paths)
    rules = profile.get("review_rules") or []
    dnf = profile.get("do_not_flag") or []
    if not (matched or rules or dnf):
        return ""
    lines = ["\n\n## Critical paths for this repository",
             "This repository has been profiled. Use the profile below as ground truth about "
             "where mistakes hurt most."]
    if profile.get("summary"):
        lines.append(f"\n{profile['summary']}")
    if matched:
        lines.append("\nThe PR touches these critical paths. For EACH one, explicitly verify it "
                     "is not broken: its callers, the contracts it exposes (APIs, schemas, "
                     "events), any migration or data shape it depends on, and the tests that "
                     "cover it. Say in the analysis what you checked for each. When a finding "
                     "concerns one of these paths, set \"critical_path\" on that finding to the "
                     "glob exactly as written here.")
        for cp in matched:
            why = cp.get("why", "")
            if len(why) > WHY_LIMIT:
                why = why[:WHY_LIMIT - 1].rstrip() + "…"
            lines.append(f"\n- `{cp['path_glob']}` — {why}" if why else f"\n- `{cp['path_glob']}`")
            for c in cp.get("checks") or []:
                lines.append(f"  - check: {c}")
    else:
        lines.append("\nNone of this repository's critical paths are touched by this PR; still "
                     "apply the rules below.")
    if rules:
        lines.append("\nRepository review rules:")
        lines += [f"- {r}" for r in rules]
    if dnf:
        lines.append("\nDeliberate in this repository — do NOT flag:")
        lines += [f"- {r}" for r in dnf]
    return "\n".join(lines)


# --- markdown (the editable copy) ------------------------------------------------------------
def to_markdown(profile):
    p = profile or {}
    out = ["# Repository profile", "", "## Summary", "", p.get("summary", "").strip() or "_none_",
           "", "## Critical paths", ""]
    for cp in p.get("critical_paths", []):
        out.append(f"### `{cp['path_glob']}`")
        out.append("")
        if cp.get("why"):
            out.append(f"Why: {cp['why']}")
            out.append("")
        for c in cp.get("checks") or []:
            out.append(f"- check: {c}")
        out.append("")
    out += ["## Risk paths", ""]
    out += [f"- {r['label']}: {r['pattern']}" for r in p.get("risk_paths", [])] or ["_none_"]
    out += ["", "## Review rules", ""]
    out += [f"- {r}" for r in p.get("review_rules", [])] or ["_none_"]
    out += ["", "## Do not flag", ""]
    out += [f"- {r}" for r in p.get("do_not_flag", [])] or ["_none_"]
    out.append("")
    return "\n".join(out)


def from_markdown(md):
    """Parse the editable markdown back into the schema. Lenient: unknown lines are ignored,
    `_none_` placeholders are dropped. Sections are matched by heading, case-insensitive."""
    prof = {"summary": "", "critical_paths": [], "risk_paths": [], "review_rules": [],
            "do_not_flag": []}
    section, cur = "", None
    summary = []
    for line in (md or "").splitlines():
        s = line.rstrip()
        h2 = re.match(r"^##\s+(.+?)\s*$", s)
        h3 = re.match(r"^###\s+`?([^`]+?)`?\s*$", s)
        if h2:
            section = h2.group(1).strip().lower()
            cur = None
            continue
        if s.startswith("# "):
            continue
        if section.startswith("critical") and h3:
            cur = {"path_glob": h3.group(1).strip(), "why": "", "checks": []}
            prof["critical_paths"].append(cur)
            continue
        if not s.strip() or s.strip() == "_none_":
            continue
        if section.startswith("summary"):
            summary.append(s.strip())
        elif section.startswith("critical") and cur is not None:
            m = re.match(r"^\s*[-*]\s*(?:check:\s*)?(.+)$", s)
            if re.match(r"^\s*why:\s*", s, re.I):
                cur["why"] = re.sub(r"^\s*why:\s*", "", s, flags=re.I).strip()
            elif m:
                cur["checks"].append(m.group(1).strip())
            elif not cur["why"]:
                cur["why"] = s.strip()
        elif section.startswith("risk"):
            m = re.match(r"^\s*[-*]\s*`?([A-Za-z0-9_-]+)`?\s*:\s*(.+?)\s*$", s)
            if m:
                prof["risk_paths"].append({"label": m.group(1), "pattern": m.group(2).strip("`")})
        elif section.startswith("review"):
            m = re.match(r"^\s*[-*]\s*(.+)$", s)
            if m:
                prof["review_rules"].append(m.group(1).strip())
        elif section.startswith("do not") or section.startswith("don"):
            m = re.match(r"^\s*[-*]\s*(.+)$", s)
            if m:
                prof["do_not_flag"].append(m.group(1).strip())
    prof["summary"] = " ".join(summary)
    return prof


# --- storage --------------------------------------------------------------------------------
def load_profile(repo):
    try:
        d = json.loads(profile_path(repo).read_text())
        return d if isinstance(d, dict) else None
    except (OSError, ValueError):
        return None


def save_profile(repo, profile, meta=None):
    """Write profile.json (+ profile.md), keeping the previous version as profile.<ts>.json."""
    d = profile_dir(repo)
    d.mkdir(parents=True, exist_ok=True)
    f = profile_path(repo)
    if f.exists():
        try:
            prev = json.loads(f.read_text())
            ts = int((prev.get("meta") or {}).get("edited_at")
                     or (prev.get("meta") or {}).get("generated_at") or f.stat().st_mtime)
        except (OSError, ValueError, TypeError):
            ts = int(f.stat().st_mtime)
        vf = d / f"profile.{ts}.json"
        if not vf.exists():
            os.replace(f, vf)
    out = dict(profile)
    m = dict(out.get("meta") or {})
    m.update(meta or {})
    out["meta"] = m
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(out, indent=1) + "\n")
    os.replace(tmp, f)
    (d / "profile.md").write_text(to_markdown(out))
    return out


def versions(repo):
    d = profile_dir(repo)
    if not d.is_dir():
        return []
    out = []
    for f in d.glob("profile.*.json"):
        ts = f.name[len("profile."):-len(".json")]
        if ts.isdigit():
            out.append(int(ts))
    return sorted(out, reverse=True)


def counts(profile):
    p = profile or {}
    return {"critical": len(p.get("critical_paths", [])),
            "risk": len(p.get("risk_paths", [])),
            "rules": len(p.get("review_rules", [])),
            "doNotFlag": len(p.get("do_not_flag", []))}


# --- CLI (used by profile-repo.sh and run-review.sh) --------------------------------------------
def _main(argv):
    cmd = argv[1] if len(argv) > 1 else ""
    if cmd == "signals":                       # signals <base> [repo]  → JSON on stdout
        print(json.dumps(gather_signals(argv[2], argv[3] if len(argv) > 3 else ""), indent=1))
        return 0
    if cmd == "prompt":                        # prompt <signals.json> <SKILL.md>
        sig = json.loads(Path(argv[2]).read_text())
        sys.stdout.write(build_prompt(sig, Path(argv[3]).read_text()))
        return 0
    if cmd == "finish":                        # finish <repo> <base> <raw-reply-file> <usage.json|->
        repo, base, raw_f = argv[2], argv[3], argv[4]
        usage = {}
        if len(argv) > 5 and argv[5] != "-" and Path(argv[5]).exists():
            try:
                usage = json.loads(Path(argv[5]).read_text())
            except ValueError:
                usage = {}
        raw = parse_model_output(Path(raw_f).read_text(errors="replace"))
        if raw is None:
            print("model reply held no JSON object", file=sys.stderr)
            return 2
        files = [f for f in _git(base, "ls-files").splitlines() if f]
        clean, dropped, err = validate_profile(raw, files)
        if err:
            print(err, file=sys.stderr)
            return 3
        for g in dropped:
            print(f"dropped hallucinated path_glob (matches nothing in the tree): {g}")
        save_profile(repo, clean, {"generated_at": int(time.time()),
                                   "model": usage.get("model", ""), "usage": usage or None,
                                   "dropped_globs": dropped,
                                   "head": _git(base, "rev-parse", "HEAD").strip(),
                                   "edited_at": None, "edited_by": ""})
        c = counts(clean)
        print(f"profile written: {c['critical']} critical paths, {c['risk']} risk paths, "
              f"{c['rules']} rules, {c['doNotFlag']} do-not-flag")
        return 0
    if cmd == "risk":                          # risk <repo> <env-rules>  → merged rule string
        sys.stdout.write(merge_risk_rules(argv[3] if len(argv) > 3 else "", load_profile(argv[2])))
        return 0
    if cmd == "block":                         # block <repo> <effort>  (changed paths on stdin)
        paths = [p.strip() for p in sys.stdin.read().splitlines() if p.strip()]
        sys.stdout.write(render_block(load_profile(argv[2]), paths,
                                      argv[3] if len(argv) > 3 else "standard"))
        return 0
    print("usage: rs_profile.py signals|prompt|finish|risk|block ...", file=sys.stderr)
    return 64


if __name__ == "__main__":
    sys.exit(_main(sys.argv))
