"""The finding contract, as the server and the job script read it — one reading of each field.

The review step writes `review.json` from whatever skill the reviewer chose, so a finding can be
anything from the full contract (`title`, `impact`, `how_to_verify`, `confidence`) to the bare
`{path, line, severity, body}` that custom skills and the first year of runs produced. This
module gives every consumer the same finding:

  - the vocabularies hold: `severity` is one of SEVERITIES, `confidence` one of CONFIDENCES or
    None when the run never stated one — an unknown word is coerced (nit / medium) with a warning,
    never dropped and never fatal;
  - `impact` accepts `why_it_matters` as a synonym — the label the card shows — so a skill that
    emits the label instead of the field still renders;
  - `how_to_verify` is ONE imperative line of at most VERIFY_CAP characters; anything longer or
    multi-line is dropped (with a warning) rather than rendered as a paragraph, because the card
    promises "under two minutes" and a paragraph is the sign the model did not have one;
  - missing text fields are None, so a card can omit a row instead of printing an empty label;
  - `what_to_check`, `expected`, `actual` (trust-and-plain §1.3) are plain one-line strings or
    None; `where` is normalised to {path, start, end} from `path:line` (and an optional `end`,
    `end_line` or `lines: "44-51"`), or None when the finding has no line;
  - the review-level `guide` block (§1.2: does / why / risk / read_plan / not_covered) is read
    from `guide`, `reading_guide`, or an object-valued `summary`; every field is optional and an
    older review gets `guide: None`. The verdict string stays `summary` — the post body and the
    notify card read it — so an object there is moved aside, never rendered as a dict;
  - every string the review emits is linted against the writing rules (§1.1): sentences over the
    word limit and hedges become `plain:` warnings, trailing hedges are stripped and double
    spaces collapsed. Warnings never reject a finding.

Normalisation never raises and never rejects a review: a run from before this contract renders
exactly as it did. Deliberately dependency-free — it runs inside the review step, which has no
GitHub write path (openspec/config.yaml, property 1), so it must import nothing that could reach
one. The CLI form (`python3 rs_review_schema.py review.json`) rewrites the file in place and
prints warnings to stderr; `bin/run-review.sh` calls it right after the jq shape check.
"""
import json
import os
import re
import sys

SEVERITIES = ("blocker", "should-fix", "nit", "question")
CONFIDENCES = ("high", "medium", "low")
DEFAULT_SEVERITY = "nit"
DEFAULT_CONFIDENCE = "medium"
VERIFY_CAP = 160
TEXT_FIELDS = ("title", "impact", "how_to_verify", "what_to_check", "expected", "actual")
IMPACT_SYNONYMS = ("why_it_matters", "whyItMatters")
VERIFY_SYNONYMS = ("howToVerify", "verify", "verification")
CHECK_SYNONYMS = ("whatToCheck", "check")
RISKS = ("breaks", "can break", "safe-looking", "unclear")
# The disproof pass (trust-and-plain §2.1): a second run's verdict on a finding, stored beside
# it as `checked = {verdict, reason, at}`. Anything outside this list is dropped at load.
CHECK_VERDICTS = ("stands", "weakened", "refuted")
CHECK_REASON_CAP = 200
GUIDE_SYNONYMS = ("reading_guide", "readingGuide")
READ_PLAN_SYNONYMS = ("readPlan", "read_in_this_order", "plan")
NOT_COVERED_SYNONYMS = ("notCovered", "not_reviewed", "skipped")
READ_PLAN_CAP = 12
NOT_COVERED_CAP = 12

# --- the writing rules (trust-and-plain/design.md §1.1) -------------------------------------------
# One sentence, one idea. Instructions (the lines that tell the reviewer what to do) get 20 words,
# descriptions 25. The limits are warnings: a long sentence is still rendered, the counter tells
# us whether the prompt is being obeyed.
INSTRUCTION_WORDS = 20
DESCRIPTION_WORDS = 25
INSTRUCTION_FIELDS = ("how_to_verify", "what_to_check")
# Hedges the rules forbid. Found anywhere → a warning; found at the end of a string → stripped.
HEDGES = ("might possibly", "may possibly", "could possibly", "it should be noted that",
          "it should be noted", "it seems that", "it seems like", "it seems", "it appears that",
          "it appears", "arguably", "perhaps", "possibly", "potentially", "i think", "i believe",
          "in my opinion", "sort of", "kind of", "somewhat", "probably")
