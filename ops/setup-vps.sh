#!/usr/bin/env bash
# VPS bootstrap for ubuntu-01. Run as rou (passwordless sudo). No new packages.
#
#   bash ops/setup-vps.sh --check
#   bash ops/setup-vps.sh --apply --allow <team-ip> ...
#   bash ops/setup-vps.sh --apply --start
#   bash ops/setup-vps.sh --demo-user
#   bash ops/setup-vps.sh --verify
set -euo pipefail

REPO=/opt/sentinell
REPO_URL=https://github.com/Roukurai/blackHatSentinel.git
DATA=/var/lib/sentinel
ENV_FILE=$REPO/.env
VPS_IP=161.97.73.23
CARGO="${CARGO:-$HOME/.cargo/bin/cargo}"
NODE=/usr/local/bin/node
COLLECTOR_BIN=/usr/local/bin/sentinel-collector
RUNNER_BIN=/usr/local/sbin/sentinel-block
SUDOERS_FILE=/etc/sudoers.d/sentinel-block
ALLOWLIST_FILE=/etc/sentinel/allowlist
API_UNIT=/etc/systemd/system/sentinel-api.service
COLLECTOR_UNIT=/etc/systemd/system/sentinel-collector.service
ENABLE_CMD="sudo systemctl enable --now sentinel-api.service sentinel-collector.service"

MODE=          # check | apply
DO_START=0
DO_DEMO=0
DO_VERIFY=0
ALLOW_GIVEN=0
ALLOW_ITEMS=()

usage() {
  cat <<'EOF' >&2
usage: ops/setup-vps.sh --check | --apply [--allow <ip|cidr> ...] [--start] [--demo-user] [--verify]
       ops/setup-vps.sh --demo-user
       ops/setup-vps.sh --verify
EOF
  exit 2
}

ok() { printf 'OK %s\n' "$1"; }
diff_line() { printf 'DIFF: %s → %s\n' "$1" "$2"; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "setup-vps: missing command: $1" >&2
    exit 1
  }
}

# --- argv ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)
      [[ -z $MODE || $MODE == check ]] || { echo "setup-vps: --check and --apply are exclusive" >&2; exit 2; }
      MODE=check
      shift
      ;;
    --apply)
      [[ -z $MODE || $MODE == apply ]] || { echo "setup-vps: --check and --apply are exclusive" >&2; exit 2; }
      MODE=apply
      shift
      ;;
    --start) DO_START=1; shift ;;
    --demo-user) DO_DEMO=1; shift ;;
    --verify) DO_VERIFY=1; shift ;;
    --allow)
      [[ $# -ge 2 ]] || usage
      ALLOW_GIVEN=1
      ALLOW_ITEMS+=("$2")
      shift 2
      ;;
    -h|--help) usage ;;
    *) echo "setup-vps: unknown argument: $1" >&2; usage ;;
  esac
done

if [[ -z $MODE ]]; then
  if [[ $DO_DEMO -eq 1 || $DO_VERIFY -eq 1 ]]; then
    MODE=none
  else
    MODE=check
  fi
fi

if [[ $DO_START -eq 1 && $MODE != apply ]]; then
  echo "setup-vps: --start requires --apply" >&2
  exit 2
fi

if [[ $MODE == apply && $(uname -s) != Linux ]]; then
  echo "setup-vps: --apply is for ubuntu-01 (Linux) only" >&2
  exit 1
fi

if [[ $MODE == apply && ${EUID:-$(id -u)} -eq 0 ]]; then
  echo "setup-vps: run as rou (uses sudo), not as root" >&2
  exit 1
fi

# --- allowlist (VPS IP always first; --allow order preserved; unique) ---
validate_allow() {
  local item=$1
  python3 - "$item" <<'PY'
import ipaddress, sys
s = sys.argv[1]
try:
    if "/" in s:
        net = ipaddress.ip_network(s, strict=False)
        if net.version == 6:
            sys.exit("setup-vps: IPv6 CIDR is not supported in the allowlist")
    else:
        ipaddress.ip_address(s)
except ValueError as e:
    sys.exit(f"setup-vps: invalid --allow {s}: {e}")
PY
}

