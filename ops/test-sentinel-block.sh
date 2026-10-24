#!/usr/bin/env bash
# Tests for ops/sentinel-block. Default: unprivileged fake nft stub.
# Real nftables: sudo TEST_REAL_NFT=1 bash ops/test-sentinel-block.sh
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
BLOCK="$ROOT/ops/sentinel-block"
pass=0
fail=0
skip=0

assert_rc() {
  local want=$1 desc=$2
  shift 2
  local rc=0
  set +e
  "$@" >/tmp/sentinel-block-test.out 2>/tmp/sentinel-block-test.err
  rc=$?
  set -e
  if [[ $rc -eq $want ]]; then
    echo "PASS: $desc"
    pass=$((pass + 1))
  else
    echo "FAIL: $desc (want rc=$want got rc=$rc)"
    echo "  stdout: $(tr '\n' ' ' </tmp/sentinel-block-test.out)"
    echo "  stderr: $(tr '\n' ' ' </tmp/sentinel-block-test.err)"
    fail=$((fail + 1))
  fi
}

assert_file_contains() {
  local file=$1 needle=$2 desc=$3
  if grep -q -- "$needle" "$file"; then
    echo "PASS: $desc"
    pass=$((pass + 1))
  else
    echo "FAIL: $desc (missing '$needle' in $file)"
    fail=$((fail + 1))
  fi
}

skip_note() {
  echo "SKIP: $1"
  skip=$((skip + 1))
}

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT
STUB="$WORKDIR/nft"
STATE="$WORKDIR/state"
LOG="$WORKDIR/nft.log"
ALLOW="$WORKDIR/allowlist"

write_stub() {
  cat > "$STUB" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
STATE=${NFT_STUB_STATE:?}
LOG=${NFT_STUB_LOG:?}
mkdir -p "$STATE"
{
  printf 'argv:'
  printf ' %q' "$@"
  printf '\n'
} >> "$LOG"

joined="$*"
op=$1
obj=${2:-}

has() { [[ -f $STATE/$1 ]]; }
touchf() { : > "$STATE/$1"; }

list_set() {
  local name=$1 kind=$2 file=$3
  has table || { echo "Error: No such file or directory" >&2; exit 1; }
  has "$file" || { echo "Error: No such file or directory" >&2; exit 1; }
  echo "table inet sentinel {"
  echo "	set $name {"
  echo "		type $kind"
  echo "		flags timeout"
  if [[ -s $STATE/elements_$name ]]; then
    local els=() line
    while IFS= read -r line; do
      [[ -n $line ]] && els+=("$line timeout 60s")
    done < "$STATE/elements_$name"
    local IFS=', '
    echo "		elements = { ${els[*]} }"
  fi
  echo "	}"
  echo "}"
}

list_chain() {
  has table || { echo "Error: No such file or directory" >&2; exit 1; }
  has chain || { echo "Error: No such file or directory" >&2; exit 1; }
  echo "table inet sentinel {"
  echo "	chain input {"
  echo "		type filter hook input priority -10; policy accept;"
  if has rule_v4; then
    echo '		ip saddr @blocklist drop comment "sentinel-drop-v4"'
  fi
  if has rule_v6; then
    echo '		ip6 saddr @blocklist6 drop comment "sentinel-drop-v6"'
  fi
  echo "	}"
  echo "}"
}

case "$op $obj" in
  "list table")
    has table || { echo "Error: No such file or directory" >&2; exit 1; }
    echo "table inet sentinel {"
    echo "}"
    ;;
  "list set")
    # argv: list set inet sentinel <set>
    if [[ ${5:-} == blocklist6 ]]; then
      list_set blocklist6 ipv6_addr set_blocklist6
    else
      list_set blocklist ipv4_addr set_blocklist
    fi
    ;;
  "list chain")
    list_chain
    ;;
  "add table")
    touchf table
    ;;
  "add set")
    has table || { echo "Error: No such file or directory" >&2; exit 1; }
    if [[ ${5:-} == blocklist6 ]]; then
      touchf set_blocklist6
    else
      touchf set_blocklist
    fi
    ;;
  "add chain")
    has table || { echo "Error: No such file or directory" >&2; exit 1; }
    touchf chain
    ;;
  "add rule")
    has table || { echo "Error: No such file or directory" >&2; exit 1; }
    if [[ $joined == *blocklist6* || $joined == *'ip6 '* ]]; then
      touchf rule_v6
    else
      touchf rule_v4
    fi
    ;;
  "add element")
    # argv: add element inet sentinel <set> '{ ip timeout Ns }'
    has table || { echo "Error: No such file or directory" >&2; exit 1; }
    elem=${6:-}
    ip=${elem#\{ }
    ip=${ip#\{}
    ip=${ip%% *}
    ip=${ip%%\}}
    if [[ ${5:-} == blocklist6 ]]; then
      echo "$ip" >> "$STATE/elements_blocklist6"
    else
      echo "$ip" >> "$STATE/elements_blocklist"
    fi
    ;;
  "delete element")
    has table || { echo "Error: Could not process rule: No such file or directory" >&2; exit 1; }
    elem=${6:-}
    ip=${elem#\{ }
    ip=${ip#\{}
    ip=${ip%% *}
    ip=${ip%%\}}
    localfile=$STATE/elements_blocklist
    [[ ${5:-} == blocklist6 ]] && localfile=$STATE/elements_blocklist6
    if [[ ! -f $localfile ]] || ! grep -qxF -- "$ip" "$localfile" 2>/dev/null; then
      echo "Error: Could not process rule: No such file or directory" >&2
      exit 1
    fi
    grep -vxF -- "$ip" "$localfile" > "$localfile.tmp" || true
    mv "$localfile.tmp" "$localfile"
    ;;
  *)
    echo "nft-stub: unhandled: $joined" >&2
    exit 1
    ;;
