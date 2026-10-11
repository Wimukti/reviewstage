"""The deterministic evidence check on a finding (trust-and-plain/design.md §1.4).

No model, no network: a finding is held against the PR's own diff — the `patch` text GitHub
returns per changed file — and gets a verdict a reviewer can read in one line:

  - the cited `path` is a file this PR changes          → else flag `path_not_in_diff`
  - the cited lines fall inside a hunk of that file     → else flag `lines_not_in_diff`
  - an identifier quoted in backticks in `title` / `what_to_check` appears in the cited lines
                                                        → else flag `symbol_not_found`
  - a *blocker* carries both `expected` and `actual`    → else flag `no_contrast`
    (skipped for a pre-contract finding that has none of what_to_check / expected / actual)

Result per finding: `{"status": "pass" | "warn", "flags": [...], "line": "…", "symbols": [...]}`.
Two or more flags demote the finding out of the pre-selection and into the "maybe" tray,
whatever confidence the model reported. One flag is a warning on the card and nothing more: a
finding about a file outside the diff is legitimate (the tests that now assert the wrong thing
are the classic case) and is only *un-checkable* here, not wrong.

The checks are deliberately lenient where the data is missing: a file the PR changes but whose
patch GitHub withheld (binary, oversized) yields no line or symbol verdict, and a finding that
quotes nothing in backticks is not flagged for a symbol it never named. Part 2 adds a second
Claude pass under `checked`; this module's output is the first signal and stays shaped so that
field can sit beside `evidence` without renaming anything.

The same module also cuts the **snippet** the card shows under *Where*: 8–12 lines of the hunk
around the cited range, each tagged `add`, `ctx` or `del`, so the reviewer reads the cited
lines without opening the diff.

Standard library only — it runs inside the server's render path and in the CLI used to build
the stage fixture (`python3 rs_evidence.py review.json files.json`), and it must import nothing
that could reach GitHub (openspec/config.yaml, property 1).
"""
import json
import re
import sys

HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")
BACKTICK = re.compile(r"`([^`\n]{1,80})`")
# A token worth looking for: the identifier-ish part of a backticked span. `retry()` → retry,
# `$vendor->leadTime()` → vendor, leadTime; `Product.php:42` → Product (a path is not a symbol
# worth matching, but its stem still is). Numbers alone are not symbols.
IDENT = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
SNIPPET_MIN = 8
SNIPPET_MAX = 12
SNIPPET_TARGET = 10
BLOCKER = "blocker"

FLAGS = ("path_not_in_diff", "lines_not_in_diff", "symbol_not_found", "no_contrast")
# Two flags → the "maybe" tray, whatever the model's confidence said.
DEMOTE_AT = 2


def hunks(patch):
    """[[{n, text, kind}]] — one list per hunk of a unified patch. `n` is the new-file line
    number for added and context lines and None for removed ones."""
    out, cur, n = [], None, 0
    rows = (patch or "").split("\n")
    if rows and rows[-1] == "":          # the trailing newline, not an empty context line
        rows.pop()
    for raw in rows:
        m = HUNK.match(raw)
        if m:
            cur = []
            out.append(cur)
            n = int(m.group(1))
            continue
        if cur is None or raw == "" and n == 0:
            continue
        if raw.startswith("\\"):            # "\ No newline at end of file"
            continue
        head = raw[:1]
        if head == "+":
            cur.append({"n": n, "text": raw[1:], "kind": "add"})
            n += 1
        elif head == "-":
            cur.append({"n": None, "text": raw[1:], "kind": "del"})
        elif head == " " or raw == "":
            cur.append({"n": n, "text": raw[1:], "kind": "ctx"})
            n += 1
    return [h for h in out if h]


def new_lines(patch):
    """{new-file line number: text} for every added or context line of a patch."""
    out = {}
    for h in hunks(patch):
        for row in h:
            if row["n"] is not None:
                out[row["n"]] = row["text"]
    return out


def snippet(patch, start, end, target=SNIPPET_TARGET, lo=SNIPPET_MIN, hi=SNIPPET_MAX):
    """The 8–12 lines of the hunk that holds `start`..`end`, centred on the cited range, or None
    when no hunk of this patch covers the start line. The cited rows carry `cited: True`; the
    window never crosses a hunk boundary (joining two hunks would invent adjacency the file does
    not have)."""
    if start is None:
        return None
    for h in hunks(patch):
        idx = [i for i, row in enumerate(h) if row["n"] is not None and start <= row["n"] <= end]
        if not idx:
            continue
        first, last = idx[0], idx[-1]
        want = max(lo, min(hi, target, len(h)))
        want = max(want, min(hi, last - first + 1))
        a, b = first, last + 1
        while b - a < want and (a > 0 or b < len(h)):
            # Grow before and after alternately, preferring the side with room.
            if a > 0 and (b >= len(h) or (first - a) <= (b - last - 1)):
                a -= 1
            elif b < len(h):
                b += 1
        rows = []
        for row in h[a:b]:
            r = dict(row)
            r["cited"] = row["n"] is not None and start <= row["n"] <= end
            rows.append(r)
        nums = [r["n"] for r in rows if r["n"] is not None]
        return {"start": min(nums) if nums else start, "end": max(nums) if nums else end,
                "lines": rows}
    return None


