#!/bin/bash
# fetch-usage.sh - Fetch Claude Code usage from Anthropic API
# Outputs JSON with five_hour and seven_day utilization

set -e

KEYCHAIN_SERVICE="Claude Code-credentials"
API_URL="https://api.anthropic.com/api/oauth/usage"

get_token() {
  local creds
  creds=$(security find-generic-password -s "$KEYCHAIN_SERVICE" -w 2>/dev/null) || return 1
  echo "$creds" | jq -r '.claudeAiOauth.accessToken // empty' 2>/dev/null
}

fetch_usage() {
  local token="$1"
  curl -s -X GET "$API_URL" \
    -H "Authorization: Bearer $token" \
    -H "anthropic-beta: oauth-2025-04-20" \
    -H "User-Agent: claude-code/2.0.60"
}

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

  echo "$response" | jq '{
    five_hour: (if .five_hour then (.five_hour.utilization // 0) else 0 end),
    seven_day: (if .seven_day then (.seven_day.utilization // 0) else 0 end),
    seven_day_sonnet: (if .seven_day_sonnet then .seven_day_sonnet.utilization else null end),
    five_hour_resets_at: (if .five_hour then .five_hour.resets_at else null end),
    seven_day_resets_at: (if .seven_day then .seven_day.resets_at else null end)
  }' 2>/dev/null || echo '{"error": "parse_error", "message": "Failed to parse API response"}'
}

main
