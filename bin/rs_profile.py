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
     "version": 1,
     "meta": {"generated_at", "model", "usage", "dropped_globs", "edited_at", "edited_by",
              "head", "validated", "degraded"}}

`version` is the schema version: load_profile shape-checks against it and warns rather than
swallowing a hand-edited file into a silently empty profile.

Imported by server.py, rs_rollup.py; profile-repo.sh and run-review.sh call it as
`python3 rs_profile.py <command>` (see main at the bottom). No third-party imports.
"""
import contextlib
import fnmatch
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
from collections import Counter
from pathlib import Path

import rs_paths as P
import rs_state

ROOT = Path(os.environ.get("ROOT", Path.home() / ".reviewstage"))
PROFILES = ROOT / "profiles"

SCHEMA_VERSION = 1

MAX_MATCHED = 12          # critical paths listed per review, at most
MAX_CRITICAL = 24         # critical paths STORED, at most — the cap validation enforces
# A glob that matches this share of the tree is not a critical path, it is "the repository".
# Told that the critical path is touched on every single PR, a review learns nothing from it.
IMPLAUSIBLE_TREE_SHARE = 0.5
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
def _git(base, *args, timeout=120, degraded=None):
    """One git call. Never raises: a git that hangs past `timeout`, is missing, or dies is a
    degraded signal, not a crashed profile build. `degraded` collects a note per failure so the
    card and the prompt can say which signal is missing instead of pretending it was empty."""
    try:
        r = subprocess.run(["git", "-C", str(base), *args], capture_output=True, text=True,
                           timeout=timeout)
    except subprocess.TimeoutExpired:
        if degraded is not None:
            degraded.append(f"git {args[0]} timed out after {timeout}s")
        return ""
    except OSError as e:
        if degraded is not None:
            degraded.append(f"git {args[0]} could not run: {e}")
        return ""
    if r.returncode != 0 and degraded is not None:
        tail = (r.stderr or "").strip().splitlines()
        degraded.append(f"git {args[0]} failed: {(tail or ['no output'])[-1][:120]}")
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


def _churn(base, files, degraded=None, timeout=300):
    """Top files by number of commits touching them in the last CHURN_MONTHS months.

    Streamed line by line: a year of `git log --name-only` on a large monorepo is hundreds of
    megabytes, and buffering it all before counting is how this got OOM-killed. Only the
    Counter is ever resident, and the counter only ever holds tracked paths."""
    present = set(files)
    c = Counter()
    try:
        p = subprocess.Popen(
            ["git", "-C", str(base), "log", f"--since={CHURN_MONTHS}.months", "--name-only",
             "--format=", "--no-renames"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)
    except OSError as e:
        if degraded is not None:
            degraded.append(f"churn skipped: git log could not run: {e}")
        return []
    deadline = time.time() + timeout
    try:
        for line in p.stdout:
            line = line.rstrip("\n")
            if line and line in present:
                c[line] += 1
            if time.time() > deadline:
                p.kill()
                if degraded is not None:
                    degraded.append(f"churn skipped: git log exceeded {timeout}s")
                return []
    finally:
        with contextlib.suppress(OSError):
            p.stdout.close()
        try:
            p.wait(timeout=5)
        except subprocess.TimeoutExpired:
            p.kill()
    return [{"path": path, "commits": n} for path, n in c.most_common(TOP_N)]


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
    degraded = []
    files = [f for f in _git(base, "ls-files", degraded=degraded).splitlines() if f]
    tree, total = _tree(files)
    langs = _languages(files)
    codeowners = next((rel for rel in CODEOWNERS_PATHS if Path(base, rel).exists()), "")
    ci = sorted(f for f in files if any(fnmatch.fnmatch(f, g) for g in CI_GLOBS))
    manifests = sorted(f for f in files if os.path.basename(f) in MANIFESTS and f.count("/") <= 1)
    churn = _churn(base, files, degraded=degraded)
    indeg = _indegree(base, files, langs)
    head = _git(base, "rev-parse", "HEAD", degraded=degraded).strip()
    commits = _git(base, "rev-list", "--count", f"--since={CHURN_MONTHS}.months", "HEAD",
                   degraded=degraded).strip()
    return {
        "repo": repo,
        "head": head,
        "degraded": degraded,
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


def strip_front_matter(text):
    """`text` without a leading YAML front-matter block (`---` … `---`). Mirrors skill_body in
    lib-common.sh: an unterminated header is returned untouched."""
    lines = text.splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        return text
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            return "".join(lines[i + 1:])
    return text


def build_prompt(signals, skill_text):
    """The single model call's prompt: the repo-profile skill, then the signals, then the
    contract. Bounded JSON so the call stays one Sonnet-sized turn. The skill's front-matter is
    dropped so the prompt never starts with `---`."""
    sig = dict(signals)
    sig.pop("gathered_at", None)
    sig.pop("duration_ms", None)
    missing = ""
    if sig.get("degraded"):
        missing = ("\n\nSome signals could not be gathered on this run — reason nothing about "
                   "what their absence implies:\n"
                   + "\n".join(f"- {d}" for d in sig["degraded"]))
    return (f"{strip_front_matter(skill_text).strip()}\n\n"
            f"## Signals gathered from {signals.get('repo') or 'the repository'} "
            f"(deterministic, from git — no guessing needed)\n\n"
            f"```json\n{json.dumps(sig, indent=1)}\n```{missing}\n\n{OUTPUT_CONTRACT}")


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


# fnmatch's `*` happily crosses a directory separator, so `src/*.ts` matched every .ts file in
# the tree — four thousand of them — and every review was told the critical path was touched.
# A path glob has to behave the way a person writing one expects: `*` stops at `/`, `**` is the
# only thing that spans directories.
_GLOB_CACHE = {}


def glob_regex(glob):
    """`glob` as a compiled regex where `*` excludes `/` and `**` spans directories."""
    rx = _GLOB_CACHE.get(glob)
    if rx is not None:
        return rx
    out, i, n = [], 0, len(glob)
    while i < n:
        ch = glob[i]
        if ch == "*":
            if glob[i:i + 3] == "**/":
                out.append(r"(?:[^/]+/)*")
                i += 3
                continue
            if glob[i:i + 2] == "**":
                out.append(r".*")
                i += 2
                continue
            out.append(r"[^/]*")
        elif ch == "?":
            out.append(r"[^/]")
        elif ch == "[":
            j = glob.find("]", i + 1)
            if j < 0:
                out.append(re.escape(ch))
            else:
                body = glob[i + 1:j].replace("\\", "\\\\")
                out.append("[" + ("^" + body[1:] if body.startswith("!") else body) + "]")
                i = j + 1
                continue
        else:
            out.append(re.escape(ch))
        i += 1
    rx = re.compile("^" + "".join(out) + "$")
    _GLOB_CACHE[glob] = rx
    return rx


def glob_hits(glob, files):
    """Every tracked file `glob` matches. A bare directory (`app/auth/`, `app/auth`,
    `app/auth/**`) counts every file under it."""
    g = (glob or "").strip().lstrip("./")
    if not g:
        return []
    rx = glob_regex(g)
    hits = [f for f in files if rx.match(f)]
    if hits:
        return hits
    d = g.rstrip("*").rstrip("/")
    if d and not any(ch in d for ch in "*?["):
        return [f for f in files if f == d or f.startswith(d + "/")]
    return []


def _glob_matches(glob, files):
    """Does `glob` match at least one tracked file?"""
    return bool(glob_hits(glob, files))


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


SECTIONS = ("critical_paths", "risk_paths", "review_rules", "do_not_flag")


def section_counts(profile):
    """How many entries each list section holds — what a save reports back to the editor."""
    p = profile or {}
    out = {k: len(p.get(k) or []) for k in SECTIONS}
    out["summary"] = 1 if (p.get("summary") or "").strip() else 0
    return out


def emptied_sections(prev, new):
    """Sections that held something before this edit and hold nothing after it."""
    a, b = section_counts(prev), section_counts(new)
    return [k for k in a if a[k] and not b[k]]


def validate_profile(raw, files, prev=None, allow_emptying=True):
    """Coerce a model (or edited) profile into the schema. Returns (clean, dropped_globs, error).

    `files` is the tracked list; pass None to skip the tree check (an edit with no clone at
    hand — the caller must then record validated: false rather than pretend the paths were
    checked). `prev` is the profile being replaced: with allow_emptying=False, an edit that
    empties a section which previously held entries is refused, because the markdown round trip
    can silently lose a whole section (a retitled heading yields nothing) and the only old
    guard fired when critical paths AND rules AND summary were all empty at once — so deleting
    the risk-paths section saved cleanly and every risk rule vanished from future reviews."""
    if not isinstance(raw, dict):
        return None, [], "profile must be a JSON object"
    clean = {"summary": re.sub(r"\s+", " ", str(raw.get("summary") or "")).strip()[:1200],
             "critical_paths": [], "risk_paths": [], "review_rules": [], "do_not_flag": []}
    dropped = []
    seen = set()
    total_files = len(files) if files is not None else 0
    over_cap = 0
    for cp in raw.get("critical_paths") or []:
        if not isinstance(cp, dict):
            continue
        glob = str(cp.get("path_glob") or cp.get("glob") or cp.get("path") or "").strip()
        glob = glob.lstrip("./")
        if not glob or glob in seen or len(glob) > 200:
            continue
        seen.add(glob)
        if files is not None:
            hits = glob_hits(glob, files)
            if not hits:
                dropped.append(glob)
                continue
            if total_files and len(hits) / total_files > IMPLAUSIBLE_TREE_SHARE:
                dropped.append(glob)       # "the whole repository" is not a critical path
                continue
        if len(clean["critical_paths"]) >= MAX_CRITICAL:
            over_cap += 1                  # capped at validation, not silently at render time
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
    clean["version"] = SCHEMA_VERSION
    if isinstance(raw.get("meta"), dict):
        clean["meta"] = raw["meta"]
    if over_cap:
        clean.setdefault("meta", {})
        clean["meta"]["capped_critical_paths"] = over_cap
    if not clean["critical_paths"] and not clean["review_rules"] and not clean["summary"]:
        return None, dropped, "profile has no critical paths, rules or summary"
    if prev is not None and not allow_emptying:
        gone = emptied_sections(prev, clean)
        if gone:
            names = ", ".join(s.replace("_", " ") for s in gone)
            return None, dropped, (f"this edit empties a section that was not empty: {names}. "
                                   "Confirm the deletion to save it anyway")
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
    """(listed, not_listed) — the critical_paths this PR touches, most-affected first.

    Ordered by how many of the PR's changed files each glob actually matches, so the cap keeps
    the paths this PR hits hardest rather than whichever the model happened to emit first."""
    scored = []
    for cp in (profile or {}).get("critical_paths", []):
        g = cp.get("path_glob", "")
        if not g:
            continue
        hits = glob_hits(g, changed_paths)
        if hits:
            scored.append((len(hits), cp))
    scored.sort(key=lambda s: -s[0])
    return [cp for _, cp in scored[:cap]], max(0, len(scored) - cap)


def render_block(profile, changed_paths, effort="standard"):
    """The prompt section for one review, or "" when nothing applies (Quick never gets it)."""
    if not profile or effort == "quick":
        return ""
    matched, not_listed = match_critical(profile, changed_paths)
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
        if not_listed:
            lines.append(f"\n({not_listed} further critical path(s) are also touched by this PR "
                         "but are not listed here — the ones above are the most affected.)")
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


# The editable markdown's headings, matched exactly (case- and punctuation-insensitive) rather
# than by prefix. A retitled or misspelled heading used to match nothing, quietly yield an empty
# list for that section, and save — taking every entry in it out of future reviews. Anything not
# in this map is reported to the editor instead of being swallowed.
_HEADINGS = {
    "summary": "summary",
    "critical paths": "critical_paths", "critical path": "critical_paths",
    "risk paths": "risk_paths", "risk path": "risk_paths",
    "review rules": "review_rules", "review rule": "review_rules",
    "do not flag": "do_not_flag", "dont flag": "do_not_flag", "do-not-flag": "do_not_flag",
}


def _heading_key(title):
    t = re.sub(r"[^a-z0-9 -]", "", (title or "").strip().lower())
    t = re.sub(r"\s+", " ", t).strip()
    return _HEADINGS.get(t) or _HEADINGS.get(t.replace("-", " "))


def from_markdown(md, report=False):
    """Parse the editable markdown back into the schema.

    Lenient about line shapes, strict about headings: every `##` heading must be one this
    format defines. With report=True returns (profile, notes) where notes lists every heading
    that was not recognised — content under an unrecognised heading is NOT silently dropped
    into nothing, the caller is told about it."""
    prof = {"summary": "", "critical_paths": [], "risk_paths": [], "review_rules": [],
            "do_not_flag": []}
    section, cur, unknown = "", None, []
    summary = []
    for line in (md or "").splitlines():
        s = line.rstrip()
        h2 = re.match(r"^##\s+(.+?)\s*$", s)
        h3 = re.match(r"^###\s+`?([^`]+?)`?\s*$", s)
        if h2:
            title = h2.group(1).strip()
            section = _heading_key(title) or ""
            cur = None
            if not section:
                unknown.append(title[:80])
            continue
        if s.startswith("# "):
            continue
        if section == "critical_paths" and h3:
            cur = {"path_glob": h3.group(1).strip(), "why": "", "checks": []}
            prof["critical_paths"].append(cur)
            continue
        if not s.strip() or s.strip() == "_none_":
            continue
        if section == "summary":
            summary.append(s.strip())
        elif section == "critical_paths" and cur is not None:
            m = re.match(r"^\s*[-*]\s*(?:check:\s*)?(.+)$", s)
            if re.match(r"^\s*why:\s*", s, re.I):
                cur["why"] = re.sub(r"^\s*why:\s*", "", s, flags=re.I).strip()
            elif m:
                cur["checks"].append(m.group(1).strip())
            elif not cur["why"]:
                cur["why"] = s.strip()
        elif section == "risk_paths":
            m = re.match(r"^\s*[-*]\s*`?([A-Za-z0-9_-]+)`?\s*:\s*(.+?)\s*$", s)
            if m:
                prof["risk_paths"].append({"label": m.group(1), "pattern": m.group(2).strip("`")})
        elif section == "review_rules":
            m = re.match(r"^\s*[-*]\s*(.+)$", s)
            if m:
                prof["review_rules"].append(m.group(1).strip())
        elif section == "do_not_flag":
            m = re.match(r"^\s*[-*]\s*(.+)$", s)
            if m:
                prof["do_not_flag"].append(m.group(1).strip())
    prof["summary"] = " ".join(summary)
    return (prof, {"unknownHeadings": unknown}) if report else prof


# --- job state ------------------------------------------------------------------------------
TERMINAL_STATUS = ("done", "stopped", "")
LOG_TAIL_LINES = 20

# Serialises probe-then-spawn across the server's request threads: two clicks in the same
# instant must never both pass the liveness check and start two builds.
_START_LOCK = threading.Lock()


def read_status(pdir):
    try:
        return (Path(pdir) / "status").read_text().strip()
    except OSError:
        return ""


def probe(pdir, now=None):
    """Every liveness signal for one profile job (rs_state.probe over the same marker names:
    .lock, pid, status) and the verdict for a run whose status is still a progress line."""
    return rs_state.probe(Path(pdir), now)


def job_alive(pdir, status=None, now=None):
    """Is a profile build genuinely in flight? The flock is exact once profile-repo.sh is past
    its first lines, but the server writes `status` and spawns before the child exists, so a
    free lock proves nothing on its own — the pid and the status file's age count too, exactly
    as rs_state does for reviews. A run whose status is terminal (done / stopped / failed…)
    is only alive while the lock is held (a re-run that has not written its first line yet)."""
    p = probe(pdir, now)
    if p["lock_held"]:
        return True
    status = (read_status(pdir) if status is None else status).strip()
    if status.startswith("failed") or status in TERMINAL_STATUS:
        return False
    return p["state"] == rs_state.REVIEWING


def start_job(pdir, spawn):
    """Start one build unless one is alive. `spawn()` launches profile-repo.sh and returns its
    pid. Returns (started, reason) — reason is "already running" when nothing was spawned. The
    status and pid markers are written only by the spawner; a live run's are never touched."""
    pdir = Path(pdir)
    pdir.mkdir(parents=True, exist_ok=True)
    with _START_LOCK:
        if job_alive(pdir):
            return False, "already running"
        (pdir / "status").write_text("queued")
        pid = spawn()
        if pid:
            (pdir / "pid").write_text(str(pid))
    return True, ""


