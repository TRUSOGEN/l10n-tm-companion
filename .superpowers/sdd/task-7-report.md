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
