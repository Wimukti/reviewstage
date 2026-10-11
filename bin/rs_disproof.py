"""The disproof pass (trust-and-plain/design.md §2.1): the brief for a second Claude run with the
opposite job, and the reading of its answer.

The main run argues *for* each finding. This pass is handed the finding set — title, where,
what to check, expected, actual, impact — plus the files it cites, and is asked for the
strongest reason each one is wrong, already handled or harmless. It answers one word per
finding, `stands` / `weakened` / `refuted`, with one sentence. The verdict is stored beside the
finding as `checked = {verdict, reason, at}` and the review carries `disproof = {status, n,
checked, duration_ms, mode}`; the three-level badge (rs_confidence) reads both.

Which findings are checked: by default the ones whose severity maps to the fixed words
*breaks* (`blocker`) and *can break* (`should-fix`). The per-run toggle "Check all findings"
(`mode = all`) checks every one; `off` checks none.

This module is standard library only and imports nothing that could reach GitHub — it runs
inside run-review.sh between the main run and the cache write (openspec/config.yaml, property
1: the review step has no GitHub write path). The pass itself runs through the same agent_env
and deny list as the main run, and run-review.sh fingerprints the PR before and after it.

    python3 rs_disproof.py select <review.json> <mode>            → {"indices", "prompt", "n", "timeout_s"}
    python3 rs_disproof.py merge  <review.json> <raw> <mode> <status> <duration_ms> [indices]
                                                                   → "stands=1 weakened=0 refuted=0 failed=0"
"""
import json
import os
import re
import sys
import time

import rs_review_schema as S

VERDICTS = S.CHECK_VERDICTS
MODES = ("default", "all", "off")
# Severity → the fixed severity word (design §1.1); the default pass covers the first two.
SEVERITY_WORDS = {"blocker": "breaks", "should-fix": "can break", "nit": "style",
                  "question": "unclear"}
DEFAULT_SEVERITIES = ("blocker", "should-fix")
# The time estimate shown beside the toggle and used for the pass's own timeout. One finding is
# one file read and one short answer; the floor covers the CLI's start-up.
SEC_PER_FINDING = 40
MIN_TIMEOUT_S = 300
MAX_TIMEOUT_S = 900
REASON_WORDS = 20
REASON_CHARS = S.CHECK_REASON_CAP
OUTPUT_FILE = "disproof.json"


def mode_of(value):
    """A mode from the environment / request, folded to MODES (anything else is `default`)."""
    v = (value or "").strip().lower()
    return v if v in MODES else "default"


def select(review, mode="default"):
    """Indices (into review.comments) of the findings this pass checks."""
    mode = mode_of(mode)
    if mode == "off":
        return []
    comments = review.get("comments") or []
    if mode == "all":
        return list(range(len(comments)))
    return [i for i, c in enumerate(comments)
            if isinstance(c, dict) and c.get("severity") in DEFAULT_SEVERITIES]


def estimate_seconds(n):
    """How long the pass adds, for `n` findings."""
    return int(n) * SEC_PER_FINDING if n else 0


def timeout_seconds(n):
    return max(MIN_TIMEOUT_S, min(MAX_TIMEOUT_S, estimate_seconds(n) + 60))


def _loc(c):
    where = c.get("where") if isinstance(c.get("where"), dict) else None
    path = (where or {}).get("path") or c.get("path") or "?"
    start = (where or {}).get("start") or c.get("line")
    end = (where or {}).get("end") or start
    if start is None:
        return path
    return f"{path}:{start}" if start == end else f"{path}:{start}-{end}"


def finding_block(i, c):
    """One finding as the pass sees it: the plain rows only, never the GitHub body."""
    rows = [f"id: {i}", f"severity: {SEVERITY_WORDS.get(c.get('severity'), c.get('severity'))}",
            f"where: {_loc(c)}", f"title: {c.get('title') or ''}"]
    for k, label in (("what_to_check", "what to check"), ("expected", "expected"),
                     ("actual", "actual"), ("impact", "impact")):
        if c.get(k):
            rows.append(f"{label}: {c[k]}")
    return "\n".join(rows)


def cited_paths(review, indices):
    out = []
    for i in indices:
        c = (review.get("comments") or [])[i]
        where = c.get("where") if isinstance(c.get("where"), dict) else None
        p = (where or {}).get("path") or c.get("path")
        if p and p not in out:
            out.append(p)
    return out


def brief(review, indices, repo="", pr=""):
    """The prompt body: the opposite brief, the findings, the files to read, the output
    contract. The skill text (skills/pr-disproof/SKILL.md) goes in front of it."""
    comments = review.get("comments") or []
    blocks = "\n\n".join(finding_block(i, comments[i]) for i in indices)
    files = "\n".join(f"  - {p}" for p in cited_paths(review, indices)) or "  (none cited)"
    head = f"PR #{pr} of {repo}. " if repo and pr else ""
    return f"""{head}A first review pass produced the findings below. Your job is the OPPOSITE one:
for each finding, find the strongest reason it is wrong, already handled, or harmless. Read the
cited lines in the checked-out code (this directory is the PR's branch). Look for the handling
the finding says is missing, a caller that makes the case impossible, a test that covers it, or
a reason the impact does not happen.

Then answer per finding, in one word and one sentence:
  - stands   — you looked and found no reason it is wrong; the expected/actual contrast holds.
  - weakened — it is real but smaller than stated, or partly handled; say what you found.
  - refuted  — it is wrong, already handled, or cannot happen; say where.

FINDINGS
{blocks}

FILES THEY CITE (read these first)
{files}

Do NOT post anything, run no git command that writes, and do not change any file except the
answer. Write the answer to ./{OUTPUT_FILE} as one JSON object:
{{"results":[{{"id":<the id above>,"verdict":"stands|weakened|refuted","reason":"ONE sentence, max {REASON_WORDS} words, naming the line or the handling you found"}}]}}
One entry per id, every id answered. The reason is shown to a reviewer on a card, so write it
plain: name the function or line, no hedges."""