def job_state(running, status, has_profile):
    """(state, failure) for one profile job from what is on disk. `state` is exactly one of
    none | running | done | failed | stopped; `failure` is the text to show when the last run
    failed, else "". A run that is not holding the lock but whose status is still a progress
    line died without reporting (killed, OOM, a `die` before its first status) — that is a
    failure too, not "never run". `running` must come from job_alive(): lock OR live pid OR a
    status younger than the startup grace — a free lock alone is not death. An existing
    profile keeps state=done even after a failed re-run, with the failure text alongside so
    the page can say so."""
    status = (status or "").strip()
    if running:
        return "running", ""
    if status.startswith("failed"):
        failure = status
    elif status not in TERMINAL_STATUS:
        failure = f"failed: the profiler exited without reporting why (last status: {status})"
    else:
        failure = ""
    if has_profile:
        return "done", failure
    if failure:
        return "failed", failure
    if status == "stopped":
        return "stopped", ""
    return "none", ""


def log_tail(path, n=LOG_TAIL_LINES):
    """The last `n` non-empty lines of a log file, or [] when there is none."""
    try:
        lines = Path(path).read_text(errors="replace").splitlines()
    except OSError:
        return []
    return [ln.rstrip() for ln in lines if ln.strip()][-n:]


# --- storage --------------------------------------------------------------------------------
def check_shape(d):
    """"" if `d` is a usable profile, else why it is not.

    load_profile used to hand back whatever JSON was on disk, and the caller's `or {}` turned a
    hand-edited file with a mistyped key into "this repository has no critical paths" — for
    ever, silently, behind a `|| true` in the shell. A shape check and a warning is the
    difference between a broken file you can fix and a feature that quietly stopped."""
    if not isinstance(d, dict):
        return "not a JSON object"
    ver = d.get("version", SCHEMA_VERSION)
    if not isinstance(ver, int) or ver > SCHEMA_VERSION:
        return f"schema version {ver!r} is newer than this build understands"
    for k in SECTIONS:
        if k in d and not isinstance(d[k], list):
            return f"`{k}` must be a list"
    for cp in d.get("critical_paths") or []:
        if not isinstance(cp, dict) or not str(cp.get("path_glob") or "").strip():
            return "every critical path needs a path_glob"
    if "summary" in d and not isinstance(d["summary"], str):
        return "`summary` must be a string"
    return ""


