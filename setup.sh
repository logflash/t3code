#!/usr/bin/env bash
#
# setup.sh — Bootstrap T3 Code for local development on macOS.
#
# What it does:
#   1. Verifies / installs the system-level dependencies the project needs.
#   2. Installs the Vite+ CLI (`vp`), which the dev runner spawns directly.
#   3. Installs workspace dependencies with `vp i`.
#   4. Checks that at least one coding-agent provider CLI is available.
#
# Design notes:
#   - Idempotent: re-running is safe. It prefers tools already on your PATH,
#     so if you manage Node/pnpm/bun/python with Nix (or anything else) those
#     are used as-is and never overwritten.
#   - By default it will `brew install` anything missing. If you manage system
#     deps yourself (e.g. Nix), run with T3_SETUP_NO_BREW=1 and the script will
#     only *verify* them and fail with instructions instead of installing.
#
# Usage:
#   ./setup.sh                 # auto-install missing deps via Homebrew
#   T3_SETUP_NO_BREW=1 ./setup.sh   # verify-only (Nix / self-managed deps)
#
set -euo pipefail

# --- Pinned versions (kept in sync with package.json / .devcontainer) --------
NODE_MIN_VERSION="24.13.1"   # package.json engines.node = ^24.13.1
PNPM_VERSION="10.24.0"       # package.json packageManager
# -----------------------------------------------------------------------------

NO_BREW="${T3_SETUP_NO_BREW:-0}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORIGINAL_PATH="$PATH"   # PATH as the user invoked us, before we inject anything

