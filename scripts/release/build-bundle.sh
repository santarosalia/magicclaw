#!/usr/bin/env bash
# Build a platform-specific MagicClaw release tarball.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

VERSION="${VERSION:-$(node -p "require('./package.json').version")}"
# Strip leading v from tag names (e.g. v0.1.0 -> 0.1.0)
VERSION="${VERSION#v}"
PLATFORM="${PLATFORM:-}"

detect_platform() {
  local os arch
  case "$(uname -s)" in
    Linux) os="linux" ;;
    Darwin) os="darwin" ;;
    *) echo "Unsupported build OS: $(uname -s)" >&2; exit 1 ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *) echo "Unsupported build arch: $(uname -m)" >&2; exit 1 ;;
  esac
  echo "${os}-${arch}"
}

if [[ -z "$PLATFORM" ]]; then
  PLATFORM="$(detect_platform)"
fi

OUT_DIR="${OUT_DIR:-$ROOT/dist/release}"
STAGING="$OUT_DIR/staging-magicclaw"
ARCHIVE_NAME="magicclaw-${VERSION}-${PLATFORM}.tar.gz"
ARCHIVE_PATH="$OUT_DIR/$ARCHIVE_NAME"

echo "==> Building MagicClaw release $VERSION ($PLATFORM)"

echo "==> pnpm install"
CI=true pnpm install --frozen-lockfile

echo "==> pnpm build:release"
pnpm build:release

echo "==> Staging bundle"
rm -rf "$STAGING"
mkdir -p "$STAGING/bin" "$STAGING/api" "$STAGING/web" "$STAGING/share"

cp scripts/bin/magicclaw "$STAGING/bin/magicclaw"
chmod +x "$STAGING/bin/magicclaw"
echo "$VERSION" >"$STAGING/VERSION"

if [[ -f .env.example ]]; then
  cp .env.example "$STAGING/share/env.example"
fi

echo "==> API dist + production dependencies"
cp -R apps/api/dist "$STAGING/api/dist"
cp apps/api/package.json "$STAGING/api/package.json"

API_DEPLOY="$OUT_DIR/api-deploy"
rm -rf "$API_DEPLOY"
mkdir -p "$API_DEPLOY"
cp apps/api/package.json "$API_DEPLOY/package.json"
(
  cd "$API_DEPLOY"
  npm install --omit=dev --no-package-lock --ignore-scripts 2>/dev/null || \
    npm install --production --no-package-lock --ignore-scripts
)
cp -R "$API_DEPLOY/node_modules" "$STAGING/api/node_modules"
rm -rf "$API_DEPLOY"

echo "==> Web standalone"
WEB_STANDALONE="apps/web/.next/standalone"
WEB_STATIC="apps/web/.next/static"
WEB_PUBLIC="apps/web/public"

if [[ ! -d "$WEB_STANDALONE" ]]; then
  echo "Error: $WEB_STANDALONE not found — run next build first" >&2
  exit 1
fi

cp -R "$WEB_STANDALONE/." "$STAGING/web/"
mkdir -p "$STAGING/web/apps/web/.next"
cp -R "$WEB_STATIC" "$STAGING/web/apps/web/.next/static"
cp -R "$WEB_PUBLIC" "$STAGING/web/apps/web/public"

echo "==> Bundle Node.js (optional, for self-contained installs)"
NODE_BIN="$(command -v node)"
NODE_DIR="$(dirname "$NODE_BIN")"
if [[ -x "$NODE_BIN" ]]; then
  mkdir -p "$STAGING/node/bin"
  cp "$NODE_BIN" "$STAGING/node/bin/node"
  if [[ -f "$NODE_DIR/npm" ]]; then
    cp "$NODE_DIR/npm" "$STAGING/node/bin/npm" 2>/dev/null || true
  fi
fi

echo "==> Create tarball"
mkdir -p "$OUT_DIR"
rm -f "$ARCHIVE_PATH" "$ARCHIVE_PATH.sha256"
(
  cd "$STAGING"
  tar -czf "$ARCHIVE_PATH" .
)

if command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "$ARCHIVE_PATH" | awk '{print $1}' >"$ARCHIVE_PATH.sha256"
elif command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$ARCHIVE_PATH" | awk '{print $1}' >"$ARCHIVE_PATH.sha256"
fi

rm -rf "$STAGING"

echo ""
echo "Release bundle ready:"
echo "  $ARCHIVE_PATH"
if [[ -f "$ARCHIVE_PATH.sha256" ]]; then
  echo "  $ARCHIVE_PATH.sha256"
fi
