#!/usr/bin/env bash
# notify.sh — one notifier, several backends. Sourced by lib-common.sh; also runnable directly
# (prbot-server.py shells out to it):   notify.sh <kind> '<json-payload>'
#
#   notify_card <kind> <json>    kind ∈ review_requested | review_ready | review_stopped | qa_ready
#
# The payload is one small JSON object every backend renders in its own idiom:
#   {repo, pr, title, author, url, login, slack_id, discord_id, extra}
# `extra` is per kind — see PAYLOAD.md next to this file (also served on the Integrations page).
#
# Backends (NOTIFY_BACKENDS, comma list; default = whichever URLs are set in .env):
#   slack    SLACK_WEBHOOK, or SLACK_BOT_TOKEN + SLACK_CHANNEL (threads replies under the card)
#   discord  DISCORD_WEBHOOK — an embed; mentions <@discord_id> when the user saved one
#   generic  WEBHOOK_URL — POST the raw JSON; WEBHOOK_SECRET → X-ReviewStage-Signature: sha256=…
#   none     nothing (the dashboard is the inbox)
# A failing backend is a WARN line, never an error: the caller's review must not die on a webhook.

# shellcheck source=lib-settings.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib-settings.sh"

notify_backends() {
  local list="${NOTIFY_BACKENDS:-}"
  if [ -z "$list" ]; then
    { [ -n "${SLACK_WEBHOOK:-}" ] || { [ -n "${SLACK_BOT_TOKEN:-}" ] && [ -n "${SLACK_CHANNEL:-}" ]; }; } \
      && list+="slack,"
    [ -n "${DISCORD_WEBHOOK:-}" ] && list+="discord,"
    [ -n "${WEBHOOK_URL:-}" ] && list+="generic,"
  fi
  echo "$list" | tr ',' '\n' | tr -d ' ' | grep -v '^$' | sort -u
}

# notify_card <kind> <json>
notify_card() {
  local kind="${1:?notify_card <kind> <json>}" payload="${2:-}" b
  case "$kind" in review_requested|review_ready|review_stopped|qa_ready) ;;
    *) echo "WARN: notify: unknown kind '$kind'" >&2; return 0;; esac
  if ! echo "$payload" | jq -e 'type=="object"' >/dev/null 2>&1; then
    echo "WARN: notify: payload for $kind is not a JSON object" >&2; return 0
  fi
  # A payload without a repo (an older caller) is attributed to the single configured repo.
  payload=$(echo "$payload" | jq -c --arg k "$kind" --arg r "$(single_repo)" --argjson t "$(date +%s)" \
    '{kind:$k, ts:$t, repo:(.repo // $r), pr:(.pr // "" | tostring), title:(.title // ""),
      author:(.author // ""), url:(.url // ""), login:(.login // ""),
      slack_id:(.slack_id // ""), discord_id:(.discord_id // ""), extra:(.extra // {})}')
  local sent=0
  for b in $(notify_backends); do
    case "$b" in
      slack)   _notify_slack "$payload"   || echo "WARN: notify: slack backend failed" >&2;;
      discord) _notify_discord "$payload" || echo "WARN: notify: discord backend failed" >&2;;
      generic) _notify_generic "$payload" || echo "WARN: notify: generic backend failed" >&2;;
      none)    ;;
      *)       echo "WARN: notify: unknown backend '$b'" >&2;;
    esac
    sent=1
  done
  [ "$sent" = 1 ] || echo "(no notification backend configured; skipping notify)"
  return 0
}

