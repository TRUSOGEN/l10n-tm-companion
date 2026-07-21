#!/bin/bash
# install.sh — L10n TM Companion 一键安装（macOS）
# ==================================================
# 做四件事：
#   1. 检查依赖：python3 / node / starling-cli，缺哪个提示怎么装
#   2. 注册 Native Messaging Host（用固定扩展 ID，所有机器一致）
#   3. 自检：bridge 能响应 ping
#   4. 打印「加载扩展」指引
#
# 用法：
#   ./install.sh                  # 默认扩展目录 = 脚本所在目录的上一级
#   install.sh [<扩展目录>]
#
# 扩展 ID 处理：未打包扩展的 ID 由 Chrome 生成，可能随机器变化。
# 本脚本自动从 Chrome 的 Preferences 探测已加载的 L10n TM Companion 扩展 ID
# （按扩展路径匹配），探测不到则用固定 ID 兜底。两者都不对时给出手动填法。

set -e

# ---- 配置 ----
# 兜底固定 ID（manifest 的 key 字段算出，但 Chrome 对未打包扩展可能不用，作 fallback）
FALLBACK_EXTENSION_ID="welukkiwnwhmkigs"
# 用于在 Preferences 里识别本扩展的目录名关键词
EXT_DIR_KEYWORD="l10n-tm-companion"

# 扩展目录 = 脚本所在目录的上一级（install.sh 在 native-host/ 里，扩展根在上一层）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ "$#" -ge 1 ] && [ "${1:0:1}" != "-" ]; then
  EXT_DIR="$(cd "$1" && pwd)"
else
  EXT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
fi
# 可选第二个参数：显式传入扩展 ID（覆盖自动探测）
EXPLICIT_ID="${2:-}"
BRIDGE_PATH="$EXT_DIR/native-host/starling-bridge.py"
MANIFEST_NAME="com.l10n.tm_companion.json"

# 颜色
G="\033[32m"; R="\033[31m"; Y="\033[33m"; N="\033[0m"
ok()   { echo -e "${G}✅ $1${N}"; }
fail() { echo -e "${R}❌ $1${N}"; }
info() { echo -e "${Y}👉 $1${N}"; }

echo "========================================"
echo " L10n TM Companion 一键安装"
echo "========================================"
echo "扩展目录: $EXT_DIR"
echo ""

# ---- 1. 依赖检查 ----
echo "--- 1/4 依赖检查 ---"
MISSING=0

if command -v python3 >/dev/null 2>&1; then
  ok "python3: $(python3 --version 2>&1)"
else
  fail "未找到 python3。安装：brew install python 或 https://www.python.org/downloads/"
  MISSING=1
fi

if command -v node >/dev/null 2>&1; then
  ok "node: $(node --version)"
else
  fail "未找到 node。安装：brew install node 或 https://nodejs.org/"
  MISSING=1
fi

if command -v starling-cli >/dev/null 2>&1; then
  ok "starling-cli: $(starling-cli --version 2>&1 | head -1)"
else
  fail "未找到 starling-cli。请先安装并配置 AK/SK（见 USAGE-GUIDE.md 前置条件）。"
  MISSING=1
fi

if [ ! -f "$BRIDGE_PATH" ]; then
  fail "未找到 bridge: $BRIDGE_PATH"
  fail "确认扩展目录正确（应含 native-host/starling-bridge.py）。"
  exit 1
fi

if [ "$MISSING" -ne 0 ]; then
  echo ""
  fail "有依赖缺失，请先装齐再重跑本脚本。"
  exit 1
fi
echo ""

# ---- 1b. 探测 Chrome 实际加载的扩展 ID ----
echo "--- 1b/4 探测扩展 ID ---"
# 显式传入优先
if [ -n "$EXPLICIT_ID" ]; then
  EXTENSION_ID="$EXPLICIT_ID"
  ok "使用传入的扩展 ID：$EXTENSION_ID"
else
# Chrome 把已加载扩展记在 Default/Preferences 的 extensions.settings 里：
#   { "extensions": { "settings": { "<EXT_ID>": { "path": "...", "manifest": {...} } } } }
# 遍历所有 profile，找 path 含本扩展目录关键词 的条目，取其 key（即扩展 ID）。
PREFS_FILES=( \
  "$HOME/Library/Application Support/Google/Chrome/Default/Preferences" \
  "$HOME/Library/Application Support/Google/Chrome/Profile */Preferences" )
