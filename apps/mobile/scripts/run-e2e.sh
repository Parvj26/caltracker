#!/usr/bin/env bash
# Runs the Maestro flows against the app installed on the booted iOS simulator.
# Starts the local helper bridge (service-role fixtures) for the duration of the run.
# Local only: needs `pnpm db:start` and the app installed (see README).
set -euo pipefail
cd "$(dirname "$0")/.."
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
export PATH="$JAVA_HOME/bin:$PATH"
PORT="${E2E_HELPER_PORT:-54399}"
pnpm exec tsx scripts/e2e-helper.ts serve "$PORT" &
BRIDGE=$!
trap 'kill $BRIDGE 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do
  curl -fs "http://127.0.0.1:$PORT/health" >/dev/null && break
  sleep 0.2
done
maestro test -e HELPER_URL="http://127.0.0.1:$PORT" "${@:-.maestro/}"
