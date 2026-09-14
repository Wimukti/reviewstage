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

Storage: $ROOT/learnings.jsonl (ROOT defaults to ~/.reviewstage, same as the server + shell).
Only short gists are stored — high signal, low bloat. Rows carry the repo they came from;
render(repo) prefers same-repo rows and pads with the rest. Imported by server.py;
run-review.sh calls render() via `python3 -c`.
"""
import hashlib
import json
import os
import re
import time
from pathlib import Path

ROOT = Path(os.environ.get("ROOT", Path.home() / ".reviewstage"))
FILE = ROOT / "learnings.jsonl"
CAP = 300                          # keep only the most recent this many rows

# Where the human decisions about proposed rules live. Small JSON objects keyed by cluster
# signature; all three are best-effort and a missing file just means "nothing decided yet".
DISMISSALS = ROOT / "rule_dismissals.json"     # signature -> {at, by, gist, severity, dir}
PROPOSALS = ROOT / "rule_proposals.json"       # signature -> {rule, rationale, at, model}
PROMOTIONS = ROOT / "rule_promotions.json"     # signature -> {at, by, rule, target, repo}

# A cluster is only worth proposing once the team has said no this many times, across at least
# this many distinct PRs (one noisy PR is a bad day, two is a pattern).
RULE_SUGGEST_MIN = max(2, int(os.environ.get("RULE_SUGGEST_MIN") or 3))
MIN_PRS = 2


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


def record(repo, pr, user, originals_sorted, form, skill="global"):
    """Log the outcome of each original finding for one posted review.

    `originals_sorted` is review.json's comments sorted exactly as the dashboard renders them
    (by severity), so form index i lines up. `form` is the parsed POST body: sel_i present =>
    kept/edited, absent => dropped; body_i is the (possibly edited) text. `skill` is the id of
    the review skill that produced these findings ("global" or a user login), so we can score
    which skills produce findings humans actually keep.
    """
    one = lambda k: (form.get(k) or [""])[0]  # noqa: E731
    now = int(time.time())
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
        out.append(row)
    if not out:
        return
    try:
        ROOT.mkdir(parents=True, exist_ok=True)
        rows = _read() + out
        rows = rows[-CAP:]
        tmp = FILE.with_suffix(".tmp")
        tmp.write_text("".join(json.dumps(r) + "\n" for r in rows))
        os.chmod(tmp, 0o600)
        tmp.replace(FILE)
    except OSError:
        pass                       # a learning we fail to store must never break a post


# --- clustering: when a rejection stops being a mood and becomes a standard -------------------
# Similarity is deliberately cheap and dependency-free, in the same spirit as rs_agree's coarse
# matching. Two gists are "the same complaint" when the SHORTER one's significant vocabulary is
# mostly present in the other — the overlap coefficient |A∩B| / min(|A|,|B|) rather than Jaccard,
# because gists vary wildly in length ("Prefer const over let" vs. a 20-word version of the same
# note) and Jaccard would punish that asymmetry as if it were disagreement. 0.6 means "most of
# the shorter gist's real words are in the other one"; below that, paraphrases of different
# complaints start colliding. _MIN_SHARED stops two 2-token gists from matching on one word.
SIM_THRESHOLD = 0.6
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
    """Do two rows belong to the same complaint? Severity + directory + gist similarity."""
    if (a.get("severity") or "nit") != (b.get("severity") or "nit"):
        return False
    da, db = _dirkey(a.get("path", "")), _dirkey(b.get("path", ""))
    if da and db and da != db:
        return False
    return _sim(_toks(a.get("gist", "")), _toks(b.get("gist", ""))) >= SIM_THRESHOLD


def signature(rows):
    """A stable id for a cluster: severity, directory and its six commonest tokens.

    Keyed on vocabulary rather than membership so the signature survives new rows joining the
    same cluster — a dismissal made today must still match tomorrow's larger cluster."""
    freq = {}
    for r in rows:
        for t in _toks(r.get("gist", "")):
            freq[t] = freq.get(t, 0) + 1
    top = [t for t, _ in sorted(freq.items(), key=lambda kv: (-kv[1], kv[0]))[:6]]
    sev = (rows[0].get("severity") or "nit") if rows else "nit"
    key = f"{sev}|{_dirkey(rows[0].get('path', '')) if rows else ''}|{','.join(top)}"
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
            "severity": members[0].get("severity", "nit"),
            "dir": _dirkey(members[0].get("path", "")),
            "count": len(members), "prs": len(prs), "repos": repos,
            "gist": longest.get("gist", ""),
            "findings": [{"repo": m.get("repo", ""), "pr": str(m.get("pr", "")),
                          "path": m.get("path", ""), "line": m.get("line"),
                          "severity": m.get("severity", "nit"), "at": m.get("at", 0),
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
    """The sentences of a skill's managed Team-rules section — the rules already in force."""
    if not skill_text or marker not in skill_text:
        return []
    tail = skill_text.split(marker, 1)[1]
    return [ln.strip()[2:].strip() for ln in tail.splitlines() if ln.strip().startswith("- ")]


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
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=1, sort_keys=True))
        os.chmod(tmp, 0o600)
        tmp.replace(path)
        return True
    except OSError:
        return False


