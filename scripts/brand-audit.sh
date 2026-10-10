#!/usr/bin/env bash
# brand-audit.sh — every old-brand ("ReviewStage") string hit in the repo, grouped by the
# categories of openspec/changes/rename/inventory.md, and a non-zero exit while any hit is not
# allowlisted. Run it before the rename to see the work (it exits 1 — expected), and after the
# rename as the gate that fails CI if an old brand string survives. Works on bash 3.2 (macOS).
#
#   scripts/brand-audit.sh [ALLOWLIST] [--env] [--quiet]
#
#   ALLOWLIST  a file of `path-glob:ERE` lines. A hit is permitted when its path matches the
#              glob (bash pattern; `*` also matches `/`, so `openspec/*` covers the whole tree)
#              AND the line matches the ERE. `#` lines and blank lines are ignored. An ERE of
#              `.` allows every line of the path.
#   --env      also list the distinct RS_* environment variable names (informational: these are
#              kept as-is forever and never count as hits).
#   --quiet    print only the per-category counts and the summary.
#
# Categories (first match wins):
#   e  tests and fixtures that assert on the brand
#   d  launch copy (docs/launch/*)
#   b  machine identifiers (paths, labels, bundle ids, package/bin/image names, headers, keys)
#   c  external assets (domain, GitHub slug, npm, YouTube, media files)
#   a  user-visible brand strings (UI, site, docs)
set -u
cd "$(dirname "$0")/.." || exit 2

ALLOW=""; SHOW_ENV=0; QUIET=0
for arg in "$@"; do
  case "$arg" in
    --env) SHOW_ENV=1 ;;
    --quiet) QUIET=1 ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) ALLOW="$arg" ;;
  esac
done
if [ -n "$ALLOW" ] && [ ! -r "$ALLOW" ]; then echo "allowlist not readable: $ALLOW" >&2; exit 2; fi

# The old brand in every spelling, plus the retired tagline. Not RS_* (kept forever).
PATTERN='review[ -]?stage|stage your review'

# Tracked + untracked-but-not-ignored text files; binaries, lockfiles and build output skipped.
files() {
  git ls-files -co --exclude-standard -z \
    | grep -z -v -E '(^|/)(node_modules|dist|\.git|__pycache__|test-results)/' \
    | grep -z -v -E '\.(lock|mp4|webm|gif|png|jpg|jpeg|icns|ico|tgz|pyc|woff2?|ttf|pdf)$' \
    | grep -z -v -E '(^|/)pnpm-lock\.yaml$' \
    | grep -z -v -E '^scripts/brand-audit\.sh$'
}

B_RE='dev\.reviewstage|io\.reviewstage|~?/?\.reviewstage\b|/home/reviewstage|reviewstage://|ReviewStage\.app|reviewstage\.desktop|reviewstage\.service|reviewstage\.conf|reviewstage-(error|access)\.log|X-ReviewStage|ReviewStage-Webhook|npx reviewstage|reviewstage@|/reviewstage`|reviewstage:(ci|local)|reviewstage-(data|demo)\b|window\.reviewstage|"reviewstage:[a-z-]+"|reviewstage\.repoFilter|reviewstage\.local|useradd|chown|USER reviewstage|HOME=/home|LAUNCH_AGENT|CFBundle|"name": "reviewstage|"bin"|reviewstage-\*\.tgz|reviewstage-launcher|reviewstage\.png|StartupWMClass|server_version|^Name=ReviewStage|RS_HOST|reviewstage-\$\{RS_ENV|reviewstage-<env>|registry|BRAND = |setName|setToolTip|\.reviewstage-branded|reviewstage_reachable|a2(en|dis)site|clone .*reviewstage|cd reviewstage|~/reviewstage'
C_RE='reviewstage\.dev|github\.com/Wimukti/reviewstage|youtu|og\.png|reviewstage-demo\.mp4|social preview|thumbnail|wordmark|aria-label="ReviewStage"'

