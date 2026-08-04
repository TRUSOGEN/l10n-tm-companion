#!/bin/bash
# 构建可线下分发的 macOS 自包含安装包。
#
# 输出目录外层只包含安装器、使用手册和一个便于发送的 ZIP；插件源码、
# Native Host 与运行数据封装在 Installer.app 的 Resources 中。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEFAULT_OUTPUT="$(cd "$PROJECT_ROOT/.." && pwd)/L10n-TM-Companion-线下安装包"
OUTPUT_DIR="${1:-$DEFAULT_OUTPUT}"
APP_NAME="安装 L10n TM Companion.app"
MANUAL_NAME="使用手册.md"
ARCHIVE_NAME="L10n-TM-Companion-macOS.zip"
SOURCE_APP="$PROJECT_ROOT/L10n TM Companion Installer.app"
SOURCE_MANUAL="$PROJECT_ROOT/docs/offline-install-manual.md"
PROGRESS_SOURCE="$PROJECT_ROOT/installer-ui/installer-progress.m"
NODE_VERSION="24.16.0"
STARLING_VERSION="1.1.41"
PYTHON_FRAMEWORK="/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework"

if [ -e "$OUTPUT_DIR" ]; then
  echo "构建已停止：输出目录已存在，请先确认其中的文件：$OUTPUT_DIR"
  exit 1
fi

STAGING_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/l10n-offline-package.XXXXXX")"
cleanup() {
  /bin/rm -rf "$STAGING_ROOT"
}
trap cleanup EXIT

PACKAGE_ROOT="$STAGING_ROOT/L10n TM Companion"
APP_PATH="$PACKAGE_ROOT/$APP_NAME"
PAYLOAD_PATH="$APP_PATH/Contents/Resources/extension"
RUNTIME_PATH="$PAYLOAD_PATH/runtime"

mkdir -p "$PACKAGE_ROOT" "$PAYLOAD_PATH"
/usr/bin/ditto --noqtn "$SOURCE_APP" "$APP_PATH"

# 编译无第三方依赖的 universal 原生进度窗口，接收者机器无需开发工具。
/usr/bin/clang -fobjc-arc -framework Cocoa -mmacosx-version-min=11.0 \
  -arch arm64 -arch x86_64 "$PROGRESS_SOURCE" \
  -o "$APP_PATH/Contents/MacOS/l10n-progress"

copy_file() {
  local relative_path="$1"
  local destination="$PAYLOAD_PATH/$relative_path"
  if [ ! -f "$PROJECT_ROOT/$relative_path" ]; then
    echo "安装包缺少必需文件：$relative_path"
    exit 1
  fi
  mkdir -p "$(dirname "$destination")"
  /usr/bin/ditto --noqtn "$PROJECT_ROOT/$relative_path" "$destination"
}

for relative_path in \
  manifest.json background.js content.js \
  options.html options.css options.js \
  popup.html popup.css popup.js \
  data/local-rates.json \
  docs/user-guide.md docs/offline-install-manual.md \
  native-host/install.sh native-host/launch-bridge.sh native-host/starling-bridge.py native-host/feishu_oauth.py \
  native-host/feishu_oauth_broker.py native-host/roi_broker_client.py \
  native-host/starling-batch-client.js native-host/starling-key-batch-client.js \
  native-host/starling-credentials-client.js; do
  copy_file "$relative_path"
done

for source_dir in icons lib skills/cd-content-review-version-2; do
  mkdir -p "$PAYLOAD_PATH/$source_dir"
  /usr/bin/rsync -a --exclude='.DS_Store' --exclude='._*' \
    "$PROJECT_ROOT/$source_dir/" "$PAYLOAD_PATH/$source_dir/"
done

# 私有 Python：最终写入 extension/runtime/bin，不读取、覆盖或卸载用户已有 Python。
if [ ! -x "$PYTHON_FRAMEWORK/Versions/Current/bin/python3" ]; then
  echo "构建机缺少可打包的 universal Python framework：$PYTHON_FRAMEWORK"
  exit 1
fi
mkdir -p "$RUNTIME_PATH/python" "$RUNTIME_PATH/bin" "$RUNTIME_PATH/starling/node_modules/@byted"
/usr/bin/ditto --noqtn "$PYTHON_FRAMEWORK" "$RUNTIME_PATH/python/Python3.framework"

# 私有 universal Node：固定官方 LTS 版本并按官方 SHA256 清单校验。
NODE_CACHE="$STAGING_ROOT/node-downloads"
mkdir -p "$NODE_CACHE"
curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" -o "$NODE_CACHE/SHASUMS256.txt"
for architecture in arm64 x64; do
  archive="node-v${NODE_VERSION}-darwin-${architecture}.tar.gz"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/${archive}" -o "$NODE_CACHE/$archive"
  expected="$(awk -v file="$archive" '$2 == file { print $1 }' "$NODE_CACHE/SHASUMS256.txt")"
  actual="$(/usr/bin/shasum -a 256 "$NODE_CACHE/$archive" | awk '{ print $1 }')"
  [ -n "$expected" ] && [ "$expected" = "$actual" ] || {
    echo "Node 下载校验失败：$archive"
    exit 1
  }
  /usr/bin/tar -xzf "$NODE_CACHE/$archive" -C "$NODE_CACHE"
