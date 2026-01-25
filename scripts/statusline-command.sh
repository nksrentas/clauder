#!/bin/bash
# statusline-command.sh - Claude Code statusline for shell prompt
# Shows git branch/status and Claude usage bar

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE_FILE="$HOME/.claude/usage-cache.json"
CACHE_TTL=30  # seconds

# Claude brand colors (warm orange gradient matching VS Code extension)
ORANGE='\033[38;5;209m'    # Brand orange for diamond icon
TAN='\033[38;5;180m'       # Healthy (<40%)
LIGHT_ORANGE='\033[38;5;216m'  # Low-mid (40-59%)
BRAND_ORANGE='\033[38;5;209m'  # Mid (60-79%)
RED_ORANGE='\033[38;5;173m'    # High (80-89%)
DARK_RED='\033[38;5;167m'      # Critical (>=90%)
GRAY='\033[38;5;245m'
RESET='\033[0m'
BOLD='\033[1m'
DIM='\033[2m'

# Get usage color based on percentage (matches VS Code extension gradient)
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

# Format time remaining (uses Python for reliable ISO 8601 parsing with timezone)
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
    # Parse ISO 8601 with timezone
    if '+' in reset_str or reset_str.endswith('Z'):
        reset_str = reset_str.replace('Z', '+00:00')
        reset_dt = datetime.fromisoformat(reset_str)
    else:
        # Assume UTC if no timezone
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

# Get cached usage or fetch fresh
get_usage() {
  local now
  now=$(date +%s)

  # Check cache
  if [[ -f "$CACHE_FILE" ]]; then
    local cache_time
    cache_time=$(stat -f %m "$CACHE_FILE" 2>/dev/null || stat -c %Y "$CACHE_FILE" 2>/dev/null)
    if (( now - cache_time < CACHE_TTL )); then
      cat "$CACHE_FILE"
      return
    fi
  fi

  # Fetch fresh data (in background to not block prompt)
  if [[ -x "$SCRIPT_DIR/fetch-usage.sh" ]]; then
    "$SCRIPT_DIR/fetch-usage.sh" > "$CACHE_FILE" 2>/dev/null &
  elif [[ -x "$HOME/.claude/scripts/fetch-usage.sh" ]]; then
    "$HOME/.claude/scripts/fetch-usage.sh" > "$CACHE_FILE" 2>/dev/null &
  fi

  # Return cached if exists, otherwise empty
  if [[ -f "$CACHE_FILE" ]]; then
    cat "$CACHE_FILE"
  else
    echo '{}'
  fi
}

# Get git info
get_git_info() {
  if ! git rev-parse --is-inside-work-tree &>/dev/null; then
    return
  fi

  local branch
  branch=$(git symbolic-ref --short HEAD 2>/dev/null || git rev-parse --short HEAD 2>/dev/null)

  local dirty=""
  if [[ -n $(git status --porcelain 2>/dev/null) ]]; then
    dirty="*"
  fi

  echo -e "${DIM}${branch}${dirty}${RESET}"
}

# Main statusline
main() {
  local parts=()

  # Git info
  local git_info
  git_info=$(get_git_info)
  if [[ -n "$git_info" ]]; then
    parts+=("$git_info")
  fi

  # Usage info
  local usage
  usage=$(get_usage)

  if [[ -n "$usage" && "$usage" != "{}" ]]; then
    local five_hour seven_day five_hour_resets
    five_hour=$(echo "$usage" | python3 -c "import sys,json; d=json.load(sys.stdin); print(int(d.get('five_hour', 0)))" 2>/dev/null || echo "0")
    seven_day=$(echo "$usage" | python3 -c "import sys,json; d=json.load(sys.stdin); print(int(d.get('seven_day', 0)))" 2>/dev/null || echo "0")
    five_hour_resets=$(echo "$usage" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('five_hour_resets_at', ''))" 2>/dev/null || echo "")

    local bar time_left color
    bar=$(build_bar "$five_hour")
    time_left=$(format_time "$five_hour_resets")
    color=$(get_color "$five_hour")

    parts+=("${ORANGE}◆${RESET} ${color}${five_hour}%${RESET} ${bar} ${DIM}${time_left}${RESET}")

    # Show weekly if high
    if (( seven_day >= 80 )); then
      local weekly_color
      weekly_color=$(get_color "$seven_day")
      parts+=("${DIM}W:${RESET}${weekly_color}${seven_day}%${RESET}")
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

main "$@"