ALLOW_LIST=("$VPS_IP")
if [[ $ALLOW_GIVEN -eq 1 ]]; then
  for item in "${ALLOW_ITEMS[@]}"; do
    validate_allow "$item"
    dup=0
    for existing in "${ALLOW_LIST[@]}"; do
      [[ $existing == "$item" ]] && dup=1 && break
    done
    [[ $dup -eq 0 ]] && ALLOW_LIST+=("$item")
  done
fi
IFS=','; ALLOW_CSV="${ALLOW_LIST[*]}"; unset IFS

allowlist_body() {
  printf '%s\n' '# Sentinel response allowlist — VPS + team. Never block these.'
  printf '%s\n' "${ALLOW_LIST[@]}"
}

sudoers_body() {
  printf '%s\n' 'sentinel ALL=(root) NOPASSWD: /usr/local/sbin/sentinel-block'
}

api_unit_body() {
  cat <<EOF
[Unit]
Description=Sentinel API
After=network-online.target
Wants=network-online.target

[Service]
User=sentinel
Group=sentinel
WorkingDirectory=${REPO}/api
ExecStart=${NODE} --experimental-strip-types src/index.ts
Restart=always
RestartSec=2
NoNewPrivileges=no
ReadWritePaths=${DATA}

[Install]
WantedBy=multi-user.target
EOF
}

collector_unit_body() {
  cat <<EOF
[Unit]
Description=Sentinel collector
After=sentinel-api.service
Wants=sentinel-api.service

[Service]
User=sentinel
Group=sentinel
ExecStart=/bin/bash -c 'set -a; . ${REPO}/.env; set +a; export COLLECTOR_MODE=live; exec ${COLLECTOR_BIN}'
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
}

# Read-only sudo: never prompt in --check.
sudo_n() { sudo -n "$@"; }

stat_ugm() {
  local path=$1
  if [[ "$(uname -s)" == Darwin ]]; then
    stat -f '%Su:%Sg %OLp' "$path"
  else
    stat -c '%U:%G %a' "$path"
  fi
}

try_stat_ugm() {
  local path=$1
  if [[ -e $path ]]; then
    stat_ugm "$path"
    return 0
  fi
  if sudo_n test -e "$path" 2>/dev/null; then
    sudo_n stat -c '%U:%G %a' "$path"
    return 0
  fi
  return 1
}

try_cat() {
  local path=$1
  if [[ -r $path ]]; then
    cat "$path"
    return 0
  fi
  sudo_n cat "$path" 2>/dev/null
}

ensure_dir() {
  local path=$1 owner=$2 mode=$3
  sudo mkdir -p "$path"
  sudo chown "$owner" "$path"
  sudo chmod "$mode" "$path"
}

install_file_if_diff() {
  local dest=$1 mode=$2 owner=$3
  local tmp
  tmp=$(mktemp)
  cat >"$tmp"
  if sudo_n test -e "$dest" 2>/dev/null && sudo_n cmp -s "$tmp" "$dest" 2>/dev/null; then
    rm -f "$tmp"
    return 1
  fi
  if [[ -e $dest ]] && cmp -s "$tmp" "$dest" 2>/dev/null; then
    rm -f "$tmp"
    return 1
  fi
  sudo install -m "$mode" -o "${owner%%:*}" -g "${owner##*:}" "$tmp" "$dest"
  rm -f "$tmp"
  return 0
}

