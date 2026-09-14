"""Diff-anchor helpers shared by the review bot.

GitHub rejects an ENTIRE review with 422 if any single inline comment points at a line
outside the diff — so one bad line number would lose every finding. Anchors are validated
at POST time (not review time) because the PR may have gained commits while the review sat
in the dashboard.
"""
import re

HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")


def commentable_lines(patch):
    """RIGHT-side line numbers a review comment can anchor to.

    Context and added lines exist in the new file and are valid targets; removed lines are
    not (they only exist on the LEFT side).
    """
    lines, new_no = set(), 0
    for raw in (patch or "").split("\n"):
        m = HUNK.match(raw)
        if m:
            new_no = int(m.group(1))
            continue
        if not raw:
            continue
        head = raw[0]
        if head in "+ ":
            lines.add(new_no)
            new_no += 1
        # '-' consumes no new-file line; '\' (no-newline marker) is ignored
    return lines


# `gh api pulls/{n}/files` omits `patch` for binary files and for files past GitHub's per-file
# size cutoff (a 344-line brand-new HTML page hit it). The shape tells us most of the answer.
UNKNOWN = None   # sentinel: this file needs the full PR diff to decide


def file_lines(entry):
    """Commentable RIGHT-side lines for one files-API entry, or UNKNOWN.

    Rule: a `patch` is authoritative. Without one — `added` → every line 1..additions is on the
    RIGHT side (the whole file is new); `removed` → nothing (no RIGHT side exists); anything
    else (modified/renamed/copied) → UNKNOWN, resolved from the full `gh pr diff` by the caller.
    """
    patch = entry.get("patch")
    if patch:
        return commentable_lines(patch)
    status = entry.get("status") or ""
    if status == "added":
        try:
            n = int(entry.get("additions") or 0)
        except (TypeError, ValueError):
            n = 0
        return set(range(1, n + 1))
    if status == "removed":
        return set()
    return UNKNOWN


DIFF_HEADER = re.compile(r"^diff --git a/(.*) b/(.*)$")
NEW_PATH = re.compile(r"^\+\+\+ (?:b/(.*)|/dev/null)$")


def parse_full_diff(text):
    """{new-side filename: commentable lines} from a whole-PR unified diff (`gh pr diff`).

    Files with no hunks (binary, pure renames/mode changes) still appear with an empty set so a
    lookup distinguishes "seen, nothing commentable" from "not in the diff".
    """
    out, cur, body = {}, None, []

    def flush():
        if cur is not None:
            out[cur] = commentable_lines("\n".join(body))

    for raw in (text or "").split("\n"):
        m = DIFF_HEADER.match(raw)
        if m:
            flush()
            cur, body = m.group(2), []
            continue
        if cur is None:
            continue
        m = NEW_PATH.match(raw)
        if m:
            if m.group(1):          # `+++ b/<path>` is the authoritative new-side name
                cur = m.group(1)
            continue
        if raw.startswith(("--- ", "index ", "old mode", "new mode", "similarity",
                           "rename ", "copy ", "new file", "deleted file", "Binary files")):
            continue
        body.append(raw)
    flush()
    return out


def anchor_map(files, fetch_diff=None):
    """{filename: {commentable line numbers}} from the PR files API payload.

    `fetch_diff` is a zero-arg callable returning the full PR diff text (or None on failure).
    It is invoked at most once, and only when some entry lacks a patch and its status alone
    can't settle the question.
    """
    out, pending = {}, []
    for f in files:
        lines = file_lines(f)
        if lines is UNKNOWN:
            pending.append(f["filename"])
            out[f["filename"]] = set()
        else:
            out[f["filename"]] = lines
    if pending and fetch_diff is not None:
        parsed = parse_full_diff(fetch_diff() or "")
        for name in pending:
            if name in parsed:
                out[name] = parsed[name]
    return out


def split_anchorable(comments, anchors):
    """Partition comments into (anchorable, orphans) against the current diff."""
    inline, orphans = [], []
    for c in comments:
        path, line = c.get("path"), c.get("line")
        body = (c.get("body") or "").strip()
        if not body:
            continue
        if path and isinstance(line, int) and line in anchors.get(path, set()):
            inline.append({"path": path, "line": line, "side": "RIGHT", "body": body})
        else:
            orphans.append(c)
    return inline, orphans


def orphan_block(orphans):
    """Fold un-anchorable findings into the summary body so they still reach the human."""
    if not orphans:
        return ""
    rows = []
    for c in orphans:
        line, path = c.get("line"), c.get("path") or "?"
        loc = f"{path}:{line}" if isinstance(line, int) else path
        sev = c.get("severity")
        prefix = f"**{sev}** — " if sev else ""
        rows.append(f"- **`{loc}`** — {prefix}{(c.get('body') or '').strip()}")
    return ("\n\n<details><summary>"
            f"{len(orphans)} finding(s) that could not be anchored to a diff line"
            "</summary>\n\n" + "\n".join(rows) + "\n\n</details>")