DETECTED_ID=""
# 未打包扩展（开发者加载）记在 Secure Preferences；商店扩展在 Preferences。两个都扫。
for prefs in "$HOME/Library/Application Support/Google/Chrome/Default/Secure Preferences" \
             "$HOME/Library/Application Support/Google/Chrome/Default/Preferences" \
             $HOME/Library/Application\ Support/Google/Chrome/Profile\ */Preferences \
             $HOME/Library/Application\ Support/Google/Chrome/Profile\ */Secure\ Preferences; do
  [ -f "$prefs" ] || continue
  FOUND=$(python3 - "$prefs" "$EXT_DIR_KEYWORD" << 'PY' 2>/dev/null || true
import json, sys
prefs_path, keyword = sys.argv[1], sys.argv[2]
try:
    data = json.load(open(prefs_path, encoding='utf-8'))
except Exception:
    sys.exit(0)
settings = data.get('extensions', {}).get('settings', {})
for ext_id, meta in settings.items():
    path = meta.get('path', '') or ''
    name = (meta.get('manifest') or {}).get('name', '') or ''
    # 匹配本扩展：路径含目录关键词 或 name 是 L10n TM Companion
    if keyword in path or name == 'L10n TM Companion':
        print(ext_id)
        sys.exit(0)
PY
)
  if [ -n "$FOUND" ]; then
    DETECTED_ID="$FOUND"
    break
  fi
done

if [ -n "$DETECTED_ID" ]; then
  EXTENSION_ID="$DETECTED_ID"
  ok "已从 Chrome 探测到扩展 ID：$EXTENSION_ID"
  echo "   （来自已加载扩展，native host 用它注册即可匹配）"
else
  EXTENSION_ID="$FALLBACK_EXTENSION_ID"
  fail "未在 Chrome 找到已加载的本扩展（可能还没加载扩展，或 Chrome 没开）。"
  echo "   先去 chrome://extensions 加载 $EXT_DIR，再重跑本脚本；"
  echo "   或手动传入 ID：./install.sh <扩展目录> <扩展ID>"
  echo "   本次先用兜底 ID $FALLBACK_EXTENSION_ID 注册（若与实际不符会 forbidden）。"
fi
fi  # 闭合 if EXPLICIT_ID else
echo ""

# ---- 2. 注册 Native Messaging Host ----
echo "--- 2/4 注册 Native Messaging Host ---"
chmod +x "$BRIDGE_PATH"

HOST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
mkdir -p "$HOST_DIR"
MANIFEST_DST="$HOST_DIR/$MANIFEST_NAME"

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

ok "Native Host 已注册"
echo "   清单: $MANIFEST_DST"
echo "   桥接: $BRIDGE_PATH"
echo ""

# ---- 3. 自检 bridge ping ----
echo "--- 3/4 自检 bridge（ping） ---"
# Native Messaging 协议：前 4 字节是消息长度（little-endian uint32），后面是 JSON
PING='{"action":"ping"}'
RESPONSE=$(printf '%s' "$PING" | python3 -c "
import sys, json, struct
msg = sys.stdin.read().encode()
buf = struct.pack('=I', len(msg)) + msg
sys.stdout.buffer.write(buf)
" | python3 "$BRIDGE_PATH" 2>/dev/null | python3 -c "
import sys, struct
data = sys.stdin.buffer.read()
if len(data) < 4:
    print('NO_RESPONSE'); sys.exit(0)
n = struct.unpack('=I', data[:4])[0]
print(data[4:4+n].decode(errors='replace'))
" 2>/dev/null || echo "PING_FAILED")

if echo "$RESPONSE" | grep -q '"pong"'; then
  ok "bridge 响应正常: $RESPONSE"
elif [ "$RESPONSE" = "NO_RESPONSE" ] || [ "$RESPONSE" = "PING_FAILED" ]; then
  fail "bridge 自检未通过（$RESPONSE）。可手动排查：见 USAGE-GUIDE.md 调试方法。"
else
  ok "bridge 有响应: $RESPONSE"
fi
echo ""

# ---- 4. 加载指引 ----
echo "--- 4/4 加载扩展 ---"
ok "安装完成！最后一步手动加载扩展："
echo ""
info "1. 打开 Chrome：chrome://extensions"
info "2. 右上角开启「开发者模式」"
info "3. 点「加载已解压的扩展程序」"
info "4. 选择目录：$EXT_DIR"
echo ""
echo "   扩展加载后会得到一个 ID（chrome://extensions 卡片可见）。"
echo "   native host 已用探测到的 ID 注册；若仍 forbidden，重启 Chrome 后重跑本脚本。"
echo ""
echo "5. 在扩展设置页填：电子表格 URL、Starling 项目 ID"
echo "   （飞书凭证已预填；LLM 配置可选，AI 改写默认关）"
echo ""
ok "全部就绪。打开飞书原文表即可开始用。"
