# Task 7 实施报告：Headerless Sheet recovery 与 error actions

## 结论

Task 7 已完成。Headerless Sheet 现在固定返回 `incomplete/header_row_required`，不会生成 `headerRow`，候选布局保持 `confirmed: false`，仍需用户点击显式确认。

## 生产接线

- `popup.js` 接入 `toUiError`，新增并导出 `renderUiError(model, container)` 与 `executeUiErrorAction(actionId, context)`。
- Details 与 Copy Details 只消费 `toUiError.rawDetails`，因此复制内容与界面详情保持同一脱敏边界，并保留 Request ID/错误码。
- `open-settings` 调用 Chrome Options；`configure-sheet-layout` 展开工作表配置、显示布局区并真实聚焦 Source select；`retry` 执行原操作回调。
- `resume-archive` 必须从 workflow snapshot 读取既有 `roiArchivePlan.baseRunId` 与 vendor `runId`；缺少可恢复 Run ID 时正确失败。恢复路径不调用 `createRoiArchiveRunId()`。
- Sheet 与 archive catch 已接入 `toUiError`；archive retry/resume 回到同一持久化 archive plan。既有授权 controller/preflight、TM 与通用错误最终通过 actionable renderer 展示。
- 保持 Task 6 的 44px action target、focus 与可访问性样式；未改动 ROI 公式、vendor 覆盖、Final TM、Broker 权威和 40 条批次边界。

## TDD 与验证

- 新增行为测试 `test/popup-error-actions.test.js`，真实执行 Settings、布局 DOM 展开/Focus、Retry、Clipboard 与 snapshot Run ID Resume，而非只检查字符串。
- 更新 Sheet 测试，断言固定 reason、无臆造 header、显式确认状态。
- Focused：Task 7 四项相关测试与 JS syntax 全部通过。
- Full JS：`test/*.test.js` 全部通过。
- `node --check lib/sheet-layout.js`、`node --check popup.js` 通过。
- `git diff --check` 通过。

## 审查修复（2026-08-05）

- Renderer 的所有 action click handler 统一改为 `async`：动作执行期间禁用同组按钮，并设置 `aria-busy`。
- Handler 必须 `await executeUiErrorAction`；任何 action rejection 均在 handler 内捕获，不会形成 unhandled rejection。
- Catch 使用 `toUiError` 对 action error 再次脱敏，并在原容器重新渲染可恢复错误；旧按钮已被移除时，`finally` 不会错误恢复失效节点。
- 恢复动作仅由后续用户点击触发，不在 catch 中自动执行，避免递归 retry/error 死循环。
- 行为测试通过 renderer 生成的真实按钮执行并覆盖：retry 成功及 in-flight 状态、resume 成功及稳定 Run ID（重复点击仍复用同一 ID）、open-settings 引导、headerless Sheet 列映射恢复、copy-details 成功、retry rejection、Clipboard failure、snapshot 缺失；同时断言错误可见、Request ID 保留、敏感值删除和按钮状态恢复。
- 移除了原先对 `popup.js` 源码字符串（`createRoiArchiveRunId`）的断言，改为通过重复点击 resume 断言 Run ID 稳定性，避免脆弱的源码搜索型测试。

## 整分支审查修复（2026-08-05 下午）

Task 1 的脱敏实现在整分支审查中被判定为 Critical 阻塞，已按 TDD 重写（commit `0f01a5a fix: redact credentials by sensitive key roots`）：

- 敏感键判定从「精确拼写白名单」改为「归一化（仅字母数字、小写）后包含敏感词根」，词根包含 `secret / token / accesskey / apikey / authorization / password / credential / privatekey / signature / cookie`，并保留 `ak / sk / akid / pwd` 等短名精确匹配。这样 `feishuAppSecret`、`feishuAppSecretBackup`、`starlingSecretKey`、`starlingAccessKey`、`starlingAccessKeyId`、`appSecret`、`client_secret`、`accessToken`、`refreshToken`、`authToken`、`access_key_id`、`llmApiKey`、`userAccessToken`、`brokerCredential`、`keychainPassword` 全部命中。
- 字符串脱敏改为同时覆盖自由文本赋值与 JSON 形态：`{"access_key":"…"}`、`"secret_key": "…"`、`"user_access_token" : "…"` 都会被替换为 `[REDACTED]`，非敏感字段（如 `safeField`）原样保留。
- 新增值形态兜底：`AKLT` 前缀凭据串与裸 `Bearer <值>` 即使没有可识别键名也会被脱敏。
- 测试先红后绿，使用真实业务字段名与真实 JSON payload（`test/ui-errors.test.js` 新增三组断言，共 15 个产品字段 + 4 个 JSON 泄漏点 + 3 个值形态）。

Task 7 的两项审查修复（同日）：

- `renderUiError` 不再把 `<details>`/动作区直接 append 进调用方容器可能是 `<p>` 的场景：`<details>` 现在包在 `div.ui-error-details` 里，`popup.html` 的 `#sheet-layout-status` 由 `<p>` 改为 `<div>`（保留 `run-status` class），`#status` 增加 `aria-live="polite"`（commit `4ab2062`）。
- 错误文案支持语言感知：`toUiError(error, { locale })` 在 `zh-CN` 下返回中文标题/说明/按钮文案，action ID、错误码与脱敏详情不变，未知 locale 回退英文；`showUiError` 传入当前 `uiLanguage`（commit `8e7c9ed`）。
