#!/bin/bash
# statusline-command.sh - Claude Code statusline
# Reads JSON context from stdin (per official docs) and shows usage info
# See: https://code.claude.com/docs/en/statusline

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE_FILE="$HOME/.claude/usage-cache.json"
CACHE_TTL=30  # seconds

# Claude brand colors (warm orange gradient)
ORANGE='\033[38;5;209m'
TAN='\033[38;5;180m'
LIGHT_ORANGE='\033[38;5;216m'
BRAND_ORANGE='\033[38;5;209m'
RED_ORANGE='\033[38;5;173m'
DARK_RED='\033[38;5;167m'
GRAY='\033[38;5;245m'
RESET='\033[0m'
DIM='\033[2m'

# Read JSON input from stdin (official API)
# Exit gracefully if no stdin (e.g., called from shell prompt instead of Claude Code)
if [[ -t 0 ]]; then
  echo ""
  exit 0
fi
INPUT=$(cat)

# Helper: extract value from stdin JSON
get_input() {
  echo "$INPUT" | jq -r "$1" 2>/dev/null
}

# Get usage color based on percentage
get_color() {
  local pct="$1"
  if (( pct < 40 )); then
    echo -e "$TAN"
  elif (( pct < 60 )); then
    echo -e "$LIGHT_ORANGE"
  elif (( pct < 80 )); then
    echo -e "$BRAND_ORANGE"
  elif (( pct < 90 )); then
    echo -e "$RED_ORANGE"
  else
    echo -e "$DARK_RED"
  fi
}