done
/usr/bin/lipo -create \
  "$NODE_CACHE/node-v${NODE_VERSION}-darwin-arm64/bin/node" \
  "$NODE_CACHE/node-v${NODE_VERSION}-darwin-x64/bin/node" \
  -output "$RUNTIME_PATH/bin/node"

# Starling CLI 固定为构建机已验证版本；接收者电脑无需 npm 或全局安装。
STARLING_ROOT="$(npm root -g)/@byted/starling-agent-cli"
if [ ! -f "$STARLING_ROOT/dist/index.js" ]; then
  echo "构建机缺少 @byted/starling-agent-cli，请先在维护环境安装固定版本。"
  exit 1
fi
INSTALLED_STARLING_VERSION="$(node -p "require('$STARLING_ROOT/package.json').version")"
if [ "$INSTALLED_STARLING_VERSION" != "$STARLING_VERSION" ]; then
  echo "构建机 Starling CLI 版本不匹配：需要 $STARLING_VERSION，当前 $INSTALLED_STARLING_VERSION"
  exit 1
fi
/usr/bin/ditto --noqtn "$STARLING_ROOT" "$RUNTIME_PATH/starling/node_modules/@byted/starling-agent-cli"

# keytar 含原生模块；额外用 x64 Node 构建同版本依赖，再合成为 universal bundle。
X64_PREFIX="$STAGING_ROOT/starling-x64"
/usr/bin/arch -x86_64 "$NODE_CACHE/node-v${NODE_VERSION}-darwin-x64/bin/node" \
  "$NODE_CACHE/node-v${NODE_VERSION}-darwin-x64/lib/node_modules/npm/bin/npm-cli.js" \
  install "@byted/starling-agent-cli@${STARLING_VERSION}" \
  --prefix "$X64_PREFIX" --registry https://bnpm.byted.org \
  --arch=x64 --target_arch=x64 --no-audit --no-fund
ARM_KEYTAR="$RUNTIME_PATH/starling/node_modules/@byted/starling-agent-cli/node_modules/keytar/build/Release/keytar.node"
X64_KEYTAR="$X64_PREFIX/node_modules/keytar/build/Release/keytar.node"
if [ ! -f "$ARM_KEYTAR" ] || [ ! -f "$X64_KEYTAR" ]; then
  echo "Starling CLI keytar 原生模块不完整，无法构建 universal 安装包。"
  exit 1
fi
/usr/bin/lipo -create "$ARM_KEYTAR" "$X64_KEYTAR" -output "$ARM_KEYTAR.universal"
/bin/mv "$ARM_KEYTAR.universal" "$ARM_KEYTAR"
/usr/bin/ditto --noqtn "$PROJECT_ROOT/runtime-templates/bin/python3" "$RUNTIME_PATH/bin/python3"
/usr/bin/ditto --noqtn "$PROJECT_ROOT/runtime-templates/bin/starling-cli" "$RUNTIME_PATH/bin/starling-cli"

chmod +x "$APP_PATH/Contents/MacOS/l10n-installer"
chmod +x "$APP_PATH/Contents/MacOS/l10n-progress"
chmod +x "$PAYLOAD_PATH/native-host/install.sh" "$PAYLOAD_PATH/native-host/starling-bridge.py"
chmod +x "$PAYLOAD_PATH/native-host/launch-bridge.sh" "$RUNTIME_PATH/bin/python3" \
  "$RUNTIME_PATH/bin/node" "$RUNTIME_PATH/bin/starling-cli"

# Ad-hoc 签名只保证包体完整性；正式外部分发仍需 Apple Developer ID 与 notarization。
/usr/bin/codesign --force --deep --sign - "$APP_PATH"
/usr/bin/codesign --verify --deep --strict "$APP_PATH"

/usr/bin/ditto --noqtn "$SOURCE_MANUAL" "$PACKAGE_ROOT/$MANUAL_NAME"
mkdir -p "$OUTPUT_DIR"
/usr/bin/ditto --noqtn "$APP_PATH" "$OUTPUT_DIR/$APP_NAME"
/usr/bin/ditto --noqtn "$PACKAGE_ROOT/$MANUAL_NAME" "$OUTPUT_DIR/$MANUAL_NAME"

# ZIP 不需要 Finder resource fork；显式关闭扩展属性，避免 __MACOSX/._* 污染交付物。
/usr/bin/ditto -c -k --norsrc --noextattr --keepParent "$PACKAGE_ROOT" "$OUTPUT_DIR/$ARCHIVE_NAME"

echo "线下安装包已生成：$OUTPUT_DIR"
echo "外层文件：${APP_NAME}、${MANUAL_NAME}、${ARCHIVE_NAME}"
