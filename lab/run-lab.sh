#!/usr/bin/env bash
# Migrate, create a synthetic owner, then run PG + HTTP proofs against this lab app.
set -euo pipefail
cd "$(dirname "$0")"

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${JWT_SECRET:?JWT_SECRET is required}"
: "${COOKIE_SECRET:?COOKIE_SECRET is required}"
: "${STAFF_ACCESS_FIXTURE_PROOF:?STAFF_ACCESS_FIXTURE_PROOF is required}"

export DATABASE_URL JWT_SECRET COOKIE_SECRET STAFF_ACCESS_FIXTURE_PROOF
export STAFF_ACCESS_HTTP_BASE="${STAFF_ACCESS_HTTP_BASE:-http://localhost:9015}"
export PORT="${PORT:-9015}"
export NODE_ENV="${NODE_ENV:-development}"

npx medusa db:migrate

npx medusa exec ./src/scripts/bootstrap-owner.ts
STAFF_OWNER_USER_IDS="$(cat staff-owner-id)"
export STAFF_OWNER_USER_IDS
test -n "$STAFF_OWNER_USER_IDS"

npx medusa exec ./src/scripts/verify-staff-access.ts

npx medusa build
npx medusa start --port "$PORT" &
SERVER_PID=$!
cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT

ready=0
for _ in $(seq 1 90); do
  if curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null; then
    ready=1
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "lab server exited before becoming ready" >&2
    exit 1
  fi
  sleep 2
done
if [[ "$ready" -ne 1 ]]; then
  echo "lab server did not become ready on port ${PORT}" >&2
  exit 1
fi

npx medusa exec ./src/scripts/verify-staff-access-http.ts
npx staff-permissions-check --routes staff-routes.json
