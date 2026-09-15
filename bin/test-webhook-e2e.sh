#!/usr/bin/env bash
# test-webhook-e2e.sh — end-to-end check of POST /webhooks/github against a real server.
#
# Boots server.py on a scratch ROOT with a webhook secret and one signed-in user, then
# uses curl + openssl (exactly what GitHub does, minus GitHub) to assert:
#   1. a bad signature → 401, a missing secret header → 401
#   2. ping → 200 and webhooks.json.last_ping is stamped
#   3. a signed review_requested → 202, the row shows up in /api/queue, `seen` holds
#      <repo>:<pr>:<login>, and the requested_at marker exists
#   4. the identical POST again → still one row, one seen line (no double-notify)
#   5. synchronize → the row's head changes and /api/pr reports stale=true for a reviewed head
#   6. closed → the row leaves the queue
#   7. an event for a repo outside REPOS → 202 and no row
# No network, no gh (a fake one on PATH), no notification backend (dashboard is the inbox).
#
#   bash bin/test-webhook-e2e.sh            # prints PASS/FAIL lines, exits non-zero on failure
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/rs-wh-e2e.XXXXXX")"
PORT="${PORT:-8997}"
SECRET="e2e-webhook-secret"
RS_SECRET="e2e-fixed-test-secret-not-for-production"
USER_LOGIN="acme-dev"
REPO="acme/widgets"
PR=4242
BASE="http://127.0.0.1:$PORT"
fails=0

pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; fails=$((fails + 1)); }
check() { # <label> <cond...>
  local label="$1"; shift
  if "$@"; then pass "$label"; else fail "$label"; fi
}

cleanup() {
  if [ -n "${SERVER_PID:-}" ]; then kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null; fi
  rm -rf "$ROOT"
}
trap cleanup EXIT

# --- scratch ROOT ------------------------------------------------------------------------------
mkdir -p "$ROOT/fakebin"
printf '#!/bin/sh\nexit 1\n' > "$ROOT/fakebin/gh"; chmod +x "$ROOT/fakebin/gh"
cat > "$ROOT/.env" <<EOF
RS_SECRET=$RS_SECRET
REVIEWER=$USER_LOGIN
REPOS=$REPO
DRY_RUN=1
PUBLIC_URL=$BASE
GITHUB_PAT=ghp_e2e_dummy_never_used
GITHUB_WEBHOOK_SECRET=$SECRET
NOTIFY_BACKENDS=none
EOF
echo "{\"$USER_LOGIN\": {\"name\": \"Acme Dev\", \"slack_id\": \"\", \"added\": 1}}" > "$ROOT/users.json"
echo '{"at": 1, "note": "e2e"}' > "$ROOT/MIGRATED"
echo '[]' > "$ROOT/queue.json"

env PATH="$ROOT/fakebin:$PATH" ROOT="$ROOT" RS_PORT="$PORT" RS_SPA=1 RS_COOKIE_SECURE=0 \
  python3 "$HERE/server.py" > "$ROOT/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 50); do curl -fs "$BASE/health" >/dev/null 2>&1 && break; sleep 0.2; done
curl -fs "$BASE/health" >/dev/null || { echo "server did not start:"; cat "$ROOT/server.log"; exit 1; }

# A session cookie for /api/* reads, minted the way the server does:
# session:<login>:<exp>:<epoch>. The epoch is 0 until "Sign out everywhere" bumps it.
exp=$(( $(date +%s) + 3600 ))
sig=$(printf '%s' "session:$USER_LOGIN:$exp:0" | openssl dgst -sha256 -hmac "$RS_SECRET" -r | cut -d' ' -f1)
COOKIE="rs_session=$USER_LOGIN:$exp:$sig"

sign() { printf 'sha256=%s' "$(printf '%s' "$1" | openssl dgst -sha256 -hmac "$SECRET" -r | cut -d' ' -f1)"; }
post() { # <event> <body> [signature | none] → prints HTTP status
  local event="$1" body="$2" s="${3:-$(sign "$2")}" hdr=()
  [ "$s" = none ] || hdr=(-H "X-Hub-Signature-256: $s")
  curl -s -o "$ROOT/last.body" -w '%{http_code}' -X POST "$BASE/webhooks/github" \
    -H 'Content-Type: application/json' -H "X-GitHub-Event: $event" \
    -H "X-GitHub-Delivery: e2e-$RANDOM" ${hdr[@]+"${hdr[@]}"} --data-binary "$body"
}
pr_json() { # <action> <head> [repo]
  jq -cn --arg a "$1" --arg h "$2" --arg r "${3:-$REPO}" --arg u "$USER_LOGIN" --argjson n "$PR" '
    {action:$a, repository:{full_name:$r, owner:{login:($r|split("/")[0])}},
     requested_reviewer:{login:$u},
     pull_request:{number:$n, title:"Webhook e2e PR", html_url:("https://github.com/"+$r+"/pull/"+($n|tostring)),
       additions:10, deletions:2, changed_files:3, draft:false, user:{login:"teammate", type:"User"},
       head:{sha:$h}, created_at:(now|todate), updated_at:(now|todate)}}'
}
queue_rows() { curl -s -b "$COOKIE" "$BASE/api/queue?tab=todo" | jq -r --arg n "$PR" '[.rows[] | select((.num|tostring) == $n)] | length'; }
rows_is() { [ "$(queue_rows)" = "$1" ]; }
file_rows() { jq -r --argjson n "$PR" '[.[] | select(.number==$n)] | length' "$ROOT/queue.json"; }
file_rows_is() { [ "$(file_rows)" = "$1" ]; }
file_head() { jq -r --argjson n "$PR" '.[] | select(.number==$n) | .head' "$ROOT/queue.json"; }
head_is() { [ "$(file_head)" = "$1" ]; }
count_is() { [ "$(jq -r .count "$ROOT/webhooks.json")" = "$1" ]; }
wait_for() { # <seconds> <cmd...>: retry until the command succeeds (the server works on a thread)
  local n=$(( $1 * 10 )); shift
  while [ "$n" -gt 0 ]; do "$@" && return 0; sleep 0.1; n=$((n - 1)); done
  "$@"
}

