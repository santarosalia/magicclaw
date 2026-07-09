#!/usr/bin/env bash
# ============================================================================
# MagicClaw Installer
# ============================================================================
# Downloads a prebuilt release bundle and installs the magicclaw CLI.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/santarosalia/magicclaw/main/scripts/install.sh | bash
#
# Or with options:
#   curl -fsSL ... | bash -s -- --version v0.1.0 --skip-setup
# ============================================================================

set -euo pipefail

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
  echo "  __  __            _      ____ _"
  echo " |  \\/  | __ _  __| | ___/ ___| | __ ___  ___  ___  ___"
  echo " | |\\/| |/ _\` |/ _\` |/ _ \\ |   | |/ _\` |/ _ \\/ __|/ _ \\"
  echo " | |  | | (_| | (_| |  __/ |___| | (_| | (_) \\__ \\  __/"
  echo " |_|  |_|\\__,_|\\__,_|\\___|\\____|_|\\__,_|\\___/|___/\\___|"
  echo -e "${NC}"
  echo "MagicClaw installer"
  echo ""
}

detect_platform() {
  local os arch
  case "$(uname -s)" in
    Linux) os="linux" ;;
    Darwin) os="darwin" ;;
    *)
      echo -e "${RED}Unsupported OS: $(uname -s)${NC}" >&2
      exit 1
      ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *)
      echo -e "${RED}Unsupported architecture: $(uname -m)${NC}" >&2
      exit 1
      ;;
  esac
  echo "${os}-${arch}"
}

resolve_version() {
  if [[ -n "$VERSION" ]]; then
    echo "$VERSION"
    return
  fi
  local tag
  tag="$(curl -fsSL "https://api.github.com/repos/$GITHUB_REPO/releases/latest" \
    | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)"
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
  trap 'rm -rf "$tmpdir"' EXIT

  if ! curl -fsSL "$url" -o "$tmpdir/bundle.tar.gz"; then
    echo -e "${RED}Download failed: $url${NC}" >&2
    echo "Check that release $version exists for platform $platform" >&2
    exit 1
  fi

  echo -e "${BLUE}Installing to ${INSTALL_DIR}...${NC}"
  mkdir -p "$INSTALL_DIR"
  rm -rf "${INSTALL_DIR:?}/"*
  tar -xzf "$tmpdir/bundle.tar.gz" -C "$INSTALL_DIR"
  chmod +x "$INSTALL_DIR/bin/magicclaw"
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
