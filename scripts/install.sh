#!/usr/bin/env bash
# ============================================================================
# MagicClaw Installer
# ============================================================================
# Downloads a prebuilt release bundle and installs the magicclaw CLI.
#
# Usage:
#   curl -fsSL https://github.com/santarosalia/magicclaw/releases/latest/download/install.sh | bash
#
# Windows PowerShell:
#   irm https://github.com/santarosalia/magicclaw/releases/latest/download/install.ps1 | iex
#
# Or with options:
#   curl -fsSL ... | bash -s -- --version v0.1.0 --skip-setup
# ============================================================================

set -euo pipefail

# When piped (curl ... | bash), BASH_SOURCE[0] is unset and $0 is "bash".
_resolve_script_dir() {
  local src="${BASH_SOURCE[0]:-}"
  if [[ -n "$src" && "$src" != bash && "$src" != -bash ]]; then
    cd "$(dirname "$src")" && pwd
    return 0
  fi
  src="${0:-}"
  if [[ -n "$src" && "$src" != bash && "$src" != -bash ]]; then
    cd "$(dirname "$src")" && pwd
    return 0
  fi
  return 1
}
SCRIPT_DIR="$(_resolve_script_dir 2>/dev/null || true)"

if [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/lib/detect-platform.sh" ]]; then
  # shellcheck source=lib/detect-platform.sh
  source "$SCRIPT_DIR/lib/detect-platform.sh"
  # shellcheck source=lib/resolve-release-tag.sh
  source "$SCRIPT_DIR/lib/resolve-release-tag.sh"
else
  # Self-contained fallback for curl | bash (release asset has no lib/ sibling).
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
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'
BOLD='\033[1m'

GITHUB_REPO="${MAGICCLAW_GITHUB_REPO:-santarosalia/magicclaw}"
MAGICCLAW_HOME="${MAGICCLAW_HOME:-$HOME/.magicclaw}"
INSTALL_DIR="${MAGICCLAW_INSTALL_DIR:-$MAGICCLAW_HOME/app}"
BIN_DIR="${HOME}/.local/bin"
SHIM_PATH="$BIN_DIR/magicclaw"

VERSION=""
SKIP_SETUP=false
NON_INTERACTIVE=false

if [[ -t 0 ]]; then
  IS_INTERACTIVE=true
else
  IS_INTERACTIVE=false
  NON_INTERACTIVE=true
fi

while [[ $# -gt 0 ]]; do
  case $1 in
    --version|-v)
      VERSION="$2"
      shift 2
      ;;
    --dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    --magicclaw-home)
      MAGICCLAW_HOME="$2"
      INSTALL_DIR="${MAGICCLAW_HOME}/app"
      shift 2
      ;;
    --skip-setup)
      SKIP_SETUP=true
      shift
      ;;
    --non-interactive)
      NON_INTERACTIVE=true
      shift
      ;;
    -h|--help)
      cat <<EOF
MagicClaw installer

Options:
  --version, -v TAG     Install specific release tag (e.g. v0.1.0)
  --dir PATH            Install application files to PATH (default: ~/.magicclaw/app)
  --magicclaw-home DIR  Data home directory (default: ~/.magicclaw)
  --skip-setup          Skip magicclaw setup (.env initialization)
  --non-interactive     Never prompt
  -h, --help            Show this help
EOF
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

INSTALL_DIR="${INSTALL_DIR:-$MAGICCLAW_HOME/app}"

print_banner() {
  echo -e "${BOLD}${BLUE}"
  echo "___  ___               _         _____  _                  "
  echo "|  \\/  |              (_)       /  __ \\| |                 "
  echo "| .  . |  __ _   __ _  _   ___  | /  \\/| |  __ _ __      __"
  echo "| |\\/| | / _\` | / _\` || | / __| | |    | | / _\` |\\ \\ /\\ / /"
  echo "| |  | || (_| || (_| || || (__  | \\__/\\| || (_| | \\ V  V / "
  echo "\\_|  |_/ \\__,_| \\__, ||_| \\___|  \\____/|_| \\__,_|  \\_/\\_/  "
  echo "                 __/ |                                      "
  echo "                |___/                                       "
  echo -e "${NC}"
  echo "Magic Claw installer"
  echo ""
}

detect_platform() {
  magicclaw_detect_platform
}

