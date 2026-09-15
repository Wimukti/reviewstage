#!/usr/bin/env bash
# pr-watch.sh — poll for PRs awaiting review from every signed-in user, keep queue.json
#               fresh for the dashboard, and post a card (Slack / Discord / webhook, see
#               notify.sh) for anything newly requested.
#
# cron (every 3 min, flock'd):
#   */3 * * * * flock -n /tmp/pr-watch.lock $HOME/.reviewstage/bin/pr-watch.sh
#
# Notify only; no review runs from here. Dedup is per REPO + PR + LOGIN (`<repo>:<pr>:<login>`
# in `seen`), written only AFTER a card is confirmed sent — the same order rs_webhook.py uses.
# A PR nobody should be pinged about yet (draft, bot, too old) goes to `suppressed` instead and
# is re-evaluated every cycle, so it pings the moment it becomes reviewable. Each reviewer is
# pinged once per PR and never again — pushing new commits changes the head SHA but must not
# re-ping anyone. The dashboard always reflects the live queue
# regardless of what has been announced, so Slack is a one-time nudge rather than the source
# of truth. To re-announce one, drop its line from `seen`.
#
# Users come from users.json (written by the dashboard on sign-in). Only login + slack_id are
# read here — PATs stay encrypted and are only ever decrypted by the server, for posting.
# With no users yet, falls back to polling $REVIEWER alone so a fresh box still works.
set -uo pipefail
# Resolve our own directory before the cd: a relative $0 would point at the wrong place after it.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE" || exit 1
# shellcheck source=lib-common.sh
. "$HERE/lib-common.sh"
require_env
# The Settings page can pause polling without touching cron or the container.
if [ "$(setting poller_enabled true)" = false ]; then
  echo "==> poller disabled in Settings (poller_enabled=false) — nothing to do"; exit 0
fi

# GitHub webhooks (POST /webhooks/github, see rs_webhook.py) deliver the same facts within a
# second and stamp $ROOT/webhooks.json. When one arrived within 2 × the poll interval this run
# is only the safety net for missed deliveries — say so, then carry on exactly as before.
WEBHOOKS_FILE="$ROOT/webhooks.json"
if [ -s "$WEBHOOKS_FILE" ]; then
  wh_last=$(jq -r '.last_event_at // 0' "$WEBHOOKS_FILE" 2>/dev/null)
  wh_interval=$(setting poll_interval_seconds "${POLL_INTERVAL:-180}")
  case "${wh_last}${wh_interval}" in
    ''|*[!0-9]*) ;;
    *) wh_age=$(( $(date +%s) - wh_last ))
       [ "$wh_age" -le $(( 2 * wh_interval )) ] \
         && echo "==> webhooks active (last event ${wh_age}s ago); poll is a safety net" ;;
  esac
fi

# Don't Slack-nudge for PRs created long ago: a fresh review request on a years-old open PR is
# almost always noise (see the pilot feedback). Such PRs are still marked seen (so they never
# spam) and stay fully visible + reviewable in the dashboard queue — only the Slack ping is
# suppressed. 0 disables the cutoff. Tunable in .env as RS_MAX_PR_AGE_DAYS.
MAX_AGE_DAYS="${RS_MAX_PR_AGE_DAYS:-45}"

USERS_FILE="$ROOT/users.json"

# How many rows one `gh` search may return before we suspect truncation. GitHub silently caps;
# the old 50 lost rows on any busy repo with no signal at all.
SEARCH_LIMIT="${RS_SEARCH_LIMIT:-200}"
ORG_SEARCH_LIMIT="${RS_ORG_SEARCH_LIMIT:-300}"
# How long per-run artefacts (agent logs, history entries) are kept by the daily sweep.
RETENTION_DAYS="${RS_RETENTION_DAYS:-30}"

# Nightly housekeeping, once per calendar day: device tokens idle for 180 days (docs/MOBILE.md),
# `seen` lines for PRs that have closed (the file is append-only and grepped once per PR per
# login every cycle), and the log / per-run artefact retention sweep. Nothing under ROOT was
# ever cleaned up before this.
if [ "$(cat "$ROOT/daily-done" 2>/dev/null)" != "$(date +%F)" ]; then
  [ -f "$USERS_FILE" ] && python3 "$HERE/rs_devices.py" prune "$USERS_FILE"
  pruned=$(ROOT="$ROOT" python3 "$HERE/rs_queue.py" prune-seen 2>&1) \
    && [ "${pruned:-0}" != 0 ] && echo "==> pruned $pruned seen line(s) for closed PRs"
  ROOT="$ROOT" python3 "$HERE/rs_queue.py" retention "$RETENTION_DAYS" || true
  date +%F > "$ROOT/daily-done"
  # Pre-rename marker: an upgraded box must not re-run yesterday's device prune twice.
  date +%F > "$ROOT/devices-pruned"
