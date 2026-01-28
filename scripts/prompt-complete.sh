#!/bin/bash
# Claude Code Stop hook - plays sound when prompt completes

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOUNDS_DIR="$HOME/.claude/sounds"

cat > /dev/null

ENABLED_FILE="$HOME/.claude/sounds-enabled"
if [[ -f "$ENABLED_FILE" && "$(cat "$ENABLED_FILE")" == "false" ]]; then
  exit 0
fi

SOUND_FILE="$SOUNDS_DIR/complete.mp3"
if [[ -f "$SOUND_FILE" ]]; then
  "$SCRIPT_DIR/play-sound.sh" "$SOUND_FILE"
elif [[ "$(uname -s)" == "Darwin" && -f "/System/Library/Sounds/Glass.aiff" ]]; then
  afplay "/System/Library/Sounds/Glass.aiff" &>/dev/null &
fi
exit 0
