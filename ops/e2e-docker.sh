#!/usr/bin/env bash
# ops/e2e-docker.sh — end-to-end install test in a throwaway Ubuntu container.
#
#   bash ops/e2e-docker.sh                     test the live site installer, both scenarios
#   bash ops/e2e-docker.sh --source local      test this checkout's committed HEAD (before merge)
#   bash ops/e2e-docker.sh --source raw        test GitHub main (skips the Vercel copy)
#   bash ops/e2e-docker.sh --scenario manual   manual | auto | all   (default: all)
#   bash ops/e2e-docker.sh --shell             keep the container; dashboard on http://localhost:8081
#
# Scenarios:
#   manual  deps installed by hand (git, toolchain, Node 22, rustup); also tests the
#           "no node" and "Node 18" refusals and the re-run/update path.
#   auto    container has only curl; installer runs with --with-deps and must do the rest.
# Both then check: dashboard build, first-run token flow, collector->API replay,
# incidents, unauthenticated /health, and SIGTERM shutdown with a busy connection.
#
# Host needs only docker. Exit 0 = every check passed. Env: E2E_IMAGE, E2E_PORT,
# E2E_EXPECT_INCIDENTS (default 4; use 3 before the 203.0.113.9 fixture fix).
set -euo pipefail

SOURCE=site
SCENARIO=all
SHELL_MODE=0
IMAGE="${E2E_IMAGE:-ubuntu:24.04}"
PORT="${E2E_PORT:-8081}"
EXPECT_INCIDENTS="${E2E_EXPECT_INCIDENTS:-4}"

usage() { sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

while (( $# )); do
  case "$1" in
    --source)   SOURCE="${2:?--source needs a value}"; shift 2 ;;
    --scenario) SCENARIO="${2:?--scenario needs a value}"; shift 2 ;;
    --shell)    SHELL_MODE=1; shift ;;
    -h|--help)  usage 0 ;;
    *) echo "e2e: unknown argument: $1" >&2; usage 2 ;;
  esac
done
case "$SOURCE" in site|raw|local) ;; *) echo "e2e: --source must be site, raw or local" >&2; exit 2 ;; esac
case "$SCENARIO" in manual|auto|all) ;; *) echo "e2e: --scenario must be manual, auto or all" >&2; exit 2 ;; esac
if (( SHELL_MODE )) && [[ $SCENARIO == all ]]; then
  echo "e2e: --shell runs one scenario; using --scenario manual" >&2
  SCENARIO=manual
fi

command -v docker >/dev/null 2>&1 || { echo "e2e: docker not found" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "e2e: docker daemon not reachable (start Docker Desktop, OrbStack or colima)" >&2; exit 1; }

MOUNT=()
if [[ $SOURCE == local ]]; then
  ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
  if [[ -n "$(git -C "$ROOT" status --porcelain)" ]]; then
    echo "e2e: warning: uncommitted changes; the installer clones committed HEAD ($(git -C "$ROOT" rev-parse --short HEAD)) only" >&2
  fi
  MOUNT=(-v "$ROOT:/src:ro")
fi

# ----------------------------------------------------------------------------- inside the container
read -r -d '' INNER <<'EOF' || true
set -uo pipefail
PASS=0; FAIL=0; T0=$(date +%s)
ok()      { printf '  \033[32mPASS\033[0m %s\n' "$*"; PASS=$((PASS+1)); }
bad()     { printf '  \033[31mFAIL\033[0m %s\n' "$*"; FAIL=$((FAIL+1)); }
step()    { printf '\n\033[1m== [%s] %s ==\033[0m\n' "$SCEN" "$*"; }
summary() { printf '\n\033[1m[%s] RESULT: %d passed, %d failed (%ss)\033[0m\n' "$SCEN" "$PASS" "$FAIL" "$(( $(date +%s) - T0 ))"; }
shell_or_exit() { summary; if [ "$SHELLMODE" = 1 ]; then echo "logs: /tmp/*.log"; exec bash; fi; exit "$1"; }
fatal()   {
  bad "$*"
  local f
  for f in /tmp/install-auto.log /tmp/install-auto2.log /tmp/install-1.log /tmp/install-2.log /tmp/api.log; do
    if [ -s "$f" ]; then
      echo "----- $f -----"
      cat "$f"
    fi
  done
  shell_or_exit 1
}
has()     { grep -qF -- "$2" "$1" 2>/dev/null; }

