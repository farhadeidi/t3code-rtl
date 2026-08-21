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
