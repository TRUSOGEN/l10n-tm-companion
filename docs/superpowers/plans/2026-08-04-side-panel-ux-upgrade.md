# Side Panel UX Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变 ROI、TM、Broker、vendor 和凭据安全边界的前提下，将 Chrome MV3 Side Panel 升级为可解释、可恢复、可访问的本地化审计控制台，并为 56 语言归档提供可信摘要、进度和 ETA。
**Architecture:** 保留 `popup.js` 作为 DOM/runtime 编排层；新增 `lib/ui-errors.js`、`lib/archive-summary.js`、`lib/archive-progress.js` 三个无 DOM 纯 ESM 模块。Settings 消费 hash/持久化导航意图；现有 archive runtime、stable Run ID、snapshot 和 Broker 路径仅增加观测与渲染接线。
**Tech Stack:** Chrome Extension Manifest V3 Side Panel、Vanilla JavaScript ESM、HTML、CSS、Node assert 测试、现有 shell/Python 回归；无构建链，不新增框架或依赖。
## Global Constraints

- 正式 ROI 始终为 `Cost(A) - Cost(C)`；B 只辅助审阅，绝不进入金额；Final TM 必须真实查询。
- Broker 权威模式不得 silent fallback 到 legacy local auth。vendor 不跨语言借价、不填 0；“不服务”是正常路由。
- 保持 56 个非英文语言完整 scope、每批 40 条边界、Sheet 只写 confirmed final。
- retry/resume 复用 stable Run ID 和断点快照，不重复创建已完成 vendor Run。
- Secret、AK/SK、token 不进入日志、错误详情、测试/运行快照或 handoff；脱敏后仍保留 Request ID/错误码。
- 保留 Workflow/Review Tab、四步 Stepper、sticky action bar、现有关键 DOM ID 和字符串契约；必要时同步测试。
- `popup.js` 只编排；计算放纯模块。每任务独立 review/commit，严格 RED→确认失败→最小实现→确认通过→commit。
- 主 Agent 已选择 Subagent-Driven，不询问执行方式；不安装新前端框架、构建链或依赖。

---

## Task 1: Friendly errors 纯模型与安全详情

**Depends on:** 无。

**Files**
- Create: `lib/ui-errors.js`
- Create: `test/ui-errors.test.js`
- Test: `test/errors.test.js`

**Interfaces**
- **Consumes:** `unknown` 原始错误及可选 `{ operation }`。
- **Produces:** `toUiError(error, context?) -> { title, message, primaryAction, secondaryAction, rawDetails, severity }`，action 为 `{ id, label } | null`；`sanitizeRawDetails(error) -> string`。

- [ ] **Step 1 (4 min, RED):** 新建表驱动测试，覆盖 storage quota、headerless Sheet、Secret 缺失、OAuth/Broker、word rate 缺失、final TM failed、Starling credential/timeout/rate limit、partial archive。使用实际接口：
  ```js
  const model = toUiError({ code: 'FEISHU_SECRET_MISSING', message: 'secret missing', requestId: 'req-42' }, { operation: 'authorize' });
  assert.deepEqual(model.primaryAction, { id: 'open-settings', label: 'Open Settings' });
  ```
  断言 `req-42`/错误码保留，而 `token: 'sensitive'`、secret、AK/SK 值被删除。
- [ ] **Step 2 (2 min, confirm RED):** 运行 `node test/ui-errors.test.js`；确认因模块/导出不存在失败，而非测试语法错误。
- [ ] **Step 3 (5 min, GREEN):** 实现 `export function sanitizeRawDetails(error) {}` 和 `export function toUiError(error, context = {}) {}`；固定规则表始终返回六字段，未知错误为可 retry 的 error，action ID 固定为 `open-settings|configure-sheet-layout|retry|resume-archive|copy-details`。
- [ ] **Step 4 (3 min, verify GREEN):** 运行 `node test/ui-errors.test.js && node test/errors.test.js && node --check lib/ui-errors.js`。
- [ ] **Step 5 (2 min, commit):** `git diff --check` 后提交上述 Create 文件，message：`feat: add safe friendly error models`。

