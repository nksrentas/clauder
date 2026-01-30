#!/bin/bash
# Claude Code Stop hook - plays sound when prompt completes

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOUNDS_DIR="$HOME/.claude/sounds"

ENABLED_FILE="$HOME/.claude/sounds-enabled"
if [[ -f "$ENABLED_FILE" && "$(cat "$ENABLED_FILE")" == "false" ]]; then
  exit 0
fi

SOUND_FILE="$SOUNDS_DIR/complete.mp3"
FALLBACK_SOUND="/System/Library/Sounds/Glass.aiff"

if [[ -f "$SOUND_FILE" ]]; then
  "$SCRIPT_DIR/play-sound.sh" "$SOUND_FILE"
elif [[ -f "$FALLBACK_SOUND" ]]; then
  "$SCRIPT_DIR/play-sound.sh" "$FALLBACK_SOUND"
fi
exit 0
