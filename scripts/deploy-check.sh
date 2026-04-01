#!/usr/bin/env bash
#
# Post-deployment smoke check for slack-server-monitor.
#
# Validates that the web server is up and responding after a deploy.
# Exits 0 on success, 1 on failure — suitable for CI/CD gating.
#
# Usage:
#   ./scripts/deploy-check.sh              # Use defaults
#   WEB_PORT=9090 ./scripts/deploy-check.sh # Custom port
#
# Environment:
#   WEB_PORT       — port to check (default: reads from .env or 8080)
#   WEB_AUTH_TOKEN  — admin token for login check (optional)
#   TIMEOUT         — max seconds to wait for startup (default: 15)

set -euo pipefail

# --- Configuration -------------------------------------------------------

TIMEOUT="${TIMEOUT:-15}"

# Try to read port from .env if not set
if [[ -z "${WEB_PORT:-}" ]] && [[ -f .env ]]; then
  WEB_PORT=$(grep -E '^WEB_PORT=' .env 2>/dev/null | cut -d= -f2 | tr -d '"' || echo "")
fi
WEB_PORT="${WEB_PORT:-8080}"

BASE_URL="http://localhost:${WEB_PORT}"

# --- Helpers --------------------------------------------------------------

pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; exit 1; }
info() { printf '  \033[36m→\033[0m %s\n' "$1"; }

# --- Checks ---------------------------------------------------------------

echo ""
echo "Deploy check: ${BASE_URL}"
echo "─────────────────────────────────────"

# 1. Wait for health endpoint
info "Waiting for server to respond (timeout: ${TIMEOUT}s)..."
SECONDS=0
until curl -sf "${BASE_URL}/health" > /dev/null 2>&1; do
  if (( SECONDS >= TIMEOUT )); then
    fail "Server did not respond within ${TIMEOUT}s"
  fi
  sleep 1
done
pass "Server is up (${SECONDS}s)"

# 2. Verify health response
HEALTH=$(curl -sf "${BASE_URL}/health")
if echo "${HEALTH}" | grep -q '"status":"ok"'; then
  pass "Health endpoint returned ok"
else
  fail "Health endpoint returned unexpected response: ${HEALTH}"
fi

# 3. Verify login page loads
LOGIN_STATUS=$(curl -sf -o /dev/null -w '%{http_code}' "${BASE_URL}/login")
if [[ "${LOGIN_STATUS}" == "200" ]]; then
  pass "Login page loads (200)"
else
  fail "Login page returned ${LOGIN_STATUS}"
fi

# 4. Verify security headers
HEADERS=$(curl -sf -I "${BASE_URL}/health")
if echo "${HEADERS}" | grep -qi "x-content-type-options: nosniff"; then
  pass "Security headers present"
else
  fail "Missing security headers"
fi

# 5. Verify protected routes require auth
PROTECTED_STATUS=$(curl -sf -o /dev/null -w '%{http_code}' "${BASE_URL}/c" 2>/dev/null || echo "000")
if [[ "${PROTECTED_STATUS}" == "401" ]]; then
  pass "Protected routes require authentication"
else
  fail "Protected route /c returned ${PROTECTED_STATUS} (expected 401)"
fi

# 6. If auth token available, verify login works
if [[ -n "${WEB_AUTH_TOKEN:-}" ]]; then
  LOGIN_RESP=$(curl -sf -o /dev/null -w '%{http_code}' -X POST \
    --data-urlencode "token=${WEB_AUTH_TOKEN}" \
    "${BASE_URL}/login" 2>/dev/null || echo "000")
  if [[ "${LOGIN_RESP}" == "302" ]]; then
    pass "Admin login succeeds"
  else
    fail "Admin login returned ${LOGIN_RESP} (expected 302)"
  fi
else
  info "Skipping login check (WEB_AUTH_TOKEN not set)"
fi

echo ""
echo "─────────────────────────────────────"
pass "All deploy checks passed"
echo ""