## Task 2: Feishu Secret preflight 与 Settings 深链

**Depends on:** Task 1 的 `toUiError`/`open-settings`。

**Files**
- Modify: `lib/feishu-auth.js`, `popup.js`, `popup.html`, `options.js`, `options.html`, `options.css`
- Create: `test/feishu-secret-preflight.test.js`
- Modify: `test/popup-feishu-oauth.test.js`, `test/options-roi-oauth.test.js`
- Test: `test/feishu-auth.test.js`

**Interfaces**
- **Consumes:** auth status、`FEISHU_SECRET_MISSING`、`#feishu-secret`、`optionsNavigationIntent`。
- **Produces:** `preflightFeishuAuthorization(status) -> { state: 'connected'|'ready'|'secret-required', actionId, title, message }`；`openFeishuSettings()`；`focusOptionsSection(hash, intent)`。
- **Preserves:** `authorizeFeishuUser({ returnUrl })`、OAuth callback、Broker authority；只显示 Configured，不回显 Secret。

- [ ] **Step 1 (4 min, RED):** 测试三种 preflight 状态；契约断言保留 `feishu-auth-card`/`connect-feishu-user`，新增 `feishu-secret-diagnostic`/`feishu-secret-action`，hash 或 intent 后 action `.focus()`。
- [ ] **Step 2 (2 min, confirm RED):** 运行 `node test/feishu-secret-preflight.test.js && node test/popup-feishu-oauth.test.js && node test/options-roi-oauth.test.js`，确认缺接口/DOM 失败。
- [ ] **Step 3 (5 min, GREEN):** 在 `feishu-auth.js` 实现：
  ```js
  export function preflightFeishuAuthorization(status = {}) {
    if (status.connected) return { state: 'connected', actionId: 'reconnect', title: 'Connected', message: status.displayName || 'Feishu connected' };
    if (status.secretConfigured) return { state: 'ready', actionId: 'connect', title: 'Ready to connect', message: 'Authorize Feishu to continue.' };
    return { state: 'secret-required', actionId: 'open-settings', title: 'Feishu setup required', message: 'Add the App Secret in Settings, then return to authorize.' };
  }
  ```
  `connectFeishuUserFromPopup()` 先 preflight；缺 Secret 时渲染诊断并停止 OAuth，绝不 fallback。
- [ ] **Step 4 (4 min, GREEN):** `openFeishuSettings()` 先写 `{ optionsNavigationIntent: 'feishu-secret' }` 再调用 `chrome.runtime.openOptionsPage()`；Settings 给 Feishu section/action 稳定 ID，`focusOptionsSection(location.hash, intent)` 滚动、聚焦并显示“填写、保存，然后返回 Side Panel 继续授权”。Secret 路径保持 password/Keychain。
- [ ] **Step 5 (3 min, verify GREEN):** 运行上述三测试及 `node test/feishu-auth.test.js && node --check popup.js && node --check options.js && node --check lib/feishu-auth.js`。
- [ ] **Step 6 (2 min, commit):** `git diff --check` 后提交本任务精确文件，message：`feat: guide missing Feishu secret setup`。

## Task 3: Archive summary 纯模块与 inline confirmation

**Depends on:** Task 1。

**Files**
- Create: `lib/archive-summary.js`, `test/archive-summary.test.js`
- Modify: `popup.js`, `popup.html`, `popup.css`, `test/popup-run-config.test.js`, `test/popup-broker-failure-policy.test.js`

**Interfaces**
- **Consumes:** source/confirmed rows、56 languages、vendor routes/rate completeness、batchSize 40。
- **Produces:**
  ```js
  summarizeArchive(input) => {
    sourceRowCount, confirmedRowCount, languageCount,
    vendorCoverage: { RWS, Pactera, unpriced }, unpricedLanguageCount,
    estimatedTmRequests: { original, final, total },
    estimatedDuration: { minSeconds, maxSeconds }
  }
  ```
  以及 `openArchiveConfirmation(summary)`/`closeArchiveConfirmation(reason)`。

