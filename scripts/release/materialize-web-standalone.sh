#!/usr/bin/env bash
# Copy Next.js runtime deps into apps/web/node_modules for portable release bundles.
# pnpm standalone output keeps styled-jsx (and peers) only under .pnpm/; Windows
# installs can fail to resolve them from apps/web/node_modules/next.
set -euo pipefail

WEB_ROOT="${1:?web standalone root required}"

WEB_NM="$WEB_ROOT/apps/web/node_modules"
STANDALONE_NM="$WEB_ROOT/node_modules"

if [[ ! -d "$WEB_NM" || ! -d "$STANDALONE_NM" ]]; then
  echo "Error: expected apps/web/node_modules and node_modules under $WEB_ROOT" >&2
  exit 1
fi

copy_tree() {
  local src="$1"
  local dest="$2"
  rm -rf "$dest"
  mkdir -p "$(dirname "$dest")"
  if cp -RL "$src" "$dest" 2>/dev/null; then
    return 0
  fi
  # BusyBox / older cp: no -L
  cp -R "$src" "$dest"
}

find_next_runtime_dir() {
  local dir
  for dir in "$STANDALONE_NM"/.pnpm/next@*/node_modules; do
    if [[ -d "$dir/next" ]]; then
      echo "$dir"
      return 0
    fi
  done
  return 1
}

NEXT_RUNTIME_DIR="$(find_next_runtime_dir || true)"
if [[ -z "$NEXT_RUNTIME_DIR" ]]; then
  echo "Error: could not find pnpm next runtime dir under $STANDALONE_NM/.pnpm" >&2
  exit 1
fi

materialize_link() {
  local link="$1"
  local name="$2"

  if [[ ! -L "$link" ]]; then
    return 0
  fi

  local target
  target="$(readlink "$link")"
  if [[ "$target" != /* ]]; then
    target="$(cd "$(dirname "$link")" && cd "$target" && pwd)"
  fi

  echo "==> Materialize web dependency: $name"
  copy_tree "$target" "$WEB_NM/$name"
}

materialize_link "$WEB_NM/next" "next"
materialize_link "$WEB_NM/react" "react"
if [[ -L "$WEB_NM/react-dom" ]]; then
  materialize_link "$WEB_NM/react-dom" "react-dom"
fi

for dep in "$NEXT_RUNTIME_DIR"/*; do
  name="$(basename "$dep")"
  case "$name" in
    next | react | react-dom) continue ;;
  esac

  if [[ -e "$WEB_NM/$name" ]]; then
    continue
  fi

  echo "==> Materialize web dependency: $name"
  copy_tree "$dep" "$WEB_NM/$name"
done

echo "Web standalone dependencies materialized"