def symbols(*texts):
    """Identifiers quoted in backticks across the given strings, in order, de-duplicated."""
    seen, out = set(), []
    for t in texts:
        if not isinstance(t, str):
            continue
        for span in BACKTICK.findall(t):
            for ident in IDENT.findall(span):
                if ident.lower() in ("a", "the", "an") or ident in seen:
                    continue
                seen.add(ident)
                out.append(ident)
    return out


def _tick(s):
    return "`" + s + "`"


def check(finding, patches, changed=None):
    """The verdict for one normalised finding.

    `patches`: {path: patch text or None} for every file the PR changes (None when GitHub
    withheld the patch). `changed` defaults to its keys. Returns None when `patches` is None —
    the diff could not be fetched, so there is no evidence either way and the card says nothing.
    """
    if patches is None:
        return None
    changed = set(changed) if changed is not None else set(patches)
    where = finding.get("where") if isinstance(finding.get("where"), dict) else None
    path = (where or {}).get("path") or finding.get("path")
    start = (where or {}).get("start")
    end = (where or {}).get("end") or start
    flags, notes, found = [], [], []
    quoted = symbols(finding.get("title"), finding.get("what_to_check"))
    patch = patches.get(path) if path else None
    in_diff = bool(path) and path in changed
    if not in_diff:
        flags.append("path_not_in_diff")
        notes.append(f"{_tick(path) if path else 'The file'} is not a file this PR changes.")
    elif patch and start is not None:
        lines = new_lines(patch)
        cited = {n: t for n, t in lines.items() if start <= n <= end}
        if not cited:
            flags.append("lines_not_in_diff")
            rng = f"{start}" if start == end else f"{start}–{end}"
            base = path.rsplit("/", 1)[-1]
            notes.append(f"Lines {rng} are not in this PR's changes to {_tick(base)}.")
        elif quoted:
            # Match against what the card shows: the snippet window around the cited lines.
            win = snippet(patch, start, end) or {"lines": []}
            hay = "\n".join(r["text"] for r in win["lines"]) or "\n".join(cited.values())
            found = [q for q in quoted if re.search(r"(?<![A-Za-z0-9_])" + re.escape(q)
                                                      + r"(?![A-Za-z0-9_])", hay)]
            if not found:
                flags.append("symbol_not_found")
                shown = ", ".join(_tick(q) for q in quoted[:3])
                notes.append(f"{shown} {'does' if len(quoted) == 1 else 'do'} not appear in "
                             "the cited lines.")
    # A blocker without a contrast. Not applied to a pre-contract finding (none of what_to_check /
    # expected / actual at all — an older run or a custom skill): such a review must render as
    # it always did, and it never promised the contrast in the first place.
    new_shape = any(finding.get(k) for k in ("what_to_check", "expected", "actual"))
    if finding.get("severity") == BLOCKER and new_shape \
            and not (finding.get("expected") and finding.get("actual")):
        flags.append("no_contrast")
        notes.append("A blocker needs both Expected and Actual.")
    if flags:
        line = " ".join(notes)
    elif found:
        line = ("The cited lines are in this diff and mention "
                + ", ".join(_tick(q) for q in found[:3]) + ".")
    elif in_diff and (not patch or start is None):
        line = "The file is in this diff; its lines could not be checked."
    else:
        line = "The cited lines are in this diff."
    return {"status": "warn" if flags else "pass", "flags": flags, "line": line,
            "symbols": found}


def demoted(evidence):
    """True when the evidence alone puts a finding in the "maybe" tray."""
    return bool(evidence) and len(evidence.get("flags") or []) >= DEMOTE_AT


def patches_of(files):
    """{filename: patch or None} from the GitHub files-API payload."""
    out = {}
    for f in files or []:
        name = f.get("filename") if isinstance(f, dict) else None
        if name:
            out[name] = f.get("patch") or None
    return out


def annotate(finding, patches):
    """`evidence` and `snippet` for one finding, as the server sends them. The snippet is cut
    only for a file in the diff whose patch is known."""
    ev = check(finding, patches)
    where = finding.get("where") if isinstance(finding.get("where"), dict) else None
    snip = None
    if patches and where and patches.get(where["path"]):
        snip = snippet(patches[where["path"]], where["start"], where["end"])
    return ev, snip


if __name__ == "__main__":
    # CLI: the server's own reading of a review against a files payload, for fixtures and tests.
    # Prints {"guide": …, "findings": [{"i", "where", "evidence", "snippet"}]} on stdout.
    if len(sys.argv) != 3:
        sys.stderr.write("usage: rs_evidence.py review.json files.json\n")
        sys.exit(2)
    import rs_review_schema  # noqa: E402  (dependency-free, same directory)
    with open(sys.argv[1], encoding="utf-8") as fh:
        review, _ = rs_review_schema.normalize(json.load(fh))
    with open(sys.argv[2], encoding="utf-8") as fh:
        files = json.load(fh)
    while isinstance(files, list) and files and isinstance(files[0], list):
        files = [x for page in files for x in page]      # `--slurp` pages
    pm = patches_of(files)
    out = []
    for i, c in enumerate(review.get("comments") or []):
        ev, snip = annotate(c, pm)
        out.append({"i": i, "where": c.get("where"), "evidence": ev, "snippet": snip})
    json.dump({"guide": review.get("guide"), "findings": out}, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
