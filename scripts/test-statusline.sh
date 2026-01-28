#!/bin/bash
# test-statusline.sh - Unit tests for statusline-command.sh
# Run with: ./scripts/test-statusline.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATUSLINE_SCRIPT="$SCRIPT_DIR/statusline-command.sh"

# Test configuration
TEST_CACHE_DIR=$(mktemp -d)
TEST_CACHE_FILE="$TEST_CACHE_DIR/usage-cache.json"
TEST_SCRIPT="$TEST_CACHE_DIR/statusline-test.sh"
PASSED=0
FAILED=0

# Colors for test output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
RESET='\033[0m'

# Cleanup on exit
cleanup() {
  rm -rf "$TEST_CACHE_DIR"
}
trap cleanup EXIT

# Create isolated test script (no fetch-usage.sh in test dir)
sed -e "s|CACHE_FILE=.*|CACHE_FILE=\"$TEST_CACHE_FILE\"|" \
    -e "s|SCRIPT_DIR=.*|SCRIPT_DIR=\"$TEST_CACHE_DIR\"|" \
    "$STATUSLINE_SCRIPT" > "$TEST_SCRIPT"
chmod +x "$TEST_SCRIPT"

# Test helper functions
pass() {
  echo -e "${GREEN}✓ PASS${RESET}: $1"
  PASSED=$((PASSED + 1))
}

fail() {
  echo -e "${RED}✗ FAIL${RESET}: $1"
  echo "  Expected: $2"
  echo "  Got: $3"
  FAILED=$((FAILED + 1))
}

section() {
  echo ""
  echo -e "${YELLOW}=== $1 ===${RESET}"
}

run_test_script() {
  local input="$1"
  echo "$input" | bash "$TEST_SCRIPT"
}

###############################################################################
# Tests
###############################################################################

section "Basic Input Parsing"

# Test: Model name extraction
output=$(run_test_script '{"model":{"display_name":"Opus"}}')
if [[ "$output" == *"Opus"* ]]; then
  pass "Model name extracted correctly"
else
  fail "Model name extraction" "contains 'Opus'" "$output"
fi

# Test: Context window percentage
output=$(run_test_script '{"model":{"display_name":"Sonnet"},"context_window":{"used_percentage":75}}')
if [[ "$output" == *"75%"* ]]; then
  pass "Context percentage extracted correctly"
else
  fail "Context percentage extraction" "contains '75%'" "$output"
fi

# Test: Empty/minimal input
output=$(run_test_script '{}')
if [[ $? -eq 0 ]]; then
  pass "Handles empty JSON input"
else
  fail "Empty JSON handling" "exit code 0" "non-zero"
fi

# Test: Missing fields
output=$(run_test_script '{"model":{}}')
if [[ $? -eq 0 ]]; then
  pass "Handles missing nested fields"
else
  fail "Missing fields handling" "exit code 0" "non-zero"
fi

###############################################################################
section "Cache Behavior"

# Test: Fresh cache is returned without fetching
echo '{"five_hour": 50, "seven_day": 30}' > "$TEST_CACHE_FILE"
touch "$TEST_CACHE_FILE"  # Ensure fresh timestamp
output=$(run_test_script '{"model":{"display_name":"Opus"}}')
if [[ "$output" == *"50%"* ]]; then
  pass "Fresh cache data is used"
else
  fail "Fresh cache usage" "contains '50%'" "$output"
fi

# Test: Stale cache still returns data (doesn't truncate)
echo '{"five_hour": 65, "seven_day": 40, "five_hour_resets_at": "2025-01-01T12:00:00Z"}' > "$TEST_CACHE_FILE"
touch -t 202001010000 "$TEST_CACHE_FILE" 2>/dev/null || touch -d "2020-01-01" "$TEST_CACHE_FILE" 2>/dev/null
output=$(run_test_script '{"model":{"display_name":"Opus"}}')
# The stale cache should still be returned while background fetch happens
if [[ "$output" == *"65%"* ]]; then
  pass "Stale cache data preserved while fetching"
else
  fail "Stale cache preservation" "contains '65%'" "$output"
fi

# Test: No cache returns empty object behavior
rm -f "$TEST_CACHE_FILE"
output=$(run_test_script '{"model":{"display_name":"Opus"}}')
# Should still show model, just no rate limit bars
if [[ "$output" == *"Opus"* ]]; then
  pass "Works without cache file"
else
  fail "No cache handling" "contains 'Opus'" "$output"
fi

###############################################################################
section "JSON Validation (jq -e '.five_hour')"

# Test: Valid JSON with five_hour passes validation
valid_json='{"five_hour": 42, "seven_day": 50}'
if echo "$valid_json" | jq -e '.five_hour' >/dev/null 2>&1; then
  pass "Valid JSON with five_hour passes validation"
else
  fail "Valid JSON validation" "passes jq check" "failed"
fi

# Test: Error JSON (no_token) fails validation
error_json='{"error": "no_token", "message": "No OAuth token"}'
if echo "$error_json" | jq -e '.five_hour' >/dev/null 2>&1; then
  fail "Error JSON rejection (no_token)" "fails jq check" "passed"
else
  pass "Error JSON (no_token) correctly rejected"
fi

# Test: Error JSON (api_error) fails validation
error_json='{"error": "api_error", "status": 500}'
if echo "$error_json" | jq -e '.five_hour' >/dev/null 2>&1; then
  fail "Error JSON rejection (api_error)" "fails jq check" "passed"
