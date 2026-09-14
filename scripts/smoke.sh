#!/usr/bin/env bash
# Smoke test for t3code-rtl against fake bundles and the real `t3` npm package.
# Everything runs inside a temp directory with an isolated HOME and is removed on
# exit (success or failure). The user's installed apps and config are never touched.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/dist/cli.js"
TMP="$(mktemp -d -t t3code-rtl-smoke.XXXXXX)"
PORT="${SMOKE_PORT:-47311}"
SERVER_PID=""

cleanup() {
  trap - EXIT INT TERM
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  rm -rf "$TMP"
}
# Runs on normal exit, failure (set -e), Ctrl-C, and SIGTERM (e.g. a timeout).
trap cleanup EXIT INT TERM

export HOME="$TMP/home"
mkdir -p "$HOME"
INDEX="apps/server/dist/client/index.html"

step() { printf '\n== %s\n' "$*"; }
expect() { # expect <actual> <expected> <label>
  if [ "$1" != "$2" ]; then echo "FAIL: $3 (got '$1', want '$2')"; exit 1; fi
  echo "ok: $3"
}

cd "$ROOT" && npm run build --silent

# --- unpacked layout -------------------------------------------------------
step "unpacked layout"
APP="$TMP/Unpacked.app"; FILE="$APP/resources/app.asar.unpacked/$INDEX"
mkdir -p "$(dirname "$FILE")"; printf '<html><body>\n  <p>hi</p>\n  </body></html>\n' > "$FILE"
export T3CODE_APP_DIRS="$APP"
printf "y\n" | node "$CLI" patch >/dev/null
expect "$(grep -c 't3code-rtl:begin' "$FILE")" 1 "patched once"
printf "y\n" | node "$CLI" patch >/dev/null
expect "$(grep -c 't3code-rtl:begin' "$FILE")" 1 "idempotent"
expect "$(node "$CLI" status | head -1 | grep -c patched)" 1 "status reports patched"
printf "y\n" | node "$CLI" unpatch >/dev/null
expect "$(grep -c 't3code-rtl:begin' "$FILE" || true)" 0 "unpatched"

# --- asar layout -----------------------------------------------------------
step "asar layout"
APP="$TMP/Asar.app"; mkdir -p "$APP/resources"
node -e '
const fs=require("fs");const html="<html><body>\n  <p>x</p>\n  </body></html>\n";
const header=JSON.stringify({files:{apps:{files:{server:{files:{dist:{files:{client:{files:{"index.html":{size:html.length,offset:"0"}}}}}}}}}}});
const json=Buffer.from(header+" ".repeat(4000));
const h=Buffer.alloc(16);h.writeUInt32LE(4,0);h.writeUInt32LE(json.length+8,4);h.writeUInt32LE(json.length+4,8);h.writeUInt32LE(json.length,12);
fs.writeFileSync(process.argv[1],Buffer.concat([h,json,Buffer.from(html)]));' "$APP/resources/app.asar"
export T3CODE_APP_DIRS="$APP"
expect "$( (printf "y\n" | node "$CLI" patch 2>&1 || true) | grep -c 'refusing to patch')" 1 "refuses without T3CODE_RTL_FORCE"
printf "y\n" | T3CODE_RTL_FORCE=1 node "$CLI" patch >/dev/null
expect "$(grep -c 't3code-rtl:begin' "$APP/resources/app.asar.unpacked/$INDEX")" 1 "patched with force"
printf "y\n" | node "$CLI" unpatch >/dev/null
expect "$(grep -c 't3code-rtl:begin' "$APP/resources/app.asar.unpacked/$INDEX" || true)" 0 "unpatched"

# --- update through a fake Homebrew (macOS only; the real brew is never called) ---
if [ "$(uname)" = Darwin ]; then
  step "update via fake brew"
  BIN="$TMP/bin"; mkdir -p "$BIN"; export BREW_LOG="$TMP/brew.log"
  cat > "$BIN/brew" <<'EOF'
