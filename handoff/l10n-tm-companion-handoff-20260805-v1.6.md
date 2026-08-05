# L10n TM Companion v1.6 本地发布交接（2026-08-05）

## 发布身份

- 版本：`1.6.0`
- 分支：`codex/publish-v1.5.0`
- 发布准备提交：`5b39c87944241b5d07a4884a441dfa8a3dc70421`
- 最终文档提交：`docs: hand off offline package v1.6.0`（即包含本文的最终 HEAD；精确 hash 以 `git rev-parse HEAD` 为准，提交内容无法自包含自身 hash）
- 状态：仅本机提交，未 push。

## v1.6 变化

Review UI 已紧凑化：Review details 默认折叠，A→B→C 方法论只在顶部展示一次，卡片不再重复；相同原因聚合到 Decision notes 并显示影响条数。Secret 缺失时由错误卡直接引导到 Secret Settings。ROI 归档前显示行数、语言、vendor coverage、A+C 请求量和预计时长，归档中显示阶段、进度、Elapsed 与 ETA。

## Task 1–9 核心能力

1. 从任意授权 Spreadsheet/Wiki Sheet 识别来源列、真实行号和六列输出布局。
2. Starling Top-3 TM 批量查询，固定扩展 ID，默认 40 条/批、最多 5 批并发。
3. 仅对 `50 ≤ Score A < 85` 的 source 创建 Inspire task，并保留最多三个安全候选。
4. Review/Focus 支持例外编辑、单条确认和批量确认剩余项。
5. Final TM 与 Sheet 六列写入均成功后才标记 Saved/confirmed。
6. ROI 自动覆盖项目共同支持的非英语语言，RWS/Pactera 复用同一 TM snapshot。
7. 归档到 Runs/Scopes/Items，包含 operator、coverage、漏斗、失败原因与 source audit。
8. 归档摘要、可取消确认、断点恢复、单调进度和 ETA 均保留真实状态。
9. OAuth Broker/异步 ROI Backend 为关闭态能力；生产网关、身份和 Secret Manager 门禁完成前不得开启。

## ROI 口径

正式金额固定为 `Cost(A) − Cost(C)`。候选 B 仅供决策，不进入正式金额，也不计入归档摘要的 A+C TM 请求量；B 的分数下降或持平不会伪装成收益。vendor 不服务某语言属于正常路由，只有服务范围内缺精确按字费率才标记 incomplete。

## Secret 安全

App Secret 只允许由获准 Owner 通过 macOS 隐藏输入写入 Keychain；Settings 只显示 Configured，不回显明文。AK/SK、token、Access Key 与 Secret 不进入 ZIP、handoff、截图或聊天。错误详情与前台日志脱敏，后台日志只保留错误类型/代码。普通用户扩大分发前必须启用 OAuth Broker，不能分发 App Secret。

## 交付制品

- 路径：`/Users/bytedance/my-project/L10n-TM-Companion-线下安装包/L10n-TM-Companion-v1.6.0-macOS.zip`
- 大小：`106911552` bytes
- SHA-256：`efc24f10b5ed679f6dcf9d9023e160bfe4d640ef20027fc00a88c5c75a79898d`
- 兼容文件名：同目录 `L10n-TM-Companion-macOS.zip`

包含：安装 App、使用手册、Chrome 扩展、manifest、Native Host、`install.sh`、Starling bridge、飞书/OAuth/ROI bridge、私有 universal Python、Node.js、Starling CLI 及固定 keytar runtime。未执行实际安装器，避免改写本机 Native Host 配置。

## 校验与测试

- 初始工作区 clean，HEAD 含 `ead617e0`。
- installer contract：53 passed，0 failed。
- 全部 JavaScript tests：通过（`ALL_JS_TESTS_PASSED`）。
- JavaScript syntax：通过（`JS_SYNTAX_OK`）。
- 全部仓库 Python 脚本测试：通过（`ALL_PYTHON_TESTS_PASSED`）。
- Native Host Python compile：通过（`PY_SYNTAX_OK`）。
- `git diff --check`：通过。
- `./scripts/run-full-regression.sh`：执行到 Backend pytest 阶段；此前各阶段通过，随后因系统 Python 报 `No module named pytest` 停止。按要求未安装依赖，不宣称全量全绿；Backend compileall 因脚本提前退出未执行。
- ZIP `unzip -t`：通过；解包后 manifest=`1.6.0`，扩展 ID=`bgbodpcofifiloekhfjiffmchcaiiicm`。
- 必需安装 App、手册、Native Host、`install.sh`、Starling bridge 与私有 runtimes：存在。
- 项目 payload 无 `.git`、worktree、`.superpowers`、项目 test/handoff；未发现 AK/SK/Secret 真实值。私有 Python 标准库/第三方运行时自身带有上游测试模块，这是既有完整 runtime 的组成部分，不是仓库测试或 handoff。

## 接收者后续动作与残留风险

1. 双击 v1.6 安装 App；在 Chrome 开发者模式重新加载桌面稳定目录，点击扩展刷新，并 `Command + Q` 完全退出 Chrome 后重开。
2. 校验扩展版本 1.6.0 和固定 ID；执行 Native Host connection、AK/SK Verify、Feishu Authorize/Secret Settings 引导。
3. 用受控数据完成 `100 行 × 56 语言` E2E：预期每个语言 A/C 各 `ceil(100/40)=3` 批，共 `336` 个 TM 请求；核对摘要、进度、ETA、Decision notes、断点恢复、Runs/Scopes/Items 和 A−C 金额。
4. 残留风险：Backend pytest 未运行（环境缺 pytest）；未执行真实安装器；未做真实 Starling PPE、Feishu、Inspire、OAuth Broker 和 100×56 E2E；安装 App 仅 ad-hoc 签名，未做 Developer ID notarization；生产 Broker feature flags 继续关闭。
