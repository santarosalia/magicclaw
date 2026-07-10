#!/usr/bin/env bash
# Resolve latest GitHub release tag (redirect first, API fallback).
magicclaw_resolve_release_tag() {
  local repo="${1:-${MAGICCLAW_GITHUB_REPO:-santarosalia/magicclaw}}"
  local tag url response api_url
  local curl_common=(-fsSL -H 'User-Agent: magicclaw-installer')

  url="$(curl "${curl_common[@]}" -o /dev/null -w '%{url_effective}' \
    "https://github.com/$repo/releases/latest" 2>/dev/null || true)"

  if [[ "$url" =~ /releases/tag/([^/?#]+) ]]; then
    tag="${BASH_REMATCH[1]}"
    printf '%s\n' "$tag"
    return 0
  fi

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