# Env rewrite: set listed keys when empty/missing (or still .env.example placeholders).
# Never prints values. RESPONSE_ALLOWLIST is forced when --allow was given.
env_rewrite() {
  local action=$1   # check | apply
  python3 - "$ENV_FILE" "$action" "$ALLOW_GIVEN" "$ALLOW_CSV" <<'PY'
import pathlib, sys

path = pathlib.Path(sys.argv[1])
action = sys.argv[2]
allow_given = sys.argv[3] == "1"
allow_csv = sys.argv[4]

targets = [
    ("HOST_ID", "ubuntu-01"),
    ("API_BIND", "0.0.0.0"),
    ("API_PORT", "8080"),
    ("API_URL", "http://127.0.0.1:8080"),
    ("PUBLIC_BASE_URL", "http://161.97.73.23:8080"),
    ("DB_PATH", "/var/lib/sentinel/sentinel.db"),
    ("WEB_DIST", "web/dist"),
    ("COLLECTOR_MODE", "live"),
    ("COLLECTOR_STATE_FILE", "/var/lib/sentinel/cursor"),
    ("RESPONSE_RUNNER", "/usr/local/sbin/sentinel-block"),
    ("RESPONSE_RUNNER_SUDO", "1"),
    ("RESPONSE_BLOCK_TTL_SECONDS", "600"),
]
placeholders = {
    "PUBLIC_BASE_URL": "http://<vps-ip>:8080",
    "DB_PATH": "./data/sentinel.db",
    "RESPONSE_RUNNER_SUDO": "0",
}
required_empty = ["DASHBOARD_USER", "DASHBOARD_PASS", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"]

def split_value(rest: str):
    idx = rest.find(" #")
    if idx == -1:
        return rest.strip(), ""
    return rest[:idx].rstrip(), rest[idx:]

def parse(text: str):
    values = {}
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, rest = stripped.split("=", 1)
        key = key.strip()
        val, _ = split_value(rest)
        values[key] = val
    return values

def upsert(text: str, key: str, value: str) -> str:
    lines = text.splitlines()
    found = False
    out = []
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            out.append(line)
            continue
        k, rest = stripped.split("=", 1)
        if k.strip() != key:
            out.append(line)
            continue
        found = True
        _, comment = split_value(rest)
        out.append(f"{key}={value}{comment}")
    if not found:
        if out and out[-1] != "":
            out.append("")
        out.append(f"{key}={value}")
    return "\n".join(out) + "\n"

if not path.is_file():
    print(f"DIFF: {path} missing → copy .env.example and fill VPS keys")
    sys.exit(0)

text = path.read_text()
values = parse(text)
changed = []

def should_set(key, current, target, force=False):
    if current == target:
        return False
    if force or current is None or current == "":
        return True
    if placeholders.get(key) == current:
        return True
    return False

plan = list(targets)
if allow_given:
    plan.append(("RESPONSE_ALLOWLIST", allow_csv))

new_text = text
for key, target in plan:
    current = values.get(key)
    force = key == "RESPONSE_ALLOWLIST" and allow_given
    if should_set(key, current, target, force=force):
        cur = "missing" if current is None else ("empty" if current == "" else "different")
        changed.append((key, cur, target))
        new_text = upsert(new_text, key, target)

if action == "check":
    if not changed:
        print("OK env keys (VPS defaults present; non-empty values not overwritten)")
    else:
        for key, cur, target in changed:
            print(f"DIFF: {key} {cur} → {target}")
else:
    if changed:
        path.write_text(new_text)

empty = [k for k in required_empty if not values.get(k)]
# re-parse after write
if action == "apply" and changed:
    values = parse(new_text)
    empty = [k for k in required_empty if not values.get(k)]
print("EMPTY required: " + (" ".join(empty) if empty else "(none)"))
print("optional (dashboard Settings): LLM_API_KEY")
PY
}

phase1_repo() {
  echo "== phase 1 repo =="
  local ugm
  if ugm=$(try_stat_ugm "$REPO" 2>/dev/null); then
    if [[ $ugm == "rou:sentinel 2750" ]]; then
      ok "repo dir $REPO ($ugm)"
    else
      diff_line "$REPO $ugm" "rou:sentinel 2750"
      if [[ $MODE == apply ]]; then
        sudo chown rou:sentinel "$REPO"
        sudo chmod 2750 "$REPO"
      fi
    fi
  else
    diff_line "$REPO missing" "dir rou:sentinel 2750"
    if [[ $MODE == apply ]]; then
      ensure_dir "$REPO" rou:sentinel 2750
    fi
  fi

  local gitdir=$REPO/.git
  if [[ $MODE == check ]]; then
    if sudo_n test -d "$gitdir" 2>/dev/null || [[ -d $gitdir ]]; then
      local url
      url=$(try_cat "$REPO/.git/config" 2>/dev/null | awk -F' = ' '/url = /{print $2; exit}' || true)
      if [[ $url == "$REPO_URL" ]]; then
        ok "git clone $REPO_URL"
      else
        diff_line "git remote '${url:-unknown}'" "$REPO_URL"
      fi
    else
      diff_line "no clone at $REPO" "git clone $REPO_URL"
    fi
    return 0
  fi

  if [[ ! -d $REPO/.git ]]; then
    if [[ -n $(ls -A "$REPO" 2>/dev/null || true) ]]; then
      echo "setup-vps: $REPO exists but is not a git clone; refusing to reset" >&2
      exit 1
    fi
    git clone "$REPO_URL" "$REPO"
  else
    git -C "$REPO" pull --ff-only
  fi
  sudo chown -R rou:sentinel "$REPO"
  sudo chmod 2750 "$REPO"
  ok "repo $REPO"
}

phase2_env() {
  echo "== phase 2 env =="
  local ugm
  if ugm=$(try_stat_ugm "$DATA" 2>/dev/null); then
    if [[ $ugm == "sentinel:sentinel 755" ]]; then
      ok "data dir $DATA ($ugm)"
    else
      diff_line "$DATA $ugm" "sentinel:sentinel 755"
      if [[ $MODE == apply ]]; then
        sudo chown sentinel:sentinel "$DATA"
        sudo chmod 755 "$DATA"
      fi
    fi
  else
    diff_line "$DATA missing" "dir sentinel:sentinel 755"
    if [[ $MODE == apply ]]; then
      ensure_dir "$DATA" sentinel:sentinel 755
    fi
  fi

  if [[ $MODE == check ]]; then
    if ! sudo_n test -f "$ENV_FILE" 2>/dev/null && [[ ! -f $ENV_FILE ]]; then
      diff_line "$ENV_FILE missing" "copy $REPO/.env.example"
      echo "EMPTY required: DASHBOARD_USER DASHBOARD_PASS TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID"
      echo "optional (dashboard Settings): LLM_API_KEY"
      return 0
    fi
    env_rewrite check
    if ugm=$(try_stat_ugm "$ENV_FILE" 2>/dev/null); then
      if [[ $ugm == "rou:sentinel 640" ]]; then
        ok "$ENV_FILE mode ($ugm)"
      else
        diff_line "$ENV_FILE $ugm" "rou:sentinel 640"
      fi
    fi
    return 0
  fi

  if [[ ! -f $ENV_FILE ]]; then
    [[ -f $REPO/.env.example ]] || { echo "setup-vps: missing $REPO/.env.example" >&2; exit 1; }
    cp "$REPO/.env.example" "$ENV_FILE"
  fi
  env_rewrite apply
  sudo chown rou:sentinel "$ENV_FILE"
  sudo chmod 0640 "$ENV_FILE"
  ok "$ENV_FILE"
}

newer_than() {
  local out=$1
  shift
  [[ -e $out ]] || return 1
  local f
  for f in "$@"; do
    [[ -e $f ]] || continue
    if [[ $f -nt $out ]]; then
      return 1
    fi
  done
  return 0
}

phase3_build() {
  echo "== phase 3 build =="
  if [[ $MODE == check ]]; then
    if [[ -d $REPO/api/node_modules ]]; then ok "api node_modules"; else diff_line "api node_modules missing" "npm ci --prefix $REPO/api"; fi
    if [[ -d $REPO/web/node_modules ]]; then ok "web node_modules"; else diff_line "web node_modules missing" "npm ci --prefix $REPO/web"; fi
    if [[ -f $REPO/web/dist/index.html ]]; then ok "web dist"; else diff_line "web/dist missing" "npm run build --prefix $REPO/web"; fi
    if [[ -x $REPO/collector/target/release/collector ]]; then ok "collector release binary"; else diff_line "collector binary missing" "cargo build --release"; fi
    if sudo_n test -x "$COLLECTOR_BIN" 2>/dev/null || [[ -x $COLLECTOR_BIN ]]; then
      ok "$COLLECTOR_BIN"
    else
      diff_line "$COLLECTOR_BIN missing" "install collector"
    fi
    return 0
  fi

  need_cmd npm
  [[ -x $NODE ]] || { echo "setup-vps: $NODE not found" >&2; exit 1; }
  [[ -x $CARGO ]] || { echo "setup-vps: cargo not found at $CARGO" >&2; exit 1; }

  if newer_than "$REPO/api/node_modules" "$REPO/api/package-lock.json"; then
    ok "api npm ci (skip, node_modules newer than lock)"
  else
    npm ci --prefix "$REPO/api"
  fi
  if newer_than "$REPO/web/node_modules" "$REPO/web/package-lock.json"; then
    ok "web npm ci (skip, node_modules newer than lock)"
  else
    npm ci --prefix "$REPO/web"
  fi
  if newer_than "$REPO/web/dist/index.html" "$REPO/web/package.json" "$REPO/web/index.html"; then
    ok "web build (skip, dist newer than inputs)"
  else
    npm run build --prefix "$REPO/web"
  fi
  if newer_than "$REPO/collector/target/release/collector" "$REPO/collector/Cargo.lock"; then
    ok "cargo build (skip, binary newer than Cargo.lock)"
  else
    (cd "$REPO/collector" && "$CARGO" build --release)
  fi
  sudo install -m 0755 -o root -g root "$REPO/collector/target/release/collector" "$COLLECTOR_BIN"
  ok "$COLLECTOR_BIN"
}

phase4_runner() {
  echo "== phase 4 runner =="
  local src=$REPO/ops/sentinel-block
  if [[ $MODE == check ]]; then
    if sudo_n test -x "$RUNNER_BIN" 2>/dev/null || [[ -x $RUNNER_BIN ]]; then
      ok "$RUNNER_BIN"
    else
      diff_line "$RUNNER_BIN missing" "install $src"
    fi
    local sudocontent
    sudocontent=$(try_cat "$SUDOERS_FILE" 2>/dev/null || true)
    if [[ $sudocontent == "$(sudoers_body)" ]]; then
      ok "$SUDOERS_FILE"
    else
      diff_line "${SUDOERS_FILE} ${sudocontent:-missing}" "sentinel NOPASSWD sentinel-block"
    fi
    local allc
    allc=$(try_cat "$ALLOWLIST_FILE" 2>/dev/null || true)
    if [[ $allc == "$(allowlist_body)" ]]; then
      ok "$ALLOWLIST_FILE"
    else
      diff_line "$ALLOWLIST_FILE differs or missing" "VPS IP + --allow entries"
    fi
    return 0
  fi

  [[ -f $src ]] || { echo "setup-vps: missing $src" >&2; exit 1; }
  sudo install -m 0755 -o root -g root "$src" "$RUNNER_BIN"

  local tmp
  tmp=$(mktemp)
  sudoers_body >"$tmp"
  sudo visudo -cf "$tmp" >/dev/null
  sudo install -m 0440 -o root -g root "$tmp" "$SUDOERS_FILE"
  rm -f "$tmp"

  sudo mkdir -p /etc/sentinel
  sudo chown root:root /etc/sentinel
  sudo chmod 0755 /etc/sentinel

  tmp=$(mktemp)
  allowlist_body >"$tmp"
  if sudo_n test -e "$ALLOWLIST_FILE" 2>/dev/null && sudo_n cmp -s "$tmp" "$ALLOWLIST_FILE" 2>/dev/null; then
    rm -f "$tmp"
    ok "$ALLOWLIST_FILE (unchanged)"
  else
    sudo install -m 0644 -o root -g root "$tmp" "$ALLOWLIST_FILE"
    rm -f "$tmp"
    ok "$ALLOWLIST_FILE"
  fi
}

phase5_systemd() {
  echo "== phase 5 systemd =="
  local reload=0
  if [[ $MODE == check ]]; then
    local cur
    cur=$(try_cat "$API_UNIT" 2>/dev/null || true)
    if [[ $cur == "$(api_unit_body)" ]]; then
      ok "$API_UNIT"
    else
      diff_line "$API_UNIT differs or missing" "sentinel-api.service"
    fi
    cur=$(try_cat "$COLLECTOR_UNIT" 2>/dev/null || true)
    if [[ $cur == "$(collector_unit_body)" ]]; then
      ok "$COLLECTOR_UNIT"
    else
      diff_line "$COLLECTOR_UNIT differs or missing" "sentinel-collector.service"
    fi
    echo "start command (not run in --check): $ENABLE_CMD"
    return 0
  fi

  if install_file_if_diff "$API_UNIT" 0644 root:root <<<"$(api_unit_body)"; then
    ok "wrote $API_UNIT"
    reload=1
  else
    ok "$API_UNIT (unchanged)"
  fi
  if install_file_if_diff "$COLLECTOR_UNIT" 0644 root:root <<<"$(collector_unit_body)"; then
    ok "wrote $COLLECTOR_UNIT"
    reload=1
  else
    ok "$COLLECTOR_UNIT (unchanged)"
  fi
  if [[ $reload -eq 1 ]]; then
    sudo systemctl daemon-reload
    ok "systemctl daemon-reload"
  fi

  if [[ $DO_START -eq 1 ]]; then
    sudo systemctl enable --now sentinel-api.service sentinel-collector.service
    ok "enabled and started api + collector"
  else
    echo "not starting; run: $ENABLE_CMD"
  fi
}

do_demo_user() {
  echo "== demo-user =="
  if [[ ! -t 0 ]]; then
    echo "setup-vps: --demo-user needs a tty (password is read with read -rs, never argv)" >&2
    exit 1
  fi
  local script=$REPO/ops/enable-demo-user.sh
  [[ -f $script ]] || { echo "setup-vps: missing $script" >&2; exit 1; }
  local pw
  printf 'demo user password (input hidden): ' >&2
  read -rs pw
  printf '\n' >&2
  sudo bash "$script" "$pw"
  unset pw
}

pass_fail() {
  local name=$1 want=$2 rc=$3
  if [[ $rc -eq $want ]]; then
    echo "PASS $name (rc=$rc)"
  else
    echo "FAIL $name (want rc=$want got rc=$rc)"
  fi
}

do_verify() {
  echo "== verify =="
  local code
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8080/health || true)
  echo "GET /health http_code=$code (expect 401 without auth or 200)"

  echo -n "sentinel-api: "; systemctl is-active sentinel-api.service || true
  echo -n "sentinel-collector: "; systemctl is-active sentinel-collector.service || true
  echo "--- journalctl -u sentinel-collector -n 5 ---"
  journalctl -u sentinel-collector -n 5 --no-pager || true

  local rc
  set +e
  sudo -u sentinel sudo -n "$RUNNER_BIN" block 192.0.2.50 60
  rc=$?
  set -e
  pass_fail "block 192.0.2.50 60" 0 "$rc"

  set +e
  sudo -u sentinel sudo -n "$RUNNER_BIN" verify 192.0.2.50
  rc=$?
  set -e
  pass_fail "verify blocked" 0 "$rc"

  set +e
  sudo -u sentinel sudo -n "$RUNNER_BIN" unblock 192.0.2.50
  rc=$?
  set -e
  pass_fail "unblock 192.0.2.50" 0 "$rc"

  set +e
  sudo -u sentinel sudo -n "$RUNNER_BIN" verify 192.0.2.50
  rc=$?
  set -e
  pass_fail "verify unblocked" 1 "$rc"

  echo "--- journal access (sentinel) ---"
  sudo -u sentinel journalctl -u ssh -n 1 --no-pager || true

  local pub
  pub=$(python3 - "$ENV_FILE" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
if not p.is_file():
    print("PUBLIC_BASE_URL=<missing .env>")
    raise SystemExit
for line in p.read_text().splitlines():
    s = line.strip()
    if s.startswith("PUBLIC_BASE_URL="):
        rest = s.split("=", 1)[1]
        i = rest.find(" #")
        if i != -1:
            rest = rest[:i]
        print("PUBLIC_BASE_URL=" + rest.strip())
        break
else:
    print("PUBLIC_BASE_URL=<unset>")
PY
)
  echo "$pub"
  echo "Open PUBLIC_BASE_URL from a phone; a basic-auth prompt is expected once DASHBOARD_USER/DASHBOARD_PASS are set."
}

# --- run ---
need_cmd python3
need_cmd git

if [[ $MODE == check ]]; then
  echo "setup-vps --check (read-only; no writes)"
  phase1_repo
  phase2_env
  phase3_build
  phase4_runner
  phase5_systemd
elif [[ $MODE == apply ]]; then
  echo "setup-vps --apply"
  need_cmd sudo
  phase1_repo
  phase2_env
  phase3_build
  phase4_runner
  phase5_systemd
fi

if [[ $DO_DEMO -eq 1 ]]; then
  do_demo_user
fi
if [[ $DO_VERIFY -eq 1 ]]; then
  do_verify
fi
