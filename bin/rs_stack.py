"""rs_stack.py — work out which open PRs form a "stack".

A stack (Graphite / ghstack style) is a chain of open PRs where each one's base branch is the
previous one's head branch:

    main  <-  feat-a (#1)  <-  feat-b (#2)  <-  feat-c (#3)

The old implementation walked that chain with two `gh pr list` calls per hop, which is fine for
the on-demand stack page but far too slow to answer "is this PR stacked?" on every PR page load.
So the walk is a pure function over one list of open PRs (number / base / head), and server.py
fetches that list once per repo and caches it. Both /api/stack and /api/pr call the same walk.

No imports, no I/O — unit-tested in bin/test_rs_stack.py.
"""

MAX_DEPTH = 15          # a stack deeper than this is a cycle or a mistake; stop walking


def _norm(rows):
    """Keep the rows that carry the fields the walk needs, keyed by PR number."""
    out = {}
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        num = r.get("number")
        if not isinstance(num, int) or not r.get("headRefName"):
            continue
        out[num] = r
    return out


def _pick(rows, field, branch, seen):
    """The lowest-numbered unvisited open PR whose `field` is `branch`.

    Lowest wins so the answer is stable: with two children off the same branch (a fork in the
    stack) gh's ordering would otherwise decide which one we follow.
    """
    hits = [r for n, r in rows.items() if n not in seen and r.get(field) == branch]
    return min(hits, key=lambda r: r["number"]) if hits else None


def chain(rows, pr):
    """The stack containing PR `pr`, ordered top (nearest mainline) → bottom.

    `rows` is every open PR in the repo. Returns [] when `pr` is not among them, and a
    single-item list when it is but nothing is stacked on it.
    """
    idx = _norm(rows)
    try:
        cur = idx[int(pr)]
    except (KeyError, TypeError, ValueError):
        return []
    out, seen = [cur], {cur["number"]}
    up = cur
    for _ in range(MAX_DEPTH):                  # a PR whose head is our base is our parent
        p = _pick(idx, "headRefName", up.get("baseRefName"), seen)
        if not p:
            break
        out.insert(0, p)
        seen.add(p["number"])
        up = p
    down = cur
    for _ in range(MAX_DEPTH):                  # a PR whose base is our head is our child
        c = _pick(idx, "baseRefName", down.get("headRefName"), seen)
        if not c:
            break
        out.append(c)
        seen.add(c["number"])
        down = c
    return out


def summary(rows, pr):
    """What a PR page needs: is this PR stacked, and how many PRs are in the stack."""
    n = len(chain(rows, pr))
    return {"isStack": n > 1, "size": n}
