"""Earned confidence (trust-and-plain/design.md Part 2): the three-level badge and its reason
line, from three signals the model did not write about itself.

    Checked  evidence PASS and the disproof pass says *stands* and, when the calibration
             bucket for this skill+repo+confidence has ≥ 20 labelled findings, its keep-rate
             is ≥ 70%
    Likely   evidence PASS with no disproof verdict (not run, or not this severity) or the
             verdict *weakened*; also the fallback when the evidence could not be checked
    Maybe    any evidence WARN, the verdict *refuted*, or a calibration keep-rate < 40%

Evidence is `rs_evidence.check()`'s output. `None` (GitHub gave no diff) is "not checked", not
PASS. A lone `path_not_in_diff` flag is also "not checked", not WARN: the file is outside the
diff, so nothing about the finding could be held against it (lane1-plain.md calls this kind
legitimate and un-checkable); it cannot earn *Checked*, and it does not fall to *Maybe*. Every
other flag, and any two flags, is a WARN.

Calibration is `rs_learn.calibration_for()`'s bucket; it counts only when `usable` (n ≥ 20 and
the skill+repo's high and low buckets are not known to overlap). The model's own `confidence`
is deliberately not an input here — it steers the maybe tray before any other signal exists
and is shown under "More", never alone (design §2.3).

Standard library only; it runs in the server's render path and in the stage-fixture CLI, and
imports nothing that could reach GitHub.
"""
import json
import sys

LEVELS = ("checked", "likely", "maybe")
LABELS = {"checked": "Checked", "likely": "Likely", "maybe": "Maybe"}
CHECKED_RATE = 70.0
MAYBE_RATE = 40.0
UNCHECKABLE_FLAGS = frozenset({"path_not_in_diff"})


def evidence_state(evidence):
    """`pass`, `warn` or `none` (not checked) from an evidence verdict."""
    if not isinstance(evidence, dict) or evidence.get("status") not in ("pass", "warn"):
        return "none"
    flags = list(evidence.get("flags") or [])
    if evidence["status"] == "pass":
        return "pass"
    if len(flags) == 1 and flags[0] in UNCHECKABLE_FLAGS:
        return "none"
    return "warn"


def _sentence(text):
    """A stripped string closed with a full stop, or "" for nothing."""
    t = (text or "").strip()
    return (t + ".") if t and t[-1] not in ".!?" else t


def _pct(rate):
    return f"{float(rate):.1f}%"


def badge(evidence, checked=None, calibration=None, disproof=None):
    """{level, label, reason, inputs} for one finding.

    `checked` is the finding's `{verdict, reason, at}` or None; `calibration` is the bucket
    `{keepRate, n, usable}` or None; `disproof` is the review-level record (so the reason can
    say why there is no verdict: not run, not this severity, or the pass failed)."""
    ev = evidence_state(evidence)
    verdict = (checked or {}).get("verdict") if isinstance(checked, dict) else None
    cal = calibration if isinstance(calibration, dict) and calibration.get("usable") else None
    rate = float(cal["keepRate"]) if cal and cal.get("keepRate") is not None else None
    if ev == "warn" or verdict == "refuted" or (rate is not None and rate < MAYBE_RATE):
        level = "maybe"
    elif ev == "pass" and verdict == "stands" and (rate is None or rate >= CHECKED_RATE):
        level = "checked"
    else:
        level = "likely"

    # The reason is the card's one verdict row under Evidence, so it never repeats what the
    # Evidence row already says: the verdict word and the second pass's own sentence when there
    # is one; otherwise why there is no verdict (the evidence note only when no Evidence row is
    # shown: a WARN the badge rests on, or no evidence at all). The calibration clause last.
    parts = []
    reason_txt = _sentence((checked or {}).get("reason") if isinstance(checked, dict) else "")
    if verdict in ("stands", "weakened", "refuted"):
        parts.append(verdict.capitalize() + "." + (f" {reason_txt}" if reason_txt else ""))
    else:
        if ev == "warn":
            parts.append(_sentence(evidence.get("line")) or "The evidence check failed.")
        elif evidence is None:
            parts.append("The diff could not be checked.")
        if ev != "warn":
            st = disproof.get("status") if isinstance(disproof, dict) else None
            if st == "failed":
                parts.append("The second pass failed.")
            elif st in ("done", "partial"):
                parts.append("No second pass for this severity.")
            else:
                parts.append("No second pass ran.")
    if rate is not None:
        parts.append(f"Reviewers kept {_pct(rate)} of findings like this here.")
    reason = f"{LABELS[level]}: " + " ".join(parts)
    return {"level": level, "label": LABELS[level], "reason": reason,
            "inputs": {"evidence": ev, "disproof": verdict,
                       "keepRate": rate, "n": int(cal["n"]) if cal else None}}


def is_maybe(b):
    """True when the badge alone puts a finding in the maybe tray."""
    return bool(b) and b.get("level") == "maybe"


if __name__ == "__main__":
    # CLI for fixtures: `rs_confidence.py evidence.json review.json` where evidence.json is the
    # output of rs_evidence.py's CLI. Prints {"badges": [...]} aligned with its findings.
    if len(sys.argv) != 3:
        sys.stderr.write("usage: rs_confidence.py evidence.json review.json\n")
        sys.exit(2)
    import rs_review_schema  # noqa: E402  (dependency-free, same directory)
    with open(sys.argv[1], encoding="utf-8") as fh:
        ev_out = json.load(fh)
    with open(sys.argv[2], encoding="utf-8") as fh:
        review, _ = rs_review_schema.normalize(json.load(fh))
    comments = review.get("comments") or []
    out = []
    for row in ev_out.get("findings") or []:
        c = comments[row["i"]] if row["i"] < len(comments) else {}
        out.append(badge(row.get("evidence"), c.get("checked"), None, review.get("disproof")))
    json.dump({"badges": out}, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