classify() { # $1 path  $2 line  -> echoes category letter
  case "$1" in
    bin/test_*|desktop/test/*|dashboard-ui/e2e/*|website/scripts/verify-site.mjs) echo e; return ;;
    docs/launch/*) echo d; return ;;
  esac
  if printf '%s\n' "$2" | grep -q -i -E "$B_RE"; then echo b; return; fi
  if printf '%s\n' "$2" | grep -q -i -E "$C_RE"; then echo c; return; fi
  case "$1" in
    website/public/*|assets/*|docs/demos/*|website/src/content/site-links.ts) echo c; return ;;
  esac
  echo a
}

allowed() { # $1 path  $2 line -> 0 when an allowlist entry matches
  [ -n "$ALLOW" ] || return 1
  local entry glob ere
  while IFS= read -r entry || [ -n "$entry" ]; do
    [ -z "$entry" ] && continue
    case "$entry" in \#*) continue ;; esac
    glob="${entry%%:*}"; ere="${entry#*:}"
    # shellcheck disable=SC2254
    if [[ "$1" == $glob ]] && printf '%s\n' "$2" | grep -q -E -- "$ere"; then return 0; fi
  done < "$ALLOW"
  return 1
}

tmp="$(mktemp)"; cls="$(mktemp)"; trap 'rm -f "$tmp" "$cls"' EXIT
files | xargs -0 grep -i -n -H -E "$PATTERN" 2>/dev/null > "$tmp" || true

# One classified row per hit: <cat>\t<allowed:1|0>\t<path>:<line>: <text>
total=0; remaining=0
while IFS= read -r hit; do
  path="${hit%%:*}"; rest="${hit#*:}"; lineno="${rest%%:*}"; text="${rest#*:}"
  cat="$(classify "$path" "$text")"
  if allowed "$path" "$text"; then ok=1; else ok=0; remaining=$((remaining+1)); fi
  total=$((total+1))
  printf '%s\t%s\t%s:%s: %s\n' "$cat" "$ok" "$path" "$lineno" "${text:0:140}" >> "$cls"
done < "$tmp"

title() { case "$1" in
  a) echo "(a) user-visible brand strings — UI, site, docs" ;;
  b) echo "(b) machine identifiers — paths, labels, ids, package/bin/image names, headers, keys" ;;
  c) echo "(c) external assets — domain, GitHub slug, npm, YouTube, media" ;;
  d) echo "(d) launch copy — docs/launch/*" ;;
  e) echo "(e) tests and fixtures asserting on the brand" ;;
esac; }

for c in a b c d e; do
  n=$(awk -F'\t' -v c="$c" '$1==c' "$cls" | wc -l | tr -d ' ')
  ok=$(awk -F'\t' -v c="$c" '$1==c && $2==1' "$cls" | wc -l | tr -d ' ')
  echo "== $(title "$c"): $n hits, $ok allowed"
  if [ "$QUIET" != 1 ] && [ "$n" -gt 0 ]; then
    awk -F'\t' -v c="$c" '$1==c { printf "%s%s\n", $3, ($2==1 ? "  (allowed)" : "") }' "$cls" | sort -t: -k1,1 -k2,2n
    echo
  fi
done

if [ "$SHOW_ENV" = 1 ]; then
  echo "== RS_* environment variable names (kept forever; not counted):"
  files | xargs -0 grep -o -h -E '\bRS_[A-Z0-9_]+' 2>/dev/null | sort | uniq -c | sort -rn | awk '{printf "   %-28s %s\n", $2, $1}'
  echo
fi

nfiles=$(cut -d: -f1 "$tmp" | sort -u | wc -l | tr -d ' ')
echo "== total: $total hits in $nfiles files; allowed: $((total-remaining)); remaining: $remaining"
if [ "$remaining" -eq 0 ]; then echo "OK: no non-allowlisted old-brand strings."; exit 0; fi
echo "FAIL: $remaining old-brand hit(s) not covered by the allowlist${ALLOW:+ ($ALLOW)}."
exit 1
