"""Rendering for the parts of a review that cannot be inline comments.

GitHub only accepts an inline review comment on a line inside the PR's diff. The repository
profile deliberately pushes a review beyond the diff — trace the callers, the consumers, the
tests — so the findings that matter most often land on lines the PR never touched. Those are
not failures to be folded away; they go into the review body, expanded, each linking straight
at the line on the head commit.
"""

SEV_ORDER = {"blocker": 0, "should-fix": 1, "nit": 2, "question": 3}
SEV_LABEL = {"blocker": "🚫 Blocker", "should-fix": "⚠️ Should fix",
             "nit": "💬 Nit", "question": "❓ Question"}
QUIET = ("nit", "question")          # collapsible once there are more than a handful
QUIET_FOLD_OVER = 3

HEADING = "## Findings outside the diff"
LEDE = ("These point at lines this PR does not change, so GitHub cannot take them as inline "
        "comments. Each link opens the exact line on this PR's head commit.")


def permalink(repo, head, path, line):
    """A blob link at the reviewed commit — works for files the PR never touched."""
    if not (repo and head and path):
        return ""
    url = f"https://github.com/{repo}/blob/{head}/{path}"
    return f"{url}#L{line}" if isinstance(line, int) else url


def _loc(c):
    line, path = c.get("line"), c.get("path") or "?"
    return f"{path}:{line}" if isinstance(line, int) else path


def _sev(c):
    s = (c.get("severity") or "").strip()
    return s if s in SEV_ORDER else ""


def _finding_md(c, repo, head):
    """One expanded finding: a severity heading that links at the line, then the comment."""
    sev = _sev(c)
    label = SEV_LABEL.get(sev, "Finding")
    loc, url = _loc(c), permalink(repo, head, c.get("path"), c.get("line"))
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


def offdiff_block(orphans, repo=None, head=None):
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
    parts += [_finding_md(c, repo, head) for c in loud]
    if quiet:
        rendered = [_finding_md(c, repo, head) for c in quiet]
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
