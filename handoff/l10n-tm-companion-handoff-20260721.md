# L10n TM Companion Handoff — 2026-07-21

## 目标与当前结论

本轮把插件收敛为完整的 A → B → C 工作流：A 是原始英文文案，B 是 AI 英文改写候选，C 是 CD 在飞书 Spreadsheet 确认的最终送翻英文。正式 ROI 严格为 `TM Cost(A) - TM Cost(C)`；Score B 只供审阅，不进入正式金额。

当前普通 Spreadsheet 固定为 A-G：插件首次流程读取 A、写 B-F，G 只由人工选择 Yes/No；确认 C 时读取 D/G。Spreadsheet 和 Popup 不显示 ROI 金额。ROI_Test 只使用 `L10n ROI Runs` 与 `L10n ROI Scopes`，不再创建、读取或写入 `L10n ROI Items`，也不需要 Bitable Formula。

## 已实现状态

### A/B/C 与 Popup

- A 查询第一次真实 Starling TM，B 生成后查询第二次真实 TM，CD 确认 C 后查询第三次真实 TM。
- Popup 结果按当前可用 TM Score 从低到高排序，优先 Score C，其次 Score B，最后 Score A；缺分数条目排最后。
- Popup 关闭后，最近一轮 A/B/C 运行快照写入 `chrome.storage.local`，同一 Spreadsheet 重新打开可恢复；新运行清除旧快照，最长保留七天，快照不含凭证。
- 确认 C 时若读取到的最终 C 数量为 0，流程现在直接停止并提示核对 D、G、Working spreadsheet 和页签，避免继续生成一个误导性的 incomplete Run。
- 项目选择和 ROI language coverage 分别折叠；语言按项目折叠并可搜索、项目级 All/None。Vendor 切换后只展示该 Vendor 有精确按字费率的语言，避免隐藏不可计费 scope。

### ROI_Test 归档

- `L10n ROI Runs` 直接写入三个 Number 字段，无需公式：
  - `Full translation USD`：完整翻译参考成本。
  - `TM estimated USD`：原始 A 的 TM 预估成本。
  - `Saving USD`：正式 A-C 节省。
- `L10n ROI Scopes` 只保存 project × target locale 的覆盖状态和失败原因，不保存 TM Cost 或金额。
- Runs 的 `Pricing notes` 同时标记金额是完整整车结果还是已覆盖文案小计。
- 归档是 append-only；已经写入的旧 Run 不会被新版自动修改，验证新逻辑必须创建新 Run。

### incomplete 部分汇总修复

旧实现以 scope 为全有或全无边界：同一 project × locale 内任一文案失败，整个 scope 的全部可计算金额都会被排除。这是“总是 incomplete 且三个金额为空”的一个已确认代码原因。

当前 `summarizeMultilingualRoi()` 改为逐条汇总：

- 所有具有真实 A/C TM、精确费率和有效金额的文案进入 subtotal。
- scope 中存在失败文案时，Run 状态仍为 `incomplete`，Scopes 保留精确失败原因。
- `coveredSegmentCount` 记录本次实际进入金额汇总的文案数。
- incomplete Run 仍写入所有可计算文案的小计；只有一条文案都无法合法计算时，金额字段保持空白，禁止把未知值伪装成 0。
- 不能用 A-B 代替缺失的 A-C，也不能为缺失费率借用其他 Vendor 的价格。

### 飞书鉴权与权限

- 当前版本保留用户在 Settings 填写 Feishu App ID 与 App Secret 的模式，每个 Chrome profile 单独保存。
- Spreadsheet 与 ROI archive 使用应用凭证换取短期 `tenant_access_token`。
- 应用权限必须已发布；应用还必须是目标 Spreadsheet / Bitable 的可编辑协作者。仅在开放平台勾选 scope 不会自动获得文档访问权。
- Wiki ROI URL 需要解析到真实 Bitable object token；禁止猜 App Token。

### LLM、火山方舟与 Inspire

- 当前插件的 OpenAI-compatible 路径发送 Chat Completions 请求体：`model + messages + temperature`，并读取 `choices[0].message.content`。
- 火山方舟接入应在 Settings 选择 Custom，使用完整 `/api/v3/chat/completions` URL；推理接入点 ID 填 Model，不得填到 Endpoint。API Key 输入原值，代码负责添加 Bearer Header。
- 用户提供的火山方舟 `/api/v3/responses` + `stream: true` 示例当前不能直接使用，因为插件尚未实现 Responses 请求体、SSE 流和 `output_text` 解析。
- Inspire 目前只确认存在个人 OpenAPI Access Key；缺少可验证的 Base URL、API 路径、模型/Agent ID、鉴权 Header、网络限制和 curl 示例。不要用猜测地址接入。向 Inspire 团队索取一条完整可运行 curl 后再实现 preset。
- 本文不记录任何 API Key、App Secret、Starling AK/SK 或内部文档 token。

## 主要代码与文档

核心实现：

- `/Users/bytedance/my-project/l10n-tm-companion/popup.js`
- `/Users/bytedance/my-project/l10n-tm-companion/lib/multilingual-roi.js`
- `/Users/bytedance/my-project/l10n-tm-companion/lib/roi-bitable-archive.js`
- `/Users/bytedance/my-project/l10n-tm-companion/lib/feishu-sheets.js`
- `/Users/bytedance/my-project/l10n-tm-companion/lib/starling-tm.js`
- `/Users/bytedance/my-project/l10n-tm-companion/lib/ai-translate.js`
- `/Users/bytedance/my-project/l10n-tm-companion/native-host/starling-bridge.py`

