#!/bin/bash
# statusline-command.sh - Claude Code statusline
# Reads JSON context from stdin (per official docs) and shows usage info
# See: https://code.claude.com/docs/en/statusline

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE_FILE="$HOME/.claude/usage-cache.json"
CACHE_TTL=30

ORANGE='\033[38;5;209m'
TAN='\033[38;5;180m'
LIGHT_ORANGE='\033[38;5;216m'
RED_ORANGE='\033[38;5;173m'
DARK_RED='\033[38;5;167m'
GRAY='\033[38;5;245m'
RESET='\033[0m'
DIM='\033[2m'

# Precomputed progress bars (0-100% in 10% increments)
declare -a BARS=(
  "░░░░░░░░░░"  # 0%
  "█░░░░░░░░░"  # 10%
  "██░░░░░░░░"  # 20%
  "███░░░░░░░"  # 30%
  "████░░░░░░"  # 40%
  "█████░░░░░"  # 50%
  "██████░░░░"  # 60%
  "███████░░░"  # 70%
  "████████░░"  # 80%
  "█████████░"  # 90%
  "██████████"  # 100%
)

if [[ -t 0 ]]; then
  echo ""
  exit 0
fi
INPUT=$(cat)

get_input() {
  echo "$INPUT" | jq -r "$1" 2>/dev/null
}

get_color() {
  local pct="$1"
  if (( pct < 40 )); then
    echo -e "$TAN"
  elif (( pct < 60 )); then
    echo -e "$LIGHT_ORANGE"
  elif (( pct < 80 )); then
    echo -e "$ORANGE"
  elif (( pct < 90 )); then
    echo -e "$RED_ORANGE"
  else
    echo -e "$DARK_RED"
  fi
}

# Parse ISO timestamp to epoch seconds (handles macOS and Linux)
parse_iso_to_epoch() {
  local ts="$1"
  [[ -z "$ts" || "$ts" == "null" ]] && return 1

  # Remove Z suffix and handle timezone
  ts="${ts%Z}"
  # Extract date/time parts (handles both +00:00 and without TZ)
  local dt="${ts%%+*}"
  local date_part="${dt%T*}"
  local time_part="${dt#*T}"

  # Try macOS date -j first, then Linux date -d
  if date -j -f "%Y-%m-%dT%H:%M:%S" "${date_part}T${time_part%%.*}" "+%s" 2>/dev/null; then
    return 0
  elif date -d "${date_part}T${time_part%%.*}Z" "+%s" 2>/dev/null; then
    return 0
  fi
  return 1
}

# Format seconds remaining as "Xh Ym" or "Ym"
format_remaining_bash() {
  local epoch="$1"
  [[ -z "$epoch" ]] && echo "N/A" && return

  local now diff hours mins
  now=$(date +%s)
  diff=$((epoch - now))

  if (( diff <= 0 )); then
    echo "now"
    return
  fi

  hours=$((diff / 3600))
  mins=$(((diff % 3600) / 60))

  if (( hours > 0 )); then
    echo "${hours}h${mins}m"
  else
    echo "${mins}m"
  fi
}

# Format epoch as weekday + time (e.g., "Mon 3:30pm")
format_day_bash() {
  local epoch="$1"
  [[ -z "$epoch" ]] && echo "N/A" && return

  local result
  # macOS date format
  if result=$(date -j -f "%s" "$epoch" "+%a %-I:%M%p" 2>/dev/null); then
    echo "${result//AM/am}" | sed 's/PM/pm/'
  # Linux date format
  elif result=$(date -d "@$epoch" "+%a %-I:%M%p" 2>/dev/null); then
    echo "${result//AM/am}" | sed 's/PM/pm/'
  else
    echo "N/A"
  fi
}