SITE_URL=https://sentinell.xyz/install.sh
RAW_URL=https://raw.githubusercontent.com/Roukurai/blackHatSentinel/main/ops/install.sh

run_install() {  # run_install LOGFILE [installer args...]
  local log=$1; shift
  case "$SRC" in
    site)  curl -fsSL "$SITE_URL" | bash -s -- "$@" >"$log" 2>&1 ;;
    raw)   curl -fsSL "$RAW_URL"  | bash -s -- "$@" >"$log" 2>&1 ;;
    local) SENTINELL_REPO_URL=/src bash /src/ops/install.sh "$@" >"$log" 2>&1 ;;
  esac
}

node_get() {  # node_get MAJOR DEST  (official tarball, sha256-verified)
  local arch base f sum
  arch=$(dpkg --print-architecture | sed 's/amd64/x64/')
  base="https://nodejs.org/dist/latest-v$1.x"
  curl -fsSL "$base/SHASUMS256.txt" -o /tmp/node$1.sums || return 1
  f=$(awk -v a="linux-$arch.tar.xz" '$2 ~ a"$" {print $2}' /tmp/node$1.sums)
  [ -n "$f" ] || return 1
  curl -fsSL "$base/$f" -o "/tmp/$f" || return 1
  sum=$(awk -v f="$f" '$2 == f {print $1}' /tmp/node$1.sums)
  echo "$sum  /tmp/$f" | sha256sum -c --quiet || return 1
  mkdir -p "$2" && tar -xJf "/tmp/$f" -C "$2" --strip-components=1
}

# --------------------------------------------------------------------------- base
step "base: curl only"
{ apt-get update -qq && apt-get install -y -qq --no-install-recommends curl ca-certificates; } >/tmp/apt.log 2>&1 \
  && ok "curl + ca-certificates" || fatal "apt failed (see /tmp/apt.log)"
case "$SRC" in
  site) echo "  installer: $SITE_URL  sha256 $(curl -fsSL "$SITE_URL" | sha256sum | cut -c1-16)…" ;;
  raw)  echo "  installer: $RAW_URL  sha256 $(curl -fsSL "$RAW_URL" | sha256sum | cut -c1-16)…" ;;
  local) echo "  installer: /src/ops/install.sh (repo HEAD $(git -C /src rev-parse --short HEAD 2>/dev/null || echo '?'))" ;;
esac

# --------------------------------------------------------------------------- scenarios
if [ "$SCEN" = manual ]; then
  step "manual: base toolchain"
  apt-get install -y -qq --no-install-recommends git xz-utils build-essential >>/tmp/apt.log 2>&1 \
    && ok "git xz-utils build-essential" || fatal "apt failed (see /tmp/apt.log)"
  git config --global --add safe.directory '*'

  step "guard: no node"
  run_install /tmp/install-nonode.log; rc=$?
  if [ $rc -ne 0 ] && has /tmp/install-nonode.log "node"; then ok "refuses without node (exit $rc)"; else bad "expected refusal mentioning node (rc=$rc, /tmp/install-nonode.log)"; fi

  step "guard: Node 18"
  node_get 18 /opt/node18 || fatal "Node 18 download/verify failed"
  PATH=/opt/node18/bin:$PATH run_install /tmp/install-node18.log; rc=$?
  if [ $rc -ne 0 ] && has /tmp/install-node18.log "22.18"; then ok "refuses Node 18 (exit $rc)"; else bad "expected 'Node 22.18+' refusal (rc=$rc, /tmp/install-node18.log)"; fi
  [ ! -d "$HOME/sentinell" ] && ok "nothing cloned on refusal" || bad "clone exists after refusal"

  step "Node 22"
  node_get 22 /usr/local || fatal "Node 22 download/verify failed"
  hash -r
  case "$(node -v)" in v22.*) ok "node $(node -v), npm $(npm -v)" ;; *) fatal "node is $(node -v)" ;; esac

  step "install #1 (no Rust)"
  run_install /tmp/install-1.log; rc=$?
  [ $rc -eq 0 ] && ok "exit 0" || fatal "install failed rc=$rc (see /tmp/install-1.log)"
  has /tmp/install-1.log "collector not built" && ok "warns: collector not built" || bad "missing collector warning"

  step "Rust"
  curl --proto '=https' -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal >/tmp/rustup.log 2>&1 \
    && . "$HOME/.cargo/env" && ok "$(cargo --version)" || fatal "rustup failed (see /tmp/rustup.log)"

  step "install #2 (re-run with Rust)"
  run_install /tmp/install-2.log; rc=$?
  [ $rc -eq 0 ] && ok "exit 0" || fatal "re-run failed rc=$rc (see /tmp/install-2.log)"
  has /tmp/install-2.log "updating existing clone" && ok "takes the update path" || bad "did not take the update path"
  has /tmp/install-2.log "collector not built" && bad "collector still not built" || ok "collector built"
  LAST=/tmp/install-2.log