- [ ] **Step 1 (5 min, RED):** 测试 0 confirmed、无可计费 vendor、coverage，以及 100 rows×56 languages×batch 40：A/C 各 `56 * ceil(100/40) = 168`，总 336；B 不计请求/金额。
- [ ] **Step 2 (2 min, confirm RED):** `node test/archive-summary.test.js`，确认模块不存在失败。
- [ ] **Step 3 (5 min, GREEN):** 实现 `estimateTmRequests({ rowCount, languageCount, batchSize = 40, passes = 2 })` 和 `summarizeArchive(input)`；`served:false` 是正常说明，只有 `served:true && completeRate:false` 为 incomplete。
- [ ] **Step 4 (5 min, UI RED→GREEN):** 先断言 `writeCurrentRoiArchive()` 不再含 `window.confirm(`；增加 `roi-archive-confirmation`（dialog/aria-modal）、`archive-confirm-cancel/start`，渲染六项及“Only confirmed rows affect official ROI amounts.”。支持 Escape、Tab trap、关闭后归还焦点；仅 Start 调既有 deferred/archive runtime，不改变 `createRoiArchiveRunId()`。
- [ ] **Step 5 (3 min, verify GREEN):** `node test/archive-summary.test.js && node test/popup-run-config.test.js && node test/popup-broker-failure-policy.test.js && node --check lib/archive-summary.js && node --check popup.js`。
- [ ] **Step 6 (2 min, commit):** `git diff --check` 后提交本任务文件，message：`feat: confirm ROI archive with summary`。

## Task 4: Archive progress/ETA 与 runtime 接线

**Depends on:** Task 3 请求估算/Start 边界。

**Files**
- Create: `lib/archive-progress.js`, `test/archive-progress.test.js`, `test/popup-archive-progress.test.js`
- Modify: `popup.js`, `popup.html`, `popup.css`, `lib/multilingual-runner.js`, `lib/broker-async-roi.js`, `test/multilingual-runner.test.js`, `test/broker-async-roi.test.js`

**Interfaces**
- **Consumes:** `{ phase, completedRequests, estimatedRequests, completedLanguages, totalLanguages, activeOperations, elapsedMs, sampleDurationMs }`；A/C 可同时 active。
- **Produces:** `createArchiveProgress({ estimatedRequests, totalLanguages, startedAt })` 与：
  ```js
  updateArchiveProgress(state, event, now) => {
    phase, completedRequests, estimatedRequests, completedLanguages,
    totalLanguages, activeOperations, elapsedMs, etaMs, percent, samples
  }
  ```
  runtime 可选 `onProgress(event)`；UI `renderArchiveProgress(model)`。

- [ ] **Step 1 (5 min, RED):** 测试初始值、乱序不回退、少于 3 样本 `etaMs:null`、最近 8 样本移动平均、A/C 双 active、Complete=100%；runtime event 不含 source/Secret/AK/SK/token。
- [ ] **Step 2 (2 min, confirm RED):** 运行三个新增/修改测试，确认缺模块/callback 失败。
- [ ] **Step 3 (5 min, GREEN):** 实现两个纯函数：`percent=max(previous,bounded(completed/estimated))`；只收正耗时，保留最近 8 个，少于 3 个显示 Estimating time。
- [ ] **Step 4 (5 min, GREEN runtime):** 在 runner 请求与 broker poll 既有边界调用 `onProgress`；不改变调度、batch=40、Final TM、Run ID、retry/resume。
- [ ] **Step 5 (5 min, GREEN UI):** 增加 `roi-archive-progress`、`archive-progress-live`（aria-live polite）、phase、A/C operations、language/request、elapsed/ETA、progressbar；阶段固定 Preparing / Original TM (A) / Final TM (C) / Calculating ROI / Writing to Feishu / Complete。
- [ ] **Step 6 (3 min, verify GREEN):** 运行 `node test/archive-progress.test.js && node test/popup-archive-progress.test.js && node test/multilingual-runner.test.js && node test/broker-async-roi.test.js` 及四个修改 JS 的 `node --check`。
- [ ] **Step 7 (2 min, commit):** `git diff --check`，提交本任务文件，message：`feat: report archive progress and ETA`。

