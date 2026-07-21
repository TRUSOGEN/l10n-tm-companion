#!/bin/bash
# register-native-host.sh
# 注册 Native Messaging Host 到 Chrome（macOS）。
#
# 用法：
#   ./register-native-host.sh <EXTENSION_ID>
# 例如：
#   ./register-native-host.sh abcdefghijklmnopqrstuvwxyzabcdef
#
# 会把 starling-bridge.py 设为可执行，并把注册清单写入
# ~/Library/Application Support/Google/Chrome/NativeMessagingHosts/

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRIDGE_PATH="$SCRIPT_DIR/starling-bridge.py"

if [ "$#" -lt 1 ]; then
  echo "用法: $0 <Chrome Extension ID>"
  echo "从 chrome://extensions 获取（开发者模式加载后可见）"
  exit 1
fi

EXTENSION_ID="$1"

# macOS Chrome 的 NativeMessagingHosts 目录
HOST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
mkdir -p "$HOST_DIR"
MANIFEST_DST="$HOST_DIR/com.l10n.tm_companion.json"

# 确认 Python3 可用
if ! command -v python3 >/dev/null 2>&1; then
  echo "❌ 未找到 python3，请先安装 Python 3。"
  exit 1
fi

# bridge 设可执行
chmod +x "$BRIDGE_PATH"

# 写入注册清单（path 必须绝对路径）
cat > "$MANIFEST_DST" << EOF
{
  "name": "com.l10n.tm_companion",
  "description": "L10n TM Companion - Starling CLI Bridge",
  "path": "$BRIDGE_PATH",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXTENSION_ID/"
  ]
}
EOF

echo "✅ Native Messaging Host 已注册:"
echo "   清单: $MANIFEST_DST"
echo "   桥接: $BRIDGE_PATH"
echo "   Extension ID: $EXTENSION_ID"
echo ""
echo "测试 bridge（手动）:"
echo "   echo '{\"action\":\"ping\"}' | python3 -c \\"
echo "     \"import sys,json,struct; m=sys.stdin.read().encode(); sys.stdout.buffer.write(struct.pack('=I',len(m))+m)\" | \\"
echo "   python3 $BRIDGE_PATH"
