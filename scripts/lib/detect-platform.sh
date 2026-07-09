#!/usr/bin/env bash
# Shared platform detection for install.sh, magicclaw CLI, and build-bundle.sh.
# Outputs: linux-x64 | darwin-arm64 | darwin-x64 | windows-x64

magicclaw_detect_platform() {
  local os arch uname_s
  uname_s="$(uname -s)"
  case "$uname_s" in
    Linux) os="linux" ;;
    Darwin) os="darwin" ;;
    MINGW*|MSYS*|CYGWIN*) os="windows" ;;
    *)
      echo "Unsupported OS: $uname_s" >&2
      return 1
      ;;
  esac

  case "$(uname -m)" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64)
      if [[ "$os" == "windows" ]]; then
        echo "Windows ARM64 is not supported yet. Use 64-bit Windows or WSL." >&2
        return 1
      fi
      arch="arm64"
      ;;
    *)
      echo "Unsupported architecture: $(uname -m)" >&2
      return 1
      ;;
  esac

  echo "${os}-${arch}"
}