# --- pretty logging ----------------------------------------------------------
if [ -t 1 ]; then
  BOLD=$'\033[1m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; DIM=$'\033[2m'; RESET=$'\033[0m'
else
  BOLD=""; GREEN=""; YELLOW=""; RED=""; DIM=""; RESET=""
fi
info()  { printf "%s==>%s %s\n" "$BOLD$GREEN" "$RESET" "$*"; }
warn()  { printf "%s warn:%s %s\n" "$BOLD$YELLOW" "$RESET" "$*"; }
err()   { printf "%serror:%s %s\n" "$BOLD$RED" "$RESET" "$*" >&2; }
step()  { printf "\n%s%s%s\n" "$BOLD" "$*" "$RESET"; }

have() { command -v "$1" >/dev/null 2>&1; }

# Compare two dotted versions; returns 0 if $1 >= $2.
version_ge() {
  [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]
}

die() { err "$*"; exit 1; }

# Install a Homebrew formula/cask, or fail with guidance under NO_BREW.
brew_install() {
  local what="$1"; shift
  if [ "$NO_BREW" = "1" ]; then
    die "$what is required but missing. Install it yourself (Nix/manual): $*"
  fi
  if ! have brew; then
    die "Homebrew is not installed and is needed to install $what.
       Install Homebrew (https://brew.sh) or set T3_SETUP_NO_BREW=1 and provide deps yourself."
  fi
  info "Installing $what via Homebrew..."
  brew install "$@"
}

# =============================================================================
step "T3 Code local setup"
printf "%sRepo:%s %s\n" "$DIM" "$RESET" "$REPO_ROOT"
[ "$NO_BREW" = "1" ] && info "T3_SETUP_NO_BREW=1 — verify-only mode (no Homebrew installs)"

# --- 0. macOS check ----------------------------------------------------------
[ "$(uname -s)" = "Darwin" ] || die "This script targets macOS. Detected: $(uname -s)"

# --- 1. Xcode Command Line Tools (clang/make for native node modules) --------
# node-pty, sharp, esbuild, electron, etc. compile native code on install.
step "1/7  Xcode Command Line Tools (native build toolchain)"
if xcode-select -p >/dev/null 2>&1; then
  info "Command Line Tools present ($(xcode-select -p))"
else
  if [ "$NO_BREW" = "1" ]; then
    die "Xcode Command Line Tools missing. Run: xcode-select --install"
  fi
  warn "Command Line Tools not found — launching installer (GUI prompt)..."
  xcode-select --install || true
  die "Re-run ./setup.sh once the Command Line Tools install completes."
fi

# --- 2. Node.js 24 -----------------------------------------------------------
step "2/7  Node.js >= $NODE_MIN_VERSION"
if have node; then
  NODE_CUR="$(node -v | sed 's/^v//')"
  if version_ge "$NODE_CUR" "$NODE_MIN_VERSION"; then
    info "node $NODE_CUR"
  else
    warn "node $NODE_CUR is older than required $NODE_MIN_VERSION"
    if have nvm || [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
      warn "nvm detected — run:  nvm install 24 && nvm use 24"
      die "Upgrade Node, then re-run ./setup.sh"
    fi
    brew_install "Node 24" node@24
    warn "You may need to add node@24 to your PATH (brew will print instructions)."
  fi
else
  if have nvm || [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
    die "Node not on PATH but nvm is present. Run: nvm install 24 && nvm use 24, then re-run."
  fi
  brew_install "Node 24" node@24
fi

# --- 3. Python 3 (node-gyp dependency for native modules) --------------------
step "3/7  Python 3 (node-gyp)"
if have python3; then
  info "python3 $(python3 --version 2>&1 | awk '{print $2}')"
else
  brew_install "Python 3" python@3.12
fi

# --- 4. pnpm (package manager pinned by the repo) ----------------------------
# corepack ships with Node and gives us the exact pinned pnpm version.
step "4/7  pnpm@$PNPM_VERSION"
if have pnpm && [ "$(pnpm -v 2>/dev/null)" = "$PNPM_VERSION" ]; then
  info "pnpm $PNPM_VERSION"
elif have corepack; then
  info "Activating pnpm@$PNPM_VERSION via corepack..."
  corepack enable >/dev/null 2>&1 || true
  corepack prepare "pnpm@$PNPM_VERSION" --activate
else
  warn "corepack not found; falling back to npm global install"
  npm install -g "pnpm@$PNPM_VERSION"
fi

# --- 5. Vite+ CLI (`vp`) — required; not in Homebrew/Nixpkgs -----------------
# The dev runner (scripts/dev-runner.ts) spawns `vp` directly, and every root
# script is `vp run ...`. Installed via the official installer, which drops the
# binary in ~/.vite-plus/bin. That dir is frequently NOT on PATH yet: the
# installer appends to ~/.profile (which zsh never reads), and Nix-managed
# dotfiles are read-only symlinks. So rather than depend on PATH wiring, we
# locate the binary directly and add it to PATH for the rest of this run.
VP_BIN_DIR="$HOME/.vite-plus/bin"
VP_PATH_INJECTED=0
VP_LINK_DIR=""
ensure_vp_on_path() {
  if ! have vp && [ -x "$VP_BIN_DIR/vp" ]; then
    export PATH="$VP_BIN_DIR:$PATH"
    VP_PATH_INJECTED=1
  fi
}

# Make `vp` durably resolvable WITHOUT editing shell config or Nix: symlink it
# into a writable directory that's already on the user's PATH. We only link the
# `vp` family (not the node/npm/corepack shims in ~/.vite-plus/bin), so this
# never shadows a Nix/Homebrew-managed node toolchain. The symlink targets the
# stable ~/.vite-plus/bin/vp path, so vp self-upgrades keep working.
link_vp_onto_path() {
  local src="$VP_BIN_DIR/vp"
  [ -x "$src" ] || return 0

  # Prefer a user-owned dir already on PATH; no sudo, no system pollution.
  local cand
  for cand in "$HOME/.local/bin" "$HOME/bin" /opt/homebrew/bin /usr/local/bin; do
    case ":$ORIGINAL_PATH:" in
      *":$cand:"*) if [ -d "$cand" ] && [ -w "$cand" ]; then VP_LINK_DIR="$cand"; break; fi ;;
    esac
  done

  if [ -n "$VP_LINK_DIR" ]; then
    ln -sf "$src" "$VP_LINK_DIR/vp"
    info "Linked vp -> $VP_LINK_DIR/vp (already on your PATH)"
    return 0
  fi

  # Nothing writable already on PATH: drop it in ~/.local/bin and try to add
  # that to PATH via the first writable, non-symlinked login shell file.
  VP_LINK_DIR="$HOME/.local/bin"
  mkdir -p "$VP_LINK_DIR"
  ln -sf "$src" "$VP_LINK_DIR/vp"
  local rc
  for rc in "$HOME/.zprofile" "$HOME/.zshrc" "$HOME/.bash_profile" "$HOME/.profile"; do
    if [ -f "$rc" ] && [ ! -L "$rc" ] && [ -w "$rc" ]; then
      if ! grep -q 'T3 Code: vp on PATH' "$rc" 2>/dev/null; then
        printf '\n# T3 Code: vp on PATH\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$rc"
      fi
      info "Linked vp -> $VP_LINK_DIR/vp and added it to PATH via $rc"
      return 0
    fi
  done
  warn "Linked vp -> $VP_LINK_DIR/vp, but that dir is not on PATH and no writable"
  warn "shell profile was found. Add this line to your shell config (or Nix sessionPath):"
  warn '    export PATH="$HOME/.local/bin:$PATH"'
}

step "5/7  Vite+ CLI (vp)"
ensure_vp_on_path   # pick up a prior install that isn't on PATH yet
if have vp; then
  info "vp present ($(vp --version 2>/dev/null | head -n1 || echo 'version unknown'))"
else
  info "Installing Vite+ (vp) from https://vite.plus ..."
  curl -fsSL https://vite.plus | bash
  ensure_vp_on_path
  if ! have vp; then
    die "vp not found after install (looked in $VP_BIN_DIR). Check the installer output above."
  fi
  info "vp installed: $(vp --version 2>/dev/null | head -n1)"
fi

# If vp wasn't on the invoking shell's PATH, make it durable for future shells.
[ "$VP_PATH_INJECTED" = "1" ] && link_vp_onto_path

# --- 6. Install workspace dependencies ---------------------------------------
step "6/7  Installing workspace dependencies (vp i)"
cd "$REPO_ROOT"
vp i

# --- 7. Electron runtime (for `vp run dev:desktop`) --------------------------
# electron's npm postinstall sometimes only partially extracts the app (missing
# the Frameworks/ dir), which crashes desktop dev with "Electron failed to
# install correctly". The repo's repair script verifies the runtime and
# re-downloads it ONLY if incomplete, so it's cheap when already valid. Skip
# with T3_SETUP_NO_DESKTOP=1 if you only do web dev.
step "7/7  Electron runtime (desktop dev)"
if [ "${T3_SETUP_NO_DESKTOP:-0}" = "1" ]; then
  info "Skipped (T3_SETUP_NO_DESKTOP=1)"
elif [ -f apps/desktop/scripts/ensure-electron-runtime.mjs ]; then
  if node apps/desktop/scripts/ensure-electron-runtime.mjs >/dev/null; then
    info "Electron runtime OK"
  else
    warn "Electron runtime check failed — desktop dev may not work."
    warn "Re-run manually: node apps/desktop/scripts/ensure-electron-runtime.mjs"
  fi
else
  warn "ensure-electron-runtime.mjs not found — skipping Electron check."
fi

# --- Provider CLI check (runtime requirement, not auto-installed) ------------
# T3 Code is a GUI for coding agents; you need >=1 provider installed + logged in.
step "Coding-agent providers"
FOUND_PROVIDER=0
check_provider() {
  if have "$1"; then info "$2 CLI found ($1)"; FOUND_PROVIDER=1; fi
}
check_provider codex        "Codex"
check_provider claude       "Claude Code"
check_provider cursor-agent "Cursor"
check_provider opencode     "OpenCode"
if [ "$FOUND_PROVIDER" = "0" ]; then
  warn "No provider CLI detected. Install and authenticate at least one:"
  printf "    %s\n" \
    "Codex:    install Codex CLI       -> codex login" \
    "Claude:   install Claude Code     -> claude auth login" \
    "Cursor:   install Cursor CLI      -> cursor-agent login" \
    "OpenCode: install OpenCode        -> opencode auth login"
fi

# --- Done --------------------------------------------------------------------
step "${GREEN}Setup complete.${RESET}"
# vp was just linked into a dir on PATH but this already-running shell cached its
# command table, so remind the user to refresh before `vp` resolves here.
if [ "$VP_PATH_INJECTED" = "1" ] && [ -n "$VP_LINK_DIR" ]; then
  printf "%svp is now on PATH via %s — open a new shell (or run: hash -r) to use it here.%s\n" \
    "$DIM" "$VP_LINK_DIR" "$RESET"
fi
cat <<EOF
Next steps:
  ${BOLD}vp run dev${RESET}            # web UI + server with hot reload
                          # web -> http://localhost:5733
  ${BOLD}vp run dev:desktop${RESET}    # Electron desktop app

Optional:
  cp .env.example .env    # only needed for T3 Connect / relay features
EOF