## Task 5: Vendor coverage、A/B/C 解释与 Review 卡片

**Depends on:** Tasks 3–4。

**Files**
- Modify: `lib/archive-summary.js`, `lib/review-workflow.js`, `popup.js`, `popup.html`, `popup.css`
- Create: `test/review-presentation.test.js`
- Modify: `test/archive-summary.test.js`, `test/review-workflow.test.js`, `test/popup-responsive-review-ui.test.js`, `test/roi-analytics-archive.test.js`

**Interfaces**
- **Consumes:** A original、B AI、C confirmed final 的 score/cost；candidate safety；vendor route/Pricing notes。
- **Produces:**
  ```js
  buildReviewPresentation(input) => {
    rail: [{ key: 'A'|'B'|'C', score, tone, label }],
    officialSaving, savingTone, headline, explanation
  }
  formatVendorCoverage(input) => { counts, explanations, incomplete }
  ```

- [ ] **Step 1 (5 min, RED):** 测试 rail、`officialSaving=Cost(A)-Cost(C)`、B 大幅提升仍不进钱、negative=warning/amber、safe rewrite 无提升固定文案、未服务 vendor 不报错、服务但 rate/TM/final 缺失才 incomplete。
- [ ] **Step 2 (2 min, confirm RED):** `node test/review-presentation.test.js && node test/archive-summary.test.js`，确认缺导出失败。
- [ ] **Step 3 (5 min, GREEN):** 在 review module 实现 `buildReviewPresentation()`，summary module 实现 `formatVendorCoverage()`，严格返回上述 shape，popup 不重复计算口径。
- [ ] **Step 4 (5 min, GREEN UI):** 增加可折叠 `roi-methodology`，解释 A 原始成本、B AI 辅助、C 最终成本和 A-C；`renderResults(items)` 渲染 A→B→C rail、失败原因、“Safe rewrite available / TM score did not improve, so it was not auto-applied.”；Focus View 保留完整解释/关闭路径。
- [ ] **Step 5 (4 min, GREEN coverage):** summary/complete 显示 RWS、Pactera、unpriced counts 和 routed explanation；保留 Bitable `Pricing notes` locale routing。
- [ ] **Step 6 (3 min, verify GREEN):** 运行本任务五个测试及 `node --check lib/review-workflow.js && node --check popup.js`。
- [ ] **Step 7 (2 min, commit):** `git diff --check`，提交本任务文件，message：`feat: explain ROI review and vendor coverage`。

## Task 6: Visual tokens、motion 与 a11y

**Depends on:** Tasks 2–5 UI 状态。

**Files**
- Modify: `popup.css`, `popup.html`, `popup.js`, `options.css`
- Create: `test/side-panel-accessibility.test.js`
- Modify: `test/popup-compact-workflow.test.js`, `test/popup-responsive-review-ui.test.js`, `test/side-panel-i18n.test.js`

**Interfaces**
- **Consumes:** 状态 class/ARIA model。
- **Produces:** `--color-canvas:#F6F7F9`、surface `#FFFFFF`、text-primary `#172033`、text-secondary `#667085`、primary `#3366FF`、ai `#6558D9`、confirmed `#14805E`、warning `#A15C00`、error `#C9362B`；统一 focus/spacing/44px；`is-entering/is-complete/is-confirmed`。