#!/usr/bin/env bash
[ -n "${FAKE_BREW_MISSING:-}" ] && exit 127
echo "$*" >> "$BREW_LOG"
[ "$1" = list ] && printf '%s\n' $FAKE_CASKS
[ "$1" = upgrade ] && [ "$4" = "${FAKE_FAIL:-}" ] && exit 1
exit 0
EOF
  chmod +x "$BIN/brew"
  ALPHA="$TMP/apps/T3 Code (Alpha).app"; NIGHTLY="$TMP/apps/T3 Code (Nightly).app"
  for APP in "$ALPHA" "$NIGHTLY"; do
    mkdir -p "$APP/resources/app.asar.unpacked/$(dirname "$INDEX")"
    printf '<html><body>\n  </body></html>\n' > "$APP/resources/app.asar.unpacked/$INDEX"
  done
  export T3CODE_APP_DIRS="$ALPHA"$'\n'"$NIGHTLY"
  run_update() { rm -f "$BREW_LOG"; (printf "y\n" | PATH="$BIN:$PATH" node "$CLI" update 2>&1 || true); }

  OUT="$(FAKE_CASKS="t3-code t3-code@nightly" run_update)"
  expect "$(grep -c '^upgrade' "$BREW_LOG")" 2 "upgrades alpha and nightly casks"
  expect "$(grep -c 't3code-rtl:begin' "$NIGHTLY/resources/app.asar.unpacked/$INDEX")" 1 "nightly patched after update"

  OUT="$(FAKE_CASKS="t3-code" run_update)"
  expect "$(grep -c '^upgrade' "$BREW_LOG")" 1 "upgrades only the installed cask"
  expect "$(grep -c 'brew install --cask --force t3-code@nightly' <<<"$OUT")" 1 "explains how to update a non-Homebrew nightly"

  OUT="$(FAKE_CASKS="t3-code t3-code@nightly" FAKE_FAIL="t3-code@nightly" run_update)"
  expect "$(grep -c 'could not upgrade t3-code@nightly' <<<"$OUT")" 1 "reports a failed cask upgrade"
  expect "$(grep -c 'Patched T3 Code (Alpha).app' <<<"$OUT")" 1 "still patches after a failed upgrade"

  OUT="$(FAKE_CASKS="" run_update)"
  expect "$(grep -c 'No T3 Code Homebrew cask' <<<"$OUT")" 1 "explains when no cask is installed"

  OUT="$(FAKE_BREW_MISSING=1 run_update)"
  expect "$(grep -c 'Homebrew is not installed' <<<"$OUT")" 1 "explains when Homebrew is missing"
fi

# --- real t3 npm package (opt-in: SMOKE_T3=1; downloads ~600 MB, takes minutes) ---
if [ "${SMOKE_T3:-}" = "1" ]; then
  step "t3 npm package served over HTTP"
  PKG="$TMP/pkg"; mkdir -p "$PKG"; cd "$PKG"
  npm init -y >/dev/null; echo "installing t3 (this can take a few minutes)..."; npm install t3@latest --silent --no-audit --no-fund --prefer-offline
  export T3CODE_APP_DIRS="$PKG/node_modules/t3"
  printf "y\n" | node "$CLI" patch >/dev/null
  node node_modules/t3/dist/bin.mjs serve --port "$PORT" --base-dir "$TMP/t3data" >"$TMP/server.log" 2>&1 &
  SERVER_PID=$!
  for _ in $(seq 1 30); do curl -sf -m 10 "http://127.0.0.1:$PORT/" >/dev/null 2>&1 && break; sleep 1; done
  expect "$(curl -sf -m 10 "http://127.0.0.1:$PORT/" | grep -c '__t3codeRtlPatch')" 2 "served page contains patch"
  kill "$SERVER_PID"; SERVER_PID=""
  printf "y\n" | node "$CLI" unpatch >/dev/null
  expect "$(node "$CLI" status | head -1 | grep -c 'not patched')" 1 "unpatched"
else
  echo; echo "(skipped t3 npm package stage; run with SMOKE_T3=1 to include it)"
fi

printf '\nAll smoke tests passed.\n'
