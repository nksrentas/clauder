#!/bin/bash
# Claude Code Shell Integration Installer
# Usage: curl -fsSL https://hellobussin.com/clauder/install.sh | bash

set -e

INSTALL_DIR="$HOME/.claude"
SCRIPTS_DIR="$INSTALL_DIR/scripts"
BASE_URL="${CLAUDER_BASE_URL:-https://hellobussin.com/clauder}"

MARKER="# clauder-shell-integration"

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

detect_shell() {
  local shell_name
  shell_name=$(basename "$SHELL")
  echo "$shell_name"
}

get_rc_file() {
  local shell_name="$1"
  case "$shell_name" in
    zsh)
      echo "$HOME/.zshrc"
      ;;
    bash)
      if [[ -f "$HOME/.bash_profile" ]]; then
        echo "$HOME/.bash_profile"
      else
        echo "$HOME/.bashrc"
      fi
      ;;
    *)
      echo "$HOME/.bashrc"
      ;;
  esac
}

is_configured() {
  local rc_file="$1"
  if [[ -f "$rc_file" ]]; then
    grep -q "$MARKER" "$rc_file" 2>/dev/null
    return $?
  fi
  return 1
}

generate_config() {
  local shell_name="$1"

  cat << 'EOF'

# clauder-shell-integration
# Claude Code usage statusline - https://github.com/nksrentas/clauder
clauder_statusline() {
  if [[ -x "$HOME/.claude/statusline-command.sh" ]]; then
    "$HOME/.claude/statusline-command.sh"
  fi
}
EOF

  if [[ "$shell_name" == "zsh" ]]; then
    cat << 'EOF'

# Add to RPROMPT for right-side display (recommended)
# Uncomment one of the following options:

# Option 1: Right prompt (recommended - doesn't affect command input)
# RPROMPT='$(clauder_statusline)'

# Option 2: Add to existing prompt
# PROMPT="$PROMPT"'$(clauder_statusline) '

# Option 3: Precmd hook (updates on each command)
precmd_clauder() {
  CLAUDER_STATUS=$(clauder_statusline)
}
precmd_functions+=(precmd_clauder)
RPROMPT='$CLAUDER_STATUS'
# end clauder-shell-integration
EOF
  else
    cat << 'EOF'

# Add to PS1 prompt
# Uncomment to enable:
# PS1="$PS1\$(clauder_statusline) "

# Or use PROMPT_COMMAND for bash (updates on each command)
__clauder_prompt() {
  CLAUDER_STATUS=$(clauder_statusline)
}
PROMPT_COMMAND="__clauder_prompt${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
PS1="$PS1\$CLAUDER_STATUS "
# end clauder-shell-integration
EOF
  fi
}

# Configure shell
configure_shell() {
  local shell_name
  local rc_file

  shell_name=$(detect_shell)
  rc_file=$(get_rc_file "$shell_name")

  info "Detected shell: $shell_name"
  info "Config file: $rc_file"

  if is_configured "$rc_file"; then
    warn "Shell integration already configured in $rc_file"
    info "Updating scripts only (config preserved)"
    return 0
  fi

  # Backup rc file
  if [[ -f "$rc_file" ]]; then
    cp "$rc_file" "${rc_file}.backup.$(date +%Y%m%d%H%M%S)"
    info "Backed up $rc_file"
  fi

  generate_config "$shell_name" >> "$rc_file"
  success "Added shell integration to $rc_file"
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
  echo "To activate the statusline, either:"
  echo "  1. Open a new terminal window"
  echo "  2. Run: source ~/.zshrc (or ~/.bashrc)"
  echo ""
  echo "The statusline shows:"
  echo "  - Git branch and dirty status"
  echo "  - Claude usage percentage with color-coded bar"
  echo "  - Time until 5-hour window resets"
  echo "  - Weekly usage (when above 80%)"
  echo ""
  echo -e "${BOLD}Sound Notifications:${NC}"
  echo "  - Completion sound when Claude Code finishes responding"
  echo "  - Warning sound when approaching rate limits"
  echo "  - Configure in VS Code: Settings > Clauder > Sounds"
  echo ""
  echo "To customize prompt placement, edit ~/.zshrc (or ~/.bashrc)"
  echo "and modify the RPROMPT/PS1 lines."
  echo ""
  echo -e "${BLUE}Tip:${NC} Run 'clauder_statusline' manually to test."
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
  configure_shell
  configure_hooks
  print_instructions
}

main "$@"