parse_timestamps() {
  local five_hour_reset="$1"
  local seven_day_reset="$2"

  local five_epoch seven_epoch
  five_epoch=$(parse_iso_to_epoch "$five_hour_reset")
  seven_epoch=$(parse_iso_to_epoch "$seven_day_reset")

  local time_left weekly_reset
  time_left=$(format_remaining_bash "$five_epoch")
  weekly_reset=$(format_day_bash "$seven_epoch")

  # If bash parsing worked, return results
  if [[ "$time_left" != "N/A" || "$weekly_reset" != "N/A" ]]; then
    echo -e "${time_left}\t${weekly_reset}"
    return
  fi

  # Fallback to Python for edge cases
  python3 -c "
from datetime import datetime, timezone
import sys

def parse_timestamp(reset_str):
    if not reset_str or reset_str == 'null' or reset_str == '':
        return None
    try:
        if '+' in reset_str or reset_str.endswith('Z'):
            reset_str = reset_str.replace('Z', '+00:00')
            return datetime.fromisoformat(reset_str)
        return datetime.fromisoformat(reset_str).replace(tzinfo=timezone.utc)
    except Exception:
        return None

def format_remaining(reset_dt):
    if reset_dt is None:
        return 'N/A'
    now = datetime.now(timezone.utc)
    diff = (reset_dt - now).total_seconds()
    if diff <= 0:
        return 'now'
    hours = int(diff // 3600)
    mins = int((diff % 3600) // 60)
    return f'{hours}h{mins}m' if hours > 0 else f'{mins}m'

def format_day(reset_dt):
    if reset_dt is None:
        return 'N/A'
    local_dt = reset_dt.astimezone()
    return local_dt.strftime('%a %-I:%M%p').replace('AM', 'am').replace('PM', 'pm')

five_hour = sys.argv[1] if len(sys.argv) > 1 else ''
seven_day = sys.argv[2] if len(sys.argv) > 2 else ''

five_dt = parse_timestamp(five_hour)
seven_dt = parse_timestamp(seven_day)

print(f'{format_remaining(five_dt)}\t{format_day(seven_dt)}')
" "$five_hour_reset" "$seven_day_reset" 2>/dev/null || echo "N/A	N/A"
}

build_bar() {
  local pct="$1"
  local color
  color=$(get_color "$pct")

  # Use precomputed bar from array (index = pct / 10, clamped to 0-10)
  local index=$(( (pct + 5) / 10 ))
  (( index < 0 )) && index=0
  (( index > 10 )) && index=10

  echo -e "${color}${BARS[$index]}${RESET}"
}

get_rate_limit_usage() {
  local now
  now=$(date +%s)

  if [[ -f "$CACHE_FILE" ]]; then
    local cache_time
    cache_time=$(stat -f %m "$CACHE_FILE" 2>/dev/null || stat -c %Y "$CACHE_FILE" 2>/dev/null)
    if (( now - cache_time < CACHE_TTL )); then
      cat "$CACHE_FILE"
      return
    fi
  fi

  local temp_file="${CACHE_FILE}.tmp.$$"

  local fetch_script=""
  if [[ -x "$SCRIPT_DIR/fetch-usage.sh" ]]; then
    fetch_script="$SCRIPT_DIR/fetch-usage.sh"
  elif [[ -x "$HOME/.claude/scripts/fetch-usage.sh" ]]; then
    fetch_script="$HOME/.claude/scripts/fetch-usage.sh"
  fi

  if [[ -n "$fetch_script" ]]; then
    (
      "$fetch_script" > "$temp_file" 2>/dev/null
      if [[ -s "$temp_file" ]] && jq -e '.five_hour' "$temp_file" >/dev/null 2>&1; then
        mv "$temp_file" "$CACHE_FILE"
      else
        rm -f "$temp_file"
      fi
    ) &
  fi

  if [[ -f "$CACHE_FILE" ]]; then
    cat "$CACHE_FILE"
  else
    echo '{}'
  fi
}

get_git_branch() {
  if git rev-parse --git-dir > /dev/null 2>&1; then
    local branch
    branch=$(git branch --show-current 2>/dev/null)
    if [[ -n "$branch" ]]; then
      local dirty=""
      if [[ -n $(git status --porcelain 2>/dev/null) ]]; then
        dirty="*"
      fi
      echo -e "${DIM}${branch}${dirty}${RESET}"
    fi
  fi
}

main() {
  local parts=()

  local model
  model=$(get_input '.model.display_name')
  if [[ -n "$model" && "$model" != "null" ]]; then
    parts+=("${ORANGE}◆${RESET} ${DIM}${model}${RESET}")
  fi

  local git_branch
  git_branch=$(get_git_branch)
  if [[ -n "$git_branch" ]]; then
    parts+=("$git_branch")
  fi

  local ctx_pct
  ctx_pct=$(get_input '.context_window.used_percentage // 0' | cut -d. -f1)
  if [[ -n "$ctx_pct" && "$ctx_pct" != "null" && "$ctx_pct" -gt 0 ]]; then
    local ctx_color
    ctx_color=$(get_color "$ctx_pct")
    parts+=("${DIM}ctx:${RESET}${ctx_color}${ctx_pct}%${RESET}")
  fi

  local usage
  usage=$(get_rate_limit_usage)

  if [[ -n "$usage" && "$usage" != "{}" ]]; then
    local five_hour five_hour_resets seven_day seven_day_resets
    read -r five_hour five_hour_resets seven_day seven_day_resets < <(
      echo "$usage" | jq -r '[
        (.five_hour // 0 | floor),
        (.five_hour_resets_at // ""),
        (.seven_day // 0 | floor),
        (.seven_day_resets_at // "")
      ] | @tsv' 2>/dev/null
    )

    if [[ -n "$five_hour" && "$five_hour" != "null" && "$five_hour" != "0" ]]; then
      local time_left weekly_reset
      IFS=$'\t' read -r time_left weekly_reset < <(parse_timestamps "$five_hour_resets" "$seven_day_resets")

      local bar color
      bar=$(build_bar "$five_hour")
      color=$(get_color "$five_hour")

      parts+=("${color}${five_hour}%${RESET} ${bar} ${DIM}${time_left}${RESET}")

      if [[ -n "$seven_day" && "$seven_day" != "null" && "$seven_day" != "0" ]]; then
        local weekly_bar weekly_color
        weekly_bar=$(build_bar "$seven_day")
        weekly_color=$(get_color "$seven_day")

        parts+=("${DIM}W:${RESET}${weekly_color}${seven_day}%${RESET} ${weekly_bar} ${DIM}${weekly_reset}${RESET}")
      fi
    fi
  fi

  local output=""
  for i in "${!parts[@]}"; do
    if (( i > 0 )); then
      output+=" ${DIM}│${RESET} "
    fi
    output+="${parts[$i]}"
  done

  echo -e "$output"
}

main
