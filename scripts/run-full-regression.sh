#!/usr/bin/env bash
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1
OUT="$ROOT/temp/v1.6-regression/full-regression.txt"
PYTHON_BIN="${L10N_PYTHON_BIN:-python3}"
BACKEND_PYTHON="${L10N_BACKEND_PYTHON:-$PYTHON_BIN}"
export PYTHONPYCACHEPREFIX="$ROOT/temp/v1.6-regression/pycache"
mkdir -p "$ROOT/temp/v1.6-regression"
: > "$OUT"
log() { printf '%s\n' "$*" | tee -a "$OUT"; }
run() {
  log "--- $* ---"
  if "$@" >> "$OUT" 2>&1; then log "OK"; else log "FAIL: $*"; return 1; fi
}
log "=== v1.6 full regression ==="
log "timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
log ""
run node test/broker-native-routing.test.js || exit 1
run "$PYTHON_BIN" test/native-broker-routing-test.py || exit 1
run node test/broker-async-roi.test.js || exit 1
run node test/popup-broker-confirmation.test.js || exit 1
run node test/popup-broker-failure-policy.test.js || exit 1
run node test/popup-broker-resume-archive.test.js || exit 1
L10N_LOCAL_SECRET_DEV_ONLY=0 run "$PYTHON_BIN" test/native-legacy-secret-gating-test.py || exit 1
run node test/feishu-auth.test.js || exit 1
log "--- all JS test files ---"
fail=0
for f in test/*.test.js; do
  if node "$f" >> "$OUT" 2>&1; then log "OK $f"; else log "FAIL $f"; fail=1; fi
done
if [ "$fail" -ne 0 ]; then exit 1; fi
log "ALL_JS_TESTS_PASSED"
log ""
log "--- all Python test files ---"
python_fail=0
for f in test/*.py; do
  if PYTHONPATH="$ROOT" "$PYTHON_BIN" "$f" >> "$OUT" 2>&1; then log "OK $f"; else log "FAIL $f"; python_fail=1; fi
done
if [ "$python_fail" -ne 0 ]; then exit 1; fi
log "ALL_PYTHON_TESTS_PASSED"
log ""
log "--- JS syntax ---"
js_syntax=0
for f in *.js lib/*.js test/*.test.js; do
  if ! node --check "$f" >> "$OUT" 2>&1; then log "JS_SYNTAX_FAIL $f"; js_syntax=1; fi
done
if [ "$js_syntax" -eq 0 ]; then log "JS_SYNTAX_OK"; else exit 1; fi
log ""
log "--- Native Host py compile ---"
if "$PYTHON_BIN" -m py_compile native-host/starling-bridge.py native-host/feishu_oauth_broker.py native-host/roi_broker_client.py test/*.py >> "$OUT" 2>&1; then log "PY_SYNTAX_OK"; else log "PY_SYNTAX_FAIL"; exit 1; fi
log ""
cd "$ROOT/backend" || exit 1
log "--- Backend pytest ---"
if PYTHONPATH="$ROOT/backend/src" "$BACKEND_PYTHON" -m pytest tests -q >> "$OUT" 2>&1; then log "BACKEND_TESTS_OK"; else log "BACKEND_TESTS_FAIL"; exit 1; fi
log ""
log "--- Backend compileall ---"
if "$BACKEND_PYTHON" -m compileall -q src tests migrations >> "$OUT" 2>&1; then log "BACKEND_COMPILE_OK"; else log "BACKEND_COMPILE_FAIL"; exit 1; fi
cd "$ROOT" || exit 1
log ""
log "=== v1.6 full regression completed ==="
