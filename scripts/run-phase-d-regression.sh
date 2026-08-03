#!/usr/bin/env bash
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1
OUT="$ROOT/temp/broker-rollout/phase-d-regression.txt"
mkdir -p "$ROOT/temp/broker-rollout" "$ROOT/handoff/broker-rollout-evidence"
: > "$OUT"
log() { printf '%s\n' "$*" | tee -a "$OUT"; }
run() {
  log "--- $* ---"
  if "$@" >> "$OUT" 2>&1; then log "OK"; else log "FAIL: $*"; return 1; fi
}
log "=== Phase D regression (Phase A+B+C+D) ==="
log "timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
log ""
run node test/broker-native-routing.test.js || exit 1
run python3 test/native-broker-routing-test.py || exit 1
run node test/broker-async-roi.test.js || exit 1
run node test/popup-broker-confirmation.test.js || exit 1
run node test/popup-broker-failure-policy.test.js || exit 1
run node test/popup-broker-resume-archive.test.js || exit 1
L10N_LOCAL_SECRET_DEV_ONLY=0 run python3 test/native-legacy-secret-gating-test.py || exit 1
run node test/feishu-auth.test.js || exit 1
log "--- all JS test files ---"
fail=0
for f in test/*.test.js; do
  if node "$f" >> "$OUT" 2>&1; then log "OK $f"; else log "FAIL $f"; fail=1; fi
done
if [ "$fail" -ne 0 ]; then exit 1; fi
log "ALL_JS_TESTS_PASSED"
log ""
log "--- JS syntax ---"
js_syntax=0
for f in *.js lib/*.js test/*.test.js; do
  if ! node --check "$f" >> "$OUT" 2>&1; then log "JS_SYNTAX_FAIL $f"; js_syntax=1; fi
done
if [ "$js_syntax" -eq 0 ]; then log "JS_SYNTAX_OK"; else exit 1; fi
log ""
log "--- Native Host py compile ---"
if python3 -m py_compile native-host/starling-bridge.py native-host/feishu_oauth_broker.py native-host/roi_broker_client.py test/*.py >> "$OUT" 2>&1; then log "PY_SYNTAX_OK"; else log "PY_SYNTAX_FAIL"; exit 1; fi
log ""
cd "$ROOT/backend" || exit 1
log "--- Backend pytest ---"
if python3 -m pytest tests -q >> "$OUT" 2>&1; then log "BACKEND_TESTS_OK"; else log "BACKEND_TESTS_FAIL"; exit 1; fi
log ""
log "--- Backend compileall ---"
if python3 -m compileall -q src tests migrations >> "$OUT" 2>&1; then log "BACKEND_COMPILE_OK"; else log "BACKEND_COMPILE_FAIL"; exit 1; fi
cd "$ROOT" || exit 1
cp "$OUT" "$ROOT/handoff/broker-rollout-evidence/phase-d-regression.txt"
log ""
log "=== Phase D regression completed ==="
