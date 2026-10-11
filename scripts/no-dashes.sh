#!/usr/bin/env bash
# No dashes as punctuation in human-readable text. Greps the copy scopes for an em dash, an en
# dash, or a spaced hyphen used as a dash, prints file:line for every hit and exits 1 on any.
# bash 3.2 (macOS) safe: no arrays of arrays, no mapfile, no ${var,,}.
#
# What is skipped on purpose: code comments (lines opening with //, * or /*, and a trailing
# " // ..." tail), test files, Markdown list markers ("- item"), SRT timing arrows ("-->"), a
# lone dash glyph standing in for an empty value ("—" in a table cell or a quoted literal), and
# a spaced hyphen in code outside a string or JSX text (arithmetic). For code files the spaced
# hyphen is only reported inside quotes or between > and < (and never inside a CSS calc()).
set -u
cd "$(dirname "$0")/.." || exit 2

EM=$(printf '\xe2\x80\x94')   # —
EN=$(printf '\xe2\x80\x93')   # –

text_files() {
  find website/src -type f \( -name '*.md' -o -name '*.mdx' \)
  find docs/launch -type f \( -name '*.md' -o -name '*.srt' \)
  printf '%s\n' README.md desktop/README.md docs/INSTALL-DESKTOP.md \
    skills/pr-review/SKILL.md skills/pr-disproof/SKILL.md openspec/changes/copy-audit/audit.md
}
code_files() {
  find website/src -type f \( -name '*.astro' -o -name '*.ts' -o -name '*.tsx' -o -name '*.mjs' \)
  find dashboard-ui/src -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.json' \) \
    ! -name '*.test.ts' ! -name '*.test.tsx'
  find desktop/pages -type f \( -name '*.html' -o -name '*.cjs' \)
}

# Drop what is not copy before matching: comment lines, trailing comments, lone dash glyphs,
# list markers and SRT arrows. Output keeps "N:" line prefixes so hits stay addressable.
strip_noise() {   # $1 = text|code
  if [ "$1" = code ]; then
    sed -E -e '/^[0-9]+:[[:space:]]*(\/\/|\*|\/\*)/d' -e 's/[[:space:]]\/\/.*$//'
  else
    sed -E -e 's/^([0-9]+:)[[:space:]]*- /\1/' -e 's/ --> / /g'
  fi | sed -E -e "s/([|\"'>(]|^|:)[[:space:]]*${EM}[[:space:]]*([|\"'<)]|$)/\1 \2/g"
}

hits=$(mktemp "${TMPDIR:-/tmp}/no-dashes.XXXXXX")
trap 'rm -f "$hits"' EXIT
report() {   # $1 file, stdin = "N:line" hits (runs in a pipeline, so it writes to a file)
  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    printf '%s:%s\n' "$1" "$hit" | tee -a "$hits"
  done
}

for f in $(text_files); do
  [ -f "$f" ] || continue
  grep -n '' "$f" | strip_noise text | grep -E "${EM}|${EN}| - " | report "$f"
done
# Code files: em and en dashes anywhere outside comments (a JS or TS line cannot hold one
# outside a string, a template or JSX text); the spaced hyphen only inside a string literal or
# JSX text, found by a small tokenizer so arithmetic next to a quote is never reported.
for f in $(code_files); do
  [ -f "$f" ] || continue
  grep -n '' "$f" | strip_noise code | sed -E 's#/\[[^]]*\]/##g' \
    | grep -E "${EM}|${EN}" | report "$f"
  python3 - "$f" <<'PY' | report "$f"
import re, sys
STR = re.compile(r'"(?:[^"\\\n]|\\.)*"|\'(?:[^\'\\\n]|\\.)*\'|`(?:[^`\\]|\\.)*`')
JSX = re.compile(r'>([^<>{}=|&]*)<')
for n, line in enumerate(open(sys.argv[1], encoding="utf-8", errors="replace"), 1):
    if re.match(r'\s*(//|\*|/\*)', line):
        continue
    code = re.sub(r'\s//(?!/).*$', '', line)
    code = re.sub(r'calc\([^)]*\)', '', code)
    code = re.sub(r'\$\{[^}]*\}', '', code)
    spans = [m.group(0) for m in STR.finditer(code)] + [m.group(1) for m in JSX.finditer(code)]
    if any(' - ' in sp for sp in spans):
        print(f"{n}:{line.rstrip()}")
PY
done

if [ -s "$hits" ]; then
  echo "no-dashes: dashes used as punctuation found above. Rewrite with a full stop, comma or colon." >&2
  exit 1
fi
exit 0
