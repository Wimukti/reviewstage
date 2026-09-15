"""Rendering for the parts of a review that cannot be inline comments.

GitHub only accepts an inline review comment on a line inside the PR's diff. The repository
profile deliberately pushes a review beyond the diff — trace the callers, the consumers, the
tests — so the findings that matter most often land on lines the PR never touched. Those are
not failures to be folded away; they go into the review body, expanded, each linking straight
at the line on the head commit.
"""
from urllib.parse import quote

import rs_diff


SEV_ORDER = {"blocker": 0, "should-fix": 1, "nit": 2, "question": 3}
SEV_LABEL = {"blocker": "🚫 Blocker", "should-fix": "⚠️ Should fix",
             "nit": "💬 Nit", "question": "❓ Question"}
QUIET = ("nit", "question")          # collapsible once there are more than a handful
QUIET_FOLD_OVER = 3

HEADING = "## Findings outside the diff"
LEDE = ("These point at lines this PR does not change, so GitHub cannot take them as inline "
        "comments. Each link opens the exact line on this PR's head commit.")


def safe_path(path):
    """The finding's path as a repo-relative path, or "" if it is not one.

    The path comes from the model, so it is untrusted: an absolute path, a `..` escape or a
    backslash would build a link that points outside the repository (or, percent-decoded by
    GitHub, somewhere else entirely). Anything that is not a plain relative path gets no link.
    """
    p = (path or "").strip().replace("\\", "/")
    if not p or p.startswith("/") or p.startswith("//") or ":" in p.split("/")[0]:
        return ""
    parts = [seg for seg in p.split("/") if seg not in ("", ".")]
    if not parts or any(seg == ".." for seg in parts):
        return ""
    return "/".join(parts)


def permalink(repo, head, path, line, deleted=()):
    """A blob link at the reviewed commit — works for files the PR never touched.

    Two things it refuses to link. A file this PR DELETED has no blob at the head commit, so
    the link 404s; the reviewer gets the plain path instead. And a path that is not a plain
    relative path (absolute, `..`, a scheme) is not linked at all. Everything else is
    percent-encoded per segment, so a path with a space or a `#` still resolves.
    """
    rel = safe_path(path)
    if not (repo and head and rel) or rel in set(deleted or ()):
        return ""
    enc = "/".join(quote(seg, safe="") for seg in rel.split("/"))
    url = f"https://github.com/{repo}/blob/{head}/{enc}"
    n = rs_diff.norm_line(line)
    return f"{url}#L{n}" if n is not None else url


def _loc(c):
    n, path = rs_diff.norm_line(c.get("line")), c.get("path") or "?"
    return f"{path}:{n}" if n is not None else path


def _sev(c):
    s = (c.get("severity") or "").strip()
    return s if s in SEV_ORDER else ""


def _finding_md(c, repo, head, deleted=()):
    """One expanded finding: a severity heading that links at the line, then the comment."""
    sev = _sev(c)
    label = SEV_LABEL.get(sev, "Finding")
    loc, url = _loc(c), permalink(repo, head, c.get("path"), c.get("line"), deleted)
    where = f"[`{loc}`]({url})" if url else f"`{loc}`"
    out = [f"### {label} — {where}", ""]
    body = (c.get("body") or "").strip()
    if body:
        out += [body, ""]
    sugg = (c.get("suggestion") or "").strip()
    if sugg:
        # NOT a ```suggestion fence: GitHub would render an Apply button that cannot work off
        # the diff. A plain block says the same thing and stays honest.
        out += ["Suggested change:", "", "```", sugg, "```", ""]
    return "\n".join(out).rstrip() + "\n"


def offdiff_block(orphans, repo=None, head=None, deleted=()):
    """The `## Findings outside the diff` section appended to the review body.

    Ordered blocker → should-fix → nit → question. Everything is expanded, except that a long
    tail of nits/questions (more than three) is tucked into a `<details>` so it cannot bury the
    findings above it. A blocker is never collapsed.
    """
    items = [c for c in (orphans or []) if (c.get("body") or "").strip()
             or (c.get("suggestion") or "").strip()]
    if not items:
        return ""
    items.sort(key=lambda c: SEV_ORDER.get(_sev(c), 8))
    loud = [c for c in items if _sev(c) not in QUIET]
    quiet = [c for c in items if _sev(c) in QUIET]
    parts = [HEADING, "", LEDE, ""]
    parts += [_finding_md(c, repo, head, deleted) for c in loud]
    if quiet:
        rendered = [_finding_md(c, repo, head, deleted) for c in quiet]
        if len(quiet) > QUIET_FOLD_OVER:
            parts += ["<details><summary>"
                      f"{len(quiet)} more nit(s) / question(s) outside the diff"
                      "</summary>\n", *rendered, "\n</details>\n"]
        else:
            parts += rendered
    return "\n\n" + "\n".join(parts).strip() + "\n"


def _plural(n, word):
    return f"{n} {word}" + ("" if n == 1 else "s")


def outcome(n_inline, n_offdiff):
    """The half-sentence that says where the findings went. Leads with what succeeded."""
    if n_inline and n_offdiff:
        return f"{n_inline} inline, {n_offdiff} in the summary."
    if n_inline:
        return _plural(n_inline, "inline comment") + "."
    if n_offdiff:
        one = n_offdiff == 1
        return (f"all {_plural(n_offdiff, 'finding')} {'is' if one else 'are'} in the summary, "
                f"because {'it points' if one else 'they point'} at lines this PR does not "
                "change (GitHub only allows inline comments on changed lines).")
    return "summary only."


def posted_message(user, n_inline, n_offdiff):
    """Banner text for a review that reached GitHub."""
    return f"Posted your review as {user} — {outcome(n_inline, n_offdiff)}"
