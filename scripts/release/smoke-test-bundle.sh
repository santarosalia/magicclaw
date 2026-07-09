#!/usr/bin/env bash
# Smoke-test a staged release bundle: API boots and /health responds.
set -euo pipefail

STAGING="${1:?staging directory required}"
NODE_BIN="${2:-$(command -v node)}"

if ! "$NODE_BIN" -v >/dev/null 2>&1; then
  echo "Error: Node binary not runnable: $NODE_BIN" >&2
  exit 1
fi

# shellcheck source=../lib/node-fts5-check.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../lib/node-fts5-check.sh"

if ! node_supports_fts5 "$NODE_BIN"; then
  echo "Warning: $NODE_BIN lacks SQLite FTS5 — API will use LIKE search fallback"
fi

SMOKE_HOME="$(mktemp -d)"
trap 'rm -rf "$SMOKE_HOME"' EXIT

PORT="$((40000 + RANDOM % 20000))"
export MAGICCLAW_HOME="$SMOKE_HOME"
export PORT
export WEB_ORIGIN="http://localhost:3000"

API_PID=""
cleanup() {
  if [[ -n "$API_PID" ]] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

cd "$STAGING/api"
"$NODE_BIN" dist/main.js >"$SMOKE_HOME/api.log" 2>&1 &
API_PID=$!

for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    echo "Smoke test passed: API /health on port $PORT"
    exit 0
  fi
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "Error: API process exited before /health responded" >&2
    cat "$SMOKE_HOME/api.log" >&2 || true
    exit 1
  fi
  sleep 0.25
done

echo "Error: timed out waiting for /health" >&2
cat "$SMOKE_HOME/api.log" >&2 || true
exit 1
