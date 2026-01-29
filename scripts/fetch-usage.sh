#!/bin/bash
# fetch-usage.sh - Fetch Claude Code usage from Anthropic API
# Outputs JSON with five_hour and seven_day utilization

set -e

KEYCHAIN_SERVICE="Claude Code-credentials"
API_URL="https://api.anthropic.com/api/oauth/usage"

# Get OAuth token from macOS Keychain
get_token() {
  local creds
  creds=$(security find-generic-password -s "$KEYCHAIN_SERVICE" -w 2>/dev/null) || return 1
  echo "$creds" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('claudeAiOauth', {}).get('accessToken', ''))" 2>/dev/null
}

# Fetch usage from API
fetch_usage() {
  local token="$1"
  curl -s -X GET "$API_URL" \
    -H "Authorization: Bearer $token" \
    -H "anthropic-beta: oauth-2025-04-20" \
    -H "User-Agent: claude-code/2.0.60"
}

# Main
main() {
  local token
  token=$(get_token)

  if [[ -z "$token" ]]; then
    echo '{"error": "no_token", "message": "OAuth token not found in Keychain"}'
    exit 1
  fi

  local response
  response=$(fetch_usage "$token")

  if [[ -z "$response" ]]; then
    echo '{"error": "api_error", "message": "Failed to fetch usage from API"}'
    exit 1
  fi

  # Parse and output simplified JSON
  echo "$response" | python3 -c "
import sys, json

try:
    data = json.load(sys.stdin)
    result = {
        'five_hour': data.get('five_hour', {}).get('utilization', 0) if data.get('five_hour') else 0,
        'seven_day': data.get('seven_day', {}).get('utilization', 0) if data.get('seven_day') else 0,
        'seven_day_sonnet': data.get('seven_day_sonnet', {}).get('utilization', 0) if data.get('seven_day_sonnet') else None,
        'five_hour_resets_at': data.get('five_hour', {}).get('resets_at') if data.get('five_hour') else None,
        'seven_day_resets_at': data.get('seven_day', {}).get('resets_at') if data.get('seven_day') else None,
    }
    print(json.dumps(result))
except Exception as e:
    print(json.dumps({'error': 'parse_error', 'message': str(e)}))
    sys.exit(1)
"
}

main