def _one_sentence(text):
    t = " ".join(str(text or "").split())
    if not t:
        return ""
    # Keep the first sentence; cap the words so a paragraph cannot sneak onto the card.
    first = re.split(r"(?<=[.!?])\s+", t, maxsplit=1)[0]
    words = first.split()
    if len(words) > REASON_WORDS:
        first = " ".join(words[:REASON_WORDS]).rstrip(",;:") + "…"
    return first[:REASON_CHARS]


def parse(raw, indices=None, warnings=None):
    """{index: {"verdict", "reason"}} from the agent's answer — a dict with `results`, a bare
    list, or the JSON text of either. Tolerant: an id as a string, a verdict in any case or with
    punctuation, a missing reason. Anything unparseable is skipped with a warning and never
    raises; an id outside `indices` (when given) is ignored."""
    if warnings is None:
        warnings = []
    if isinstance(raw, (str, bytes)):
        try:
            raw = json.loads(raw)
        except ValueError:
            # The agent may have wrapped the object in prose or a fence: take the outermost {…}.
            text = raw.decode("utf-8", "replace") if isinstance(raw, bytes) else raw
            m = re.search(r"\{.*\}", text, re.S)
            try:
                raw = json.loads(m.group(0)) if m else None
            except ValueError:
                raw = None
            if raw is None:
                warnings.append("disproof: output is not JSON")
                return {}
    rows = raw.get("results") if isinstance(raw, dict) else raw
    if isinstance(raw, dict) and rows is None:
        rows = raw.get("findings") or raw.get("verdicts")
    if not isinstance(rows, list):
        warnings.append("disproof: no results array")
        return {}
    allowed = set(indices) if indices is not None else None
    out = {}
    for row in rows:
        if not isinstance(row, dict):
            warnings.append("disproof: a result is not an object; skipped")
            continue
        try:
            i = int(str(row.get("id", row.get("i", ""))).strip())
        except ValueError:
            warnings.append(f"disproof: result id {row.get('id')!r} is not a number; skipped")
            continue
        if allowed is not None and i not in allowed:
            warnings.append(f"disproof: result id {i} was not asked for; skipped")
            continue
        v = re.sub(r"[^a-z]", "", str(row.get("verdict") or "").lower())
        if v not in VERDICTS:
            warnings.append(f"disproof: result {i} verdict {row.get('verdict')!r} is not one of "
                            f"{'|'.join(VERDICTS)}; skipped")
            continue
        out[i] = {"verdict": v, "reason": _one_sentence(row.get("reason"))}
    return out


def merge(review, results, indices, mode="default", status="done", duration_ms=0, at=None):
    """Write the verdicts into the review (in place) and return the verdict counts, including
    `failed` for a finding that was asked about and got no usable answer."""
    now = int(at or time.time())
    comments = review.get("comments") or []
    counts = {v: 0 for v in VERDICTS}
    counts["failed"] = 0
    for i in indices:
        if i >= len(comments) or not isinstance(comments[i], dict):
            continue
        r = results.get(i)
        if r:
            comments[i]["checked"] = {"verdict": r["verdict"], "reason": r["reason"], "at": now}
            counts[r["verdict"]] += 1
        else:
            comments[i]["checked"] = None
            counts["failed"] += 1
    if status == "done" and counts["failed"]:
        status = "partial" if len(results) else "failed"
    review["disproof"] = {"status": status, "n": len(indices), "checked": len(results),
                          "duration_ms": max(0, int(duration_ms or 0)), "mode": mode_of(mode)}
    return counts


def _load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _main(argv):
    if len(argv) >= 3 and argv[0] == "select":
        review, _ = S.normalize(_load(argv[1]))
        idx = select(review, argv[2])
        out = {"indices": idx, "n": len(idx), "timeout_s": timeout_seconds(len(idx)),
               "prompt": brief(review, idx, os.environ.get("RS_REPO", ""),
                               os.environ.get("RS_PR", "")) if idx else ""}
        json.dump(out, sys.stdout, ensure_ascii=False)
        sys.stdout.write("\n")
        return 0
    if len(argv) >= 6 and argv[0] == "merge":
        path, raw_path, mode, status, duration = argv[1:6]
        review, _ = S.normalize(_load(path))
        indices = ([int(x) for x in argv[6].split(",") if x.strip()] if len(argv) > 6
                   else select(review, mode))
        warnings = []
        results = {}
        if status == "done":
            try:
                with open(raw_path, encoding="utf-8") as fh:
                    results = parse(fh.read(), indices, warnings)
            except OSError:
                warnings.append(f"disproof: no {raw_path}")
                status = "failed"
        counts = merge(review, results, indices, mode=mode, status=status,
                       duration_ms=duration)
        for w in warnings:
            sys.stderr.write(f"[disproof] {w}\n")
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(review, fh, ensure_ascii=False)
        os.replace(tmp, path)
        print(" ".join(f"{k}={counts[k]}" for k in (*VERDICTS, "failed")))
        return 0
    sys.stderr.write(__doc__)
    return 2


if __name__ == "__main__":
    raise SystemExit(_main(sys.argv[1:]))