- [ ] **Step 1 (4 min, RED):** CSS/DOM 契约测试断言全部 token、focus-visible、44px、reduced-motion、aria-live、dialog label、Focus close、无持续闪烁。
- [ ] **Step 2 (2 min, confirm RED):** 跑 accessibility、compact、responsive 三测试，确认断言失败。
- [ ] **Step 3 (5 min, GREEN):** 在 `:root` 定义 token 并替换组件 raw colors；4/8px rhythm、统一 focus/radius、44px target；容器 `min-width:0; overflow-x:hidden`。
- [ ] **Step 4 (4 min, GREEN):** 仅 opacity/transform：step 150ms、card 180ms、Focus 200ms、confirm rail 单次高亮、progress 平滑不回退；reduced-motion 将非必要 duration 置 0.01ms。
- [ ] **Step 5 (4 min, GREEN):** 补 ARIA/文字信号；Review >50 项时 `renderResults` 复用 filter，`requestAnimationFrame` 每批最多 25 卡，保持顺序/焦点。
- [ ] **Step 6 (3 min, verify GREEN):** 跑本任务四测试及 `node --check popup.js`。
- [ ] **Step 7 (2 min, commit):** `git diff --check`，提交本任务文件，message：`feat: apply accessible side panel visual system`。

## Task 7: Headerless Sheet recovery 与 error actions

**Depends on:** Tasks 1、6。

**Files**
- Modify: `popup.js`, `popup.html`, `popup.css`, `lib/sheet-layout.js`
- Create: `test/popup-error-actions.test.js`
- Modify: `test/sheet-layout.test.js`, `test/popup-broker-failure-policy.test.js`, `test/popup-fast-path.test.js`

**Interfaces**
- **Consumes:** `toUiError` action IDs；`detectSheetLayout()` 的 `header_row_required|source_header_not_found`。
- **Produces:** `renderUiError(model, container)`、`executeUiErrorAction(actionId, context)`；Details+copy 只复制脱敏 rawDetails。

- [ ] **Step 1 (5 min, RED):** 固定 headerless reason；UI 测试人话、details/copy、Settings、layout focus、retry、partial resume；复制内容无敏感值但有 Request ID。
- [ ] **Step 2 (2 min, confirm RED):** `node test/sheet-layout.test.js && node test/popup-error-actions.test.js`，确认 renderer 不存在失败。
- [ ] **Step 3 (4 min, GREEN):** `detectSheetLayout()` 对 headerless 返回：
  ```js
  { status: 'incomplete', reason: 'header_row_required', layout: { sourceColumn, dataStartRow, outputStartColumn, confirmed: false }, preview }
  ```
  不臆造 header，保留 `btn-confirm-sheet-layout` 显式确认。
- [ ] **Step 4 (5 min, GREEN):** 实现两个 UI 函数；`configure-sheet-layout` 展开 `working-sheet-details`/`sheet-context-config` 并聚焦 source select；`resume-archive` 读取 snapshot 现有 `runId`，禁止调用 `createRoiArchiveRunId()`；授权/Sheet/TM/archive catch 接 `toUiError`。
- [ ] **Step 5 (3 min, verify GREEN):** 运行本任务四测试及 `node --check lib/sheet-layout.js && node --check popup.js`。
- [ ] **Step 6 (2 min, commit):** `git diff --check`，提交本任务文件，message：`feat: add actionable Sheet and archive recovery`。

## Task 8: Full regression、文档与 handoff

**Depends on:** Tasks 1–7 全通过。

**Files**
- Modify: `docs/user-guide.md`, `docs/E2E-CHECKLIST.md`, `docs/oauth-broker-async-roi-contract.md`, `USAGE-GUIDE.md`
- Create: `docs/side-panel-ux-upgrade-handoff.md`
- Test: `test/*.test.js`, `test/*-test.py`, `test/test_*.py`, `backend/tests/**/*.py`, `scripts/run-full-regression.sh`

**Interfaces**
- **Consumes:** 最终 models/DOM/action IDs。
- **Produces:** 用户指南、E2E、Broker/Run ID/安全契约、无敏感信息 handoff。

