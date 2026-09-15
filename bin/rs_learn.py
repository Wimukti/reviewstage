"""rs_learn.py — the "Learnings" loop: capture what reviewers reject, feed it back.

Every time a reviewer unticks a finding (not worth saying) or edits its wording before posting,
that is a labeled example the dashboard already produces and used to discard. record() logs it;
render() turns recent rejections into a compact block appended to the review prompt so the agent
stops re-raising the same noise; recent() backs the read-only /learnings page.

Phase 2 of the loop turns repetition into a standard: rows that keep being dropped are clustered
(cheap token-overlap similarity, no dependencies), and a cluster the team has rejected enough
times becomes a *proposed* Team rule a human accepts or dismisses on the Skills page. Nothing is
ever written to a skill without a click. A promoted cluster leaves the rolling prompt block —
the rule carries it from then on, so the window is spent on new signal.

Storage: $ROOT/learnings.jsonl (ROOT defaults to ~/.reviewstage, same as the server + shell),
capped at CAP rows, with a never-truncated tally in $ROOT/learnings_totals.json beside it —
every "all-time" count comes from the tally, never from the capped log.
Only short gists are stored — high signal, low bloat. Rows carry the repo they came from;
render(repo) prefers same-repo rows and pads with the rest. Imported by server.py;
run-review.sh calls render() via `python3 -c`.
"""
import contextlib
import fcntl
import hashlib
import json
import os
import re
import tempfile
import time
from pathlib import Path

ROOT = Path(os.environ.get("ROOT", Path.home() / ".reviewstage"))
FILE = ROOT / "learnings.jsonl"
CAP = 300                          # the DETAIL log keeps only the most recent this many rows
TOTALS = ROOT / "learnings_totals.json"   # never-truncated running tally beside the detail log

# How many rows of each outcome render() actually puts in the prompt. Exported because the
# dashboard states these numbers to the user and must not hardcode them.
WINDOW_DROPPED = 24
WINDOW_EDITED = 12


def windows():
    return {"dropped": WINDOW_DROPPED, "edited": WINDOW_EDITED}

# No rate computed from fewer observations than this is presented as a rate: one kept finding
# is not "100%". The same floor governs the Insights keep rate and the per-skill table, so the
# product ships exactly one definition of "enough data to rate".
MIN_RATE_SAMPLE = 20

# Where the human decisions about proposed rules live. Small JSON objects keyed by cluster
# signature; all three are best-effort and a missing file just means "nothing decided yet".
DISMISSALS = ROOT / "rule_dismissals.json"     # signature -> {at, by, gist, severity, dir}
PROPOSALS = ROOT / "rule_proposals.json"       # signature -> {rule, rationale, at, model}
PROMOTIONS = ROOT / "rule_promotions.json"     # signature -> {at, by, rule, target, repo}


def _env_int(name, default, lo):
    """An int from the environment, floored at `lo`. A typo must not stop the server booting."""
    try:
        v = int(os.environ.get(name) or default)
    except (TypeError, ValueError):
        print(f"{name}={os.environ.get(name)!r} is not a number — using {default}", flush=True)
        v = default
    return max(lo, v)


# A cluster is only worth proposing once the team has said no this many times, across at least
# this many distinct PRs (one noisy PR is a bad day, two is a pattern).
RULE_SUGGEST_MIN = _env_int("RULE_SUGGEST_MIN", 3, 2)
MIN_PRS = 2


