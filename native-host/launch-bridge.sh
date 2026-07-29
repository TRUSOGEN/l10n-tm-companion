#!/bin/bash
# 使用插件私有运行环境启动 Native Messaging bridge；源码开发模式回退到系统 Python。

set -euo pipefail

EXTENSION_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_BIN="$EXTENSION_ROOT/runtime/bin"

if [ -d "$RUNTIME_BIN" ]; then
  export PATH="$RUNTIME_BIN:/usr/bin:/bin:/usr/sbin:/sbin"
fi

if [ -x "$RUNTIME_BIN/python3" ]; then
  exec "$RUNTIME_BIN/python3" "$EXTENSION_ROOT/native-host/starling-bridge.py"
fi

exec /usr/bin/env python3 "$EXTENSION_ROOT/native-host/starling-bridge.py"
