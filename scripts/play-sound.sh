#!/bin/bash
# Cross-platform sound player for Claude Code notifications
# Usage: play-sound.sh <sound-file>

SOUND_FILE="$1"
[[ -z "$SOUND_FILE" || ! -f "$SOUND_FILE" ]] && exit 1

case "$(uname -s)" in
  Darwin)
    afplay "$SOUND_FILE" &>/dev/null &
    ;;
  Linux)
    (paplay "$SOUND_FILE" 2>/dev/null || \
     aplay "$SOUND_FILE" 2>/dev/null || \
     mpv --no-terminal "$SOUND_FILE" 2>/dev/null || \
     ffplay -nodisp -autoexit "$SOUND_FILE" 2>/dev/null) &
    ;;
  MINGW*|MSYS*|CYGWIN*)
    powershell.exe -NoProfile -Command \
      "(New-Object Media.SoundPlayer '$SOUND_FILE').PlaySync()" &>/dev/null &
    ;;
esac
exit 0