# --- concurrency + atomic writes ---------------------------------------------------------------
# Two reviewers posting at the same instant used to read the same JSON, each add their own row
# and each write the whole file back — one of the two decisions vanished, and with a shared
# `.tmp` path the two writers could even swap payloads. Every mutation now takes an exclusive
# flock on a per-file sidecar and lands through a uniquely-named temp file.
@contextlib.contextmanager
def file_lock(path):
    """Exclusive lock for one data file, held for the whole read-modify-write."""
    lf = Path(str(path) + ".lock")
    try:
        lf.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(str(lf), os.O_CREAT | os.O_RDWR, 0o600)
    except OSError:
        yield False                      # cannot lock (read-only ROOT) — proceed unserialised
        return
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield True
    finally:
        with contextlib.suppress(OSError):
            fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def _atomic_write(path, text, mode=0o600):
    """Replace `path` with `text` through a temp file unique to this writer."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=path.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as fh:
            fh.write(text)
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    except OSError:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise


def _gist(body, limit=120):
    """One-line plain-text gist of a finding body (mirrors the server's gist())."""
    t = re.sub(r"```.*?```", "", body or "", flags=re.S)
    t = re.sub(r"[`*_>#]", "", t).replace("\n", " ")
    t = re.sub(r"\s+", " ", t).strip()
    cut = t.split(". ")[0].strip(" .")
    return (cut[:limit].rstrip() + "…") if len(cut) > limit else cut


def _norm(s):
    return re.sub(r"\s+", " ", (s or "").strip()).lower()


def _read():
    rows = []
    if FILE.exists():
        for line in FILE.read_text().splitlines():
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return rows


def post_key(repo, pr, user, head=""):
    """The idempotency key for one posted review: re-recording it replaces its rows.

    `posted.json` only exists once a post has succeeded, so it could never guard a retry of the
    post that failed halfway. The key can: the second attempt at the same (repo, PR, reviewer,
    head) overwrites the first attempt's rows instead of doubling every decision."""
    return f"{(repo or '').lower()}#{pr}@{user}@{(head or '')[:12]}"


def row_id(row):
    """A stable id for one learning row — what a dismissal and a promotion are anchored to."""
    key = "|".join(str(row.get(k, "")) for k in
                   ("at", "repo", "pr", "user", "path", "line", "outcome", "gist"))
    return hashlib.sha1(key.encode()).hexdigest()[:12]


def record(repo, pr, user, originals_sorted, form, skill="global", key="", at=None):
    """Log the outcome of each original finding for one review that REACHED GitHub.

    Call this AFTER the post succeeds — never before the dry-run branch and never before the
    POST. A keep rate computed over findings that were never sent is a number about a
    hypothetical review; during a DRY_RUN pilot it is entirely hypothetical.

    `originals_sorted` is review.json's comments sorted exactly as the dashboard renders them
    (by severity), so form index i lines up. `form` is the parsed POST body: sel_i present =>
    kept/edited, absent => dropped; body_i is the (possibly edited) text. `skill` is the id of
    the review skill that produced these findings ("global" or a user login), so we can score
    which skills produce findings humans actually keep. `key` (see post_key) makes the write
    idempotent: rows already stored under the same key are replaced, not appended to.
    """
    one = lambda k: (form.get(k) or [""])[0]  # noqa: E731
    now = int(at or time.time())
    out = []
    for i, orig in enumerate(originals_sorted):
        ob = orig.get("body", "")
        selected = bool(form.get(f"sel_{i}"))
        edited_body = one(f"body_{i}")
        if not selected:
            outcome = "dropped"
        elif _norm(edited_body) != _norm(ob):
            outcome = "edited"
        else:
            outcome = "kept"
        row = {"at": now, "repo": repo, "pr": str(pr), "user": user, "skill": skill,
               "path": orig.get("path", ""), "line": orig.get("line"),
               "severity": orig.get("severity", "nit"),
               "gist": _gist(ob), "outcome": outcome}
        if orig.get("critical_path"):
            row["critical_path"] = str(orig["critical_path"])[:200]
        if outcome == "edited":
            row["edited_gist"] = _gist(edited_body)
        if key:
            row["key"] = key
        out.append(row)
    if not out:
        return
    try:
        ROOT.mkdir(parents=True, exist_ok=True)
        with file_lock(FILE):
            before = _read()
            replaced = [r for r in before if key and r.get("key") == key]
            rows = [r for r in before if r.get("key") != key] if replaced else list(before)
            _atomic_write(FILE, "".join(json.dumps(r) + "\n" for r in (rows + out)[-CAP:]))
            _bump_totals(out, undo=replaced, seed_rows=before)
    except OSError:
        pass                       # a learning we fail to store must never break a post


# --- the running tally: the only honest "all-time" ----------------------------------------------
# The detail log is capped at CAP rows so the prompt block and the /learnings page stay cheap.
# Every total derived from that log is therefore "the last CAP decisions", which is not what
# "all-time" means — and it can go DOWN as old rows fall off the end. The tally below is
# incremented once per recorded decision and never truncated, so the headline counts are real.
TOTALS_VERSION = 1


def _blank():
    return {"kept": 0, "edited": 0, "dropped": 0}


def _tally_slot(t, path):
    node = t
    for seg in path[:-1]:
        node = node.setdefault(seg, {})
    return node.setdefault(path[-1], _blank())


def _apply_row(t, row, sign):
    o = row.get("outcome")
    if o not in ("kept", "edited", "dropped"):
        return
    repo = (row.get("repo") or "").lower()
    day = _utc_daystart(int(row.get("at") or 0))
    for path in (("outcomes",), ("repos", repo or "-"), ("skills", row.get("skill") or "global"),
                 ("days", str(day))):
        _tally_slot(t, path)[o] += sign
    if row.get("critical_path"):
        for path in (("criticalPath",), ("repoCriticalPath", repo or "-")):
            _tally_slot(t, path)[o] += sign


def _utc_daystart(ts):
    """Midnight UTC of `ts`. Day buckets are UTC on both the writing and the reading side so a
    clock change never mints a key that no generated bucket can match."""
    return int(ts) - (int(ts) % 86400)


def rebuild_totals(rows):
    """A tally built from whatever rows survive in the detail log — the best an install that
    predates the tally can do. Flagged `complete: false` so nothing claims it is all-time."""
    t = {"version": TOTALS_VERSION, "cap": CAP, "complete": False,
         "outcomes": _blank(), "criticalPath": _blank(),
         "repos": {}, "repoCriticalPath": {}, "skills": {}, "days": {}}
    for r in rows:
        _apply_row(t, r, 1)
    return t


def load_totals(root=None):
    """The running tally, seeded from the detail log the first time it is asked for."""
    p = (Path(root) / "learnings_totals.json") if root else TOTALS
    try:
        v = json.loads(p.read_text())
        if isinstance(v, dict) and v.get("version") == TOTALS_VERSION:
            v.setdefault("cap", CAP)
            return v
    except (OSError, ValueError):
        pass
    log = (Path(root) / "learnings.jsonl") if root else FILE
    rows = []
    try:
        for line in log.read_text().splitlines():
            with contextlib.suppress(json.JSONDecodeError):
                rows.append(json.loads(line))
    except OSError:
        pass
    return rebuild_totals(rows)


def _bump_totals(added, undo=(), seed_rows=None):
    """Fold one post's decisions into the tally (caller holds the log's lock).

    `seed_rows` is the detail log as it stood BEFORE this post — the only thing an install
    that predates the tally can be seeded from, and never including the rows being added."""
    try:
        t = None
        try:
            v = json.loads(TOTALS.read_text())
            t = v if isinstance(v, dict) and v.get("version") == TOTALS_VERSION else None
        except (OSError, ValueError):
            t = None
        if t is None:
            t = rebuild_totals(seed_rows or [])
            t["complete"] = not (seed_rows or [])   # nothing predates us: this really is all-time
        for r in undo:
            _apply_row(t, r, -1)
        for r in added:
            _apply_row(t, r, 1)
        t["cap"] = CAP
        _atomic_write(TOTALS, json.dumps(t, indent=1, sort_keys=True))
    except (OSError, ValueError):
        pass


# --- clustering: when a rejection stops being a mood and becomes a standard -------------------
# Similarity is deliberately cheap and dependency-free, in the same spirit as rs_agree's coarse
# matching. Two gists are "the same complaint" when at least half of the SHORTER one's
# significant vocabulary appears in the other — the overlap coefficient |A∩B| / min(|A|,|B|)
# rather than Jaccard, because gists vary wildly in length ("Prefer const over let" vs. a
# 20-word version of the same note) and Jaccard would punish that asymmetry as if it were
# disagreement. 0.5 is where real paraphrases land once stopwords are gone: two people writing
# the same complaint agree on the nouns and little else ("const/binding" survives, "prefer" vs.
# "rather than" does not). It is a loose bar on its own, so it never stands on its own — a match
# also needs the same severity, the same top-two directory segments and at least _MIN_SHARED
# tokens in common, which is what stops one shared word from merging two complaints.
SIM_THRESHOLD = 0.5
_MIN_SHARED = 2

_STOP = set((
    "the a an of to and or is are be this that it for in on with as at by from into if then else "
    "not no yes can will would should could may might but so than when where which who what how "
    "you your they their its we our review finding line file code change pr does done also here "
    "there only just more most some any all one two use used using need needs make makes"
).split())


def _stem(w):
    """Crude suffix trim so 'guards', 'guarded' and 'guarding' land on the same token."""
    for suf in ("ing", "ed", "es", "s"):
        if len(w) > len(suf) + 3 and w.endswith(suf):
            return w[: -len(suf)]
    return w


def _toks(text):
    """The significant vocabulary of a gist or a rule sentence."""
    return {_stem(w) for w in re.findall(r"[a-z0-9_]+", (text or "").lower())
            if len(w) > 3 and w not in _STOP}


def _sim(a, b):
    """Overlap coefficient of two token sets, 0.0 when either side is too thin to judge."""
    if len(a) < _MIN_SHARED or len(b) < _MIN_SHARED:
        return 0.0
    shared = len(a & b)
    if shared < _MIN_SHARED:
        return 0.0
    return shared / min(len(a), len(b))


def _dirkey(path):
    """The path's top two directory segments — 'app/models/Product.php' -> 'app/models'.

    Same complaint in a different corner of the tree is usually a different rule, so the
    directory is part of the grouping. An empty path (a summary-level finding) matches anything:
    we only split on the directory when both sides actually have one."""
    parts = [p for p in (path or "").split("/") if p][:-1]
    return "/".join(parts[:2])


def _same_group(a, b):
    """Do two rows belong to the same complaint? Outcome + severity + directory + similarity.

    Outcome is part of the identity: "the team keeps dropping this" and "the team keeps
    rewording this" are different findings about the review, and a cluster that mixes them has
    a different signature from the dropped-only cluster a rule was promoted from — which is
    exactly how a promoted rule used to stay in the rolling prompt window for ever."""
    if a.get("outcome") != b.get("outcome"):
        return False
    if (a.get("severity") or "nit") != (b.get("severity") or "nit"):
        return False
    da, db = _dirkey(a.get("path", "")), _dirkey(b.get("path", ""))
    if da and db and da != db:
        return False
    return _sim(_toks(a.get("gist", "")), _toks(b.get("gist", ""))) >= SIM_THRESHOLD


def _commonest(values):
    freq = {}
    for v in values:
        if v:
            freq[v] = freq.get(v, 0) + 1
    return sorted(freq.items(), key=lambda kv: (-kv[1], kv[0]))[0][0] if freq else ""


def signature(rows):
    """A stable id for a cluster: severity, directory and its six commonest tokens, sorted.

    Keyed on vocabulary rather than membership so the signature survives new rows joining the
    same cluster — a dismissal made today must still match tomorrow's larger cluster. The tokens
    are sorted before hashing so a shift in their relative frequency does not mint a new id."""
    freq = {}
    for r in rows:
        for t in _toks(r.get("gist", "")):
            freq[t] = freq.get(t, 0) + 1
    top = sorted(t for t, _ in sorted(freq.items(), key=lambda kv: (-kv[1], kv[0]))[:6])
    sev = _commonest(r.get("severity") or "nit" for r in rows) or "nit"
    key = f"{sev}|{_commonest(_dirkey(r.get('path', '')) for r in rows)}|{','.join(top)}"
    return hashlib.sha1(key.encode()).hexdigest()[:12]


def cluster_rows(rows):
    """Greedy single-link grouping of learning rows into complaint clusters, biggest first.

    Single-link (a row joins a cluster if it matches ANY member) is the right bias here: gists
    are short, so a chain of near-paraphrases is one complaint, not three."""
    clusters = []
    for r in rows:
        for cl in clusters:
            if any(_same_group(r, m) for m in cl):
                cl.append(r)
                break
        else:
            clusters.append([r])
    return sorted(clusters, key=lambda c: -len(c))


def _cluster_info(members, outcome):
    prs = sorted({f"{m.get('repo', '')}#{m.get('pr', '')}" for m in members})
    repos = sorted({m.get("repo", "") for m in members if m.get("repo")})
    longest = max(members, key=lambda m: len(m.get("gist", "")))
    return {"signature": signature(members), "outcome": outcome,
            "severity": _commonest(m.get("severity") or "nit" for m in members) or "nit",
            "dir": _commonest(_dirkey(m.get("path", "")) for m in members),
            "count": len(members), "prs": len(prs), "repos": repos,
            "gist": longest.get("gist", ""),
            "rowIds": [row_id(m) for m in members],
            "findings": [{"repo": m.get("repo", ""), "pr": str(m.get("pr", "")),
                          "path": m.get("path", ""), "line": m.get("line"),
                          "severity": m.get("severity", "nit"), "at": m.get("at", 0),
                          "rid": row_id(m),
                          "gist": m.get("gist", "")} for m in members]}


def clusters(outcome="dropped", rows=None, min_rows=None):
    """Qualifying clusters of one outcome, richest first.

    A cluster qualifies as evidence when it holds >= min_rows rows from >= MIN_PRS distinct PRs.
    Coverage by an existing rule is checked separately (the caller owns the skills)."""
    mn = RULE_SUGGEST_MIN if min_rows is None else min_rows
    src = _read() if rows is None else rows
    src = [r for r in src if r.get("outcome") == outcome]
    out = [_cluster_info(c, outcome) for c in cluster_rows(src)]
    return [c for c in out if c["count"] >= mn and c["prs"] >= MIN_PRS]


def parse_rules(skill_text, marker="## Team rules"):
    """The sentences of a skill's managed Team-rules section — the rules already in force.

    Parsing stops at the next heading. The section is not guaranteed to be last (a hand-edited
    skill can have anything after it), and reading every later bullet in the document as a team
    rule turned a skill's own prose into invented rules."""
    if not skill_text or marker not in skill_text:
        return []
    tail = skill_text.split(marker, 1)[1]
    out = []
    for ln in tail.splitlines():
        s = ln.strip()
        if s.startswith("#"):
            break
        if s.startswith("- "):
            out.append(s[2:].strip())
    return out


def covered_by_rule(cluster, rules):
    """Is this complaint already a Team rule? Same similarity function, rule text vs. gists."""
    rule_toks = [_toks(r) for r in rules]
    for f in cluster.get("findings", []):
        ft = _toks(f.get("gist", ""))
        if any(_sim(ft, rt) >= SIM_THRESHOLD for rt in rule_toks):
            return True
    return False


# --- the three little decision stores ---------------------------------------------------------
def _load_json(path):
    try:
        v = json.loads(path.read_text())
        return v if isinstance(v, dict) else {}
    except (OSError, ValueError):
        return {}


def _save_json(path, data):
    try:
        ROOT.mkdir(parents=True, exist_ok=True)
        _atomic_write(path, json.dumps(data, indent=1, sort_keys=True))
        return True
    except OSError:
        return False


def _update_json(path, fn):
    """Read-modify-write one decision store under its own lock. Two accepts landing together
    used to read the same store and write back one rule each — one was silently lost while
    BOTH were marked promoted, so the lost one could never be suggested again."""
    try:
        ROOT.mkdir(parents=True, exist_ok=True)
        with file_lock(path):
            store = _load_json(path)
            fn(store)
            _atomic_write(path, json.dumps(store, indent=1, sort_keys=True))
        return True
    except OSError:
        return False


def dismissals():
    return _load_json(DISMISSALS)


def promotions():
    return _load_json(PROMOTIONS)


def proposals():
    return _load_json(PROPOSALS)


# A dismissal used to fall back to "same severity and 0.5 similarity against the remembered
# gist" — and the remembered gist is the LONGEST member's, which drifts every time the cluster
# grows. That both suppressed complaints the person never dismissed and, once the gist moved,
# resurrected the one they did. Dismissals are anchored to the row ids they were made over;
# the fallback exists only for a cluster that has since been rewritten wholesale, and is held
# to a much higher bar plus the same directory.
DISMISS_FALLBACK_SIM = 0.85


def dismissed_match(cluster, store=None):
    """The dismissal covering this cluster, if any."""
    store = dismissals() if store is None else store
    sig = cluster["signature"]
    if sig in store:
        return store[sig]
    rids = set(cluster.get("rowIds") or [])
    for rec in store.values():
        if rids & set(rec.get("rowIds") or []):
            return rec                     # the evidence dismissed is still in this cluster
    ct = _toks(cluster.get("gist", ""))
    for rec in store.values():
        if rec.get("severity") == cluster.get("severity") \
                and rec.get("outcome", cluster.get("outcome")) == cluster.get("outcome") \
                and (rec.get("dir") or "") == (cluster.get("dir") or "") \
                and _sim(ct, _toks(rec.get("gist", ""))) >= DISMISS_FALLBACK_SIM:
            return rec
    return None


def dismiss(sig, cluster, by):
    rec = {"at": int(time.time()), "by": by, "gist": cluster.get("gist", ""),
           "severity": cluster.get("severity", "nit"), "dir": cluster.get("dir", ""),
           "outcome": cluster.get("outcome", "dropped"),
           "rowIds": list(cluster.get("rowIds") or []),
           "count": cluster.get("count", 0)}
    return _update_json(DISMISSALS, lambda s: s.__setitem__(sig, rec))


def undismiss(sig):
    if sig not in dismissals():
        return False
    return _update_json(DISMISSALS, lambda s: s.pop(sig, None))


def promote(sig, cluster, by, rule, target):
    repos = cluster.get("repos") or []
    rec = {"at": int(time.time()), "by": by, "rule": rule, "target": target,
           "repo": repos[0] if len(repos) == 1 else "",
           "outcome": cluster.get("outcome", "dropped"),
           "rowIds": list(cluster.get("rowIds") or []),
           "count": cluster.get("count", 0), "gist": cluster.get("gist", "")}
    return _update_json(PROMOTIONS, lambda s: s.__setitem__(sig, rec))


def save_proposal(sig, rule, rationale, model="", error=""):
    """Cache one drafted rule — or the reason drafting failed, so the Skills page can show it
    instead of spending the user's Claude quota on the same failing call every time it loads."""
    rec = {"rule": rule, "rationale": rationale, "at": int(time.time()), "model": model}
    if error:
        rec["error"] = error[:300]
    return _update_json(PROPOSALS, lambda s: s.__setitem__(sig, rec))


def promoted_signatures():
    return set(promotions())


def promoted_count(repo=""):
    """How many rules the team promoted from evidence — the one Insights number."""
    n = 0
    for rec in promotions().values():
        if repo and rec.get("repo") and rec["repo"].lower() != repo.lower():
            continue
        n += 1
    return n


def _promoted_rows(rows):
    """The subset of `rows` belonging to a cluster that has already become a rule.

    Two independent handles on the same question, because the headline claim of the loop is
    that a promoted rule LEAVES the rolling window: the row ids recorded when the rule was
    accepted (exact, and immune to the cluster changing shape afterwards), plus a re-cluster
    per outcome for rows that joined the complaint after the promotion. Re-clustering the
    dropped and edited rows together — as this used to — produced merged clusters whose
    signature never matched the dropped-only one that was promoted, so nothing was ever
    skipped and every promoted complaint stayed in the prompt for ever."""
    proms = promotions()
    if not proms:
        return set()
    promoted_ids = set()
    for rec in proms.values():
        promoted_ids.update(rec.get("rowIds") or [])
    sigs = set(proms)
    out = {id(r) for r in rows if row_id(r) in promoted_ids}
    by_outcome = {}
    for r in rows:
        by_outcome.setdefault(r.get("outcome"), []).append(r)
    for group in by_outcome.values():
        for members in cluster_rows(group):
            if signature(members) in sigs:
                out.update(id(m) for m in members)
    return out


def cluster_status(max_clusters=8):
    """One line per complaint cluster for the Learnings page: still rolling, or now a rule."""
    proms, dis = promotions(), dismissals()
    out = []
    for outcome in ("dropped", "edited"):
        for c in clusters(outcome, min_rows=2):
            sig = c["signature"]
            rec = proms.get(sig)
            out.append({"signature": sig, "gist": c["gist"], "severity": c["severity"],
                        "count": c["count"], "prs": c["prs"], "outcome": outcome,
                        "status": "promoted" if rec else
                                  ("dismissed" if dismissed_match(c, dis) else "rolling"),
                        "rule": (rec or {}).get("rule", "")})
    out.sort(key=lambda c: (c["status"] != "promoted", -c["count"]))
    return out[:max_clusters]


def render(repo="", max_items=40):
    """A compact prompt block of recent dropped/edited findings, or "" if nothing learned.

    Appended to the review prompt so the agent weighs the reviewer's past decisions. Rows from
    the same repo come first (they are about this codebase); rows from other repos — or legacy
    rows with no repo — fill whatever room is left, so a new repo still benefits from the team's
    general preferences."""
    rows = [r for r in _read() if r.get("outcome") in ("dropped", "edited")]
    # A cluster the team promoted to a Team rule is already in the skill; repeating it here
    # would spend the 40-row window restating what the rule says. Drop those rows.
    skip = _promoted_rows(rows)
    promoted = len(skip)
    rows = [r for r in rows if id(r) not in skip]
    if not rows:
        return ""
    if repo:
        same = [r for r in rows if (r.get("repo") or "").lower() == repo.lower()][-max_items:]
        other = [r for r in rows if (r.get("repo") or "").lower() != repo.lower()]
        rows = other[-(max_items - len(same)):] + same if len(same) < max_items else same
    else:
        rows = rows[-max_items:]
    dropped = [r for r in rows if r["outcome"] == "dropped"]
    edited = [r for r in rows if r["outcome"] == "edited"]
    lines = ["\n\nReviewer preferences learned from past reviews"
             + (f" (mostly on {repo})" if repo else "") + " — weigh these:"]
    if promoted:
        lines.append("(Rejections the team repeated often enough are now Team rules in the skill "
                     "above and are deliberately left out of this list — follow the rules for "
                     "those; what follows is newer, softer signal.)")
    if dropped:
        lines.append("\nFindings the reviewer chose NOT to post (treat near-duplicates as noise "
                     "and omit them unless clearly higher-stakes here):")
        for r in dropped[-WINDOW_DROPPED:]:
            loc = f"{r.get('path', '')}" + (f":{r['line']}" if r.get("line") else "")
            lines.append(f"- [{r.get('severity', 'nit')}] {loc} — {r.get('gist', '')}")
    if edited:
        lines.append("\nFindings the reviewer kept but reworded (prefer this tighter phrasing "
                     "and level of detail):")
        for r in edited[-WINDOW_EDITED:]:
            lines.append(f"- was: {r.get('gist', '')}\n  became: {r.get('edited_gist', '')}")
    lines.append("\nThese are preferences, not rules — still raise a genuine, higher-severity "
                 "issue even if it resembles a past drop.")
    return "\n".join(lines)


def recent(n=60):
    """Most-recent rows first, for the /learnings page."""
    return list(reversed(_read()))[:n]


def counts():
    """All-time outcome counts, from the running tally — not from the capped detail log."""
    t = load_totals()
    c = dict(t.get("outcomes") or _blank())
    return {"dropped": c.get("dropped", 0), "edited": c.get("edited", 0),
            "kept": c.get("kept", 0)}


# One definition of "keep rate" ships in this product: a finding was worth posting when the
# reviewer kept it, verbatim or reworded. The stricter kept-verbatim measure is a different
# number with a different name (`verbatimRate`), never called the keep rate.
def keep_rates(d):
    """{keepRate, verbatimRate, decided, keptOrEdited, ratable, minSample} for one bucket."""
    kept, edited, dropped = d.get("kept", 0), d.get("edited", 0), d.get("dropped", 0)
    total = kept + edited + dropped
    ratable = total >= MIN_RATE_SAMPLE
    pct = lambda n: round(100 * n / total, 1) if total else None  # noqa: E731
    return {"kept": kept, "edited": edited, "dropped": dropped, "decided": total,
            "keptOrEdited": kept + edited, "keepRate": pct(kept + edited),
            "verbatimRate": pct(kept), "ratable": ratable, "minSample": MIN_RATE_SAMPLE}


def skill_stats():
    """Per-skill quality: kept / edited / dropped counts and the keep rate, most-used first.

    This is the performance signal — which review skill produces findings humans actually
    keep — computed from real accept/reject decisions, keyed on the skill that produced them.
    All-time from the running tally, so a skill's history does not evaporate with the log."""
    by = {}
    for skill, d in (load_totals().get("skills") or {}).items():
        r = keep_rates(d)
        by[skill] = {"skill": skill, "kept": r["kept"], "edited": r["edited"],
                     "dropped": r["dropped"], "total": r["decided"],
                     "keptOrEdited": r["keptOrEdited"],
                     "rate": r["keepRate"] if r["keepRate"] is not None else 0,
                     "verbatimRate": r["verbatimRate"], "ratable": r["ratable"],
                     "minSample": MIN_RATE_SAMPLE}
    return sorted(by.values(), key=lambda d: -d["total"])


if __name__ == "__main__":       # `python3 rs_learn.py [repo]` prints the block
    import sys
    print(render(sys.argv[1] if len(sys.argv) > 1 else ""))