fi

# mark_seen <repo> <pr> <login> — through rs_queue so the append takes the same fcntl lock a
# concurrent prune or webhook holds; a bare `>> $SEEN` could be lost under a rewrite.
mark_seen() { ROOT="$ROOT" python3 "$HERE/rs_queue.py" mark-seen "$1" "$2" "$3" >/dev/null; }

# with_timeout <seconds> <cmd...> — GNU `timeout` when present, else run it plain. A card is
# posted inside the poller's flock, so a blackholed Slack/Discord/webhook endpoint would
# otherwise stop discovery for everyone, permanently.
with_timeout() {
  local secs="$1"; shift
  if command -v timeout >/dev/null 2>&1; then timeout "$secs" "$@"; else "$@"; fi
}

logins=$(jq -r 'keys[]' "$USERS_FILE" 2>/dev/null)
[ -n "$logins" ] || logins="$REVIEWER"

# Which repositories to poll: every configured one, plus — with REPO_ALLOW_ORG — any repo under
# that org where a signed-in user has an open review request. Discovery is one search per user
# (`gh search prs --review-requested=<login> --owner <org>`); it needs the service token to see
# the org. The discovered repos then go through the same per-repo listing as the configured ones,
# so every queue row has the same fields. Cloned lazily by run-review.sh on first review.
repos=$(repos_list)
if [ -n "$REPO_ALLOW_ORG" ]; then
  for login in $logins; do
    if ! found=$(gh search prs --owner "$REPO_ALLOW_ORG" --review-requested="$login" \
                   --state open --limit "$ORG_SEARCH_LIMIT" --json repository \
                   -q '.[].repository.nameWithOwner' 2>&1); then
      echo "ERROR: gh search (org $REPO_ALLOW_ORG) failed for $login: $(printf '%s' "$found" \
        | tr '\n' ' ' | cut -c1-200)" >&2
      continue
    fi
    n=$(printf '%s' "$found" | grep -c . || true)
    [ "$n" -ge "$ORG_SEARCH_LIMIT" ] && echo "WARN: org discovery for $login returned $n repos \
(the --limit) — results are probably truncated; raise RS_ORG_SEARCH_LIMIT" >&2
    [ -n "$found" ] && repos+=$'\n'"$found"
  done
fi
repos=$(printf '%s\n' "$repos" | awk 'NF && !seen[tolower($0)]++')

# One search per user per repo beats paging every open PR: a busy repo sees 200+ PR updates a
# week, and `review-requested:` resolves to direct individual requests server-side. Each row is
# tagged with the repo and the login it was found for; rows for the same repo+PR are merged below.
#
# EVERY FAILURE IS TRACKED. A swallowed `2>/dev/null; || continue` used to let a partial — often
# empty — result be written straight over queue.json, so an expired token or a secondary rate
# limit showed every user "You're all caught up" while real requests sat on GitHub. A repo+login
# whose search failed is simply not in $PAIRS, and rs_queue.merge_poll then leaves its existing
# rows exactly where they are.
fields=number,title,author,headRefOid,url,additions,deletions,changedFiles,isDraft,createdAt,updatedAt
FRESH="$ROOT/.poll-rows.json"
PAIRS="$ROOT/.poll-pairs"
: > "$PAIRS"
tagged=""
searches=0; failures=0
for repo in $repos; do
  repo_allowed "$repo" || { echo "skipping $repo (not in REPOS / REPO_ALLOW_ORG)"; continue; }
  for login in $logins; do
    searches=$((searches + 1))
    if ! rows=$(gh pr list -R "$repo" --state open --search "review-requested:$login" \
                  --limit "$SEARCH_LIMIT" --json "$fields" 2>&1); then
      failures=$((failures + 1))
      echo "ERROR: gh pr list failed for $login in $repo: $(printf '%s' "$rows" \
        | tr '\n' ' ' | cut -c1-200)" >&2
      continue
    fi
    n=$(printf '%s' "$rows" | jq 'length' 2>/dev/null || echo 0)
    if [ "$n" -ge "$SEARCH_LIMIT" ]; then
      echo "WARN: $repo review-requested:$login returned $n rows (the --limit) — results are \
probably truncated; raise RS_SEARCH_LIMIT" >&2
    fi
    printf '%s %s\n' "$(printf '%s' "$repo" | tr 'A-Z' 'a-z')" "$login" >> "$PAIRS"
    tagged+=$(echo "$rows" | jq -c --arg u "$login" --arg r "$repo" '.[] | . + {requested:[$u], repo:$r}')$'\n'
  done
