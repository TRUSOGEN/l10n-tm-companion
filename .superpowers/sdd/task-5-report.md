# Task 5 修复报告

## 最终实现

- `popup.js` 真实导入并调用 `buildReviewPresentation`；卡片与 Focus View 均通过 `reviewPresentationForItem()` 构建同一 model，并由 `createReviewPresentationElement()` 渲染，不再分别计算 A/B/C 展示口径。
- UI 真实展示 official `Cost(A)-Cost(C)`、负值 warning、safe rewrite 无 TM 提升固定文案，以及安全门禁失败原因；B 仅作为审阅证据，永不进入金额。
- Vendor coverage 由 `deriveVendorRoiResults()` 的 RWS/Pactera 双 vendor 真实结果，经 `buildVendorRoutes()` 和 `formatVendorCoverage()` 生成；不再读取第一个 vendor summary。
- `buildVendorRoutes()` 从真实 scope run 的 rate、原始 TM 和 confirmed final TM 字段推导 completeness；无观测值保持 incomplete，unserved 仅作正常路由，不报错。
- 保持现有 Bitable `Pricing notes` locale routing 与官方金额边界。

## TDD 与测试

- RED：新增 DOM renderer 行为测试首先因 `review-presentation-view.js` 不存在失败；真实 route completeness 断言随后推动 unknown 不得伪 complete。
- GREEN：`test/review-presentation.test.js` 使用真实 model、真实 DOM renderer、真实 `deriveVendorRoiResults/buildVendorRoutes/formatVendorCoverage` 覆盖卡片/Focus 共用行为、warning、文案和双 vendor coverage。
- 同步：`archive-summary`、`popup-responsive-review-ui` 以及三个 Popup Broker sandbox 测试。

## 验证结果

- Task 5 focused：`review-presentation`、`archive-summary`、`review-workflow`、`popup-responsive-review-ui`、`roi-analytics-archive` 全部通过。
- Full regression：全部 JS 测试通过；全部顶层 Python 测试通过；JS syntax 通过；Native Host Python compile 通过。
- Backend pytest：环境缺少 pytest，`python3 -m pytest -q` 返回 1：`No module named pytest`；遵循计划未安装依赖，因此 full regression 最终退出码为 1。
- `git diff --check`：通过。

## 边界

未实施 Task 6 全局 token、motion 或全局视觉改造。