def read_profile(repo, path=None):
    """(profile, error). `error` is non-empty when there is a file but it cannot be trusted."""
    f = Path(path) if path else profile_path(repo)
    try:
        raw = f.read_text()
    except OSError:
        return None, ""
    try:
        d = json.loads(raw)
    except ValueError as e:
        return None, f"{f.name} is not valid JSON ({e})"
    err = check_shape(d)
    return (None, err) if err else (d, "")


def load_profile(repo):
    d, err = read_profile(repo)
    if err:
        print(f"profile for {repo} ignored: {err}", flush=True)
    return d


def version_path(repo, ts):
    return profile_dir(repo) / f"profile.{int(ts)}.json"


def load_version(repo, ts):
    """(profile, error) for one earlier version — the read behind the restore route."""
    if int(ts) not in versions(repo):
        return None, "no such version"
    return read_profile(repo, version_path(repo, ts))


def head_of(base, degraded=None):
    return _git(base, "rev-parse", "HEAD", degraded=degraded).strip()


def staleness(profile, base, files=None):
    """How far the profile has drifted from the checkout, or None when we cannot tell.

    meta.head was stored, returned and typed, and nothing ever compared it to anything."""
    meta = (profile or {}).get("meta") or {}
    was = (meta.get("head") or "").strip()
    base = Path(base)
    if not was or not (base / ".git").exists():
        return None
    now = head_of(base)
    if not now:
        return None
    out = {"head": was[:12], "currentHead": now[:12], "stale": was != now,
           "commitsBehind": None, "unmatchedPaths": 0, "criticalPaths": 0}
    if was != now:
        n = _git(base, "rev-list", "--count", f"{was}..{now}").strip()
        out["commitsBehind"] = int(n) if n.isdigit() else None
    if files is None:
        files = [f for f in _git(base, "ls-files").splitlines() if f]
    cps = (profile or {}).get("critical_paths") or []
    out["criticalPaths"] = len(cps)
    out["unmatchedPaths"] = sum(1 for cp in cps
                                if not _glob_matches(cp.get("path_glob", ""), files))
    if out["unmatchedPaths"]:
        out["stale"] = True
    return out