resolve_version() {
  if [[ -n "$VERSION" ]]; then
    echo "$VERSION"
    return
  fi
  local tag
  if declare -F magicclaw_resolve_release_tag >/dev/null 2>&1; then
    tag="$(magicclaw_resolve_release_tag "$GITHUB_REPO" || true)"
  else
    local url
    url="$(curl -fsSL -o /dev/null -w '%{url_effective}' "https://github.com/$GITHUB_REPO/releases/latest")" || true
    if [[ "$url" =~ /releases/tag/([^/?#]+) ]]; then
      tag="${BASH_REMATCH[1]}"
    fi
  fi
  if [[ -z "$tag" ]]; then
    echo -e "${RED}Could not resolve latest release. Specify --version vX.Y.Z${NC}" >&2
    exit 1
  fi
  echo "$tag"
}

check_prerequisites() {
  if ! command -v curl >/dev/null 2>&1; then
    echo -e "${RED}curl is required${NC}" >&2
    exit 1
  fi
  if ! command -v tar >/dev/null 2>&1; then
    echo -e "${RED}tar is required${NC}" >&2
    exit 1
  fi
  if ! command -v node >/dev/null 2>&1; then
    echo -e "${RED}Node.js 22+ is required. Install from https://nodejs.org/ and re-run.${NC}" >&2
    exit 1
  fi
  local major
  major="$(node -p "process.versions.node.split('.')[0]")"
  if [[ "$major" -lt 22 ]]; then
    echo -e "${RED}Node.js 22+ required (found $(node -v))${NC}" >&2
    exit 1
  fi
}

download_and_install() {
  local platform="$1"
  local version="$2"
  local ver_plain="${version#v}"
  local asset="magicclaw-${ver_plain}-${platform}.tar.gz"
  local url="https://github.com/$GITHUB_REPO/releases/download/${version}/${asset}"

  echo -e "${BLUE}Downloading ${asset}...${NC}"
  local tmpdir
  tmpdir="$(mktemp -d)"

  if ! curl -fsSL "$url" -o "$tmpdir/bundle.tar.gz"; then
    rm -rf "$tmpdir"
    echo -e "${RED}Download failed: $url${NC}" >&2
    echo "Check that release $version exists for platform $platform" >&2
    exit 1
  fi

  echo -e "${BLUE}Installing to ${INSTALL_DIR}...${NC}"
  mkdir -p "$INSTALL_DIR"
  rm -rf "${INSTALL_DIR:?}/"*
  tar -xzf "$tmpdir/bundle.tar.gz" -C "$INSTALL_DIR"
  rm -rf "$tmpdir"
  chmod +x "$INSTALL_DIR/bin/magicclaw" 2>/dev/null || true
  if [[ -f "$INSTALL_DIR/bin/magicclaw.cmd" ]]; then
    chmod +x "$INSTALL_DIR/bin/magicclaw.cmd" 2>/dev/null || true
  fi
}

install_shim() {
  mkdir -p "$BIN_DIR"
  cat >"$SHIM_PATH" <<EOF
#!/usr/bin/env bash
export MAGICCLAW_HOME="\${MAGICCLAW_HOME:-$MAGICCLAW_HOME}"
export MAGICCLAW_INSTALL_DIR="$INSTALL_DIR"
exec "$INSTALL_DIR/bin/magicclaw" "\$@"
EOF
  chmod +x "$SHIM_PATH"
  echo -e "${GREEN}Installed CLI shim: $SHIM_PATH${NC}"
}

ensure_path() {
  if echo ":$PATH:" | grep -q ":$BIN_DIR:"; then
    return 0
  fi
  echo -e "${YELLOW}$BIN_DIR is not in PATH${NC}"
  if [[ "$NON_INTERACTIVE" == true ]]; then
    echo "Add to your shell profile: export PATH=\"\$HOME/.local/bin:\$PATH\""
    return 0
  fi
  local shell_name rc_line
  shell_name="$(basename "${SHELL:-bash}")"
  case "$shell_name" in
    zsh) rc_line="export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
    fish) rc_line='fish_add_path $HOME/.local/bin' ;;
    *) rc_line="export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
  esac
  read -r -p "Add ~/.local/bin to PATH in your shell profile? [Y/n] " reply || reply=""
  if [[ -z "$reply" || "$reply" =~ ^[Yy] ]]; then
    case "$shell_name" in
      zsh)
        echo "$rc_line" >>"$HOME/.zshrc"
        echo -e "${GREEN}Added to ~/.zshrc${NC}"
        ;;
      fish)
        fish -c 'fish_add_path $HOME/.local/bin' 2>/dev/null || true
        ;;
      *)
        echo "$rc_line" >>"$HOME/.bashrc"
        echo -e "${GREEN}Added to ~/.bashrc${NC}"
        ;;
    esac
    echo "Restart your shell or run: export PATH=\"\$HOME/.local/bin:\$PATH\""
  fi
}

run_setup() {
  if [[ "$SKIP_SETUP" == true ]]; then
    return 0
  fi
  export MAGICCLAW_HOME
  if [[ "$NON_INTERACTIVE" == true ]]; then
    "$INSTALL_DIR/bin/magicclaw" setup || true
  else
    "$INSTALL_DIR/bin/magicclaw" setup
  fi
}

main() {
  print_banner
  check_prerequisites

  local platform version
  platform="$(detect_platform)"
  version="$(resolve_version)"

  echo "Platform:  $platform"
  echo "Version:   $version"
  echo "Install:   $INSTALL_DIR"
  echo "Data home: $MAGICCLAW_HOME"
  echo ""

  download_and_install "$platform" "$version"
  install_shim
  ensure_path
  run_setup

  echo ""
  echo -e "${GREEN}${BOLD}MagicClaw installed successfully!${NC}"
  echo ""
  echo "Next steps:"
  echo "  magicclaw start     # Start API + Web"
  echo "  open http://localhost:3000"
  echo ""
  echo "Other commands:"
  echo "  magicclaw status"
  echo "  magicclaw setup"
  echo "  magicclaw update"
}

main "$@"