_HEDGE_RE = re.compile(r"\b(" + "|".join(re.escape(h) for h in sorted(HEDGES, key=len, reverse=True))
                       + r")\b", re.IGNORECASE)
_TRAILING_HEDGE_RE = re.compile(
    r"[,;:\s(-]*\b(" + "|".join(re.escape(h) for h in sorted(HEDGES, key=len, reverse=True))
    + r")\b[)\s]*([.!?]?)\s*$", re.IGNORECASE)
_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z`\"'(])")
# Dashes as punctuation (the writing rules forbid them). An em or en dash is replaced with a
# comma so none reaches the card; a spaced hyphen is only reported.
_DASH_RE = re.compile(r"\s*[\u2014\u2013]\s*")
_SPACED_HYPHEN_RE = re.compile(r"(?<=\S) - (?=\S)")
_SPACES_RE = re.compile(r"[ \t]{2,}")


def _text(v):
    """A stripped string, or None for anything that is not usable text."""
    if v is None or isinstance(v, (bool, dict, list)):
        return None
    s = v if isinstance(v, str) else str(v)
    s = s.strip()
    return s or None


def plain(text):
    """The writing rules applied to one string: double spaces collapsed, a trailing hedge
    removed. Returns (text, stripped_hedge_or_None). Never changes the meaning of a sentence —
    only what the rules call filler."""
    if not isinstance(text, str):
        return text, None
    out = _SPACES_RE.sub(" ", text).strip()
    m = _TRAILING_HEDGE_RE.search(out)
    stripped = None
    # Only strip when something remains: a string that IS the hedge is left for the warning.
    if m and m.start() > 0:
        stripped = m.group(1)
        end = m.group(2) or ""
        out = out[:m.start()].rstrip(" ,;:(-") + end
    return out, stripped


def undash(text):
    """(text, n): every em or en dash replaced with ", " (surrounding spaces folded), and how
    many were. A dash at the very start or end of the string is simply dropped with its spaces."""
    n = len(_DASH_RE.findall(text))
    if not n:
        return text, 0
    out = _DASH_RE.sub(", ", text)
    out = re.sub(r"^, |, $", "", out)
    out = _SPACES_RE.sub(" ", out).strip()
    return out, n


def sentences(text):
    """Sentences of a string, as the linter counts them."""
    return [t for t in _SENTENCE_RE.split(text.strip()) if t.strip()]


def words(text):
    return len(text.split())


def lint_text(text, limit, label, warnings):
    """Warn (with the `plain:` marker) on every sentence over `limit` words and on every hedge.
    Returns the text with filler removed."""
    if not isinstance(text, str) or not text.strip():
        return text
    text, stripped = plain(text)
    if stripped:
        warnings.append(f"{label}: plain: trailing hedge {stripped!r} removed")
    text, dashes = undash(text)
    if dashes:
        warnings.append(f"{label}: plain: dash used as punctuation ({dashes} replaced with a comma)")
    if _SPACED_HYPHEN_RE.search(text):
        warnings.append(f"{label}: plain: spaced hyphen used as a dash")
    for sent in sentences(text):
        n = words(sent)
        if n > limit:
            warnings.append(f"{label}: plain: sentence has {n} words (limit {limit}): "
                            f"{sent[:60]!r}")
    for m in _HEDGE_RE.finditer(text):
        warnings.append(f"{label}: plain: hedge {m.group(1)!r}")
    return text


def _vocab(value, allowed, default, field, i, warnings):
    if value is None:
        return None
    s = _text(value)
    if s is None:
        return None
    low = s.lower().replace("_", "-").replace(" ", "-")
    if low in allowed:
        return low
    warnings.append(f"finding {i}: {field} {s!r} is not one of {'|'.join(allowed)}; using {default}")
    return default


def normalize_finding(c, i=0, warnings=None):
    """One finding, normalised in place and returned. Non-dict input becomes a bare finding so the
    rest of the pipeline can still index into it."""
    if warnings is None:
        warnings = []
    if not isinstance(c, dict):
        warnings.append(f"finding {i}: not an object ({type(c).__name__}); replaced with an empty finding")
        c = {"body": _text(c) or ""}
    sev = _vocab(c.get("severity"), SEVERITIES, DEFAULT_SEVERITY, "severity", i, warnings)
    c["severity"] = sev or DEFAULT_SEVERITY
    c["confidence"] = _vocab(c.get("confidence"), CONFIDENCES, DEFAULT_CONFIDENCE,
                             "confidence", i, warnings)
    for alias in IMPACT_SYNONYMS:
        if _text(c.get("impact")) is None and _text(c.get(alias)) is not None:
            c["impact"] = c[alias]
    for alias in VERIFY_SYNONYMS:
        if _text(c.get("how_to_verify")) is None and _text(c.get(alias)) is not None:
            c["how_to_verify"] = c[alias]
    for alias in CHECK_SYNONYMS:
        if _text(c.get("what_to_check")) is None and _text(c.get(alias)) is not None:
            c["what_to_check"] = c[alias]
    for f in TEXT_FIELDS:
        c[f] = _text(c.get(f))
    v = c["how_to_verify"]
    if v is not None:
        if "\n" in v or "\r" in v:
            warnings.append(f"finding {i}: how_to_verify is not a single line; dropped")
            c["how_to_verify"] = None
        elif len(v) > VERIFY_CAP:
            warnings.append(f"finding {i}: how_to_verify is {len(v)} chars (cap {VERIFY_CAP}); dropped")
            c["how_to_verify"] = None
    # `expected` / `actual` are one line each; a paragraph is folded onto one line, not dropped —
    # the contrast is the card's most useful row and a long one is still a contrast.
    for f in ("what_to_check", "expected", "actual"):
        if c[f] is not None and ("\n" in c[f] or "\r" in c[f]):
            c[f] = " ".join(c[f].split())
    c["where"] = normalize_where(c, i, warnings)
    for f in TEXT_FIELDS:
        if c[f] is not None:
            limit = INSTRUCTION_WORDS if f in INSTRUCTION_FIELDS else DESCRIPTION_WORDS
            c[f] = lint_text(c[f], limit, f"finding {i}: {f}", warnings) or None
    c["checked"] = normalize_checked(c.get("checked"), i, warnings)
    return c


def normalize_checked(v, i=0, warnings=None):
    """The disproof verdict on one finding, or None. `{verdict, reason, at}` with the verdict
    in CHECK_VERDICTS; a malformed object is dropped with a warning, an absent one is silent."""
    if v is None:
        return None
    if warnings is None:
        warnings = []
    if not isinstance(v, dict):
        warnings.append(f"finding {i}: checked is not an object; dropped")
        return None
    verdict = _text(v.get("verdict"))
    verdict = verdict.lower() if verdict else None
    if verdict not in CHECK_VERDICTS:
        warnings.append(f"finding {i}: checked.verdict {verdict!r} is not one of "
                        f"{'|'.join(CHECK_VERDICTS)}; dropped")
        return None
    reason = " ".join((_text(v.get("reason")) or "").split())[:CHECK_REASON_CAP]
    reason, dashes = undash(reason)
    if dashes:
        warnings.append(f"finding {i}: checked.reason: plain: dash used as punctuation "
                        f"({dashes} replaced with a comma)")
    try:
        at = int(v.get("at") or 0)
    except (TypeError, ValueError):
        at = 0
    return {"verdict": verdict, "reason": reason, "at": at}


def normalize_disproof(v, warnings=None):
    """The review-level record of the disproof pass, or None: `{status, n, checked, duration_ms,
    mode}`. Counts are ints, the status a short word; nothing else is kept."""
    if not isinstance(v, dict):
        return None

    def num(k):
        try:
            return max(0, int(v.get(k) or 0))
        except (TypeError, ValueError):
            return 0
    status = (_text(v.get("status")) or "done").lower()[:20]
    mode = (_text(v.get("mode")) or "default").lower()[:20]
    return {"status": status, "n": num("n"), "checked": num("checked"),
            "duration_ms": num("duration_ms"), "mode": mode}


def _line_no(v):
    """A positive int line number or None (the same reading rs_diff.norm_line gives)."""
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v if v > 0 else None
    if isinstance(v, str) and v.strip().isdigit():
        n = int(v.strip())
        return n if n > 0 else None
    return None


def normalize_where(c, i=0, warnings=None):
    """{path, start, end} for one finding, or None. `path` and `line` stay authoritative (the
    post path anchors on them); `where` only adds an end line, from `where.end`, `end_line`,
    `end`, or a `lines: "44-51"` range. An end before the start is folded to the start."""
    if warnings is None:
        warnings = []
    path = _text(c.get("path"))
    start = _line_no(c.get("line"))
    end = None
    w = c.get("where")
    if isinstance(w, dict):
        if start is None:
            start = _line_no(w.get("start")) or _line_no(w.get("line"))
        end = _line_no(w.get("end"))
        if path is None:
            path = _text(w.get("path"))
    for k in ("end_line", "line_end", "end"):
        if end is None:
            end = _line_no(c.get(k))
    rng = _text(c.get("lines"))
    if rng and end is None:
        m = re.match(r"^\s*(\d+)\s*[-–:]\s*(\d+)\s*$", rng)
        if m:
            if start is None:
                start = _line_no(m.group(1))
            end = _line_no(m.group(2))
    if path is None or start is None:
        return None
    if end is None or end < start:
        if end is not None:
            warnings.append(f"finding {i}: where.end {end} is before line {start}; using {start}")
        end = start
    return {"path": path, "start": start, "end": end}


def _str_list(v, cap):
    if isinstance(v, str):
        v = [v]
    if not isinstance(v, list):
        return []
    out = []
    for x in v:
        t = _text(x)
        if t:
            out.append(_SPACES_RE.sub(" ", t))
    return out[:cap]


def normalize_guide(g, warnings=None):
    """The reading guide (§1.2), or None when the review has none. Fields are optional; a
    read_plan entry without a path is dropped; `risk` outside RISKS becomes None with a warning
    (not invented — a wrong risk word is worse than no word)."""
    if warnings is None:
        warnings = []
    if not isinstance(g, dict):
        return None
    out = {"does": _text(g.get("does")) or _text(g.get("what")),
           "why": _text(g.get("why")),
           "risk": None, "read_plan": [], "not_covered": []}
    risk = _text(g.get("risk"))
    if risk is not None:
        low = risk.lower().replace("_", " ").replace("-", " ").strip()
        folded = {"breaks": "breaks", "can break": "can break", "safe looking": "safe-looking",
                  "safe": "safe-looking", "looks safe": "safe-looking", "unclear": "unclear"}
        if low in folded:
            out["risk"] = folded[low]
        else:
            warnings.append(f"guide: risk {risk!r} is not one of {'|'.join(RISKS)}; dropped")
    plan = g.get("read_plan")
    for alias in READ_PLAN_SYNONYMS:
        if plan is None:
            plan = g.get(alias)
    if isinstance(plan, list):
        for j, row in enumerate(plan[:READ_PLAN_CAP]):
            if isinstance(row, str):
                row = {"path": row}
            if not isinstance(row, dict):
                continue
            path = _text(row.get("path")) or _text(row.get("file"))
            if not path:
                warnings.append(f"guide: read_plan[{j}] has no path; dropped")
                continue
            lines = row.get("lines")
            if isinstance(lines, (int, float)) and not isinstance(lines, bool):
                lines = str(int(lines))
            lines = _text(lines)
            if lines is not None and not re.match(r"^\d+(\s*[-–]\s*\d+)?$", lines):
                lines = None
            why = _text(row.get("why")) or _text(row.get("reason"))
            if why is not None:
                why = lint_text(why, DESCRIPTION_WORDS, f"guide: read_plan[{j}].why", warnings)
            out["read_plan"].append({"path": path, "lines": lines.replace(" ", "") if lines else None,
                                     "why": why})
    nc = g.get("not_covered")
    for alias in NOT_COVERED_SYNONYMS:
        if nc is None:
            nc = g.get(alias)
    out["not_covered"] = [lint_text(x, DESCRIPTION_WORDS, f"guide: not_covered[{j}]", warnings)
                          for j, x in enumerate(_str_list(nc, NOT_COVERED_CAP))]
    for f in ("does", "why"):
        if out[f] is not None:
            out[f] = " ".join(out[f].split())
            out[f] = lint_text(out[f], DESCRIPTION_WORDS, f"guide: {f}", warnings) or None
    if not any([out["does"], out["why"], out["risk"], out["read_plan"], out["not_covered"]]):
        return None
    return out


def normalize(review):
    """(review, warnings). The review is normalised in place when it is a dict; anything else is
    returned untouched with a warning, so a caller that already validated the shape can trust the
    result and one that did not loses nothing."""
    warnings = []
    if not isinstance(review, dict):
        warnings.append(f"review is not an object ({type(review).__name__}); left as is")
        return review, warnings
    # The reading guide. An object in `summary` is the design's spelling (§1.2); it is moved to
    # `guide` so `summary` stays the verdict string every other reader expects.
    guide_src = review.get("guide")
    for alias in GUIDE_SYNONYMS:
        if guide_src is None:
            guide_src = review.get(alias)
    if isinstance(review.get("summary"), dict):
        block = review["summary"]
        if guide_src is None:
            guide_src = block
        does = _text(block.get("does"))
        risk = _text(block.get("risk"))
        review["summary"] = " ".join(x for x in (does, f"Risk: {risk}." if risk else None) if x)
    review["guide"] = normalize_guide(guide_src, warnings)
    review["disproof"] = normalize_disproof(review.get("disproof"), warnings)
    if isinstance(review.get("summary"), str):
        review["summary"] = lint_text(review["summary"], DESCRIPTION_WORDS, "summary", warnings)
    if isinstance(review.get("explainer"), str):
        review["explainer"] = lint_text(review["explainer"], DESCRIPTION_WORDS, "explainer", warnings)
    # The assessment's bullets are read aloud on the card too: the same rules, dashes included.
    if isinstance(review.get("keyPoints"), list):
        review["keyPoints"] = [lint_text(x, DESCRIPTION_WORDS, f"keyPoints[{j}]", warnings)
                               if isinstance(x, str) else x
                               for j, x in enumerate(review["keyPoints"])]
    comments = review.get("comments")
    if comments is None:
        review["comments"] = []
        return review, warnings
    if not isinstance(comments, list):
        warnings.append(f"comments is not an array ({type(comments).__name__}); replaced with []")
        review["comments"] = []
        return review, warnings
    review["comments"] = [normalize_finding(c, i, warnings) for i, c in enumerate(comments)]
    return review, warnings


def normalize_file(path):
    """Rewrite `path` with its normalised content (atomically) and return the warnings. A file that
    is not JSON is left alone and reported — the shape check upstream owns that failure."""
    try:
        with open(path, encoding="utf-8") as fh:
            review = json.load(fh)
    except (OSError, ValueError) as e:
        return [f"could not read {path}: {e}"]
    review, warnings = normalize(review)
    tmp = f"{path}.norm"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(review, fh, ensure_ascii=False)
    os.replace(tmp, path)
    return warnings


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.stderr.write("usage: rs_review_schema.py review.json\n")
        sys.exit(2)
    for w in normalize_file(sys.argv[1]):
        sys.stderr.write(f"[review-schema] {w}\n")
