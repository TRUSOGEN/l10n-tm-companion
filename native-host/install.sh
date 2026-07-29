#!/bin/bash
# L10n TM Companion macOS 安装器。
#
# 统一承载 .command 与 Installer.app 的安装逻辑：检查私有运行环境、从 manifest 公钥
# 计算稳定扩展 ID、注册 Native Messaging Host、自检 bridge，并打开 Chrome 加载页。

set -euo pipefail

# Finder 启动 .app 时 PATH 通常只有系统目录；补齐公司 Mac 常见的 Node/CLI 安装位置。
prepend_path_dir() {
  [ -d "$1" ] || return 0
  case ":$PATH:" in
    *":$1:"*) ;;
    *) PATH="$1:$PATH" ;;
  esac
}

if [ "${L10N_TM_SKIP_PATH_DISCOVERY:-0}" != "1" ]; then
  prepend_path_dir "/opt/homebrew/bin"
  prepend_path_dir "/usr/local/bin"
  prepend_path_dir "$HOME/.volta/bin"
  prepend_path_dir "$HOME/.npm-global/bin"
  prepend_path_dir "$HOME/.local/bin"
  for NODE_BIN_DIR in "$HOME"/.nvm/versions/node/*/bin; do
    prepend_path_dir "$NODE_BIN_DIR"
  done
fi
export PATH

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEFAULT_EXT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
EXT_DIR="$DEFAULT_EXT_DIR"
EXPLICIT_ID=""
DRY_RUN=0
OPEN_UI=1
INSTALL_STARLING=0
POSITIONAL_COUNT=0
PROGRESS_FILE=""

usage() {
  cat <<'EOF'
用法：
  ./install.sh
  ./install.sh --dry-run --no-open
  ./install.sh --extension-dir <扩展目录> [--extension-id <32位ID>]

选项：
  --dry-run          只检查并打印安装计划，不写文件、不打开应用
  --no-open          不自动打开 Chrome 与 Finder
  --install-starling 兼容旧启动器参数；新安装包已内置 Starling CLI
  --progress-file    将安装阶段写入指定文件，供 Installer.app 显示进度
  --extension-dir    指定包含 manifest.json 的扩展根目录
  --extension-id     覆盖由 manifest 公钥计算出的扩展 ID
  -h, --help         显示帮助

兼容旧用法：./install.sh <扩展目录> <扩展ID>
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --no-open) OPEN_UI=0 ;;
    --install-starling) INSTALL_STARLING=1 ;;
    --progress-file)
      shift
      [ "$#" -gt 0 ] || { echo "❌ --progress-file 缺少参数"; exit 2; }
      PROGRESS_FILE="$1"
      ;;
    --extension-dir)
      shift
      [ "$#" -gt 0 ] || { echo "❌ --extension-dir 缺少参数"; exit 2; }
      EXT_DIR="$1"
      ;;
    --extension-id)
      shift
      [ "$#" -gt 0 ] || { echo "❌ --extension-id 缺少参数"; exit 2; }
      EXPLICIT_ID="$1"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      echo "❌ 未知选项：$1"
      usage
      exit 2
      ;;
    *)
      POSITIONAL_COUNT=$((POSITIONAL_COUNT + 1))
      if [ "$POSITIONAL_COUNT" -eq 1 ]; then
        EXT_DIR="$1"
      elif [ "$POSITIONAL_COUNT" -eq 2 ]; then
        EXPLICIT_ID="$1"
      else
        echo "❌ 位置参数过多"
        usage
        exit 2
      fi
      ;;
  esac
  shift
done

if [ ! -d "$EXT_DIR" ]; then
  echo "❌ 扩展目录不存在：$EXT_DIR"
  exit 1
fi
EXT_DIR="$(cd "$EXT_DIR" && pwd)"
MANIFEST_PATH="$EXT_DIR/manifest.json"
BRIDGE_PATH="$EXT_DIR/native-host/starling-bridge.py"
BRIDGE_LAUNCHER="$EXT_DIR/native-host/launch-bridge.sh"
RUNTIME_BIN="$EXT_DIR/runtime/bin"
HOST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
HOST_MANIFEST="$HOST_DIR/com.l10n.tm_companion.json"

ok() { printf '\033[32m✅ %s\033[0m\n' "$1"; }
warn() { printf '\033[33m⚠️  %s\033[0m\n' "$1"; }
fail() { printf '\033[31m❌ %s\033[0m\n' "$1"; }
step() { printf '\n--- %s ---\n' "$1"; }

report_progress() {
  [ -n "$PROGRESS_FILE" ] || return 0
  printf '%s|%s\n' "$1" "$2" > "$PROGRESS_FILE"
}

require_file() {
  if [ ! -f "$1" ]; then
    fail "安装包不完整，缺少：$1"
    exit 1
  fi
}

derive_extension_id() {
  "$PYTHON_BIN" - "$MANIFEST_PATH" <<'PY'
import base64
import hashlib
import json
import sys

with open(sys.argv[1], encoding='utf-8') as manifest_file:
    manifest = json.load(manifest_file)
public_key = manifest.get('key')
if not isinstance(public_key, str) or not public_key.strip():
    raise SystemExit('manifest.json 缺少固定扩展 ID 所需的 key')
digest = hashlib.sha256(base64.b64decode(public_key)).digest()[:16]
print(''.join(chr(ord('a') + nibble) for byte in digest for nibble in (byte >> 4, byte & 0x0f)))
PY
}

verify_starling_runtime() {
  "$PYTHON_BIN" - "$BRIDGE_PATH" "$STARLING_BIN" <<'PY'
import importlib.util
import os
import sys

bridge_path, cli_path = sys.argv[1:]
spec = importlib.util.spec_from_file_location('l10n_installer_bridge_check', bridge_path)
if not spec or not spec.loader:
    raise SystemExit('Native Host bridge module cannot be loaded')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
cli_root = bridge._resolve_starling_cli_root(cli_path)
core_entry = os.path.join(
    cli_root,
    'node_modules',
    '@byted',
    'starling-agent-core',
    'dist',
    'index.js',
)
if not os.path.isfile(core_entry):
    raise SystemExit('Starling Core ESM entrypoint is missing')
PY
}

detect_loaded_ids() {
  "$PYTHON_BIN" - "$EXT_DIR" <<'PY'
import glob
import json
import os
import sys

extension_dir = os.path.realpath(sys.argv[1])
chrome_root = os.path.expanduser('~/Library/Application Support/Google/Chrome')
preference_files = glob.glob(os.path.join(chrome_root, '*/Preferences'))
preference_files += glob.glob(os.path.join(chrome_root, '*/Secure Preferences'))
seen = set()
for preference_path in preference_files:
    try:
        with open(preference_path, encoding='utf-8') as preference_file:
            settings = json.load(preference_file).get('extensions', {}).get('settings', {})
    except (OSError, ValueError):
        continue
    for extension_id, metadata in settings.items():
        configured_path = metadata.get('path') or ''
        path_matches = configured_path and os.path.realpath(configured_path) == extension_dir
        if path_matches:
            if extension_id not in seen:
                print(extension_id)
                seen.add(extension_id)
