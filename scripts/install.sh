#!/bin/bash
# Claude Code Shell Integration Installer
# Usage: curl -fsSL https://hellobussin.com/clauder/install.sh | bash

set -e

INSTALL_DIR="$HOME/.claude"
SCRIPTS_DIR="$INSTALL_DIR/scripts"
BASE_URL="${CLAUDER_BASE_URL:-https://hellobussin.com/clauder}"

GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'
BOLD='\033[1m'

info() {
  echo -e "${BLUE}[clauder]${NC} $1"
}

success() {
  echo -e "${GREEN}[clauder]${NC} $1"
}

warn() {
  echo -e "${YELLOW}[clauder]${NC} $1"
}

setup_directories() {
  info "Creating directories..."
  mkdir -p "$INSTALL_DIR"
  mkdir -p "$SCRIPTS_DIR"
}

download_scripts() {
  info "Downloading scripts..."

  curl -fsSL "$BASE_URL/statusline-command.sh" -o "$INSTALL_DIR/statusline-command.sh"
  chmod +x "$INSTALL_DIR/statusline-command.sh"

  curl -fsSL "$BASE_URL/fetch-usage.sh" -o "$SCRIPTS_DIR/fetch-usage.sh"
  chmod +x "$SCRIPTS_DIR/fetch-usage.sh"

  success "Scripts downloaded to $INSTALL_DIR"
}

setup_sounds() {
  local sounds_dir="$HOME/.claude/sounds"
  info "Setting up notification sounds..."
  mkdir -p "$sounds_dir"

  for sound in complete warning limit; do
    if curl -fsSL "$BASE_URL/sounds/${sound}.mp3" -o "$sounds_dir/${sound}.mp3" 2>/dev/null; then
      success "Downloaded ${sound}.mp3"
    else
      warn "Could not download ${sound}.mp3"
    fi
  done
}

download_sound_scripts() {
  info "Downloading sound notification scripts..."

  curl -fsSL "$BASE_URL/play-sound.sh" -o "$SCRIPTS_DIR/play-sound.sh"
  chmod +x "$SCRIPTS_DIR/play-sound.sh"

  curl -fsSL "$BASE_URL/prompt-complete.sh" -o "$SCRIPTS_DIR/prompt-complete.sh"
  chmod +x "$SCRIPTS_DIR/prompt-complete.sh"

  success "Sound scripts installed"
}

configure_hooks() {
  local settings_file="$HOME/.claude/settings.json"
  info "Configuring Claude Code hooks..."

  [[ ! -f "$settings_file" ]] && echo '{}' > "$settings_file"

  if command -v jq &>/dev/null; then
    local hook_cmd="$HOME/.claude/scripts/prompt-complete.sh"
    if jq -e '.hooks.Stop[]?.hooks[]? | select(.command == "'"$hook_cmd"'")' "$settings_file" &>/dev/null; then
      info "Hook already configured"
      return 0
    fi
    jq --arg cmd "$hook_cmd" '
      .hooks //= {} |
      .hooks.Stop //= [] |
      .hooks.Stop += [{"hooks": [{"type": "command", "command": $cmd}]}]
    ' "$settings_file" > "${settings_file}.tmp" && mv "${settings_file}.tmp" "$settings_file"
    success "Hooks configured in settings.json"
  elif command -v python3 &>/dev/null; then
    python3 << 'PYEOF'
import json, os
path = os.path.expanduser('~/.claude/settings.json')
with open(path) as f: s = json.load(f)
hook_cmd = os.path.expanduser('~/.claude/scripts/prompt-complete.sh')
hooks = s.setdefault('hooks', {}).setdefault('Stop', [])
# Check if hook already exists
if not any(h.get('hooks', [{}])[0].get('command') == hook_cmd for h in hooks if h.get('hooks')):
    hooks.append({'hooks': [{'type': 'command', 'command': hook_cmd}]})
with open(path, 'w') as f: json.dump(s, f, indent=2)
PYEOF
    success "Hooks configured in settings.json"
  else
    warn "Install jq or python3 to auto-configure hooks"
  fi
}

print_instructions() {
  echo ""
  echo -e "${BOLD}Installation complete!${NC}"
  echo ""
  echo -e "${BOLD}Statusline:${NC}"
  echo "  Add to ~/.claude/settings.json:"
  echo ""
  echo '  {
    "statusLine": {
      "type": "command",
      "command": "~/.claude/statusline-command.sh",
      "padding": 0
    }
  }'
  echo ""
  echo "  The statusline shows:"
  echo "  - Model name and git branch"
  echo "  - Context window usage"
  echo "  - Rate limit usage with countdown"
  echo ""
  echo -e "${BOLD}Sound Notifications:${NC}"
  echo "  - Completion sound when Claude Code finishes responding"
  echo "  - Hooks configured in ~/.claude/settings.json"
  echo ""
}

main() {
  echo ""
  echo -e "${BOLD}Claude Code Shell Integration Installer${NC}"
  echo ""

  setup_directories
  setup_sounds
  download_scripts
  download_sound_scripts
  configure_hooks
  print_instructions
}

main "$@"