# Format time remaining
format_time() {
  local reset_at="$1"
  if [[ -z "$reset_at" || "$reset_at" == "null" ]]; then
    echo "N/A"
    return
  fi

  python3 -c "
from datetime import datetime, timezone
import sys

try:
    reset_str = sys.argv[1]
    if '+' in reset_str or reset_str.endswith('Z'):
        reset_str = reset_str.replace('Z', '+00:00')
        reset_dt = datetime.fromisoformat(reset_str)
    else:
        reset_dt = datetime.fromisoformat(reset_str).replace(tzinfo=timezone.utc)

    now = datetime.now(timezone.utc)
    diff = (reset_dt - now).total_seconds()

    if diff <= 0:
        print('now')
    else:
        hours = int(diff // 3600)
        mins = int((diff % 3600) // 60)
        if hours > 0:
            print(f'{hours}h{mins}m')
        else:
            print(f'{mins}m')
except Exception:
    print('N/A')
" "$reset_at" 2>/dev/null || echo "N/A"
}

# Format weekly reset as day/time (e.g., "Sat 2:00PM")
format_reset_day() {
  local reset_at="$1"
  if [[ -z "$reset_at" || "$reset_at" == "null" ]]; then
    echo "N/A"
    return
  fi

  python3 -c "
from datetime import datetime, timezone
import sys

try:
    reset_str = sys.argv[1]
    if '+' in reset_str or reset_str.endswith('Z'):
        reset_str = reset_str.replace('Z', '+00:00')
        reset_dt = datetime.fromisoformat(reset_str)
    else:
        reset_dt = datetime.fromisoformat(reset_str).replace(tzinfo=timezone.utc)

    # Convert to local time
    local_dt = reset_dt.astimezone()

    # Format as 'Sat 2:00PM'
    print(local_dt.strftime('%a %-I:%M%p').replace('AM', 'am').replace('PM', 'pm'))
except Exception:
    print('N/A')
" "$reset_at" 2>/dev/null || echo "N/A"
}

# Build usage bar
build_bar() {
  local pct="$1"
  local width=10
  local filled=$((pct * width / 100))
  local empty=$((width - filled))
  local color
  color=$(get_color "$pct")

  local bar=""
  for ((i=0; i<filled; i++)); do
    bar+="█"
  done
  for ((i=0; i<empty; i++)); do
    bar+="░"
  done

  echo -e "${color}${bar}${RESET}"
}

# Get rate limit usage (fetched from API, cached)
get_rate_limit_usage() {
  local now
  now=$(date +%s)

  # Check cache freshness
  if [[ -f "$CACHE_FILE" ]]; then
    local cache_time
    cache_time=$(stat -f %m "$CACHE_FILE" 2>/dev/null || stat -c %Y "$CACHE_FILE" 2>/dev/null)
    if (( now - cache_time < CACHE_TTL )); then
      cat "$CACHE_FILE"
      return
    fi
  fi

  # Fetch fresh data in background, writing to temp file first
  # Use PID to avoid race conditions between concurrent calls
  local temp_file="${CACHE_FILE}.tmp.$$"

  if [[ -x "$SCRIPT_DIR/fetch-usage.sh" ]]; then
    (
      "$SCRIPT_DIR/fetch-usage.sh" > "$temp_file" 2>/dev/null
      # Only replace cache if we got valid JSON with five_hour field (not error JSON)
      # Error responses have "error" field but no "five_hour" field
      if [[ -s "$temp_file" ]] && jq -e '.five_hour' "$temp_file" >/dev/null 2>&1; then
        mv "$temp_file" "$CACHE_FILE"
      else
        rm -f "$temp_file"
      fi
    ) &
  elif [[ -x "$HOME/.claude/scripts/fetch-usage.sh" ]]; then
    (
      "$HOME/.claude/scripts/fetch-usage.sh" > "$temp_file" 2>/dev/null
      if [[ -s "$temp_file" ]] && jq -e '.five_hour' "$temp_file" >/dev/null 2>&1; then
        mv "$temp_file" "$CACHE_FILE"
      else
        rm -f "$temp_file"
      fi
    ) &
  fi

  # Always return existing cache (even if stale) rather than empty
  if [[ -f "$CACHE_FILE" ]]; then
    cat "$CACHE_FILE"
  else
    echo '{}'
  fi
}

# Get git branch
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

# Main
main() {
  local parts=()

  # Model name from stdin JSON
  local model
  model=$(get_input '.model.display_name')
  if [[ -n "$model" && "$model" != "null" ]]; then
    parts+=("${ORANGE}◆${RESET} ${DIM}${model}${RESET}")
  fi

  # Git branch
  local git_branch
  git_branch=$(get_git_branch)
  if [[ -n "$git_branch" ]]; then
    parts+=("$git_branch")
  fi

  # Context window usage from stdin JSON
  local ctx_pct
  ctx_pct=$(get_input '.context_window.used_percentage // 0' | cut -d. -f1)
  if [[ -n "$ctx_pct" && "$ctx_pct" != "null" && "$ctx_pct" -gt 0 ]]; then
    local ctx_color
    ctx_color=$(get_color "$ctx_pct")
    parts+=("${DIM}ctx:${RESET}${ctx_color}${ctx_pct}%${RESET}")
  fi

  # Rate limit usage (from API cache)
  local usage
  usage=$(get_rate_limit_usage)

  if [[ -n "$usage" && "$usage" != "{}" ]]; then
    # 5-hour limit with countdown
    local five_hour five_hour_resets
    five_hour=$(echo "$usage" | jq -r '.five_hour // 0' 2>/dev/null | cut -d. -f1)
    five_hour_resets=$(echo "$usage" | jq -r '.five_hour_resets_at // empty' 2>/dev/null)

    if [[ -n "$five_hour" && "$five_hour" != "null" ]]; then
      local bar time_left color
      bar=$(build_bar "$five_hour")
      time_left=$(format_time "$five_hour_resets")
      color=$(get_color "$five_hour")

      parts+=("${color}${five_hour}%${RESET} ${bar} ${DIM}${time_left}${RESET}")
    fi

    # Weekly limit with day/time reset (always shown)
    local seven_day seven_day_resets
    seven_day=$(echo "$usage" | jq -r '.seven_day // 0' 2>/dev/null | cut -d. -f1)
    seven_day_resets=$(echo "$usage" | jq -r '.seven_day_resets_at // empty' 2>/dev/null)

    if [[ -n "$seven_day" && "$seven_day" != "null" ]]; then
      local weekly_bar weekly_reset weekly_color
      weekly_bar=$(build_bar "$seven_day")
      weekly_reset=$(format_reset_day "$seven_day_resets")
      weekly_color=$(get_color "$seven_day")

      parts+=("${DIM}W:${RESET}${weekly_color}${seven_day}%${RESET} ${weekly_bar} ${DIM}${weekly_reset}${RESET}")
    fi
  fi

  # Join parts with separator
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