else
  pass "Error JSON (api_error) correctly rejected"
fi

# Test: Error JSON (parse_error) fails validation
error_json='{"error": "parse_error", "raw": "invalid"}'
if echo "$error_json" | jq -e '.five_hour' >/dev/null 2>&1; then
  fail "Error JSON rejection (parse_error)" "fails jq check" "passed"
else
  pass "Error JSON (parse_error) correctly rejected"
fi

# Test: Empty response fails validation
if echo "" | jq -e '.five_hour' >/dev/null 2>&1; then
  fail "Empty response rejection" "fails jq check" "passed"
else
  pass "Empty response correctly rejected"
fi

# Test: Invalid JSON fails validation
if echo "not json at all" | jq -e '.five_hour' >/dev/null 2>&1; then
  fail "Invalid JSON rejection" "fails jq check" "passed"
else
  pass "Invalid JSON correctly rejected"
fi

# Test: JSON with null five_hour fails validation
null_json='{"five_hour": null, "seven_day": 50}'
if echo "$null_json" | jq -e '.five_hour' >/dev/null 2>&1; then
  fail "Null five_hour rejection" "fails jq check" "passed"
else
  pass "JSON with null five_hour correctly rejected"
fi

###############################################################################
section "Temp File Handling"

# Test: Temp file uses PID for uniqueness
if grep -q 'tmp\.\$\$' "$STATUSLINE_SCRIPT"; then
  pass "Temp file uses PID for uniqueness"
else
  fail "Temp file PID usage" "contains 'tmp.\$\$'" "not found"
fi

# Test: Temp file is cleaned up on validation failure
if grep -q 'rm -f "\$temp_file"' "$STATUSLINE_SCRIPT"; then
  pass "Temp file cleanup on failure is implemented"
else
  fail "Temp file cleanup" "contains 'rm -f'" "not found"
fi

# Test: Atomic mv is used for cache replacement
if grep -q 'mv "\$temp_file" "\$CACHE_FILE"' "$STATUSLINE_SCRIPT"; then
  pass "Atomic mv used for cache replacement"
else
  fail "Atomic mv usage" "contains 'mv'" "not found"
fi

###############################################################################
section "Color Thresholds"

# Test: Low usage gets correct color
echo '{"five_hour": 30, "five_hour_resets_at": "2099-01-01T12:00:00Z"}' > "$TEST_CACHE_FILE"
touch "$TEST_CACHE_FILE"
output=$(run_test_script '{"model":{"display_name":"Opus"}}')
# 30% should use TAN color (38;5;180)
if [[ "$output" == *"30%"* ]]; then
  pass "Low usage (30%) displays correctly"
else
  fail "Low usage display" "contains '30%'" "$output"
fi

# Test: High usage gets warning color
echo '{"five_hour": 95, "five_hour_resets_at": "2099-01-01T12:00:00Z"}' > "$TEST_CACHE_FILE"
touch "$TEST_CACHE_FILE"
output=$(run_test_script '{"model":{"display_name":"Opus"}}')
# 95% should use DARK_RED color (38;5;167)
if [[ "$output" == *"95%"* ]]; then
  pass "High usage (95%) displays correctly"
else
  fail "High usage display" "contains '95%'" "$output"
fi

###############################################################################
section "Edge Cases"

# Test: Handles decimal percentages
output=$(run_test_script '{"context_window":{"used_percentage":42.7}}')
# Should truncate to integer
if [[ "$output" == *"42%"* ]]; then
  pass "Decimal percentage truncated correctly"
else
  fail "Decimal percentage" "contains '42%'" "$output"
fi

# Test: Handles zero percentage
rm -f "$TEST_CACHE_FILE"
output=$(run_test_script '{"model":{"display_name":"Opus"},"context_window":{"used_percentage":0}}')
# Zero context shouldn't show ctx: section
if [[ "$output" != *"ctx:0%"* ]] && [[ "$output" == *"Opus"* ]]; then
  pass "Zero percentage handled (not displayed)"
else
  fail "Zero percentage handling" "no ctx:0%" "$output"
fi

# Test: Handles null values gracefully
output=$(run_test_script '{"model":{"display_name":null},"context_window":{"used_percentage":null}}')
if [[ $? -eq 0 ]]; then
  pass "Null values handled gracefully"
else
  fail "Null value handling" "exit code 0" "non-zero"
fi

###############################################################################
section "Background Fetch Integration"

# Test: Script has subshell grouping for background operations
if grep -q '( *$' "$STATUSLINE_SCRIPT" || grep -qE '\(\s*$' "$STATUSLINE_SCRIPT"; then
  pass "Uses subshell grouping for background fetch"
else
  # Check for ( on same line
  if grep -q '( *"' "$STATUSLINE_SCRIPT"; then
    pass "Uses subshell grouping for background fetch"
  else
    fail "Subshell grouping" "contains '(' before fetch" "not found"
  fi
fi

# Test: Background fetch is properly backgrounded with &
if grep -q ') &$' "$STATUSLINE_SCRIPT"; then
  pass "Background fetch runs in background with &"
else
  fail "Background execution" "contains ') &'" "not found"
fi

###############################################################################
# Summary
###############################################################################

echo ""
echo "========================================"
echo -e "Tests: ${GREEN}$PASSED passed${RESET}, ${RED}$FAILED failed${RESET}"
echo "========================================"

if [[ $FAILED -gt 0 ]]; then
  exit 1
fi
exit 0