body=$(pr_json review_requested aaaa1111)

# 1. signature handling
code=$(post pull_request "$body" "sha256=deadbeef"); check "bad signature → 401 (got $code)" [ "$code" = 401 ]
code=$(post pull_request "$body" none); check "missing signature → 401 (got $code)" [ "$code" = 401 ]
check "no row after rejected posts" rows_is 0

# 2. ping
code=$(post ping '{"zen":"Keep it logically awesome.","hook_id":1}')
check "ping → 200 (got $code)" [ "$code" = 200 ]
check "webhooks.json.last_ping stamped" [ "$(jq -r '.last_ping // 0' "$ROOT/webhooks.json")" -gt 0 ]

# 3. review_requested
code=$(post pull_request "$body"); check "review_requested → 202 (got $code)" [ "$code" = 202 ]
check "row appears in /api/queue" wait_for 5 rows_is 1
check "seen has $REPO:$PR:$USER_LOGIN" wait_for 5 grep -qxF "$REPO:$PR:$USER_LOGIN" "$ROOT/seen"
row_is() { [ "$(jq -r --argjson n "$PR" '.[] | select(.number==$n) | "\(.requested|join(","))/\(.head)"' "$ROOT/queue.json")" = "$1" ]; }
check "queue.json row has the requested login + head" wait_for 5 row_is "$USER_LOGIN/aaaa1111"
check "requested_at marker written" wait_for 5 test -f "$ROOT/state/acme__widgets/$PR/users/$USER_LOGIN/requested_at"
check "webhooks.json counts the event" wait_for 3 count_is 1
check "/api/settings exposes webhooks.configured=true" \
  [ "$(curl -s -b "$COOKIE" "$BASE/api/settings" | jq -r .webhooks.configured)" = true ]
check "/api/me exposes webhooks_configured=true" \
  [ "$(curl -s -b "$COOKIE" "$BASE/api/me" | jq -r .webhooks_configured)" = true ]

# 4. identical redelivery
code=$(post pull_request "$body"); check "redelivery → 202 (got $code)" [ "$code" = 202 ]
check "second event counted" wait_for 3 count_is 2
check "still exactly one queue row" file_rows_is 1
check "still exactly one seen line" [ "$(grep -cxF "$REPO:$PR:$USER_LOGIN" "$ROOT/seen")" = 1 ]
check "server log says already seen" wait_for 5 grep -q "already seen" "$ROOT/server.log"

# 5. synchronize → stale. Pretend a review ran against the first head.
ud="$ROOT/state/acme__widgets/$PR/users/$USER_LOGIN"; mkdir -p "$ud"
echo aaaa1111 > "$ud/head"; echo 'done' > "$ud/status"; echo '{"event":"COMMENT","summary":"ok","comments":[]}' > "$ud/review.json"
code=$(post pull_request "$(pr_json synchronize bbbb2222)"); check "synchronize → 202 (got $code)" [ "$code" = 202 ]
check "queue row head flipped to bbbb2222" wait_for 5 head_is bbbb2222
stale_is() { [ "$(curl -s -b "$COOKIE" "$BASE/api/pr?repo=acme%2Fwidgets&pr=$PR" | jq -r .stale)" = "$1" ]; }
check "/api/pr reports the review as stale" wait_for 5 stale_is true
check "no second seen line after push" [ "$(grep -cxF "$REPO:$PR:$USER_LOGIN" "$ROOT/seen")" = 1 ]

# 6. closed
code=$(post pull_request "$(pr_json closed bbbb2222)"); check "closed → 202 (got $code)" [ "$code" = 202 ]
check "row left queue.json" wait_for 5 file_rows_is 0
check "unposted review archived for $USER_LOGIN" wait_for 5 test -f "$ud/archived"

# 7. a repository outside REPOS
code=$(post pull_request "$(pr_json review_requested cccc3333 evil/corp)"); check "foreign repo → 202 (got $code)" [ "$code" = 202 ]
check "foreign repo ignored with a log line" wait_for 3 grep -q "evil/corp is not in REPOS" "$ROOT/server.log"
check "foreign repo wrote no row" [ "$(jq -r '[.[] | select(.repo=="evil/corp")] | length' "$ROOT/queue.json")" = 0 ]

echo
echo "server log:"; sed 's/^/  /' "$ROOT/server.log"
echo
if [ "$fails" = 0 ]; then echo "ALL PASS"; else echo "$fails FAILED"; exit 1; fi
