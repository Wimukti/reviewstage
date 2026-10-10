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
  - missing text fields are None, so a card can omit a row instead of printing an empty label.

Normalisation never raises and never rejects a review: a run from before this contract renders
exactly as it did. Deliberately dependency-free — it runs inside the review step, which has no
GitHub write path (openspec/config.yaml, property 1), so it must import nothing that could reach
one. The CLI form (`python3 rs_review_schema.py review.json`) rewrites the file in place and
prints warnings to stderr; `bin/run-review.sh` calls it right after the jq shape check.
"""
import json
import os
import sys

SEVERITIES = ("blocker", "should-fix", "nit", "question")
CONFIDENCES = ("high", "medium", "low")
DEFAULT_SEVERITY = "nit"
DEFAULT_CONFIDENCE = "medium"
VERIFY_CAP = 160
TEXT_FIELDS = ("title", "impact", "how_to_verify")
IMPACT_SYNONYMS = ("why_it_matters", "whyItMatters")
VERIFY_SYNONYMS = ("howToVerify", "verify", "verification")


def _text(v):
    """A stripped string, or None for anything that is not usable text."""
    if v is None or isinstance(v, (bool, dict, list)):
        return None
    s = v if isinstance(v, str) else str(v)
    s = s.strip()
    return s or None


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
    return c


def normalize(review):
    """(review, warnings). The review is normalised in place when it is a dict; anything else is
    returned untouched with a warning, so a caller that already validated the shape can trust the
    result and one that did not loses nothing."""
    warnings = []
    if not isinstance(review, dict):
        warnings.append(f"review is not an object ({type(review).__name__}); left as is")
        return review, warnings
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
