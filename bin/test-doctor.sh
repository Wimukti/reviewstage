#!/usr/bin/env bash
# test-doctor.sh — regression test for desktop tool-version diagnostics.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/rs-doctor.XXXXXX")"
fails=0

pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; fails=$((fails + 1)); }
check_contains() { # <label> <needle> <haystack>
  local label="$1" needle="$2" haystack="$3"
  if printf '%s\n' "$haystack" | grep -Fq -- "$needle"; then pass "$label"; else fail "$label"; fi
}

cleanup() { rm -rf "$ROOT"; }
trap cleanup EXIT

mkdir -p "$ROOT/bin" "$ROOT/state"
cat > "$ROOT/.env" <<'EOF'
RS_PERSONAL=1
RS_SECRET=doctor-test-secret-with-enough-characters
PUBLIC_URL=http://127.0.0.1:65535
EOF
printf '2.81.0\n' > "$ROOT/bin/.gh.version"
printf '1.7\n' > "$ROOT/bin/.jq.version"
printf '2026.9.3\n' > "$ROOT/bin/.cloudflared.version"

# Doctor intentionally returns non-zero for an incomplete scratch install.  The assertions
# target only its read-only reporting of the stamps the desktop installer writes.
output=$(ROOT="$ROOT" bash "$HERE/doctor.sh" 2>&1 || true)
check_contains "reports gh's fetched version" "PASS  fetched tool gh 2.81.0" "$output"
check_contains "reports jq's fetched version" "PASS  fetched tool jq 1.7" "$output"
check_contains "reports cloudflared's fetched version" "PASS  fetched tool cloudflared 2026.9.3" "$output"

if [ "$fails" = 0 ]; then echo "ALL PASS"; else echo "$fails FAILED"; exit 1; fi