- [ ] **Step 1 (4 min, docs RED):** E2E checklist 先加未勾选场景：Secret→Settings→focus→save→return、100×56 summary/progress/ETA、quota/rate/final-TM/partial recovery、窄宽/键盘/reduced-motion、Broker 无 fallback、stable Run ID resume。
- [ ] **Step 2 (5 min, docs GREEN):** 更新用户指南和 Broker contract：A-C、B 不进钱、真实 Final TM、vendor routing/unpriced/incomplete、ETA estimating、error actions、56 scope、stable Run ID、敏感字段禁入日志/快照。
- [ ] **Step 3 (3 min, syntax):** 对 `popup.js options.js background.js lib/ui-errors.js lib/archive-summary.js lib/archive-progress.js lib/review-workflow.js lib/multilingual-runner.js lib/broker-async-roi.js` 分别执行 `node --check`。
- [ ] **Step 4 (5 min, focused):** 运行 `node test/ui-errors.test.js && node test/feishu-secret-preflight.test.js && node test/archive-summary.test.js && node test/archive-progress.test.js && node test/review-presentation.test.js && node test/side-panel-accessibility.test.js && node test/popup-error-actions.test.js && node test/popup-feishu-oauth.test.js && node test/popup-run-config.test.js && node test/popup-responsive-review-ui.test.js`。
- [ ] **Step 5 (5 min, full):** 运行 `./scripts/run-full-regression.sh`。它覆盖全部 JS、顶层 Python、compile/backend；Python <3.11 等环境失败记录命令、版本、原始错误，不能记作通过。
- [ ] **Step 6 (3 min, lint):** 运行 `standard-lint` 并显式列出本次所有修改/新增 JS；命令缺失/依赖失败时不安装依赖，在 handoff 记录命令、退出码、错误，标“环境跳过”。
- [ ] **Step 7 (5 min, manual):** unpacked MV3 手验所有 E2E；重点 dialog Escape/Tab/focus return、aria-live、A/C 同时 active、percent 不回退、Focus close、窄宽/reduced-motion。
- [ ] **Step 8 (4 min, handoff):** 写 handoff：变更、逐命令结果、手验、环境跳过、已知问题；不得包含 credential/snapshot。
- [ ] **Step 9 (2 min, commit):** `git diff --check` 后提交文档和必要测试修正，message：`docs: hand off side panel UX upgrade`。

---

## Final Verification Checklist

- [ ] 七个具体新增测试与涉及的现有测试全部通过。
- [ ] `node --check` 已覆盖 popup/options/background 和所有本次修改/新增 JS。
- [ ] `./scripts/run-full-regression.sh` 通过；Python 3.11+ 或其他环境问题按事实记录。
- [ ] `standard-lint` 对本次文件执行；缺失/依赖失败只记“环境跳过”，未安装依赖。
- [ ] Secret 深链、100×56 archive、四类恢复、键盘、窄宽、reduced-motion 手验通过。
- [ ] Workflow/Review、Stepper、action bar、关键 DOM ID/字符串契约保留或测试同步。
- [ ] A-C 正式金额、B 不进钱、Final TM 真实查询、Broker 无 fallback。
- [ ] vendor 无借价/填 0、56 非英文 scope 完整、Sheet 只写 confirmed final。
- [ ] retry/resume stable Run ID，已完成 vendor Run 不重复。
- [ ] 日志、details、snapshot、fixture、文档/handoff 无 Secret、AK/SK、token。
- [ ] 四份指南/契约和 handoff 已更新；`git diff --check` 无错误。

## Plan Self-Check

- [x] 无 TBD、TODO、“类似上面”或 placeholder。
- [x] 设计 1–3 节由总体/Tasks 2、5、6；4→Task 2；5→Task 3；6→Task 4；7→Tasks 1/7；8–9→Task 5；10→Tasks 2/3/7；11–12→Task 6；13–16→全局约束/Task 8 覆盖。
- [x] 接口命名前后一致：`toUiError`、`summarizeArchive`、`createArchiveProgress/updateArchiveProgress`、`buildReviewPresentation`、`formatVendorCoverage`、`renderUiError`。
- [x] 依赖为 1→2/3→4→5→6→7→8；每任务可独立 review/commit。
- [x] 每任务有精确路径、Consumes/Produces、2–5 分钟、RED/失败确认/最小实现/通过/commit。
- [x] 验证含具体 Node 测试、`node --check`、全量 regression、`standard-lint` 记录规则；不引入框架/依赖。