done

# Nothing at all came back: publish nothing. An empty $PAIRS means we learned nothing this
# cycle, and writing a queue built from that is exactly the bug above.
if [ "$searches" -gt 0 ] && [ ! -s "$PAIRS" ]; then
  echo "ERROR: all $searches gh search(es) failed — queue.json left untouched. Check the token \
(gh auth status), GitHub status and your rate limit." >&2
  exit 1
fi
[ "$failures" -gt 0 ] && echo "WARN: $failures of $searches searches failed; their rows are kept \
as-is rather than dropped" >&2

# The rows this cycle derived, in queue.json's shape. `requested` is the union of logins
# awaiting each PR — the dashboard filters on it, so one file serves every user.
echo "$tagged" | jq -s 'group_by([.repo, .number]) | map(.[0] + {requested: (map(.requested[]) | unique)})
  | map({repo, number, title, url, additions, deletions, changedFiles, requested,
         author: .author.login, isBot: (.author.is_bot // false),
         isDraft, head: .headRefOid, createdAt, updatedAt})' \
  > "$FRESH" || die "could not build this cycle's rows (jq failed)"

# MERGE, never replace, and under the same fcntl lock every other writer takes — a webhook
# delivery landing mid-poll is no longer lost, and a row only a webhook could know about (a
# TEAM review request, which `review-requested:<login>` never returns) survives the cycle.
summary=$(ROOT="$ROOT" python3 "$HERE/rs_queue.py" merge-poll "$FRESH" "$PAIRS") \
  || die "queue merge failed — queue.json left untouched"
echo "==> queue: $summary"
rm -f "$FRESH" "$PAIRS"

# --- New-user clean slate ---------------------------------------------------------------------
# A person signing in usually has a backlog of open review requests they'll never action. We
# don't want to Slack-spam them with a card for each, or fill their "To review" with old ones —
# they should start fresh and only see requests from now on. So the FIRST time we ever see a
# login, seed its whole current backlog as already-notified (no Slack) and archive it in the
# dashboard. Only genuinely-new requests after this point ping and land in "To review".
KNOWN="$ROOT/known_logins"
if [ ! -f "$KNOWN" ]; then
  # First run of this logic on an existing box (or after a rebuild that lost known_logins):
  # onboard everyone already signed in. Seed each one's WHOLE current backlog as already-seen
  # (no Slack) so the upgrade never blasts their existing review-request queue — but do NOT
  # archive it, so their live "To review" queue stays intact (unlike a brand-new sign-in).
  # Without this seeding, every existing user's entire backlog re-pings on the next poll.
  for login in $logins; do
    for key in $(jq -r --arg u "$login" \
                   '.[] | select(.requested | index($u)) | "\(.repo):\(.number)"' "$ROOT/queue.json"); do
      grep -qxF "$key:$login" "$SEEN" || mark_seen "${key%:*}" "${key##*:}" "$login"
    done
    echo "$login" >> "$KNOWN"
  done
  echo "==> first run: seeded existing users' backlogs as seen (no Slack, no archive)"
fi
for login in $logins; do
  grep -qxF "$login" "$KNOWN" && continue
  n=0
  for key in $(jq -r --arg u "$login" \
                 '.[] | select(.requested | index($u)) | "\(.repo):\(.number)"' "$ROOT/queue.json"); do
    grep -qxF "$key:$login" "$SEEN" || mark_seen "${key%:*}" "${key##*:}" "$login"
    ud=$(udir "${key%:*}" "${key##*:}" "$login"); mkdir -p "$ud"
    # `.auto` marks this as OUR archive, so a later re-request can undo it (a user's own
    # archive has no such sibling and is never touched).
    [ -f "$ud/archived" ] || { date +%s > "$ud/archived"; date +%s > "$ud/archived.auto"; }
    n=$((n + 1))
  done
  echo "$login" >> "$KNOWN"
  echo "==> new user $login: seeded $n backlog PR(s) as seen + archived (clean slate)"
done

# Slack member ID / Discord user ID from users.json: with one the card pings the person, without
# it a bare @login is a visible label that pings nobody (add yours in Integrations).
user_field() {   # <login> <field>
  jq -r --arg l "$1" --arg f "$2" '.[$l][$f] // ""' "$USERS_FILE" 2>/dev/null
}
# seen_for <repo> <pr> <login>. Lines written before the repo dimension were `<pr>:<login>`
# (and, before multi-user, a bare `<pr>` meaning the owner) — both still count when this is the
# only configured repo, so an upgrade never re-pings anyone.
seen_for() {
  grep -qxF "$1:$2:$3" "$SEEN" && return 0
  [ "$(single_repo)" = "$1" ] || return 1
  grep -qxF "$2:$3" "$SEEN" || { [ "$3" = "$REVIEWER" ] && grep -qxF "$2" "$SEEN"; }
}

jq -c '.[]' "$ROOT/queue.json" | while read -r pr; do
  num=$(echo "$pr" | jq -r .number)
  repo=$(echo "$pr" | jq -r .repo)

  # Who on this PR has not been told yet? A request that returned after we auto-archived it
  # (PR closed, or the new-user clean slate) is un-archived and un-seen first, or it would come
  # back invisible and silent.
  new=""
  for login in $(echo "$pr" | jq -r '.requested[]'); do
    ROOT="$ROOT" python3 "$HERE/rs_queue.py" unarchive-auto "$repo" "$num" "$login" >/dev/null 2>&1
    seen_for "$repo" "$num" "$login" || new+="$login "
  done
  [ -n "$new" ] || continue

  # Not-yet-notifiable: a draft, a bot PR (with SKIP_BOT_PRS) or one created more than
  # MAX_AGE_DAYS ago. These go to `suppressed`, NOT to `seen`: marking them seen was permanent,
  # so a PR that happened to be a draft the first time we looked could never ping again.
  # `date -d` is GNU-only — on macOS the old `|| echo 0` silently disabled the cutoff entirely.
  suppress=""
  if [ "${MAX_AGE_DAYS:-0}" -gt 0 ]; then
    created=$(echo "$pr" | jq -r '.createdAt // empty')
    if [ -n "$created" ]; then
      age_days=$(python3 -c 'import calendar,sys,time
try:
    print(int((time.time() - calendar.timegm(time.strptime(sys.argv[1][:19], "%Y-%m-%dT%H:%M:%S"))) // 86400))
except ValueError:
    print(-1)' "$created")
      [ "$age_days" -gt "$MAX_AGE_DAYS" ] \
        && suppress="created ${age_days}d ago (> ${MAX_AGE_DAYS}d)"
    fi
  fi
  draft=$(echo "$pr"  | jq -r .isDraft)
  is_bot=$(echo "$pr" | jq -r '.isBot')
  [ "$draft" = "true" ] && suppress="draft"
  [ "$SKIP_BOT_PRS" = "1" ] && [ "$is_bot" = "true" ] && suppress="bot author (SKIP_BOT_PRS)"
  if [ -n "$suppress" ]; then
    echo "==> $repo#$num $suppress — no ping (re-checked every cycle)"
    for login in $new; do
      ROOT="$ROOT" python3 "$HERE/rs_queue.py" suppress "$repo" "$num" "$login" "$suppress"
    done
    continue
  fi
  for login in $new; do
    ROOT="$ROOT" python3 "$HERE/rs_queue.py" clear-suppressed "$repo" "$num" "$login"
  done

  author=$(echo "$pr" | jq -r .author)
  title=$(echo "$pr"  | jq -r .title)
  url=$(echo "$pr"    | jq -r .url)
  adds=$(echo "$pr"   | jq -r .additions)
  dels=$(echo "$pr"   | jq -r .deletions)
  files=$(echo "$pr"  | jq -r .changedFiles)
  detail=$(signed_link pr "$repo" "$num" 604800)   # 7 days — opening the dashboard costs nothing
  board=$(dashboard_link 604800)

  # One card per requested reviewer — each mentions only that person and threads their own
  # review-ready reply, so two reviewers on the same PR never share a ping or a thread.
  for login in $new; do
    echo "==> notifying $repo#$num ($author) $title → $login"
    card=$(jq -n --arg repo "$repo" --arg t "$title" --arg u "$url" \
          --arg a "$author" --arg l "$detail" --arg n "$num" --arg s "$adds" --arg d "$dels" \
          --arg f "$files" --arg b "$board" --arg login "$login" \
          --arg sid "$(user_field "$login" slack_id)" --arg did "$(user_field "$login" discord_id)" '
      {repo:$repo, pr:$n, title:$t, author:$a, url:$u, login:$login, slack_id:$sid, discord_id:$did,
       extra:{additions:($s|tonumber? // 0), deletions:($d|tonumber? // 0),
              files:($f|tonumber? // 0), detail:$l, board:$b}}')
    # Watchdog: notify.sh runs in its own process under `timeout`, not as a function call, so a
    # backend that accepts the connection and then never answers cannot wedge the whole poll.
    # `seen` is written only on a confirmed send — the same order rs_webhook.py uses — and a
    # send that keeps failing is retried, then given up on after MAX_NOTIFY_ATTEMPTS.
    if ROOT="$ROOT" with_timeout 20 bash "$HERE/notify.sh" review_requested "$card"; then
      mark_seen "$repo" "$num" "$login"
      ROOT="$ROOT" python3 "$HERE/rs_queue.py" notify-ok "$repo" "$num" "$login"
    else
      tries=$(ROOT="$ROOT" python3 "$HERE/rs_queue.py" notify-failed "$repo" "$num" "$login")
      if [ "${tries:-1}" -ge 5 ]; then
        echo "ERROR: card for $repo#$num → $login failed $tries times — giving up (marking seen)" >&2
        mark_seen "$repo" "$num" "$login"
      else
        echo "ERROR: card for $repo#$num → $login failed (attempt $tries) — will retry next cycle" >&2
      fi
    fi
    # Phase 4 cycle-time source: stamp when this reviewer was first asked (once).
    ud=$(udir "$repo" "$num" "$login"); mkdir -p "$ud"
    [ -f "$ud/requested_at" ] || date +%s > "$ud/requested_at"
  done
done

# --- Auto re-profile ------------------------------------------------------------------------
# For each repo with auto_profile on (settings.json, set from the Skills page): at most once a
# day, refresh the base clone and hash `git ls-files`; if the tree changed materially since the
# last profile, ask the server to rebuild it. The server runs it as the admin, on the admin's
# connected Claude account — the poller never sees a token — and logs + skips when the admin has
# none. "Materially" = at least max(5, 2%) of paths added or removed, so a renamed file or a new
# doc never spends a Sonnet call.
AUTO="$(setting auto_profile '{}')"
if [ "$AUTO" != "{}" ] && [ -n "$AUTO" ]; then
  for repo in $(repos_list); do
    slug=$(repo_slug "$repo")
    [ "$(printf '%s' "$AUTO" | jq -r --arg s "$slug" '.[$s] // false')" = true ] || continue
    base=$(base_dir "$repo"); pd="$ROOT/profiles/$slug"; mkdir -p "$pd"
    git -C "$base" rev-parse --git-dir >/dev/null 2>&1 || continue
    now=$(date +%s); last=$(cat "$pd/tree.checked" 2>/dev/null || echo 0)
    [ $((now - last)) -ge 86400 ] || continue
    echo "$now" > "$pd/tree.checked"
    git -C "$base" fetch -q origin 2>/dev/null || true
    git -C "$base" pull -q --ff-only 2>/dev/null || true
    git -C "$base" ls-files | sort > "$pd/tree.now"
    if [ -f "$pd/tree.paths" ]; then
      changed=$(comm -3 "$pd/tree.paths" "$pd/tree.now" | wc -l | tr -d ' ')
      total=$(wc -l < "$pd/tree.now" | tr -d ' ')
      min=$(( total / 50 )); [ "$min" -lt 5 ] && min=5
      if [ "$changed" -lt "$min" ]; then
        echo "==> auto-profile $repo: tree changed by $changed path(s) (< $min) — no re-profile"
        rm -f "$pd/tree.now"; continue
      fi
      echo "==> auto-profile $repo: $changed path(s) added/removed — asking the server to re-profile"
    else
      echo "==> auto-profile $repo: first fingerprint recorded — no re-profile yet"
      mv "$pd/tree.now" "$pd/tree.paths"; continue
    fi
    mv "$pd/tree.now" "$pd/tree.paths"
    exp=$(( now + 300 )); sig=$(sign "profile-auto:$repo:$exp")
    resp=$(curl -fsS -m 20 -X POST "http://127.0.0.1:${RS_PORT:-8899}/api/profile/auto" \
             -H 'Content-Type: application/json' \
             -d "$(jq -n --arg r "$repo" --arg e "$exp" --arg s "$sig" '{repo:$r, exp:$e, sig:$s}')" \
             2>&1) || { echo "==> auto-profile $repo: server did not accept the request: $resp"; continue; }
    echo "==> auto-profile $repo: $(printf '%s' "$resp" | jq -c . 2>/dev/null || printf '%s' "$resp")"
  done
fi
