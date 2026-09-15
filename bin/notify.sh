#!/usr/bin/env bash
# notify.sh — one notifier, several backends. Sourced by lib-common.sh; also runnable directly
# (server.py shells out to it):   notify.sh <kind> '<json-payload>'
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

# --- colours ---------------------------------------------------------------------------------
# Neutral cards (review_requested, qa_ready) wear the brand colour; a stop is grey, a failure
# red. Slack takes the hex, Discord the same colour as an integer.
NOTIFY_BRAND_HEX="#5865f2"; NOTIFY_BRAND_INT=5793266
NOTIFY_RED_HEX="#ed4245";   NOTIFY_RED_INT=15548997
NOTIFY_GREY_HEX="#95a5a6";  NOTIFY_GREY_INT=9807270

# --- verdict --------------------------------------------------------------------------------
# A review_ready card is coloured and labelled by the VERDICT, never by the review event
# (COMMENT / REQUEST_CHANGES is how the review would be posted, which means nothing to a reader).
# Same thresholds as the dashboard's verdict banner (PrPage.tsx `verdict`): any blocker — or an
# agent that asked for changes — is red; otherwise a should-fix is amber; other findings (nits,
# questions) are blue; nothing at all is green. Also written back into `extra` (verdict,
# blockers, should_fix) so the generic payload carries the same reading machines can key on.
#
# Adds to the payload: .verdict ∈ lgtm|minor|attention|blocked, .label ("Not LGTM — 2 blockers"),
# .dot (🔴 🟡 🔵 🟢), .hex ("#ed4245"), .color (the same colour as a Discord integer) and
# .header — the one-line "<dot> <label> · N findings" every backend prints.
NOTIFY_VERDICT_JQ='
  def plural($n; $one): ($n | tostring) + " " + $one + (if $n == 1 then "" else "s" end);
  (.extra.findings // 0) as $n | (.extra.blockers // 0) as $b | (.extra.should_fix // 0) as $f |
  (if $b > 0 or .extra.event == "REQUEST_CHANGES" then
     {verdict:"blocked", dot:"🔴", hex:"#ed4245", color:15548997,
      label:(if $b > 0 then "Not LGTM — " + plural($b; "blocker") else "Not LGTM — changes requested" end)}
   elif $f > 0 then
     {verdict:"attention", dot:"🟡", hex:"#f0b232", color:15774258, label:("Needs attention — " + ($f|tostring) + " to fix")}
   elif $n > 0 then
     {verdict:"minor", dot:"🔵", hex:"#3498db", color:3447003, label:("Minor notes — " + ($n|tostring))}
   else
     {verdict:"lgtm", dot:"🟢", hex:"#57f287", color:5763719, label:"LGTM — nothing to fix"}
   end) as $v |
  . + $v + {header:($v.dot + " " + $v.label + " · " + plural($n; "finding")),
            extra:(.extra + {verdict:$v.verdict, findings:$n, blockers:$b, should_fix:$f})}'

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
  if [ "$kind" = review_ready ]; then payload=$(echo "$payload" | jq -c "$NOTIFY_VERDICT_JQ"); fi
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
    # The bot token goes in on stdin via `-H @-`, never as an argv element: argv is world-readable
    # in `ps` for the lifetime of the request, and the box runs other people's jobs.
    # --connect-timeout / --max-time because pr-watch.sh calls notify_card synchronously inside
    # the poller's flock: without them one blackholed Slack endpoint wedges discovery for good.
    resp=$(printf 'Authorization: Bearer %s\n' "$SLACK_BOT_TOKEN" \
      | curl -fsS --connect-timeout 5 --max-time 10 -X POST -H @- \
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
  echo "$payload" | curl -fsS --connect-timeout 5 --max-time 10 -X POST \
    -H 'Content-type: application/json' \
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
      blocks=$(echo "$p" | jq --arg c "$NOTIFY_BRAND_HEX" '
        (if .slack_id != "" then "<@" + .slack_id + "> " else "@" + .login + " " end) as $w |
        {attachments: [{color: $c, blocks: [
          {type:"section", text:{type:"mrkdwn",
            text:($w + "review requested\n*<" + .url + "|" + .ref + " — " + .title + ">*\n`@"
                  + .author + "`  ·  +" + (.extra.additions // 0 | tostring) + " −"
                  + (.extra.deletions // 0 | tostring) + "  ·  "
                  + (.extra.files // 0 | tostring) + " files")}},
          {type:"actions", elements:[
            {type:"button", text:{type:"plain_text", text:"🔍 Open review"},
             style:"primary", url:(.extra.detail // .url)},
            {type:"button", text:{type:"plain_text", text:"Dashboard"}, url:(.extra.board // .url)},
            {type:"button", text:{type:"plain_text", text:"Open PR"}, url:.url}]}]}]}')
      echo "$blocks" | slack_post "$repo" "$pr" root "$login";;
    review_ready)
      # Ping ONLY the person who triggered the run; no Slack ID => no ping, no label.
      # Bar colour + header come from the verdict (NOTIFY_VERDICT_JQ), not the review event.
      # The summary block is emitted ONLY when there is a summary: Slack rejects the whole
      # message (invalid_blocks) for a section whose mrkdwn text is the empty string, so an
      # agent that returned no summary used to silently lose the entire card. Clamped to
      # Slack's 3000-character section limit, by characters, for the same reason.
      blocks=$(echo "$p" | jq '
        (if .slack_id != "" then "<@" + .slack_id + "> " else "" end) as $w |
        ((.extra.summary // "") | .[0:2900]) as $sum |
        {attachments:[{color: .hex, blocks:([
          {type:"section", text:{type:"mrkdwn",
            text:($w + "Review ready — *<" + .url + "|" + .ref + " — " + .title + ">*\n"
                  + .header)}}]
          + (if $sum == "" then [] else
              [{type:"section", text:{type:"mrkdwn", text:$sum}}] end)
          + [
          {type:"actions", elements:[
            {type:"button", text:{type:"plain_text", text:"📋 Open dashboard"},
             style:"primary", url:(.extra.detail // .url)},
            {type:"button", text:{type:"plain_text", text:"Open PR"}, url:.url}]},
          {type:"context", elements:[{type:"mrkdwn",
            text:"Nothing posted yet — select, edit and post from the dashboard."}]}])}]}')
      echo "$blocks" | slack_post "$repo" "$pr" reply "$login";;
    review_stopped)
      # extra.text is pre-rendered mrkdwn (the server's stop confirmation); a failed run from
      # run-review.sh carries extra.status=failed + extra.message instead. Red bar for a
      # failure, grey for a deliberate stop.
      blocks=$(echo "$p" | jq --arg red "$NOTIFY_RED_HEX" --arg grey "$NOTIFY_GREY_HEX" '
        (if (.extra.text // "") != "" then .extra.text
         elif .extra.status == "failed" then
           "⚠️ Review of *<" + .url + "|" + .ref + ">* failed: " + (.extra.message // "")
         else "🛑 Review of *<" + .url + "|" + .ref + " — " + .title + ">* was stopped." end) as $t |
        {attachments:[{color:(if .extra.status == "failed" then $red else $grey end),
          blocks:[{type:"section", text:{type:"mrkdwn", text:$t}}]}]}')
      echo "$blocks" | slack_post "$repo" "$pr" reply "$login";;
    qa_ready)
      blocks=$(echo "$p" | jq --arg c "$NOTIFY_BRAND_HEX" '
        (if .slack_id != "" then "<@" + .slack_id + "> " else "" end) as $w |
        {attachments:[{color: $c, blocks:[
          {type:"section", text:{type:"mrkdwn",
            text:($w + "📋 QA guide ready — *<" + .url + "|" + .ref + " — " + .title + ">*")}},
          {type:"actions", elements:[
            {type:"button", text:{type:"plain_text", text:"Open QA guide"},
             style:"primary", url:(.extra.detail // .url)},
            {type:"button", text:{type:"plain_text", text:"Open PR"}, url:.url}]}]}]}')
      echo "$blocks" | slack_post "$repo" "$pr" reply "$login";;
  esac
}

# --- discord ---------------------------------------------------------------------------------
# One embed per card: title "owner/name #123 · <PR title>", a description that says what
# happened, and a links line standing in for buttons (Discord webhooks have none).
_notify_discord() {
  local p="$1" body
  [ -n "${DISCORD_WEBHOOK:-}" ] || { echo "WARN: notify: discord enabled but DISCORD_WEBHOOK is empty" >&2; return 0; }
  body=$(echo "$p" | jq -c --argjson brand "$NOTIFY_BRAND_INT" --argjson red "$NOTIFY_RED_INT" \
                            --argjson grey "$NOTIFY_GREY_INT" '
    (if .discord_id != "" then "<@" + .discord_id + ">" else "" end) as $m |
    (if .kind == "review_requested" then
       {c: $brand, d: ("**Review requested** — `@" + .author + "`  ·  +"
            + (.extra.additions // 0 | tostring) + " −" + (.extra.deletions // 0 | tostring)
            + "  ·  " + (.extra.files // 0 | tostring) + " files"),
        l: ("[🔍 Open review](" + (.extra.detail // .url) + ") · [Dashboard]("
            + (.extra.board // .url) + ") · [Open PR](" + .url + ")")}
     elif .kind == "review_ready" then
       # colour + header come from the verdict (NOTIFY_VERDICT_JQ), not the review event
       {c: .color,
        d: ("**Review ready** — " + .header + "\n" + (.extra.summary // "")
            + "\n\n_Nothing posted yet — select, edit and post from the dashboard._"),
        l: ("[📋 Open dashboard](" + (.extra.detail // .url) + ") · [Open PR](" + .url + ")")}
     elif .kind == "review_stopped" then
       {c: (if .extra.status == "failed" then $red else $grey end),
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
       {c: $brand, d: "📋 **QA guide ready**",
        l: ("[Open QA guide](" + (.extra.detail // .url) + ") · [Open PR](" + .url + ")")}
     end) as $r |
    # Discord hard-limits an embed title to 256 characters and a description to 4096, and
    # rejects the WHOLE card with a 400 that only ever showed up in a log line. Both are
    # truncated by CHARACTER (jq slices codepoints) so a multi-byte title can never be cut in
    # half into invalid UTF-8. The links line is appended after the clamp so it always survives.
    ((.repo + " #" + .pr + " · " + .title) | if length > 250 then .[0:249] + "…" else . end) as $ti |
    (($r.d | if length > 3900 then .[0:3899] + "…" else . end) + "\n\n" + $r.l
      | if length > 4096 then .[0:4095] + "…" else . end) as $de |
    {content: $m, allowed_mentions: {parse: [], users: (if .discord_id != "" then [.discord_id] else [] end)},
     embeds: [{title: $ti, url: .url, color: $r.c,
               description: $de,
               footer: {text: "ReviewStage"}}]}')
  local code
  code=$(echo "$body" | curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 10 -X POST \
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
  code=$(printf '%s' "$p" | curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 10 -X POST \
          "${hdr[@]}" --data-binary @- "$WEBHOOK_URL" 2>/dev/null) || code="000"
  case "$code" in 2*) ;; *) echo "WARN: notify: generic webhook returned $code" >&2;; esac
  return 0
}

# Direct invocation: notify.sh <kind> '<json>' — used by server.py. Loads the install's
# config through lib-common.sh (which sources this file again as a library; guarded below).
if [ "${BASH_SOURCE[0]}" = "$0" ] && [ -z "${_NOTIFY_MAIN:-}" ]; then
  _NOTIFY_MAIN=1   # lib-common.sh sources this file again; the guard stops the recursion
  # shellcheck source=lib-common.sh
  . "$(dirname "$0")/lib-common.sh"
  notify_card "${1:-}" "${2:-}"
fi
