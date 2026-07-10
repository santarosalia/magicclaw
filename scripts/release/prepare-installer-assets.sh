#!/usr/bin/env bash
# Flatten installer scripts for GitHub Release asset names.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${1:-$ROOT/dist/installer-assets}"

mkdir -p "$OUT"

cp "$ROOT/scripts/install.sh" "$OUT/install.sh"
cp "$ROOT/scripts/install.ps1" "$OUT/install.ps1"
cp "$ROOT/scripts/lib/magicclaw-github.ps1" "$OUT/magicclaw-github.ps1"
cp "$ROOT/scripts/lib/magicclaw-service.ps1" "$OUT/magicclaw-service.ps1"

chmod +x "$OUT/install.sh" 2>/dev/null || true

echo "Installer assets prepared in $OUT"
ls -la "$OUT"
