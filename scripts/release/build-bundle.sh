#!/usr/bin/env bash
# Build a platform-specific MagicClaw release tarball.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

VERSION="${VERSION:-$(node -p "require('./package.json').version")}"
# Strip leading v from tag names (e.g. v0.1.0 -> 0.1.0)
VERSION="${VERSION#v}"
PLATFORM="${PLATFORM:-}"

if [[ -z "$PLATFORM" ]]; then
  # shellcheck source=../lib/detect-platform.sh
  source "$ROOT/scripts/lib/detect-platform.sh"
  PLATFORM="$(magicclaw_detect_platform)"
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
mkdir -p "$STAGING/bin" "$STAGING/lib" "$STAGING/api" "$STAGING/web" "$STAGING/share"

cp scripts/bin/magicclaw "$STAGING/bin/magicclaw"
chmod +x "$STAGING/bin/magicclaw" 2>/dev/null || true
cp scripts/lib/detect-platform.sh "$STAGING/lib/detect-platform.sh"
cp scripts/lib/node-fts5-check.sh "$STAGING/lib/node-fts5-check.sh"
cp scripts/lib/normalize-path.sh "$STAGING/lib/normalize-path.sh"
cp scripts/lib/resolve-release-tag.sh "$STAGING/lib/resolve-release-tag.sh"
if [[ "$PLATFORM" == windows-* ]]; then
  cp scripts/lib/magicclaw-github.ps1 "$STAGING/lib/magicclaw-github.ps1"
  cp scripts/lib/magicclaw-service.ps1 "$STAGING/lib/magicclaw-service.ps1"
fi
chmod +x "$STAGING/lib/"*.sh 2>/dev/null || true
if [[ "$PLATFORM" == windows-* ]]; then
  for script in "$STAGING/bin/magicclaw" "$STAGING/lib/"*.sh; do
    sed -i 's/\r$//' "$script" 2>/dev/null || sed -i '' 's/\r$//' "$script"
  done
fi
if [[ "$PLATFORM" == windows-* ]]; then
  cp scripts/bin/magicclaw.cmd "$STAGING/bin/magicclaw.cmd"
  cp scripts/bin/magicclaw.ps1 "$STAGING/bin/magicclaw.ps1"
fi
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

echo "==> Materialize web standalone dependencies"
chmod +x "$ROOT/scripts/release/materialize-web-standalone.sh"
bash "$ROOT/scripts/release/materialize-web-standalone.sh" "$STAGING/web"

echo "==> Smoke test staged bundle"
# shellcheck source=../lib/node-fts5-check.sh
source "$ROOT/scripts/lib/node-fts5-check.sh"
NODE_BIN="$(command -v node)"
bash "$ROOT/scripts/release/smoke-test-bundle.sh" "$STAGING" "$NODE_BIN"
chmod +x "$ROOT/scripts/release/smoke-test-web-standalone.sh"
bash "$ROOT/scripts/release/smoke-test-web-standalone.sh" "$STAGING/web" "$NODE_BIN"
if [[ "$PLATFORM" == windows-* ]]; then
  tmp_home="$(mktemp -d)"
  ps_validate="$tmp_home/validate-powershell.ps1"
  cat >"$ps_validate" <<'PS1'
$root = $env:MAGICCLAW_PS_VALIDATE_ROOT
$errors = @()

Get-ChildItem -LiteralPath $root -Recurse -Filter '*.ps1' | ForEach-Object {
  $tokens = $null
  $parseErrors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$tokens, [ref]$parseErrors) | Out-Null
  foreach ($err in $parseErrors) {
    $errors += "$($_.FullName): $($err.Extent.StartLineNumber):$($err.Extent.StartColumnNumber) $($err.Message)"
  }
}

if ($errors.Count -gt 0) {
  $errors | ForEach-Object { Write-Error $_ }
  exit 1
}
PS1
  if command -v pwsh >/dev/null 2>&1; then
    if ! MAGICCLAW_PS_VALIDATE_ROOT="$STAGING" pwsh -NoProfile -ExecutionPolicy Bypass -File "$ps_validate"; then
      echo "Error: PowerShell parse validation failed in staged bundle" >&2
      rm -rf "$tmp_home"
      exit 1
    fi
    if ! MAGICCLAW_HOME="$tmp_home" pwsh -NoProfile -ExecutionPolicy Bypass -File "$STAGING/bin/magicclaw.ps1" status >/dev/null 2>&1; then
      echo "Error: magicclaw.ps1 status failed in staged bundle" >&2
      MAGICCLAW_HOME="$tmp_home" pwsh -NoProfile -ExecutionPolicy Bypass -File "$STAGING/bin/magicclaw.ps1" status >&2 || true
      rm -rf "$tmp_home"
      exit 1
    fi
  elif command -v powershell >/dev/null 2>&1; then
    if ! MAGICCLAW_PS_VALIDATE_ROOT="$STAGING" powershell -NoProfile -ExecutionPolicy Bypass -File "$ps_validate"; then
      echo "Error: PowerShell parse validation failed in staged bundle" >&2
      rm -rf "$tmp_home"
      exit 1
    fi
    if ! MAGICCLAW_HOME="$tmp_home" powershell -NoProfile -ExecutionPolicy Bypass -File "$STAGING/bin/magicclaw.ps1" status >/dev/null 2>&1; then
      echo "Error: magicclaw.ps1 status failed in staged bundle" >&2
      MAGICCLAW_HOME="$tmp_home" powershell -NoProfile -ExecutionPolicy Bypass -File "$STAGING/bin/magicclaw.ps1" status >&2 || true
      rm -rf "$tmp_home"
      exit 1
    fi
  else
    echo "Error: pwsh or powershell required for Windows bundle smoke test" >&2
    rm -rf "$tmp_home"
    exit 1
  fi
  rm -rf "$tmp_home"
  echo "CLI smoke test passed: magicclaw.ps1 status"
else
  if ! MAGICCLAW_HOME="$(mktemp -d)" bash "$STAGING/bin/magicclaw" status >/dev/null 2>&1; then
    echo "Error: magicclaw status failed in staged bundle" >&2
    MAGICCLAW_HOME="$(mktemp -d)" bash "$STAGING/bin/magicclaw" status >&2 || true
    exit 1
  fi
  echo "CLI smoke test passed: magicclaw status"
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
else
  node -e "
    const crypto = require('crypto');
    const fs = require('fs');
    const hash = crypto.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex');
    fs.writeFileSync(process.argv[1] + '.sha256', hash + '\n');
  " "$ARCHIVE_PATH"
fi

rm -rf "$STAGING"

echo ""
echo "Release bundle ready:"
echo "  $ARCHIVE_PATH"
if [[ -f "$ARCHIVE_PATH.sha256" ]]; then
  echo "  $ARCHIVE_PATH.sha256"
fi
