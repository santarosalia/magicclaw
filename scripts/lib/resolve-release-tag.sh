#!/usr/bin/env bash
# Resolve latest GitHub release tag (redirect/asset first, API fallback).
magicclaw_release_tag_from_url() {
  local url="$1"
  local tag=""

  if [[ "$url" =~ /releases/tag/([^/?#]+) ]]; then
    tag="${BASH_REMATCH[1]}"
  elif [[ "$url" =~ /releases/download/([^/]+)/ ]]; then
    tag="${BASH_REMATCH[1]}"
  fi

  if [[ -n "$tag" ]]; then
    printf '%s\n' "$tag"
    return 0
  fi

  return 1
}

magicclaw_resolve_release_tag() {
  local repo="${1:-${MAGICCLAW_GITHUB_REPO:-santarosalia/magicclaw}}"
  local tag url response api_url start_uri
  local curl_common=(-fsSL -H 'User-Agent: magicclaw-installer')

  for start_uri in \
    "https://github.com/$repo/releases/latest/download/install.sh" \
    "https://github.com/$repo/releases/latest"; do
    url="$(curl "${curl_common[@]}" -o /dev/null -w '%{url_effective}' "$start_uri" 2>/dev/null || true)"
    if magicclaw_release_tag_from_url "$url"; then
      return 0
    fi
  done

  api_url="https://api.github.com/repos/$repo/releases/latest"
  local curl_args=("${curl_common[@]}" -H 'Accept: application/vnd.github+json')

  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    curl_args+=(-H "Authorization: Bearer $GITHUB_TOKEN")
  fi

  response="$(curl "${curl_args[@]}" "$api_url" 2>/dev/null || true)"
  tag="$(printf '%s' "$response" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"

  if [[ -n "$tag" ]]; then
    printf '%s\n' "$tag"
    return 0
  fi

  return 1
}