else
  step "auto: install --with-deps (only curl present)"
  run_install /tmp/install-auto.log --with-deps; rc=$?
  [ $rc -eq 0 ] && ok "exit 0" || fatal "install --with-deps failed rc=$rc (see /tmp/install-auto.log)"
  [ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
  export PATH="$HOME/.local/bin:/usr/local/bin:$PATH"; hash -r
  command -v git >/dev/null && ok "git installed" || bad "git missing"
  case "$(node -v 2>/dev/null)" in v22.*|v2[3-9].*) ok "node $(node -v)" ;; *) bad "node missing or too old" ;; esac
  has /tmp/install-auto.log "collector not built" && bad "collector not built" || ok "collector built"

  step "auto: re-run is idempotent"
  run_install /tmp/install-auto2.log --with-deps; rc=$?
  [ $rc -eq 0 ] && ok "exit 0" || bad "re-run failed rc=$rc (see /tmp/install-auto2.log)"
  has /tmp/install-auto2.log "updating existing clone" && ok "takes the update path" || bad "did not take the update path"
  LAST=/tmp/install-auto.log
fi

# --------------------------------------------------------------------------- common checks
step "layout"
APP="$HOME/sentinell"
[ -f "$APP/web/dist/index.html" ] && ok "dashboard built" || bad "web/dist/index.html missing"
[ -x "$APP/collector/target/release/collector" ] && ok "collector binary" || bad "collector binary missing"
[ -x "$HOME/.local/bin/sentinell" ] && ok "CLI linked" || bad "~/.local/bin/sentinell missing"
[ "$(stat -c %a "$APP/.env" 2>/dev/null)" = 600 ] && ok ".env is 600" || bad ".env mode is $(stat -c %a "$APP/.env" 2>/dev/null)"
has "$LAST" "unbound variable" && bad "unbound variable in installer output" || ok "no unbound-variable errors"
has "$LAST" "can't read sshd logs" && bad "journal warning shown for root" || ok "no journal warning for root"
export PATH="$HOME/.local/bin:$PATH"

step "API"
cd "$APP/api" && { nohup node --experimental-strip-types src/index.ts >/tmp/api.log 2>&1 & echo $! >/tmp/api.pid; }; cd /
for _ in $(seq 1 40); do curl -fs localhost:8080/auth/status >/tmp/status.json 2>/dev/null && break; sleep 0.5; done
has /tmp/status.json '"configured":false' && ok "up; first run not configured" || fatal "API not up (see /tmp/api.log)"
has /tmp/api.log "setup-token" && ok "logs setup-token path" || bad "no setup-token line in /tmp/api.log"
[ -f "$APP/data/setup-token" ] && ok "setup token created" || bad "setup token missing"
code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Accept: text/html' localhost:8080/)
[ "$code" = 200 ] && ok "dashboard served (200)" || bad "dashboard returned $code"
sentinell status >/tmp/status-cli.txt 2>&1 && ok "sentinell status works unauthenticated" || bad "sentinell status failed (see /tmp/status-cli.txt)"

