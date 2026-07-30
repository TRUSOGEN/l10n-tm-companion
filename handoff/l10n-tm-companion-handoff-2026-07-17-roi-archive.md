# L10n TM Companion 交接：ROI 多维表格归档已完成

**更新时间**：2026-07-17。  
**代码目录**：`/Users/bytedance/my-project/l10n-tm-companion/`。  
**状态**：用户指定的 test003 A 列 ROI 已计算、归档并在云端复核完成。

## 本轮完成结果

- 输入来自用户指定的 `test003` 飞书表格 A 列，共 25 条 source segment。
- 实测 scope：`live_client · en→ar`，项目 `513`；全量翻译 USD 7.5991，TM 估算 USD 2.8601，预计节省 USD 4.7390。
- ROI_Test Bitable 已有两张专用表：`L10n ROI Runs` 和 `L10n ROI Scopes`。
- 两张表各有一条本次运行记录。Runs 保存汇总，Scopes 保存 `en → ar`、25 条 source segment 和 `complete` 状态。
- Popup 在归档后返回 `complete`；随后通过 ROI_Test 云端页面实际核验了两张表、Runs 记录和 Scopes 记录。

## OAuth 与实现状态

- ROI Bitable 表、字段和记录操作使用本机 Native Host 取得的短期 Feishu `user_access_token`；不得回退为应用身份或 `tenant_access_token`。
- 回调地址固定为 `http://localhost:39641/l10n-tm-companion/oauth/callback`。
- 当前 OAuth scope 定义在 `native-host/feishu_oauth.py` 的 `ROI_ARCHIVE_SCOPE`，包含表读取/创建、字段读取、记录创建/更新和 Bitable block 读取/更新。
- 已修复真实 API 的建表响应兼容：`lib/roi-bitable-archive.js` 接受 `data.table_id`，同时兼容旧的嵌套返回形式。
- 用户已经在开放平台开通、发布并重新授权了上述权限。令牌为短期凭证，过期后在 Settings 使用 `Connect Feishu for ROI archive` 重新授权即可；不要记录或输出令牌、授权码、App Secret。

## 验证与参考

- 真实过程、各次权限缺口与最终云端复核记录在 `temp/test_roi_bitable_archive/verification.md`。
- 配置和用户操作说明见 `docs/popup-configuration.md`、`docs/E2E-CHECKLIST.md` 和 `docs/multilingual-roi.md`。
- 归档设计和字段 schema 见 `docs/superpowers/specs/2026-07-17-roi-bitable-archive-design.md`。
- 本轮已通过全部 JS 测试、Python 测试、JS syntax check 与 Native Host Python compile；实际执行命令和测试输出可由本次会话记录追溯。
- 旧的业务/LLM 接入背景与尚未处理的 `buildRewritePrompt()` 中 `tm_source` 使用问题见 `handoff/l10n-tm-companion-handoff-2026-07-17.md`；不要在没有明确任务时改动该部分。

## 后续接手建议

1. 若用户再次测试归档，先在 test003（或用户指定的新 Sheet）运行 TM，再在 Results 点击 `Write ROI archive`；确认框会显示目标和记录数量。
2. 如遇 Feishu `99991672` 等权限错误，先看接口错误中缺失的用户身份 scope，确认该权限已开通、发布并完成一次新的 OAuth 授权，再改代码。
3. 不要把 Run/Scope 归档写入普通 Spreadsheet，也不要修改用户已有 ROI_Test 表、视图或数据。
4. 插件目录在父仓库仍为 untracked，且历史源码存在敏感信息风险；未经专门审计，不执行整目录 `git add`、提交或推送。

## Suggested skills

- `systematic-debugging`：处理后续 Feishu OAuth、权限或 Bitable API 失败。
- `test-driven-development`：调整归档 schema、状态机或数据映射前新增回归测试。
- `brainstorming`：用户准备推进英文 rewrite / 公司 LLM 能力时先冻结业务边界和数据约束。
- `starling-shared`：需要查询 Starling 平台、项目权限或 TM 数据时使用。