当前正式文档：

- `/Users/bytedance/my-project/l10n-tm-companion/docs/user-guide.md`：面向使用者的完整教程。
- `/Users/bytedance/my-project/l10n-tm-companion/docs/multilingual-roi.md`：A-C、多语言和 incomplete 业务规则。
- `/Users/bytedance/my-project/l10n-tm-companion/docs/popup-configuration.md`：Popup、Vendor、项目、语言与鉴权规格。
- `/Users/bytedance/my-project/l10n-tm-companion/docs/roi-bitable-formulas.md`：文件名为历史兼容，内容已改为“无需公式的 ROI_Test 金额说明”。
- `/Users/bytedance/my-project/l10n-tm-companion/README.md`：项目入口与快速 CLI 参考。

关键回归测试：

- `/Users/bytedance/my-project/l10n-tm-companion/test/multilingual-roi.test.js`
- `/Users/bytedance/my-project/l10n-tm-companion/test/roi-bitable-archive.test.js`
- `/Users/bytedance/my-project/l10n-tm-companion/test/popup-fast-path.test.js`
- `/Users/bytedance/my-project/l10n-tm-companion/test/feishu-sheets.test.js`

## 验证状态

已执行并通过：

```bash
node --check popup.js
node --check lib/multilingual-roi.js
node --check lib/roi-bitable-archive.js
for test_file in test/*.test.js; do node "$test_file" || exit 1; done
```

完整 JavaScript 回归通过，包括：内容抓取 38、AI/TM 74、错误提示 17、Feishu Bitable 13、Feishu Sheets 127、多语言 ROI 7、New Match 49、Popup fast path 30、Popup run configuration 39、pricing rules 24、ROI archive 5、ROI calculation 22、Starling TM 25，以及其他入口/凭证测试。

尚未完成真实飞书 E2E：当前连接器的 user token 已失效，应用身份也未配置；Codex 内置浏览器打开目标 Wiki 时停在登录页。因此本轮没有读取用户真实 D/G 单元格，也没有在修复后执行新的真实 ROI archive 写入。

## Git 与交付边界

- `/Users/bytedance/my-project` 的父级 Git 当前把整个 `l10n-tm-companion/` 显示为 `?? l10n-tm-companion/`。
- 本轮没有 stage、commit、push 或创建 PR。
- 目录历史上存在凭证风险，禁止 broad-stage 整个未跟踪目录。若用户后续要求上传，先检查 tracking boundary、敏感文件、`.env`、keys、debug logs、Native Host 配置和打包 ZIP 内容。

## 下一会话优先步骤

1. 在 `chrome://extensions` 重新加载当前未解压扩展，确保不是旧代码。
2. 从目标 Spreadsheet 的正确页签打开 Popup，确认 Working spreadsheet 与当前页签一致。
3. 检查每个最终 C 行：D 非空、G 为 Yes；点击“确认最终 C，计算 Score C”，确认已确认数量等于 G=Yes 行数，并在结果卡片看到 Score C。
4. 新建一次 ROI archive，不要复用旧 Run；检查 Runs 的三个金额字段和 Pricing notes。
5. 若仍为 incomplete，读取对应 Scopes 的 `Failure reasons` 原值并保存截图/文本。优先区分 `final_source_text_missing`、`final_tm_missing`、`final_tm_query_failed`、`rate_missing_language_pair` 与 `roi_amount_invalid`。
6. 若所有 D/G 已确认但仍出现 `final_source_text_missing`，建立真实 A2:G 最小读回 fixture，核对 Wiki-backed Sheet 的实际 sheet ID、返回的 G 值类型和行号映射；不要继续猜原因。
7. 若要接 Inspire，先取得官方完整 curl；若要立即用火山方舟，先用 Chat Completions endpoint 做一次非流式 smoke test，再在插件 UI 验证英文 rewrite JSON。

## 必须保持的业务约束

- 正式 ROI 永远是 A-C；B 只供 CD 审阅。
- G 列永远由人工填写，插件不得自动确认。
- Spreadsheet 不显示 ROI 金额；Runs 显示整车或可计算文案小计，Scopes 只显示覆盖与失败原因。
- default TM 路径保持 Batch TM-only，不恢复 Key lookup 或 `/project/search`。
- `tm_source` 是英文 Best TM source evidence；`tm_match` 是目标语言复用翻译，不得互换。
- 费率必须精确匹配 Vendor + source + target；缺失即明确失败，不得借价或填零。

## Suggested skills

- `diagnosing-bugs`：真实飞书仍 incomplete 时，先建立 D/G → final C → ROI 的可重复失败闭环。
- `verification-before-completion`：真实写入后检查 Runs/Scopes 的字段值和输出语义，再宣称修复完成。
- `webapp-testing`：需要验证 Popup 关闭/恢复、折叠、语言选择和按钮门禁时使用。
- `handoff`：下一阶段结束后继续更新临时 handoff，并引用正式文档而不是复制规格。
- `credentials`：处理 Inspire、Ark、Starling 或 Feishu 凭证时使用，确保日志和交付物不泄露秘密。
