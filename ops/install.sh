#!/usr/bin/env bash
# Minimal Sentinell install for one Ubuntu host (hackathon / self-host).
# Served at https://sentinell.xyz/install.sh
#
#   curl -fsSL https://sentinell.xyz/install.sh | bash
#   curl -fsSL https://sentinell.xyz/install.sh | bash -s -- --with-deps
#   # verify first:
#   curl -fsSL https://sentinell.xyz/install.sh -o install.sh && less install.sh && bash install.sh
#   # or from a clone:
#   bash ops/install.sh
#   bash ops/install.sh --with-deps
#
# Whole body lives in main() so a truncated download never executes half a script.
# --with-deps (or SENTINELL_WITH_DEPS=1) installs missing packages on Debian/Ubuntu only.

set -euo pipefail

main() {
  local REPO_URL="${SENTINELL_REPO_URL:-https://github.com/Roukurai/blackHatSentinel.git}"
  local INSTALL_DIR="${SENTINELL_HOME:-$HOME/sentinell}"
  local BIN_DIR="${SENTINELL_BIN_DIR:-$HOME/.local/bin}"
  local NODE_MIN_MAJOR=22 NODE_MIN_MINOR=18
  local collector_ok=0
  local WITH_DEPS=0
  local me
  me="${USER:-$(id -un)}"

  if [[ ${SENTINELL_WITH_DEPS:-0} == 1 ]]; then
    WITH_DEPS=1
  fi
  local arg
  for arg in "$@"; do
    case "$arg" in
      --with-deps) WITH_DEPS=1 ;;
      -h|--help)
        sed -n '2,16p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//' || true
        exit 0
        ;;
      *)
        printf '[sentinell] error: unknown argument: %s\n' "$arg" >&2
        exit 1
        ;;
    esac
  done

  say()  { printf '[sentinell] %s\n' "$*"; }
  die()  { printf '[sentinell] error: %s\n' "$*" >&2; exit 1; }

  say "install dir: $INSTALL_DIR"

  is_debian() {
    [[ -r /etc/os-release ]] || return 1
    # shellcheck disable=SC1091
    . /etc/os-release
    [[ ${ID:-} == debian || ${ID:-} == ubuntu || ${ID_LIKE:-} == *debian* ]]
  }

  node_version() {
    command -v node >/dev/null 2>&1 || return 1
    node -p 'process.versions.node' 2>/dev/null
  }

  node_ok() {
    local nv major minor
    nv="$(node_version)" || return 1
    major="${nv%%.*}"; minor="${nv#*.}"; minor="${minor%%.*}"
    (( major > NODE_MIN_MAJOR || (major == NODE_MIN_MAJOR && minor >= NODE_MIN_MINOR) ))
  }

  # Collect every gap first so the user sees the full list, not one crash at a time.
  local miss=() req_fail=0
  report() { # report KIND NAME DETAIL FIX
    miss+=("$2"$'\n'"    $3"$'\n'"    fix: $4")
    if [[ $1 == req ]]; then
      req_fail=1
    fi
    return 0
  }

  local GIT_FIX="sudo apt-get install -y --no-install-recommends git"
  local CURL_FIX="sudo apt-get install -y --no-install-recommends curl ca-certificates"
  local NODE_FIX="install Node.js 22 from the official tarball: https://nodejs.org/dist/latest-v22.x/ (linux-x64 or linux-arm64 .tar.xz; verify sha256 from SHASUMS256.txt; extract to /usr/local as root or ~/.local otherwise)"
  local NPM_FIX="install Node.js 22 from the official tarball (npm is included): https://nodejs.org/dist/latest-v22.x/"
  local CARGO_FIX="curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal"
  local CC_FIX="sudo apt-get install -y --no-install-recommends build-essential"

  command -v git >/dev/null 2>&1 || report req git "git is missing" "$GIT_FIX"
  command -v curl >/dev/null 2>&1 || report opt curl "curl is missing" "$CURL_FIX"
  if ! command -v node >/dev/null 2>&1; then
    report req node "node is missing" "$NODE_FIX"
  elif ! node_ok; then
    report req node "Node.js ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR}+ required (found $(node_version))" "$NODE_FIX"
  fi
  command -v npm >/dev/null 2>&1 || report req npm "npm is missing" "$NPM_FIX"
  command -v cargo >/dev/null 2>&1 || report opt cargo "cargo is missing (collector will be skipped)" "$CARGO_FIX"
  command -v cc >/dev/null 2>&1 || report opt cc "cc is missing (collector will be skipped)" "$CC_FIX"

  print_miss() {
    local item
    printf '[sentinell] missing or too old:\n' >&2
    for item in "${miss[@]}"; do
      printf '  - %s\n' "$item" >&2
    done
  }

  run_apt() {
    local cmd=(apt-get)
    if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
      sudo -n true >/dev/null 2>&1 || die "sudo needs a password; re-run as root or configure passwordless sudo, then: bash ops/install.sh --with-deps"
      cmd=(sudo -n env DEBIAN_FRONTEND=noninteractive apt-get)
    else
      cmd=(env DEBIAN_FRONTEND=noninteractive apt-get)
    fi
    "${cmd[@]}" update -qq
    "${cmd[@]}" install -y --no-install-recommends git curl ca-certificates xz-utils build-essential
  }

  install_node22() {
    command -v curl >/dev/null 2>&1 || die "curl is required to install Node.js"
    command -v tar >/dev/null 2>&1 || die "tar is required to install Node.js"
    local arch dest base f sum
    if command -v dpkg >/dev/null 2>&1; then
      arch=$(dpkg --print-architecture)
    else
      arch=$(uname -m)
    fi
    case "$arch" in
      amd64|x86_64) arch=x64 ;;
      arm64|aarch64) arch=arm64 ;;
      *) die "unsupported architecture for Node tarball: $arch" ;;
    esac
    if [[ ${EUID:-$(id -u)} -eq 0 ]]; then
      dest=/usr/local
    else
      dest="$HOME/.local"
    fi
    mkdir -p "$dest" /tmp
    base="https://nodejs.org/dist/latest-v22.x"
    say "installing Node.js 22 from $base → $dest"
    curl -fsSL "$base/SHASUMS256.txt" -o /tmp/node22.sums
    f=$(awk -v a="linux-$arch.tar.xz" '$2 ~ a"$" {print $2}' /tmp/node22.sums)
    [[ -n $f ]] || die "could not find linux-$arch tarball in SHASUMS256.txt"
    curl -fsSL "$base/$f" -o "/tmp/$f"
    sum=$(awk -v name="$f" '$2 == name {print $1}' /tmp/node22.sums)
    echo "$sum  /tmp/$f" | sha256sum -c --quiet
    tar -xJf "/tmp/$f" -C "$dest" --strip-components=1
    export PATH="$dest/bin:$PATH"
    hash -r
    node_ok || die "Node.js ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR}+ still missing after tarball install (found $(node_version 2>/dev/null || echo none))"
    say "node $(node -v), npm $(npm -v)"
  }

  install_rust() {
    command -v curl >/dev/null 2>&1 || die "curl is required to install Rust"
    say "installing Rust via rustup --profile minimal"
    curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal
    # Same run must be able to build the collector.
    # shellcheck disable=SC1091
    . "$HOME/.cargo/env"
    hash -r
    command -v cargo >/dev/null 2>&1 || die "cargo missing after rustup"
    say "$(cargo --version)"
  }

  if (( WITH_DEPS )); then
    if ! is_debian; then
      print_miss
      die "--with-deps is Debian/Ubuntu only; install the missing tools above and re-run without the flag"
    fi
    if (( ${#miss[@]} )); then
      print_miss
      say "installing missing dependencies (--with-deps)"
      run_apt
      export PATH="$HOME/.local/bin:/usr/local/bin:$PATH"
      hash -r
      if ! node_ok || ! command -v npm >/dev/null 2>&1; then
        install_node22
      fi
      if ! command -v cargo >/dev/null 2>&1; then
        install_rust
      fi
    fi
    miss=(); req_fail=0
    command -v git >/dev/null 2>&1 || report req git "git is missing" "$GIT_FIX"
    if ! command -v node >/dev/null 2>&1; then
      report req node "node is missing" "$NODE_FIX"
    elif ! node_ok; then
      report req node "Node.js ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR}+ required (found $(node_version))" "$NODE_FIX"
    fi
    command -v npm >/dev/null 2>&1 || report req npm "npm is missing" "$NPM_FIX"
    command -v cargo >/dev/null 2>&1 || report opt cargo "cargo is missing (collector will be skipped)" "$CARGO_FIX"
    command -v cc >/dev/null 2>&1 || report opt cc "cc is missing (collector will be skipped)" "$CC_FIX"
    if (( req_fail )); then
      print_miss
      die "required tools still missing after --with-deps"
    fi
    if (( ${#miss[@]} )); then
      print_miss
    fi
  else
    if (( ${#miss[@]} )); then
      print_miss
    fi
    if (( req_fail )); then
      die "install the required tools above, or re-run with --with-deps on Debian/Ubuntu"
    fi
  fi

  # --- source ----------------------------------------------------------------
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    say "updating existing clone…"
    git -C "$INSTALL_DIR" pull --ff-only \
      || die "local changes in $INSTALL_DIR block a fast-forward; resolve manually"
  else
    say "cloning…"
    git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
  fi

  cd "$INSTALL_DIR"

  if [[ ! -f .env ]]; then
    cp .env.example .env
    chmod 600 .env
    say "wrote .env from .env.example — edit HOST_ID, Telegram, LLM_*"
  fi

  # --- node deps (reproducible when lockfile exists) -------------------------
  local d
  for d in api web; do
    if [[ -d "$d/node_modules" && -f "$d/package-lock.json" && "$d/node_modules" -nt "$d/package-lock.json" ]]; then
      say "skipping $d npm ci (node_modules newer than package-lock.json)"
      continue
    fi
    say "installing $d deps…"
    if [[ -f "$d/package-lock.json" ]]; then
      (cd "$d" && npm ci --no-audit --no-fund)
    else
      (cd "$d" && npm install --no-audit --no-fund)
    fi
  done

  say "building dashboard (web/dist)…"
  npm run build --prefix web

  # --- collector -------------------------------------------------------------
  if command -v cargo >/dev/null 2>&1 && [[ -f collector/Cargo.toml ]]; then
    say "building collector…"
    if (cd collector && cargo build --release); then
      collector_ok=1
    else
      say "collector build FAILED"
    fi
  fi

  # --- CLI -------------------------------------------------------------------
  [[ -f "$INSTALL_DIR/bin/sentinell" ]] || die "bin/sentinell missing from repo"
  chmod +x "$INSTALL_DIR/bin/sentinell"
  mkdir -p "$BIN_DIR" "$HOME/.local/state/sentinell"
  ln -sfn "$INSTALL_DIR/bin/sentinell" "$BIN_DIR/sentinell"

  # --- post-install checks ---------------------------------------------------
  local warn=()
  (( collector_ok )) || warn+=("collector not built — no SSH log ingestion until you install Rust (https://rustup.rs) and re-run")
  if [[ $(id -u) -ne 0 ]] && ! id -nG | tr ' ' '\n' | grep -qxE 'systemd-journal|adm'; then
    warn+=("user '$me' can't read sshd logs: sudo usermod -aG systemd-journal $me  (then re-login)")
  fi
  case ":$PATH:" in *":$BIN_DIR:"*) ;; *) warn+=("add to PATH: export PATH=\"$BIN_DIR:\$PATH\"") ;; esac

  cat <<EOF

[sentinell] done.

Next:
  1. Edit $INSTALL_DIR/.env  (HOST_ID, TELEGRAM_*, optional LLM_*)
     Or start the API and set the model key in the dashboard Settings page (BYO).
  2. Start API:  cd $INSTALL_DIR/api && npm start
     Start collector (needs journal access; separate shell):
       set -a; . $INSTALL_DIR/.env; set +a
       COLLECTOR_STATE_FILE=\$HOME/.local/state/sentinell/cursor $INSTALL_DIR/collector/target/release/collector
     Production (systemd units, sentinel user, nft runner): bash ops/setup-vps.sh --check
  3. Open the dashboard and create the password. It asks for the one-time setup token:
     sudo cat <data dir>/setup-token   (the API log prints the exact path)
     MCP local:   sentinell mcp
     MCP remote:  sentinell mcp token create --name <agent>
                  then POST https://<host>/mcp with Authorization: Bearer <token>
                  Prefer TLS. See docs/MCP.md (never print a live token here).
     Claude:      claude mcp add sentinell -- sentinell mcp
  4. Health:     sentinell status
  5. Reinstall with deps (Debian/Ubuntu): curl -fsSL https://sentinell.xyz/install.sh | bash -s -- --with-deps
EOF

  if (( ${#warn[@]} )); then
    printf '\n[sentinell] WARNINGS:\n'
    printf '  ! %s\n' "${warn[@]}"
  fi
}

main "$@"