PY
}

valid_extension_id() {
  [[ "$1" =~ ^[a-p]{32}$ ]]
}

echo "========================================"
echo " L10n TM Companion Installer"
echo "========================================"
echo "扩展目录：$EXT_DIR"
[ "$DRY_RUN" -eq 0 ] || warn "DRY RUN：不会写入文件，也不会打开 Chrome"

report_progress 28 "检查内置运行环境"
step "1/5 检查安装包与依赖"
require_file "$MANIFEST_PATH"
require_file "$BRIDGE_PATH"
require_file "$BRIDGE_LAUNCHER"
require_file "$EXT_DIR/native-host/starling-credentials-client.js"

if [ -x "$RUNTIME_BIN/python3" ]; then
  PYTHON_BIN="$RUNTIME_BIN/python3"
else
  PYTHON_BIN="$(command -v python3 || true)"
fi
if [ -x "$RUNTIME_BIN/node" ]; then
  NODE_BIN="$RUNTIME_BIN/node"
else
  NODE_BIN="$(command -v node || true)"
fi
if [ -x "$RUNTIME_BIN/starling-cli" ]; then
  STARLING_BIN="$RUNTIME_BIN/starling-cli"
else
  STARLING_BIN="$(command -v starling-cli || true)"
fi

prepend_path_dir "$RUNTIME_BIN"
export PATH

if [ -z "$PYTHON_BIN" ]; then
  fail "未找到 Python 3：https://www.python.org/downloads/macos/"
  if [ "$OPEN_UI" -eq 1 ] && [ "$DRY_RUN" -eq 0 ]; then
    /usr/bin/open "https://www.python.org/downloads/macos/" 2>/dev/null || true
  fi
  exit 1
fi
ok "Python：$("$PYTHON_BIN" --version 2>&1)"

if [ -z "$NODE_BIN" ]; then
  fail "未找到 Node.js：https://nodejs.org/en/download"
  if [ "$OPEN_UI" -eq 1 ] && [ "$DRY_RUN" -eq 0 ]; then
    /usr/bin/open "https://nodejs.org/en/download" 2>/dev/null || true
  fi
  exit 1
fi
ok "Node.js：$("$NODE_BIN" --version)"

if [ -z "$STARLING_BIN" ]; then
  fail "安装包没有内置 Starling CLI，开发版需由维护者准备 starling-cli"
  exit 1
fi
ok "Starling CLI：$("$STARLING_BIN" --version 2>&1 | head -1)"

report_progress 42 "核对 Chrome 扩展身份"
step "2/5 计算并核对 Chrome 扩展 ID"
DERIVED_ID="$(derive_extension_id)"
if ! valid_extension_id "$DERIVED_ID"; then
  fail "manifest 公钥生成了非法扩展 ID：$DERIVED_ID"
  exit 1
fi
EXTENSION_ID="${EXPLICIT_ID:-$DERIVED_ID}"
if ! valid_extension_id "$EXTENSION_ID"; then
  fail "扩展 ID 必须是 32 位 a-p 字符：$EXTENSION_ID"
  exit 1