esac
EOF
  chmod +x "$STUB"
}

reset_state() {
  rm -rf "$STATE"
  mkdir -p "$STATE"
  : > "$LOG"
}

run_sb() {
  SENTINEL_BLOCK_NFT="$STUB" SENTINEL_BLOCK_ALLOWLIST="$ALLOW" \
    NFT_STUB_STATE="$STATE" NFT_STUB_LOG="$LOG" \
    bash "$BLOCK" "$@"
}

write_stub
reset_state
: > "$ALLOW"

echo "=== fake mode (unprivileged nft stub) ==="

if [[ $(id -u) -ne 0 ]]; then
  skip_note "allowlist ownership check (not root)"
fi

assert_rc 0 "block 192.0.2.10 60" run_sb block 192.0.2.10 60
assert_rc 0 "verify 192.0.2.10 after block" run_sb verify 192.0.2.10
set +e
list_out=$(run_sb list 2>/dev/null)
set -e
if grep -q '192.0.2.10' <<<"$list_out"; then
  echo "PASS: list shows 192.0.2.10"
  pass=$((pass + 1))
else
  echo "FAIL: list shows 192.0.2.10"
  echo "  list: $list_out"
  fail=$((fail + 1))
fi
assert_rc 0 "unblock 192.0.2.10" run_sb unblock 192.0.2.10
assert_rc 0 "unblock 192.0.2.10 again (absent)" run_sb unblock 192.0.2.10
assert_rc 1 "verify 192.0.2.10 after unblock" run_sb verify 192.0.2.10

assert_rc 2 "leading-zero IPv4 192.000.002.077" run_sb block 192.000.002.077 60
assert_rc 2 "octet 256" run_sb block 192.0.2.256 60
assert_rc 2 "semicolon injection" run_sb block '192.0.2.1;id' 60
assert_rc 2 'command substitution $(id)' run_sb block '$(id)' 60
assert_rc 2 "IPv6 :::" run_sb block ':::' 60

assert_rc 3 "refuse 0.0.0.0" run_sb block 0.0.0.0 60
assert_rc 3 "refuse 255.255.255.255" run_sb block 255.255.255.255 60
assert_rc 3 "refuse 127.0.0.1" run_sb block 127.0.0.1 60
assert_rc 3 "refuse 224.0.0.1" run_sb block 224.0.0.1 60
assert_rc 3 "refuse ::1" run_sb block ::1 60

