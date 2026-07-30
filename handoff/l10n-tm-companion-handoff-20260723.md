# L10n TM Companion Handoff — 2026-07-23

## 当前状态

- 版本：`1.1.5`
- 分支：`main`
- HEAD：`a678f53`
- Git：本轮未 commit、未 push；工作区在开始前已有大量本地修改，本轮没有 broad stage。
- 活动 Chrome 加载目录：`/Users/bytedance/L10n TM Companion - Chrome 加载这个文件夹`
- 固定扩展 ID：`bgbodpcofifiloekhfjiffmchcaiiicm`

## 本轮完成

- 原样加入 `cd-content-review-version-2`、Content Review Principles、Style Guide、Glossary、Game Legal Guidelines 与 Revenue Legal Guidelines，并在 `SNAPSHOT.md` 记录 2026-07-23 快照和 SHA-256。
- Inspire prompt 读取 Skill 核心规则、完整 Principles、相关 Style/Glossary 证据，并按明确 gaming 语义只选择一份 Legal Guidelines。
- Inspire 结构化 JSON revision 会解析为可写入的英文 source；候选保留可读 revision 与原始 revision。
- 结果卡片保持 Sheet 原始行号顺序，提供 `保持原文 A`、`使用 AI 候选 B`、`人工编辑`。
- URL、placeholder、模板 token 或数字改变，或真实 Score B 未高于 Score A 时，默认保持 A。
- TM 模板只在 UI 生成可读预览，原始 TM source 继续保留用于审计。
- Working spreadsheet 缺失不再误报为 TM 配置错误。
- Inspire task `completed` 后第一次 copies 为空时，对同一 task 最多执行两次额外只读读取，不创建新 task；最终失败会报告安全的响应形状与 prompt 字符数。
- ROI archive 固定为 `https://bytedance.larkoffice.com/wiki/J1RJwEf0FijMQQkceUkcZyqCnJc?table=tbls3B039S6J7zdT&view=vewSwbY6Ry`；Settings 不再提供 URL 输入框，历史 `roiArchiveUrl` 会被清理且不能覆盖底层固定目标。
- ROI archive 按钮只依赖最终 C 验证和有效 ROI 结果；确认窗口始终展示固定 ROI_Test，底层 Wiki node 解析、schema 校验与 Run/Scope 写入流程保持不变。
- 当前规格、用户手册、离线手册、历史入口文档、E2E checklist 与版本号已同步。

## 验证

- 全部 JavaScript 测试通过。
- Python：Batch TM 24/24、Search Key 21/21、unittest 18/18 通过。
- 本轮相关最终测试：Content Review、Source policy、AI E2E 95/95、Errors 21/21、Popup fast path 30/30、i18n、Installer contract 全部通过。
- `git diff --check` 通过。
- Installer.app ad-hoc 深度签名验证通过。
- 内置 Node 与进度程序均为 `x86_64 arm64`。
- ZIP 完整性验证通过；v1.1.5 SHA-256：`0c91d9c08456afd0078a43de1a939aa9c09f8d478c04fce52172d81b4722ecd4`。
- 隔离 HOME 真实安装通过：Python 3.9.6、Node 24.16.0、Starling CLI 1.1.24、bridge ping、官方签名客户端与 Native Host 注册均成功。
- 本机活动目录真实升级通过，manifest 为 1.1.5；固定 URL、无配置入口和关键文件与源码 SHA-256 一致，安装日志确认 bridge、Starling 客户端与 Native Host 正常。

## 交付位置

- 正式目录：`/Users/bytedance/my-project/L10n-TM-Companion-线下安装包`
- Installer：`/Users/bytedance/my-project/L10n-TM-Companion-线下安装包/安装 L10n TM Companion.app`
- ZIP：`/Users/bytedance/my-project/L10n-TM-Companion-线下安装包/L10n-TM-Companion-macOS.zip`
- 使用手册：`/Users/bytedance/my-project/L10n-TM-Companion-线下安装包/使用手册.md`
- 旧正式包备份：`/private/tmp/L10n-TM-Companion-线下安装包-pre-1.1.3-20260723`
- v1.1.3 正式包备份：`/private/tmp/L10n-TM-Companion-线下安装包-pre-1.1.4-20260723`
- v1.1.4 正式包备份：`/private/tmp/L10n-TM-Companion-线下安装包-pre-1.1.5-20260723`
- 旧活动目录完整备份：`/private/tmp/L10n-TM-Companion-installed-v1.1.2-backup-20260723`
- Installer 自动备份：`/Users/bytedance/Library/Application Support/L10n TM Companion/extension.previous`

## 权限与外部验证边界

- Starling 本机 bridge 和固定 CLI 已验证。
- 本轮没有调用真实 Inspire 生成，因此不能声称线上输出质量、额度或延迟已验证。
- 本轮没有执行真实 Feishu Sheet 写回，因此不能声称目标表权限和最终写回 E2E 已验证。
- 本轮没有向固定 ROI_Test 写入测试记录；真实 Wiki/Bitable 权限、已有 schema 与首条归档仍需用户确认后的 E2E 验证。
- Chrome 已识别固定扩展 ID；若 Chrome 正在运行，需要 `Cmd+Q` 完全退出并重开，或在 `chrome://extensions` 点击刷新，才能让当前进程加载 v1.1.5。

## 下一步

- 重启或刷新 Chrome 扩展。
- 用一小批同时包含普通、game、Glossary 命中、placeholder/数字和 TM 模板的真实 Sheet 样本跑一轮 Inspire + Starling + Feishu E2E，检查默认选择和最终写回。
- 确认样本效果后，再按用户明确指令决定是否整理、提交和推送当前脏工作区。
