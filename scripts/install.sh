#!/bin/bash
# Claude Code Shell Integration Installer
# Usage: curl -fsSL https://hellobussin.com/clauder/install.sh | bash

set -e

INSTALL_DIR="$HOME/.claude"
SCRIPTS_DIR="$INSTALL_DIR/scripts"
BASE_URL="${CLAUDER_BASE_URL:-https://hellobussin.com/clauder}"

# Marker comment for idempotency
MARKER="# clauder-shell-integration"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color
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

# Create directories
setup_directories() {
  info "Creating directories..."
  mkdir -p "$INSTALL_DIR"
  mkdir -p "$SCRIPTS_DIR"
}

# Download scripts
download_scripts() {
  info "Downloading scripts..."

  # Download statusline-command.sh
  curl -fsSL "$BASE_URL/statusline-command.sh" -o "$INSTALL_DIR/statusline-command.sh"
  chmod +x "$INSTALL_DIR/statusline-command.sh"

  # Download fetch-usage.sh
  curl -fsSL "$BASE_URL/fetch-usage.sh" -o "$SCRIPTS_DIR/fetch-usage.sh"
  chmod +x "$SCRIPTS_DIR/fetch-usage.sh"

  success "Scripts downloaded to $INSTALL_DIR"
}

# Detect user's shell
detect_shell() {
  local shell_name
  shell_name=$(basename "$SHELL")
  echo "$shell_name"
}

# Get shell rc file
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

# Check if already configured
is_configured() {
  local rc_file="$1"
  if [[ -f "$rc_file" ]]; then
    grep -q "$MARKER" "$rc_file" 2>/dev/null
    return $?
  fi
  return 1
}

# Generate shell config
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

  # Append config
  generate_config "$shell_name" >> "$rc_file"
  success "Added shell integration to $rc_file"
}

# Print usage instructions
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
  echo "To customize prompt placement, edit ~/.zshrc (or ~/.bashrc)"
  echo "and modify the RPROMPT/PS1 lines."
  echo ""
  echo -e "${BLUE}Tip:${NC} Run 'clauder_statusline' manually to test."
  echo ""
}

# Main
main() {
  echo ""
  echo -e "${BOLD}Claude Code Shell Integration Installer${NC}"
  echo ""

  setup_directories
  download_scripts
  configure_shell
  print_instructions
}

main "$@"
