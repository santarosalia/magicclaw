#!/usr/bin/env bash
# Normalize Windows paths for Git Bash / MSYS environments.

magicclaw_normalize_path() {
  local p="$1"
  if [[ -z "$p" ]]; then
    echo "$p"
    return 0
  fi

  case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*)
      if command -v cygpath >/dev/null 2>&1; then
        cygpath -u "$p"
        return 0
      fi
      if [[ "$p" =~ ^([A-Za-z]):(.*)$ ]]; then
        local drive="${BASH_REMATCH[1],,}"
        local rest="${BASH_REMATCH[2]}"
        rest="${rest//\\//}"
        rest="${rest#/}"
        echo "/${drive}/${rest}"
        return 0
      fi
      ;;
  esac

  echo "$p"
}