# --- slack -----------------------------------------------------------------------------------
# slack_post <repo> <pr> [root|reply] [login]   (blocks JSON on stdin; repo+pr may be empty)
#
# With SLACK_BOT_TOKEN + SLACK_CHANNEL set, posts via chat.postMessage — which DOES return a
# message ts, so the review-ready update threads under the review-request card: a "root" post
# stores its ts; a "reply" post sends thread_ts from that file. Reviews are per reviewer, so a
# login keys the ts per user (udir/<login>/slack_ts) — each reviewer gets their own request card
# and their review-ready reply threads under it, never under someone else's. Without a login it
# uses the shared prdir/slack_ts. Without a bot token it falls back to the incoming webhook
# (send-only — a fresh message, no threading).
slack_post() {
  local repo="${1:-}" pr="${2:-}" mode="${3:-}" login="${4:-}" payload; payload=$(cat)
  if [ -n "${SLACK_BOT_TOKEN:-}" ] && [ -n "${SLACK_CHANNEL:-}" ]; then
    local ts_file="" thread="" body resp
    if [ -n "$pr" ]; then
      [ -n "$login" ] && ts_file="$(udir "$repo" "$pr" "$login")/slack_ts" || ts_file="$(prdir "$repo" "$pr")/slack_ts"
    fi
    [ "$mode" = reply ] && [ -f "$ts_file" ] && thread=$(cat "$ts_file")
    body=$(echo "$payload" | jq --arg ch "$SLACK_CHANNEL" --arg th "$thread" \
      '. + {channel:$ch, text:"ReviewStage PR review"} + (if $th=="" then {} else {thread_ts:$th} end)')
    resp=$(curl -fsS -X POST -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
      -H 'Content-type: application/json; charset=utf-8' --data "$body" \
      https://slack.com/api/chat.postMessage 2>/dev/null)
    if [ "$(echo "$resp" | jq -r '.ok' 2>/dev/null)" = true ]; then
      if [ "$mode" = root ] && [ -n "$ts_file" ]; then
        mkdir -p "$(dirname "$ts_file")"; echo "$resp" | jq -r '.ts' > "$ts_file"
      fi
    else
      echo "WARN: slack chat.postMessage failed: $(echo "$resp" | jq -r '.error // "?"')" >&2
    fi
    return 0
  fi
  [ -n "${SLACK_WEBHOOK:-}" ] || { echo "(no SLACK_WEBHOOK; skipping notify)"; return 0; }
  echo "$payload" | curl -fsS -X POST -H 'Content-type: application/json' \
    --data @- "$SLACK_WEBHOOK" >/dev/null 2>&1 || echo "WARN: slack post failed" >&2
}

# Renders the same Block Kit cards the scripts used to build inline, word for word. The PR is
# labelled `#123` on a single-repo install and `owner/name#123` once several are configured
# (`.ref` below) — same rule as the dashboard.
_notify_slack() {
  local p="$1" kind repo pr login blocks
  kind=$(echo "$p" | jq -r .kind); repo=$(echo "$p" | jq -r .repo)
  pr=$(echo "$p" | jq -r .pr); login=$(echo "$p" | jq -r .login)
  if [ "$(repo_count)" -gt 1 ] && [ -n "$repo" ]; then
    p=$(echo "$p" | jq -c '. + {ref:(.repo + "#" + .pr)}')
  else
    p=$(echo "$p" | jq -c '. + {ref:("#" + .pr)}')
  fi
  case "$kind" in
    review_requested)
      # <@U…> pings the person; a bare @login is a visible label that pings nobody.
      blocks=$(echo "$p" | jq '
        (if .slack_id != "" then "<@" + .slack_id + "> " else "@" + .login + " " end) as $w |
        {blocks: [
          {type:"section", text:{type:"mrkdwn",
            text:($w + "review requested\n*<" + .url + "|" + .ref + " — " + .title + ">*\n`@"
                  + .author + "`  ·  +" + (.extra.additions // 0 | tostring) + " −"
                  + (.extra.deletions // 0 | tostring) + "  ·  "
                  + (.extra.files // 0 | tostring) + " files")}},
          {type:"actions", elements:[
            {type:"button", text:{type:"plain_text", text:"🔍 Open review"},
             style:"primary", url:(.extra.detail // .url)},
            {type:"button", text:{type:"plain_text", text:"Dashboard"}, url:(.extra.board // .url)},
            {type:"button", text:{type:"plain_text", text:"Open PR"}, url:.url}]}]}')
      echo "$blocks" | slack_post "$repo" "$pr" root "$login";;
    review_ready)
      # Ping ONLY the person who triggered the run; no Slack ID => no ping, no label.
      blocks=$(echo "$p" | jq '
        (if .slack_id != "" then "<@" + .slack_id + "> " else "" end) as $w |
        (if .extra.event == "REQUEST_CHANGES" then "🔴" else "🟢" end) as $i |
        {blocks:[
          {type:"section", text:{type:"mrkdwn",
            text:($w + $i + " Review ready — *<" + .url + "|" + .ref + " — " + .title + ">*\n*"
                  + (.extra.event // "COMMENT") + "* · " + (.extra.findings // 0 | tostring)
                  + " finding(s), " + (.extra.blockers // 0 | tostring) + " blocker(s)")}},
          {type:"section", text:{type:"mrkdwn", text:(.extra.summary // "")}},
          {type:"actions", elements:[
            {type:"button", text:{type:"plain_text", text:"📋 Open dashboard"},
             style:"primary", url:(.extra.detail // .url)},
            {type:"button", text:{type:"plain_text", text:"Open PR"}, url:.url}]},
          {type:"context", elements:[{type:"mrkdwn",
            text:"Nothing posted yet — select, edit and post from the dashboard."}]}]}')
      echo "$blocks" | slack_post "$repo" "$pr" reply "$login";;
    review_stopped)
      # extra.text is pre-rendered mrkdwn (the server's stop confirmation); a failed run from
      # run-review.sh carries extra.status=failed + extra.message instead.
      blocks=$(echo "$p" | jq '
        (if (.extra.text // "") != "" then .extra.text
         elif .extra.status == "failed" then
           "⚠️ Review of *<" + .url + "|" + .ref + ">* failed: " + (.extra.message // "")
         else "🛑 Review of *<" + .url + "|" + .ref + " — " + .title + ">* was stopped." end) as $t |
        {blocks:[{type:"section", text:{type:"mrkdwn", text:$t}}]}')
      echo "$blocks" | slack_post "$repo" "$pr" reply "$login";;
    qa_ready)
      blocks=$(echo "$p" | jq '
        (if .slack_id != "" then "<@" + .slack_id + "> " else "" end) as $w |
        {blocks:[
          {type:"section", text:{type:"mrkdwn",
            text:($w + "📋 QA guide ready — *<" + .url + "|" + .ref + " — " + .title + ">*")}},
          {type:"actions", elements:[
            {type:"button", text:{type:"plain_text", text:"Open QA guide"},
             style:"primary", url:(.extra.detail // .url)},
            {type:"button", text:{type:"plain_text", text:"Open PR"}, url:.url}]}]}')
      echo "$blocks" | slack_post "$repo" "$pr" reply "$login";;
  esac
}

# --- discord ---------------------------------------------------------------------------------
# One embed per card: title "owner/name #123 · <PR title>", a description that says what
# happened, and a links line standing in for buttons (Discord webhooks have none).
_notify_discord() {
  local p="$1" body
  [ -n "${DISCORD_WEBHOOK:-}" ] || { echo "WARN: notify: discord enabled but DISCORD_WEBHOOK is empty" >&2; return 0; }
  body=$(echo "$p" | jq -c '
    (if .discord_id != "" then "<@" + .discord_id + ">" else "" end) as $m |
    (if .kind == "review_requested" then
       {c: 5793266, d: ("**Review requested** — `@" + .author + "`  ·  +"
            + (.extra.additions // 0 | tostring) + " −" + (.extra.deletions // 0 | tostring)
            + "  ·  " + (.extra.files // 0 | tostring) + " files"),
        l: ("[🔍 Open review](" + (.extra.detail // .url) + ") · [Dashboard]("
            + (.extra.board // .url) + ") · [Open PR](" + .url + ")")}
     elif .kind == "review_ready" then
       {c: (if .extra.event == "REQUEST_CHANGES" then 15548997 else 5763719 end),
        d: ((if .extra.event == "REQUEST_CHANGES" then "🔴" else "🟢" end)
            + " **Review ready** — **" + (.extra.event // "COMMENT") + "** · "
            + (.extra.findings // 0 | tostring) + " finding(s), "
            + (.extra.blockers // 0 | tostring) + " blocker(s)\n" + (.extra.summary // "")
            + "\n\n_Nothing posted yet — select, edit and post from the dashboard._"),
        l: ("[📋 Open dashboard](" + (.extra.detail // .url) + ") · [Open PR](" + .url + ")")}
     elif .kind == "review_stopped" then
       {c: 15105570,
        d: (if .extra.status == "failed" then "⚠️ **Review failed:** " + (.extra.message // "")
            else "🛑 **" + (.extra.job // "Review") + " stopped** by "
              + (if $m != "" then $m else "`@" + .login + "`" end)
              + (if .extra.confirmed == false then
                   " — ⚠️ a process may still be running on the box; check that Claude usage stopped."
                 else " — ✅ the agent is gone and the lock is released." end)
              + (if (.extra.runner // "") != "" and .extra.runner != "shared"
                 then " It was running on `" + .extra.runner + "`\u0027s Claude account." else "" end) end),
        l: ("[Open PR](" + .url + ")")}
     else
       {c: 5793266, d: "📋 **QA guide ready**",
        l: ("[Open QA guide](" + (.extra.detail // .url) + ") · [Open PR](" + .url + ")")}
     end) as $r |
    {content: $m, allowed_mentions: {parse: [], users: (if .discord_id != "" then [.discord_id] else [] end)},
     embeds: [{title: (.repo + " #" + .pr + " · " + .title), url: .url, color: $r.c,
               description: ($r.d + "\n\n" + $r.l),
               footer: {text: "ReviewStage"}}]}')
  local code
  code=$(echo "$body" | curl -sS -o /dev/null -w '%{http_code}' --max-time 10 -X POST \
          -H 'Content-Type: application/json' --data @- "$DISCORD_WEBHOOK" 2>/dev/null) || code="000"
  case "$code" in 2*) ;; *) echo "WARN: notify: discord webhook returned $code" >&2;; esac
  return 0
}

# --- generic webhook ---------------------------------------------------------------------------
# The raw payload, for Teams / Zapier / n8n / your own endpoint. With WEBHOOK_SECRET set, the
# body is signed: X-ReviewStage-Signature: sha256=HMAC-SHA256(secret, body). Verify with
# openssl or your language's hmac module — see docs/guides/notifications.
_notify_generic() {
  local p="$1" code sig=""
  [ -n "${WEBHOOK_URL:-}" ] || { echo "WARN: notify: generic enabled but WEBHOOK_URL is empty" >&2; return 0; }
  local -a hdr=(-H 'Content-Type: application/json' -H 'User-Agent: ReviewStage-Webhook/1'
                -H "X-ReviewStage-Event: $(echo "$p" | jq -r .kind)")
  if [ -n "${WEBHOOK_SECRET:-}" ]; then
    sig=$(printf '%s' "$p" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" -r | cut -d' ' -f1)
    hdr+=(-H "X-ReviewStage-Signature: sha256=$sig")
  fi
  code=$(printf '%s' "$p" | curl -sS -o /dev/null -w '%{http_code}' --max-time 10 -X POST \
          "${hdr[@]}" --data-binary @- "$WEBHOOK_URL" 2>/dev/null) || code="000"
  case "$code" in 2*) ;; *) echo "WARN: notify: generic webhook returned $code" >&2;; esac
  return 0
}

# Direct invocation: notify.sh <kind> '<json>' — used by prbot-server.py. Loads the install's
# config through lib-common.sh (which sources this file again as a library; guarded below).
if [ "${BASH_SOURCE[0]}" = "$0" ] && [ -z "${_NOTIFY_MAIN:-}" ]; then
  _NOTIFY_MAIN=1   # lib-common.sh sources this file again; the guard stops the recursion
  # shellcheck source=lib-common.sh
  . "$(dirname "$0")/lib-common.sh"
  notify_card "${1:-}" "${2:-}"
fi
