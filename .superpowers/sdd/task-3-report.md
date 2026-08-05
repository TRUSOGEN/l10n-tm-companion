# Task 3 修复报告：Archive summary 与 confirmation controller

## 审查反馈修复

1. 抽取 `lib/archive-confirmation.js`，导出 `createArchiveConfirmationController()` 与 `confirmThenRunArchive()`；controller 通过依赖注入接收 document、dialog、按钮、字段和 trigger。
2. 新增真实行为测试，实际触发 click/keydown，验证：打开聚焦 Start、Tab/Shift+Tab 循环、Escape/Cancel 返回 false、Start 返回 true、所有路径归还 trigger 焦点。
3. 新增 popup 编排测试：Cancel/Escape 的 runtime 调用为 0，Start 恰好调用 1 次；删除原有对应源码字符串搜索断言。
4. 新增 `buildVendorRoutes()`，生产 summary 直接读取 `deriveVendorRoiResults` 产生的真实 `scopeRuns[].rate.status` 与 `unservedScopes`，不再把所有 scopeRun 强制标成完整费率。
5. 真实 fixture 覆盖 ready rate、served 但 word rate incomplete、vendor unserved；仅 served 且 rate 不完整计 incomplete。
6. 请求估算固定为产品 A/C 两 pass，移除可变 passes；`total === original + final`，B 不计请求或金额。
7. row/language/batch 全部规范化为非负整数；batch 最小为 1。
8. stable Run ID、Broker authority、snapshot retry/resume、Final TM、batch=40 与 56 scope 边界未改变。

## TDD

- RED：`archive-confirmation.test.js` 首次因生产 controller 模块不存在失败。
- GREEN：实现可注入 controller 后，真实键盘/焦点/关闭行为全部通过。
- RED：summary 测试首次因缺少 `buildVendorRoutes` 导出失败。
- GREEN：从真实 vendor run/rate shape 建模后 fixture、incomplete 与 coverage 断言通过。

## 验证

- `node test/archive-confirmation.test.js`：通过。
- `node test/archive-summary.test.js`：通过；100×56、batch=40 为 A=168、C=168、总计=336。
- `node test/popup-archive-confirmation.test.js`：通过；Cancel/Escape=0 次 runtime，Start=1 次。
- `node test/popup-run-config.test.js`：70/70。
- `node test/popup-broker-failure-policy.test.js`：33/33。
- `node test/popup-broker-confirmation.test.js`：35/35。
- `node test/popup-broker-resume-archive.test.js`：16/16。
- `node test/roi-analytics-archive.test.js`：45/45。
- `node test/roi-bitable-archive.test.js`：19/19。
- 完整 JS regression：`for test_file in test/*.test.js; do node "$test_file" || exit 1; done` 通过。
- 语法：`node --check lib/archive-confirmation.js lib/archive-summary.js popup.js` 通过。
- `git diff --check`：通过。

## Concerns

无已知功能阻塞或回归。Task 6 全局视觉重构仍未提前实施。
