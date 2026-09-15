"""Phase 3 — independence-weighted convergence across reviews on the same PR head.

The confidence signal counts INDEPENDENT CONFIGURATIONS, not runs. Two runs that used the same
skill + model + effort are correlated (one unit), not two — even if two different people ran them.
A finding confirmed across 2+ *different* configs is a real signal; agreement between identical
configs is pseudoreplication and must not be counted as confirmation.

Matching is deliberately coarse (structural + light body-token overlap), so treat a "confirmed"
tag as a strong candidate, not proof. Pure functions here; the server loads the runs.
"""
import re

LINE_TOL = 6          # same file+severity within this many lines is treated as the same spot
_MIN_SHARED = 2       # significant body tokens two findings must share to count as "the same"

_STOP = set((
    "the a an of to and or is are be this that it for in on with as at by from into if then else "
    "not no yes can will would should could may might but so than when where which who what how "
    "you your they their its it's we our review finding line file code change pr does done also "
    "here there only just more most some any all one two use used using check checked"
).split())


def _sig(body):
    """A coarse bag of significant lowercase tokens from a finding's body."""
    return {w for w in re.findall(r"[a-z0-9_]+", (body or "").lower())
            if len(w) > 3 and w not in _STOP}


def _bucket(sev):
    """Collapse severities into agreement buckets: a blocker and a should-fix can be 'the same
    concern' — but only on the exact same line (see _match). Nits and questions stay distinct."""
    return {"blocker": "problem", "should-fix": "problem"}.get(sev, sev or "nit")


def config_sig(run):
    """What makes two runs correlated vs independent: same skill+model+effort => one unit."""
    return (run.get("skill", "global"), run.get("model", ""), run.get("effort", ""))


def _line(c):
    v = c.get("line")
    return v if isinstance(v, int) else None


def _match(a, b):
    """Are these two findings the same concern raised twice?

    The "confirmed by an independent run" badge is presented to the reviewer as evidence, so
    both error directions are real damage and both were present:

    Over-confirmation. A body too thin to judge used to fall through to a purely structural
    match, so a typo nit confirmed a null-check six lines away as long as the severities
    collapsed into the same bucket. A body with fewer than _MIN_SHARED significant tokens is
    now an honest "cannot tell" — False, not True — and two findings whose severities merely
    collapse into one bucket (blocker vs. should-fix) must sit on the SAME line, not within
    LINE_TOL of each other.

    Under-confirmation. _line() returns None for a file-level finding and any None refused the
    match, so two byte-identical file-level findings on the same path never confirmed each
    other. None now matches None on the same path, on the same token-overlap terms as any
    other pair."""
    if a.get("path") != b.get("path"):
        return False
    ba, bb = _bucket(a.get("severity")), _bucket(b.get("severity"))
    if ba != bb:
        return False
    sa, sb = _sig(a.get("body")), _sig(b.get("body"))
    if len(sa) < _MIN_SHARED or len(sb) < _MIN_SHARED:
        return False                           # too little text to tell them apart: do not guess
    if len(sa & sb) < _MIN_SHARED:
        return False
    la, lb = _line(a), _line(b)
    if la is None and lb is None:
        return True                            # two file-level findings on the same path
    if la is None or lb is None:
        return False                           # one is anchored and one is not
    tol = LINE_TOL if a.get("severity") == b.get("severity") else 0
    return abs(la - lb) <= tol


def cluster(runs):
    """Group matching findings across runs into clusters.

    `runs` is a list of {login, effort, model, skill, focus, comments:[...]}. Returns a list of
    clusters, each: {members:[(run_idx, comment)], configs:set(config_sig), logins:set,
    n_independent:int (distinct config_sigs)}.
    """
    items = []
    for ri, r in enumerate(runs):
        for c in (r.get("comments") or []):
            items.append((ri, c))
    clusters = []
    for ri, c in items:
        placed = False
        for cl in clusters:
            if any(_match(c, m[1]) for m in cl["members"]):
                cl["members"].append((ri, c))
                cl["configs"].add(config_sig(runs[ri]))
                cl["logins"].add(runs[ri]["login"])
                placed = True
                break
        if not placed:
            clusters.append({"members": [(ri, c)],
                             "configs": {config_sig(runs[ri])},
                             "logins": {runs[ri]["login"]}})
    for cl in clusters:
        cl["n_independent"] = len(cl["configs"])
    return clusters


def _differ_label(a, b):
    """Which dimension differs between two configs — what makes the confirmation independent."""
    if a[0] != b[0]:
        return "different skills"
    if a[1] != b[1]:
        return "different models"
    if a[2] != b[2]:
        return "different effort"
    return "different focus"


def tags_for(viewer_idx, runs, clusters):
    """Per-finding agreement tags for one viewer's own review.

    Returns a dict {comment_id(path,line,severity,body-hash) -> tag}. A confirmation counts only
    runs whose config differs from the viewer's (independence). Same-config agreement is suppressed.
    """
    vsig = config_sig(runs[viewer_idx])
    out = {}
    for cl in clusters:
        mine = [c for (ri, c) in cl["members"] if ri == viewer_idx]
        if not mine:
            continue
        # independent confirmers: other runs in this cluster with a DIFFERENT config than mine
        others = [(ri, c) for (ri, c) in cl["members"] if ri != viewer_idx]
        indep = [(ri, c) for (ri, c) in others if config_sig(runs[ri]) != vsig]
        indep_sigs = {config_sig(runs[ri]) for (ri, c) in indep}
        for c in mine:
            key = _cid(c)
            if indep:
                n = 1 + len(indep_sigs)
                by = sorted({runs[ri]["login"] for (ri, c2) in indep})
                differ = _differ_label(vsig, next(iter(indep_sigs)))
                out[key] = {"confirmed": True, "n": n, "by": by, "differ": differ}
            else:
                out[key] = {"confirmed": False, "n": 1, "by": [], "differ": ""}
    return out


def _cid(c):
    return (c.get("path", "?"), c.get("line", "?"), c.get("severity", "nit"),
            (c.get("body", "") or "")[:40])


def rate(clusters):
    """PR-level agreement rate: clusters confirmed by 2+ independent configs ÷ total clusters.
    Framed as precision-to-improve, never a marketing number (see the v2 spec)."""
    total = len(clusters)
    if not total:
        return {"rate": None, "confirmed": 0, "total": 0}
    conf = sum(1 for cl in clusters if cl["n_independent"] >= 2)
    return {"rate": round(100 * conf / total, 1), "confirmed": conf, "total": total}
