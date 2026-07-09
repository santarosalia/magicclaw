#!/usr/bin/env bash
# Smoke-test staged Next.js standalone: server boots and serves /.
set -euo pipefail

WEB_ROOT="${1:?web standalone root required}"
NODE_BIN="${2:-$(command -v node)}"

if ! "$NODE_BIN" -v >/dev/null 2>&1; then
  echo "Error: Node binary not runnable: $NODE_BIN" >&2
  exit 1
fi

SERVER_JS="$WEB_ROOT/apps/web/server.js"
if [[ ! -f "$SERVER_JS" ]]; then
  echo "Error: $SERVER_JS not found" >&2
  exit 1
fi

SMOKE_HOME="$(mktemp -d)"
trap 'rm -rf "$SMOKE_HOME"' EXIT

PORT="$((30000 + RANDOM % 20000))"
WEB_PID=""
cleanup() {
  if [[ -n "$WEB_PID" ]] && kill -0 "$WEB_PID" 2>/dev/null; then
    kill "$WEB_PID" 2>/dev/null || true
    wait "$WEB_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

(
  cd "$WEB_ROOT"
  PORT="$PORT" HOSTNAME=127.0.0.1 "$NODE_BIN" apps/web/server.js >"$SMOKE_HOME/web.log" 2>&1 &
  echo $! >"$SMOKE_HOME/web.pid"
)
WEB_PID="$(cat "$SMOKE_HOME/web.pid")"

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${PORT}/" >/dev/null 2>&1; then
    echo "Smoke test passed: Web / on port $PORT"
    exit 0
  fi
  if ! kill -0 "$WEB_PID" 2>/dev/null; then
    echo "Error: Web process exited before / responded" >&2
    cat "$SMOKE_HOME/web.log" >&2 || true
    exit 1
  fi
  sleep 0.25
done

echo "Error: timed out waiting for Web /" >&2
cat "$SMOKE_HOME/web.log" >&2 || true
exit 1