fi
ok "固定扩展 ID：$EXTENSION_ID"

LOADED_IDS="$(detect_loaded_ids || true)"
ORIGIN_IDS=("$EXTENSION_ID")
while IFS= read -r loaded_id; do
  [ -n "$loaded_id" ] || continue
  if valid_extension_id "$loaded_id" && [ "$loaded_id" != "$EXTENSION_ID" ]; then
    warn "检测到旧加载 ID：$loaded_id；本次兼容注册，建议之后移除旧实例"
    ORIGIN_IDS+=("$loaded_id")
  elif [ "$loaded_id" = "$EXTENSION_ID" ]; then
    ok "Chrome 已加载同一固定 ID"
  fi
done <<< "$LOADED_IDS"

report_progress 56 "测试本机通信组件"
step "3/5 自检本机桥接"
if [ "$DRY_RUN" -eq 1 ]; then
  warn "跳过 bridge ping"
else
  RESPONSE="$("$PYTHON_BIN" - "$BRIDGE_LAUNCHER" <<'PY'
import json
import struct
import subprocess
import sys

payload = json.dumps({'action': 'ping'}).encode()
framed = struct.pack('=I', len(payload)) + payload
completed = subprocess.run([sys.argv[1]], input=framed, capture_output=True, timeout=15)
if len(completed.stdout) < 4:
    raise SystemExit('NO_RESPONSE')
length = struct.unpack('=I', completed.stdout[:4])[0]
print(completed.stdout[4:4 + length].decode(errors='replace'))
PY
)" || { fail "bridge ping 失败"; exit 1; }
  if [[ "$RESPONSE" == *'"pong": true'* ]]; then
    ok "bridge ping 正常"
  else
    fail "bridge 返回异常：$RESPONSE"
    exit 1
  fi
  if verify_starling_runtime; then
    ok "Starling 官方签名客户端正常"
  else
    fail "无法加载 Starling 官方签名客户端；安装包不完整"
    exit 1
  fi
fi

report_progress 72 "注册 Chrome 本机通信组件"
step "4/5 原子注册 Native Messaging Host"
if [ "$DRY_RUN" -eq 1 ]; then
  echo "将写入：$HOST_MANIFEST"
else
  chmod +x "$BRIDGE_PATH" "$BRIDGE_LAUNCHER"
  mkdir -p "$HOST_DIR"
  TEMP_MANIFEST="$(mktemp "$HOST_DIR/.com.l10n.tm_companion.json.XXXXXX")"
  cleanup_temp_manifest() {
    [ ! -f "$TEMP_MANIFEST" ] || rm -f "$TEMP_MANIFEST"
  }
  trap cleanup_temp_manifest EXIT
  "$PYTHON_BIN" - "$TEMP_MANIFEST" "$BRIDGE_LAUNCHER" "${ORIGIN_IDS[@]}" <<'PY'
import json
import sys

manifest_path, bridge_path, *extension_ids = sys.argv[1:]
payload = {
    'name': 'com.l10n.tm_companion',
    'description': 'L10n TM Companion - Starling CLI Bridge',
    'path': bridge_path,
    'type': 'stdio',
    'allowed_origins': [f'chrome-extension://{extension_id}/' for extension_id in extension_ids],
}
with open(manifest_path, 'w', encoding='utf-8') as manifest_file:
    json.dump(payload, manifest_file, ensure_ascii=False, indent=2)
    manifest_file.write('\n')
PY
  mv "$TEMP_MANIFEST" "$HOST_MANIFEST"
  trap - EXIT
  ok "Native Host 已注册：$HOST_MANIFEST"
fi

report_progress 88 "准备 Chrome 加载目录"
step "5/5 打开 Chrome 加载与配置入口"
echo "Chrome 仍要求用户本人确认‘加载已解压的扩展程序’，安装器不能绕过这项安全确认。"
echo "请选择目录：$EXT_DIR"
if [ "$OPEN_UI" -eq 1 ] && [ "$DRY_RUN" -eq 0 ]; then
  /usr/bin/open -a "Google Chrome" "chrome://extensions/" 2>/dev/null || warn "未能自动打开 Google Chrome"
  /usr/bin/open -R "$MANIFEST_PATH" 2>/dev/null || true
  if [ -t 0 ]; then
    echo ""
    echo "在 Chrome 开启开发者模式，点击‘加载已解压的扩展程序’，选择 Finder 中显示的目录。"
    printf '完成加载后按回车，我会打开插件设置页：'
    read -r _
    /usr/bin/open -a "Google Chrome" "chrome-extension://$EXTENSION_ID/options.html" 2>/dev/null || true
  fi
fi

echo ""
ok "安装步骤完成"
echo "如果 Chrome 已在运行，请 Cmd+Q 完全退出并重新打开一次，再在 Settings 点击 Test connection。"
echo "Starling AK/SK：https://starling.bytedance.net/personal_center#aksk"
echo "Inspire Writer：https://inspire.bytedance.net"
echo "Feishu Open Platform：https://open.feishu.cn/app"
report_progress 100 "安装准备完成"