step "first-run setup"
post_setup() { curl -s -o "$1" -w '%{http_code}' -c /tmp/cookies -H 'content-type: application/json' -d "$2" localhost:8080/setup; }
code=$(post_setup /tmp/setup-bad.json '{"setup_token":"wrong","username":"e2e","password":"e2e-pass-1234"}')
[ "$code" = 403 ] && ok "wrong token rejected (403)" || bad "wrong token returned $code"
TOKEN=$(tr -d '\n' <"$APP/data/setup-token" 2>/dev/null)
code=$(post_setup /tmp/setup.json "{\"setup_token\":\"$TOKEN\",\"username\":\"e2e\",\"password\":\"e2e-pass-1234\"}")
case "$code" in 2??) ok "setup accepted ($code)" ;; *) bad "setup returned $code ($(cat /tmp/setup.json))" ;; esac
[ ! -e "$APP/data/setup-token" ] && ok "token consumed" || bad "token still on disk"
curl -fs localhost:8080/auth/status | grep -qF '"configured":true' && ok "configured" || bad "not configured after setup"
grep -q sentinel_session /tmp/cookies && ok "session cookie issued" || bad "no session cookie"

step "collector -> API (replay fixtures)"
( set -a; . "$APP/.env"; set +a
  COLLECTOR_MODE=replay COLLECTOR_REPLAY_FILE="$APP/collector/tests/fixtures.jsonl" COLLECTOR_STATE_FILE= \
    timeout 60 "$APP/collector/target/release/collector" ) >/tmp/replay.log 2>&1
has /tmp/replay.log "accepted=34" && ok "34 events accepted" || bad "replay: $(tail -1 /tmp/replay.log)"

step "incidents"
sleep 1
curl -fs -b /tmp/cookies localhost:8080/incidents >/tmp/incidents.json
n=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).length)}catch{console.log(-1)}})' </tmp/incidents.json)
[ "$n" = "$EXPECT" ] && ok "$n incidents" || bad "expected $EXPECT incidents, got $n"
for ip in 192.0.2.50 203.0.113.9 203.0.113.77 203.0.113.200; do
  grep -qF "\"$ip\"" /tmp/incidents.json && ok "incident for $ip" || bad "no incident for $ip"
done

if [ "$SHELLMODE" = 1 ]; then
  printf '\nDashboard: http://localhost:%s  (login e2e / e2e-pass-1234)\n' "$PORT"
  shell_or_exit 0
fi

step "shutdown with a busy connection"
pid=$(cat /tmp/api.pid)
( exec 3<>/dev/tcp/127.0.0.1/8080; printf 'GET /auth/status HTTP/1.1\r\nHost: e2e\r\n' >&3; sleep 30 ) &
holder=$!
sleep 1
kill -TERM "$pid"
t=0; while kill -0 "$pid" 2>/dev/null && [ $t -lt 30 ]; do sleep 0.1; t=$((t+1)); done
if kill -0 "$pid" 2>/dev/null; then bad "API still running 3s after SIGTERM"; kill -9 "$pid"; else ok "API exited $((t*100))ms after SIGTERM"; fi
kill "$holder" 2>/dev/null

shell_or_exit $(( FAIL > 0 ))
EOF

# ----------------------------------------------------------------------------- run
run_one() {
  local scen=$1 tty=(-i) ports=()
  if (( SHELL_MODE )); then tty=(-it); ports=(-p "127.0.0.1:$PORT:8080"); fi
  docker run --rm "${tty[@]}" ${ports[@]+"${ports[@]}"} ${MOUNT[@]+"${MOUNT[@]}"} \
    -e DEBIAN_FRONTEND=noninteractive -e TZ=UTC \
    -e SRC="$SOURCE" -e SCEN="$scen" -e EXPECT="$EXPECT_INCIDENTS" -e SHELLMODE="$SHELL_MODE" -e PORT="$PORT" \
    "$IMAGE" bash -c "$INNER"
}

overall=0
if [[ $SCENARIO == all ]]; then list="manual auto"; else list="$SCENARIO"; fi
for s in $list; do
  echo "=== e2e: scenario=$s source=$SOURCE image=$IMAGE ==="
  run_one "$s" || overall=1
done
if (( overall )); then echo "=== e2e: FAILED ==="; else echo "=== e2e: ALL PASSED ==="; fi
exit "$overall"