printf '%s\n' '198.51.100.0/24' > "$ALLOW"
reset_state
assert_rc 3 "allowlist CIDR blocks 198.51.100.7" run_sb block 198.51.100.7 60
assert_rc 0 "allowlist CIDR allows 203.0.113.9" run_sb block 203.0.113.9 60

printf '%s\n' '198.51.100.0/24' 'not a cidr' > "$ALLOW"
reset_state
assert_rc 3 "allowlist garbage line" run_sb block 203.0.113.9 60

: > "$ALLOW"
reset_state
assert_rc 2 "ttl 0" run_sb block 192.0.2.10 0
assert_rc 2 "ttl 86401" run_sb block 192.0.2.10 86401
assert_rc 2 "ttl abc" run_sb block 192.0.2.10 abc
assert_rc 2 "unknown command" run_sb foo 192.0.2.10

if command -v python3 >/dev/null 2>&1; then
  reset_state
  : > "$LOG"
  assert_rc 0 "block canonical IPv6 2001:DB8:0:0::1" run_sb block 2001:DB8:0:0::1 60
  assert_file_contains "$LOG" '2001:db8::1' "nft received compressed 2001:db8::1"
else
  skip_note "IPv6 python3 canonicalization (python3 missing)"
fi

reset_state
touch "$STATE/table" "$STATE/set_blocklist" "$STATE/set_blocklist6" "$STATE/chain"
: > "$LOG"
assert_rc 0 "block on existing table without drop rule" run_sb block 192.0.2.10 60
assert_file_contains "$LOG" 'add rule' "block adds drop rule when missing"
assert_file_contains "$LOG" 'sentinel-drop-v4' "added rule uses sentinel-drop-v4 comment"

echo
echo "=== real nft mode ==="
REAL_NFT=/usr/sbin/nft
if [[ $(id -u) -eq 0 && ${TEST_REAL_NFT:-0} == 1 && -x $REAL_NFT ]]; then
  existed=0
  if "$REAL_NFT" list table inet sentinel >/dev/null 2>&1; then
    existed=1
  fi
  run_real() { SENTINEL_BLOCK_ALLOWLIST="$ALLOW" bash "$BLOCK" "$@"; }
  : > "$ALLOW"
  assert_rc 0 "real block 192.0.2.50 60" run_real block 192.0.2.50 60
  assert_rc 0 "real verify 192.0.2.50" run_real verify 192.0.2.50
  assert_rc 0 "real unblock 192.0.2.50" run_real unblock 192.0.2.50
  assert_rc 1 "real verify after unblock" run_real verify 192.0.2.50

  assert_rc 0 "real re-block 192.0.2.50 60" run_real block 192.0.2.50 60
  handles=$("$REAL_NFT" -a list chain inet sentinel input | awk '/sentinel-drop-v4|ip saddr @blocklist drop/{print $NF; exit}')
  if [[ -n ${handles:-} && $handles =~ ^[0-9]+$ ]]; then
    "$REAL_NFT" delete rule inet sentinel input handle "$handles"
  else
    echo "WARN: could not parse v4 drop handle; skipping restore assertion"
  fi
  : > "$ALLOW"
  assert_rc 0 "real block restores drop rule" run_real block 192.0.2.50 60
  if "$REAL_NFT" list chain inet sentinel input | grep -q 'ip saddr @blocklist drop'; then
    echo "PASS: drop rule present after restore"
    pass=$((pass + 1))
  else
    echo "FAIL: drop rule present after restore"
    fail=$((fail + 1))
  fi
  "$REAL_NFT" delete element inet sentinel blocklist '{ 192.0.2.50 }' >/dev/null 2>&1 || true
  if [[ $existed -eq 0 ]]; then
    "$REAL_NFT" delete table inet sentinel
  fi
else
  skip_note "real nft (need root, TEST_REAL_NFT=1, and $REAL_NFT)"
fi

echo
echo "PASS=$pass FAIL=$fail SKIP=$skip"
[[ $fail -eq 0 ]]