def dismissals():
    return _load_json(DISMISSALS)


def promotions():
    return _load_json(PROMOTIONS)


def proposals():
    return _load_json(PROPOSALS)


def dismissed_match(cluster, store=None):
    """The dismissal covering this cluster, if any.

    Signature first; then a vocabulary fallback against each dismissal's remembered gist, so a
    cluster that grows a seventh member (and with it a slightly different top-six signature)
    stays dismissed instead of popping back up."""
    store = dismissals() if store is None else store
    sig = cluster["signature"]
    if sig in store:
        return store[sig]
    ct = _toks(cluster.get("gist", ""))
    for rec in store.values():
        if rec.get("severity") == cluster.get("severity") and \
                _sim(ct, _toks(rec.get("gist", ""))) >= SIM_THRESHOLD:
            return rec
    return None


def dismiss(sig, cluster, by):
    store = dismissals()
    store[sig] = {"at": int(time.time()), "by": by, "gist": cluster.get("gist", ""),
                  "severity": cluster.get("severity", "nit"), "dir": cluster.get("dir", ""),
                  "count": cluster.get("count", 0)}
    return _save_json(DISMISSALS, store)


def undismiss(sig):
    store = dismissals()
    if store.pop(sig, None) is None:
        return False
    return _save_json(DISMISSALS, store)


def promote(sig, cluster, by, rule, target):
    store = promotions()
    repos = cluster.get("repos") or []
    store[sig] = {"at": int(time.time()), "by": by, "rule": rule, "target": target,
                  "repo": repos[0] if len(repos) == 1 else "",
                  "count": cluster.get("count", 0), "gist": cluster.get("gist", "")}
    return _save_json(PROMOTIONS, store)


def save_proposal(sig, rule, rationale, model=""):
    store = proposals()
    store[sig] = {"rule": rule, "rationale": rationale, "at": int(time.time()), "model": model}
    return _save_json(PROPOSALS, store)


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
    """The subset of `rows` belonging to a cluster that has already become a rule."""
    sigs = promoted_signatures()
    if not sigs:
        return set()
    out = set()
    for members in cluster_rows(rows):
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
        for r in dropped[-24:]:
            loc = f"{r.get('path', '')}" + (f":{r['line']}" if r.get("line") else "")
            lines.append(f"- [{r.get('severity', 'nit')}] {loc} — {r.get('gist', '')}")
    if edited:
        lines.append("\nFindings the reviewer kept but reworded (prefer this tighter phrasing "
                     "and level of detail):")
        for r in edited[-12:]:
            lines.append(f"- was: {r.get('gist', '')}\n  became: {r.get('edited_gist', '')}")
    lines.append("\nThese are preferences, not rules — still raise a genuine, higher-severity "
                 "issue even if it resembles a past drop.")
    return "\n".join(lines)


def recent(n=60):
    """Most-recent rows first, for the /learnings page."""
    return list(reversed(_read()))[:n]


def counts():
    c = {"dropped": 0, "edited": 0, "kept": 0}
    for r in _read():
        o = r.get("outcome")
        if o in c:
            c[o] += 1
    return c


def skill_stats():
    """Per-skill quality: kept / edited / dropped counts and a kept-rate, most-used first.

    This is the performance signal — which review skill produces findings humans actually
    keep — computed from real accept/reject decisions, keyed on the skill that produced them."""
    by = {}
    for r in _read():
        s = r.get("skill", "global")
        d = by.setdefault(s, {"skill": s, "kept": 0, "edited": 0, "dropped": 0, "total": 0})
        o = r.get("outcome")
        if o in ("kept", "edited", "dropped"):
            d[o] += 1
            d["total"] += 1
    for d in by.values():
        # kept + edited both mean "worth posting"; dropped means "noise". Rate = worth/total.
        d["rate"] = round(100 * (d["kept"] + d["edited"]) / d["total"]) if d["total"] else 0
    return sorted(by.values(), key=lambda d: -d["total"])


if __name__ == "__main__":       # `python3 rs_learn.py [repo]` prints the block
    import sys
    print(render(sys.argv[1] if len(sys.argv) > 1 else ""))
