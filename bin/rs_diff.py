"""Diff-anchor helpers shared by the review bot.

GitHub rejects an ENTIRE review with 422 if any single inline comment points at a line
outside the diff — so one bad line number would lose every finding. Anchors are validated
at POST time (not review time) because the PR may have gained commits while the review sat
in the dashboard.
"""
import re

HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")


def norm_line(v):
    """One canonical answer to "which RIGHT-side line is this?" — an int, or None.

    The model returns a line as an int, a string of digits, "?", null, and once as `true`.
    Every site that asked `isinstance(line, int)` therefore disagreed with every site that
    asked `line.isdigit()`, which is how a finding could be labelled "in summary" on the page
    and still be sent to GitHub as an inline comment. bool is excluded deliberately:
    `isinstance(True, int)` is True, and line 1 is not what the model meant.
    """
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v if v > 0 else None
    if isinstance(v, str):
        t = v.strip()
        if t.isdigit():
            n = int(t)
            return n if n > 0 else None
    return None


def is_line(v):
    """True when `v` names a real line number (see norm_line)."""
    return norm_line(v) is not None


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
                           "rename ", "copy ", "new file", "deleted file", "Binary files",
                           # A submodule bump has no hunk, but git prints two bare
                           # "-/+Subproject commit <sha>" lines that look exactly like a
                           # removed and an added line — counted, they invented a
                           # commentable line 1 on a path with no diff at all.
                           "Subproject commit", "-Subproject commit", "+Subproject commit")):
            continue
        body.append(raw)
    flush()
    return out


def anchor_map(files, fetch_diff=None):
    """{filename: {commentable line numbers}} from the PR files API payload.

    Eager form, kept for callers that want the whole map. `fetch_diff` is a zero-arg callable
    returning the full PR diff text (or None on failure); it is invoked at most once, and only
    when some entry lacks a patch and its status alone can't settle the question.
    """
    a = Anchors(files, fetch_diff=fetch_diff)
    a.resolve_all()
    return dict(a.lines)


class Anchors:
    """Lazy anchor lookup: answers "can a comment sit on <path>:<line>?" for one PR.

    The full-diff fetch (`gh pr diff`) is slow on a large PR, so it is deferred until a finding
    actually points at a file that IS in the PR but arrived without a patch. A finding whose
    path is not in the PR's file list at all is off-diff by definition and never triggers it.
    """

    def __init__(self, files, fetch_diff=None):
        self.fetch_diff = fetch_diff
        self.lines, self.pending = {}, set()
        self.deleted = set()
        for f in files or []:
            name = f.get("filename")
            if not name:
                continue
            if (f.get("status") or "") == "removed":
                self.deleted.add(name)
            got = file_lines(f)
            if got is UNKNOWN:
                self.pending.add(name)
                self.lines[name] = set()
            else:
                self.lines[name] = got
        self.fetched = False
        self.error = None               # why the last full-diff fetch failed, or None

    def resolve_all(self):
        """Pull the full diff once, if anything is still unresolved.

        A FAILED fetch used to clear `pending` anyway, which silently downgraded every
        patchless modified file to "seen, nothing commentable" — indistinguishable from a
        file the PR really does not touch, and the reviewer was then told their findings
        "point at lines this PR does not change", which was false. A failure now leaves the
        files unresolved, records why, and can be retried.
        """
        if self.fetched or not self.pending:
            return
        if self.fetch_diff is None:
            self.fetched = True
            self.error = "no full-diff fetcher was supplied"
            return
        try:
            text = self.fetch_diff()
        except Exception as e:          # noqa: BLE001 — a fetch failure is data, not a crash
            text = None
            self.error = f"{type(e).__name__}: {e}"
        if not text:
            self.error = self.error or ("GitHub would not return the full diff for this PR, "
                                        "so some files could not be checked")
            return                      # keep `pending`: the next call retries
        parsed = parse_full_diff(text)
        for name in list(self.pending):
            if name in parsed:
                self.lines[name] = parsed[name]
        self.pending = set()
        self.fetched, self.error = True, None

    def unresolved(self):
        """Files still waiting on a full diff that could not be fetched."""
        return set(self.pending)

    def anchor_state(self, path, line):
        """Tri-state: True (GitHub will take an inline comment here), False (it will not),
        or None — the check genuinely could not run, so neither answer is honest."""
        n = norm_line(line)
        if not path or n is None:
            return False
        if path not in self.lines:      # not in the PR at all — cheap no, no diff fetch
            return False
        if n in self.lines[path]:
            return True
        if path in self.pending:        # in the PR but patchless: now the fetch is worth it
            self.resolve_all()
            if path in self.pending:
                return None             # the fetch failed — say "unknown", never "no"
            return n in self.lines.get(path, set())
        return False

    def can_anchor(self, path, line):
        """The conservative boolean the POST path needs: unknown counts as not anchorable,
        because one line GitHub rejects loses the entire review with a 422."""
        return self.anchor_state(path, line) is True


def _checker(anchors):
    """Accept either an Anchors instance or a plain {path: {lines}} dict."""
    if hasattr(anchors, "can_anchor"):
        return anchors.can_anchor
    return lambda p, l: bool(p) and is_line(l) and norm_line(l) in (anchors.get(p) or set())


def suggestion_fence(sugg):
    """GitHub's one-click-apply block. Only valid on a line inside the diff."""
    return "```suggestion\n" + sugg.rstrip("\n") + "\n```"


def split_anchorable(comments, anchors):
    """Partition comments into (anchorable, orphans) against the current diff.

    An anchorable comment carries its suggestion as a ```suggestion fence; an orphan keeps the
    suggestion in its own field, because a fence GitHub cannot apply is worse than no fence.
    """
    inline, orphans = [], []
    can = _checker(anchors)
    for c in comments:
        path, line = c.get("path"), c.get("line")
        body = (c.get("body") or "").strip()
        sugg = (c.get("suggestion") or "").strip()
        if not body and not sugg:
            continue
        if can(path, line):
            if sugg:
                body = (body + "\n\n" if body else "") + suggestion_fence(sugg)
            inline.append({"path": path, "line": norm_line(line), "side": "RIGHT",
                           "body": body})
        else:
            orphans.append(c)
    return inline, orphans
