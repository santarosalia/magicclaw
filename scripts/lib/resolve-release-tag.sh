#!/usr/bin/env bash
# Resolve latest GitHub release tag without the REST API (avoids unauthenticated 403/rate limits).
magicclaw_resolve_release_tag() {
  local repo="${1:-${MAGICCLAW_GITHUB_REPO:-santarosalia/magicclaw}}"
  local url tag

  url="$(curl -fsSL -o /dev/null -w '%{url_effective}' "https://github.com/$repo/releases/latest")" || return 1

  if [[ "$url" =~ /releases/tag/([^/?#]+) ]]; then
    tag="${BASH_REMATCH[1]}"
    printf '%s\n' "$tag"
    return 0
  fi

  return 1
}
