#!/bin/bash
# 双击安装.command — macOS 双击即可启动安装
# ============================================
# 双击本文件 → 自动用「终端」打开 → 跑 native-host/install.sh 完成安装。
# 不用手动 cd、不用手敲命令。

# 定位到自己所在目录（双击时工作目录是 $HOME，必须自己找路径）
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR/native-host" || { echo "❌ 找不到 native-host 目录，确认本文件在 l10n-tm-companion/ 根目录下"; read -p "按回车关闭"; exit 1; }

echo "========================================"
echo " L10n TM Companion 双击安装"
echo "========================================"
echo ""

# 跑统一安装脚本，并保留真实退出状态。
INSTALL_STATUS=1
if [ -f ./install.sh ]; then
  ./install.sh
  INSTALL_STATUS=$?
else
  echo "❌ 未找到 install.sh，请确认安装包完整。"
fi

echo ""
echo "----------------------------------------"
if [ "$INSTALL_STATUS" -eq 0 ]; then
  echo "✅ 安装流程完成。"
else
  echo "❌ 安装失败，请按上面的错误提示处理。"
fi
echo "----------------------------------------"
# 双击启动时，终端跑完会一闪而过，这里停住让用户看到结果
read -p "按回车键关闭此窗口..."
exit "$INSTALL_STATUS"
