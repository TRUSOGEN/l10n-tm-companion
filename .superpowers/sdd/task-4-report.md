# Task 4 Archive progress / ETA 实施报告

## 范围

- 基线：`86087d85c831a8b356d6817cfb0d5dd45b14070a`
- 任务：Archive progress / ETA 与 runtime 接线
- 日期：2026-08-05

## 实现

- 新增 `lib/archive-progress.js` 纯状态模型：
  - `createArchiveProgress()` 创建稳定初始状态。
  - `updateArchiveProgress()` 对乱序完成数与百分比取单调最大值，百分比不回退。
  - 仅接受正耗时样本并保留最近 8 个；少于 3 个样本时 `etaMs` 为 `null`。
  - 支持 A、C 同时 active；Complete 固定为 100%。
- 新增生产与测试共用的可执行 `renderArchiveProgress()`，测试直接导入并执行，不依赖仅字符串断言。
- Side Panel 新增：
  - `aria-live="polite"` 状态播报；
  - 原生 `progressbar` ARIA 属性；
  - Preparing / Original TM (A) / Final TM (C) / Calculating ROI / Writing to Feishu / Complete 阶段；
  - A/C active、language/request、elapsed/ETA 展示。
- `multilingual-runner` 的可选 `onProgress(event)` 在既有 A/C 请求完成边界发出白名单事件；事件不包含 source、Secret、AK/SK 或 token。
- Broker poll 增加可选 `onProgress(event)`，不改变轮询调度与终止条件。
- 保持既有 40 条 batch 估算、真实 Final TM、stable Run ID、失败重试与 resume 行为。
- 修复三个 popup VM 回归测试的依赖接线；未绕过测试，也未削弱 Broker 权威、pending outbox、stable Run ID 等原契约。

## TDD 与验证

### Focused regression

通过：

```text
node test/archive-progress.test.js
node test/popup-archive-progress.test.js
node test/multilingual-runner.test.js
node test/broker-async-roi.test.js
node test/popup-broker-confirmation.test.js
node test/popup-broker-failure-policy.test.js
node test/popup-broker-resume-archive.test.js
```

其中 Broker confirmation 35/35、failure policy 33/33、resume archive 16/16 通过。

### Full JS regression

执行 `./scripts/run-full-regression.sh`：全部 JS test files 通过并输出 `ALL_JS_TESTS_PASSED`；全部顶层 Python 测试、JS syntax 与 Native Host py compile 同时通过。脚本后续的 backend pytest 阶段输出 `BACKEND_TESTS_FAIL`，因此脚本总退出码为 1；该阶段不属于 Task 4 的 full JS regression，且脚本未输出更具体 backend 失败详情。

### 语法

以下均通过：

```text
node --check lib/archive-progress.js
node --check popup.js
node --check lib/multilingual-runner.js
node --check lib/broker-async-roi.js
```

### Diff

`git diff --check` 通过，无 whitespace error。

## 安全与不变量复核

- Progress event 采用显式白名单 shape，不传 scope/source 文本与 credential。
- A 与 C 可并发观测，但未改变现有 request limiter 或调度顺序。
- B 不计入请求进度或正式金额。
- Final TM 仍调用原 `queryFinalTm` 路径。
- Archive plan 继续复用既有 base Run ID / vendor Run ID；complete vendor 在 retry 时继续跳过。
- Broker 权威模式、pending final archive guard 和 resume 行为的既有回归全部通过。

## 审查修复（后续 commit）

针对 Task 4 审查阻塞完成以下修复：

1. Runner 与 Broker 均通过 safe emitter 调用进度观察者；观察者同步抛错被隔离，不改变查询、轮询、调度或业务返回。新增 callback throw 回归。
2. 生产 `pollActiveBrokerRun` 接受并真实调用 `onProgress`，Writing 与 Complete 事件进入同一 UI 观察路径；Broker authority、Run ID 与 archive guard 未改变。生产轮询测试覆盖两个阶段。
3. Renderer 明确分离 `progressTrack`（仅维护 ARIA）与 `progressFill`（仅维护视觉宽度），可执行 DOM 节点行为测试验证二者不会串写。
4. ETA 样本统一为“单请求耗时”：runner 通过 `sampleRequestCount` 将 scope 总耗时按请求数规范化。新增 100 rows / batch 40（每 operation 3 请求）测试，确认 ETA 不重复乘 batch 数。
5. 阶段使用固定有序状态机并取单调最大阶段；迟到的 A/C 事件不能将 Calculating ROI 等后续阶段回退，也不能重新激活已结束的 A/C。新增乱序测试。

复验结果：focused tests 全部通过；`./scripts/run-full-regression.sh` 再次输出 `ALL_JS_TESTS_PASSED`、`JS_SYNTAX_OK`，顶层 Python 与 native compile 也通过。脚本仍在既有 backend pytest 阶段输出 `BACKEND_TESTS_FAIL` 并以 1 退出。

## Broker terminal 语义修复

- 将 Broker archive 的 terminal 与 success 分离：`complete|failed|incomplete` 都会停止生产轮询，但只有 `archive_state=complete` 才发出 `phase=Complete` 并触发 100%。
- `failed` 与 `incomplete` 保持 `Writing to Feishu`/当前百分比，状态仍由既有 `syncBrokerRunStatus()` 错误或部分完成 UI 路径处理。
- 新增生产轮询行为测试：complete 发 Complete；failed/incomplete 均停止且绝不发 Complete。
- Focused regression、四文件语法检查与 `git diff --check` 通过；full JS regression 再次输出 `ALL_JS_TESTS_PASSED`。全量脚本仍仅在既有 backend pytest 阶段输出 `BACKEND_TESTS_FAIL`。
