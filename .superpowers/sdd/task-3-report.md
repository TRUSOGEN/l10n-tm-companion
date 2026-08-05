# Task 3 实施报告：Archive summary 与 inline confirmation

## 变更

- 新增纯函数模块 `lib/archive-summary.js`：
  - `estimateTmRequests()` 固定按 batch=40 估算 A/C 请求；B 不进入正式请求或金额口径。
  - `summarizeArchive()` 汇总 source/confirmed/language、RWS/Pactera/unpriced coverage、请求数与时长区间。
  - `served:false` 视为正常未服务路由；仅 `served:true && completeRate:false` 计 incomplete。
- Popup 归档入口移除 `window.confirm`，改为 inline modal：
  - `role=dialog`、`aria-modal`、label/description。
  - Escape、Tab focus trap、Cancel、Start、关闭后焦点归还。
  - 仅 Start 进入既有 archive runtime；测试 hook 继续直接覆盖既有 broker/runtime 回归。
- 保持既有 stable Run ID、snapshot 重试、broker authority、Final TM、56 scope 与 vendor archive 流程不变。
- Modal 展示 A/C 正式口径，明确 B 不计请求/金额；适配窄 Side Panel，按钮最小高度 44px，并提供可见 focus。

## TDD 记录

1. RED：`node test/archive-summary.test.js` 因 `lib/archive-summary.js` 不存在而失败。
2. GREEN：新增纯模块后通过；100 rows × 56 languages × ceil(100/40) 得到 A=168、C=168、总计=336。
3. UI RED：先更新 popup contract test，确认 dialog/动作/正式口径及移除 `window.confirm` 的断言失败。
4. UI GREEN：接入 modal、键盘行为、焦点归还与既有 runtime 边界后通过。

## 验证

- Focused：
  - `node test/archive-summary.test.js`：通过。
  - `node test/popup-run-config.test.js`：74/74 通过。
  - `node test/popup-broker-failure-policy.test.js`：33/33 通过。
- Archive/Broker：
  - `node test/popup-broker-confirmation.test.js`：35/35 通过。
  - `node test/popup-broker-resume-archive.test.js`：16/16 通过。
  - `node test/roi-analytics-archive.test.js`：45/45 通过。
  - `node test/roi-bitable-archive.test.js`：19/19 通过。
- 完整 JS regression：`for test_file in test/*.test.js; do node "$test_file" || exit 1; done`：通过。
- 语法：`node --check lib/archive-summary.js && node --check popup.js`：通过。
- Diff：`git diff --check`：通过。

## Concerns

- 无已知功能阻塞或回归。
- 未实施 Task 6 的全局视觉 token/motion 重构；本任务样式仅限定在 archive confirmation。