# How many superseded profile.<ts>.json versions are kept. They were never pruned, so every
# regeneration and every dashboard edit left one behind for ever. The Skills page only ever
# offers a list of them to restore from, and nobody reaches back past the last handful.
KEEP_VERSIONS = 10


def prune_versions(repo, keep=KEEP_VERSIONS):
    """Delete all but the newest `keep` profile.<ts>.json versions. Returns how many went."""
    gone = 0
    for ts in versions(repo)[keep:]:
        try:
            version_path(repo, ts).unlink()
            gone += 1
        except OSError:
            pass
    return gone


def _atomic_write(path, text):
    """Replace `path` with `text` via a temp file in the same directory, so a concurrent
    reader sees either the old file or the new one — never a missing or half-written one."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=path.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as fh:
            fh.write(text)
        os.replace(tmp, path)
    except OSError:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise


def save_profile(repo, profile, meta=None):
    """Write profile.json (+ profile.md), keeping the previous version as
    profile.<ts>.json and pruning back to the newest KEEP_VERSIONS of them.

    The live path is never moved out of the way: the previous version is archived from the
    bytes we already read, and the replacement lands with a single os.replace. A reader
    racing the write therefore always sees a complete profile.json.
    """
    d = profile_dir(repo)
    d.mkdir(parents=True, exist_ok=True)
    f = profile_path(repo)
    prev_text = None
    if f.exists():
        try:
            prev_text = f.read_text()
            prev = json.loads(prev_text)
            ts = int((prev.get("meta") or {}).get("edited_at")
                     or (prev.get("meta") or {}).get("generated_at") or f.stat().st_mtime)
        except (OSError, ValueError, TypeError):
            try:
                ts = int(f.stat().st_mtime)
            except OSError:
                ts = int(time.time())
        vf = d / f"profile.{ts}.json"
        if prev_text is not None and not vf.exists():
            with contextlib.suppress(OSError):
                _atomic_write(vf, prev_text)
    out = dict(profile)
    out["version"] = SCHEMA_VERSION
    m = dict(out.get("meta") or {})
    m.update(meta or {})
    out["meta"] = m
    _atomic_write(f, json.dumps(out, indent=1) + "\n")
    _atomic_write(d / "profile.md", to_markdown(out))
    prune_versions(repo)
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
        degraded = []
        files = [f for f in _git(base, "ls-files", degraded=degraded).splitlines() if f]
        clean, dropped, err = validate_profile(raw, files)
        if err:
            print(err, file=sys.stderr)
            return 3
        for g in dropped:
            print(f"dropped path_glob (matches nothing, or most of the tree): {g}")
        capped = (clean.get("meta") or {}).get("capped_critical_paths") or 0
        if capped:
            print(f"kept the first {MAX_CRITICAL} critical paths; {capped} more were not stored")
        save_profile(repo, clean, {"generated_at": int(time.time()),
                                   "model": usage.get("model", ""), "usage": usage or None,
                                   "dropped_globs": dropped, "validated": True,
                                   "degraded": degraded,
                                   "head": head_of(base, degraded),
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
