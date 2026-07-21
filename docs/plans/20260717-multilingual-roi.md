# 多语言整车 ROI 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让插件按项目和目标语言分别取得真实 TM 快照、严格计价并展示整车 ROI，而不是把一个目标语言当作全部语言。

**Architecture:** `lib/run-config.js` 负责把项目和用户选择规范化为独立 locale scopes。新增纯模块负责把每个 locale scope 的条目 ROI 结果汇总为完整总额或可审计 subtotal；`popup.js` 负责串行执行 scope、复用现有 TM/AI 能力并渲染状态。普通 Sheet 继续写入一个明确的查看 scope，避免改变 A-G 契约。

**Tech Stack:** Chrome MV3、ES modules、Starling Batch TM、现有 Native Messaging bridge、Node 内置测试、Feishu Sheets API。

**执行状态（2026-07-17）：** Task 1 至 Task 4 的代码、文档和自动化验证已完成。Chrome Popup 的真实多语言 Starling 调用尚待按 `docs/E2E-CHECKLIST.md` 执行；该真机验证不影响已通过的本地回归结论。

## 全局约束

- locale scope 的唯一键是 `projectId + sourceLocale + targetLocale`，默认覆盖已选项目的所有 `targetLocales`。
- 选中多个项目时使用 project × locale 并集；项目必须共享 source locale，但不要求共享 target locale。
- 不得以单语言 score 外推其他语言，不得使用默认价格、跨 vendor 借价、语言回退或零价补齐。
- AI 关闭或没有 rewrite 时，改写后快照复用首轮快照，完整语言的 saving 必须为 0。
- 任一已选 scope 不完整时整车状态为 `incomplete`，但需保留 complete scope 的 subtotal、覆盖率和失败原因。
- 单个 Batch TM 请求仍最多十条 source 和十个 project ID；多语言 scope 串行执行。
- 普通 Sheet A-G 只保存一个明确的查看 scope；多语言 ROI 仅在 Popup 结果中展示。
- 所有产品可见文案和文档使用中文或已有英文产品术语；不得记录 AK、SK、LLM key 或真实敏感值。

---

### Task 1: Locale scope 纯模型与选择回归

**Files:**
- Modify: `l10n-tm-companion/lib/run-config.js`
- Modify: `l10n-tm-companion/test/run-config.test.js`

**Interfaces:**
- Consumes: `normalizeProject(raw)`、已选 `projectIds`、`selectedLocalesByProject`。
- Produces: `buildLocaleScopes({ projects, projectIds, selectedLocalesByProject })`，返回 `{ status, sourceLocale, scopes, reason? }`；每个 scope 为 `{ key, projectId, projectName, sourceLocale, targetLocale }`。

- [ ] **Step 1: 写失败测试，覆盖默认全选、手动缩小和项目并集。**

```js
const scopes = buildLocaleScopes({
  projects: [projectA, projectB],
  projectIds: [513, 385],
  selectedLocalesByProject: {},
});
assert.deepEqual(scopes.scopes.map((scope) => scope.key), [
  '513:en:ja-JP', '513:en:zh-Hans', '385:en:ko-KR', '385:en:zh-Hans',
]);
assert.equal(buildLocaleScopes({
  projects: [projectA], projectIds: [513],
  selectedLocalesByProject: { 513: ['ja-JP'] },
}).scopes.length, 1);
```

- [ ] **Step 2: 运行失败测试。**

Run: `node test/run-config.test.js`

Expected: `buildLocaleScopes is not a function`。

- [ ] **Step 3: 实现 scope 构建和严格选择校验。**

```js
export function buildLocaleScopes(input = {}) {
  const projects = (input.projects || []).map(normalizeProject).filter(Boolean);
  const selectedIds = [...new Set((input.projectIds || []).map(Number).filter(Number.isInteger))];
  const selected = selectedIds.map((id) => projects.find((project) => project.id === id)).filter(Boolean);
  if (selected.length !== selectedIds.length) {
    return { status: 'incomplete', reason: 'project_unavailable', scopes: [] };
  }
  const sourceLocales = new Set(selected.map((project) => project.sourceLocale));
  if (!selected.length) return { status: 'incomplete', reason: 'project_required', scopes: [] };
  if (sourceLocales.size !== 1 || sourceLocales.has('')) {
    return { status: 'incomplete', reason: 'source_locale_mismatch', scopes: [] };
  }
  const scopes = selected.flatMap((project) => {
    const requested = input.selectedLocalesByProject?.[project.id];
    const locales = requested === undefined ? project.targetLocales : requested;
    if (!Array.isArray(locales) || !locales.length) return [];
    return [...new Set(locales)].sort().map((targetLocale) => {
      if (!project.targetLocales.includes(targetLocale)) throw new Error('target_locale_unavailable');
      return { key: `${project.id}:${project.sourceLocale}:${targetLocale}`, projectId: project.id,
        projectName: project.name, sourceLocale: project.sourceLocale, targetLocale };
    });
  });
  return scopes.length ? { status: 'ready', sourceLocale: selected[0].sourceLocale, scopes }
    : { status: 'incomplete', reason: 'locale_scope_required', scopes: [] };
}
```

- [ ] **Step 4: 运行 scope 测试与既有配置测试。**

Run: `node test/run-config.test.js`

Expected: 退出码 0，默认全选、手动选择、并集和 source locale 不匹配断言均通过。

### Task 2: 多语言 ROI 汇总纯模块

**Files:**
- Create: `l10n-tm-companion/lib/multilingual-roi.js`
- Create: `l10n-tm-companion/test/multilingual-roi.test.js`

**Interfaces:**
- Consumes: `{ scope, items }[]`，其中每个 item 的 `roi` 来自 `calculateRoiForItem()`。
- Produces: `summarizeMultilingualRoi(scopeRuns)`，返回 `{ status, selectedScopeCount, completeScopeCount, subtotalBefore, subtotalAfter, subtotalSaving, incompleteScopes }`。

- [ ] **Step 1: 写失败测试，覆盖完整汇总、部分缺失费率与无 LLM 零节省。**

```js
const summary = summarizeMultilingualRoi([
  { scope: { key: '513:en:ja-JP' }, items: [{ roi: complete(2, 1.5) }] },
  { scope: { key: '513:en:zh-Hans' }, items: [{ roi: incomplete('rate_missing_language_pair') }] },
]);
assert.equal(summary.status, 'incomplete');
assert.equal(summary.completeScopeCount, 1);
assert.equal(summary.subtotalSaving, 0.5);
assert.deepEqual(summary.incompleteScopes, [{ key: '513:en:zh-Hans', reasons: ['rate_missing_language_pair'] }]);
```

- [ ] **Step 2: 运行失败测试。**

Run: `node test/multilingual-roi.test.js`

Expected: module-not-found failure。

- [ ] **Step 3: 实现不可伪造的逐 scope 汇总。**

```js
export function summarizeMultilingualRoi(scopeRuns = []) {
  const complete = [];
  const incompleteScopes = [];
  for (const { scope, items = [] } of scopeRuns) {
    const failed = items.map((item) => item.roi).filter((roi) => roi?.status !== 'complete');
    if (failed.length) {
      incompleteScopes.push({ key: scope.key, reasons: [...new Set(failed.map((roi) => roi?.reason || 'roi_unavailable'))] });
      continue;
    }
    complete.push({ scope, items });
  }
  const sum = (field) => complete.flatMap(({ items }) => items)
    .reduce((total, item) => total + item.roi[field], 0);
  return { status: incompleteScopes.length ? 'incomplete' : 'complete', selectedScopeCount: scopeRuns.length,
    completeScopeCount: complete.length, subtotalBefore: sum('estimatedCostBefore'),
    subtotalAfter: sum('estimatedCostAfter'), subtotalSaving: sum('estimatedSaving'), incompleteScopes };
}
```

- [ ] **Step 4: 运行模块测试。**

Run: `node test/multilingual-roi.test.js && node test/roi-calculation.test.js`

Expected: 退出码 0；无 rewrite 的 `post_rewrite_tm: not_required` 条目计入 before/after 且 saving 为 0。

### Task 3: Popup 多语言选择与 scope 运行

**Files:**
- Modify: `l10n-tm-companion/popup.html`
- Modify: `l10n-tm-companion/popup.css`
- Modify: `l10n-tm-companion/popup.js`
- Modify: `l10n-tm-companion/test/popup-run-config.test.js`
- Modify: `l10n-tm-companion/test/popup-fast-path.test.js`

**Interfaces:**
- Consumes: `buildLocaleScopes()`、`searchTM()`、`queryPostRewriteTmSnapshots()`、`calculateRoiForItem()`、`summarizeMultilingualRoi()`。
- Produces: `processedItems` 保留 `scopeResults[scope.key]`；`multilingualRoiSummary` 保存本次运行汇总；Sheet 查看 scope 由 `activeDisplayScopeKey` 指定。

- [ ] **Step 1: 写 Popup 静态回归断言。**

```js
assert('语言覆盖容器存在', html.includes('id="roi-language-coverage"'));
assert('不再要求单一 ROI locale', !html.includes('id="run-target-locale"'));
assert('Popup 使用 scope 构建器', source.includes('buildLocaleScopes('));
assert('Popup 串行执行每个 scope', source.includes('for (const scope of runConfig.scopes)'));
assert('Popup 汇总多语言 ROI', source.includes('summarizeMultilingualRoi('));
```

- [ ] **Step 2: 运行失败测试。**

Run: `node test/popup-run-config.test.js && node test/popup-fast-path.test.js`

Expected: language coverage 和 scope orchestration 断言失败。

- [ ] **Step 3: 替换单语言选择为按项目的 checkbox 覆盖选择。**

```html
<div class="run-field-header"><label>ROI coverage languages</label><span id="roi-scope-count">0 scopes</span></div>
<div id="roi-language-coverage" class="roi-language-coverage"></div>
<p class="hint">All project target languages are selected by default. Uncheck languages to exclude them from this ROI run.</p>
```

`popup.js` 维护 `selectedLocalesByProject`，首次加载项目或新增项目时默认填入全部 target locales；取消 checkbox 后立即写入 `chrome.storage.local.roiLocalesByProject`。移除项目时删除其持久化语言选择；范围为空时 `ensureWorkflowReady()` 显示 `Select at least one ROI coverage language.` 并停止运行。

- [ ] **Step 4: 按 scope 串行执行首轮 TM、AI、二次 TM 与逐项 ROI。**

```js
const scopeRuns = [];
for (const [scopeIndex, scope] of runConfig.scopes.entries()) {
  showProgress(`Querying ${scope.projectName} · ${scope.targetLocale}…`, 30 + Math.round((scopeIndex / runConfig.scopes.length) * 55));
  const scopeItems = items.map((item) => ({ ...item }));
  const tmResults = await searchTM(scopeItems.map((item) => item.source_text), scope.sourceLocale, scope.targetLocale,
    { ...tmOpts, projectIds: [scope.projectId] });
  scopeItems.forEach((item, index) => {
    const tm = tmResults[index];
    if (!tm) return;
    item.tm_match = tm.tm_match;
    item.tm_source = tm.tm_source;
    item.similarity = tm.similarity;
    item.origin = tm.origin;
    item.tm_method = tm.method || 'starling';
    item.tm_candidate_count = tm.candidate_count ?? 0;
    item.match_category = tm.match_category ?? null;
  });
  const aiResults = config.enableAI === true
    ? await rewriteSourceWithAI(scopeItems, config, TM_MATCH_THRESHOLD)
    : scopeItems.map((item) => ({ ...item, reached_threshold: (item.similarity || 0) >= TM_MATCH_THRESHOLD,
      ai_translation: '', reasoning: 'AI disabled (enableAI=off in settings).', reuse_tm: false }));
  const snapshots = await queryPostRewriteTmSnapshots(aiResults, scope.sourceLocale, scope.targetLocale,
    { ...tmOpts, projectIds: [scope.projectId] });
  const rate = resolveWordRate(rateCatalog, { vendor: runVendor, sourceLang: scope.sourceLocale, targetLang: scope.targetLocale });
  aiResults.forEach((item, index) => { item.post_rewrite_tm = snapshots[index]; item.roi = calculateRoiForItem(item, rate); });
  scopeRuns.push({ scope, items: aiResults });
}
```

保留第一个完整 scope 作为 `activeDisplayScopeKey` 并将其条目写入原有 `processedItems`，以保证 A-G 和人工选择交互兼容；每个结果条目附加 `scopeResults`，用于显示跨语言金额与状态。

- [ ] **Step 5: 在结果页渲染整车 summary 和逐语言缺失项。**

```js
function renderMultilingualRoiSummary(summary) {
  const label = summary.status === 'complete' ? 'Estimated vehicle ROI' : 'Estimated covered-language subtotal';
  return `<section class="roi-summary ${summary.status}"><strong>${label}</strong><span>${summary.completeScopeCount}/${summary.selectedScopeCount} scopes complete</span><span>Before USD ${formatMoney(summary.subtotalBefore)} · After USD ${formatMoney(summary.subtotalAfter)} · Saving USD ${formatMoney(summary.subtotalSaving)}</span>${renderIncompleteScopes(summary.incompleteScopes)}</section>`;
}
```

`incomplete` 状态必须渲染 selected/complete scope 数和失败原因，且不得把 subtotal 写成完整整车金额。

- [ ] **Step 6: 运行 Popup 与语法回归。**

Run: `node --check popup.js && node test/popup-run-config.test.js && node test/popup-fast-path.test.js`

Expected: 退出码 0；不再出现单一 `run-target-locale` 运行门禁，新的语言范围、scope 顺序与汇总断言通过。

### Task 4: 文档、全回归和真实输出检查

**Files:**
- Modify: `l10n-tm-companion/README.md`
- Modify: `l10n-tm-companion/docs/popup-configuration.md`
- Modify: `l10n-tm-companion/docs/E2E-CHECKLIST.md`
- Modify: `l10n-tm-companion/handoff/HANDOFF-2026-07-16-post-rewrite-tm-snapshot.md`
- Create: `l10n-tm-companion/temp/test_multilingual_roi/verification.md`

**Interfaces:**
- Consumes: 已实现的 scope、汇总和 Popup 显示行为。
- Produces: 与代码一致的使用说明、真机 E2E 步骤和已人工检查的测试证据。

- [ ] **Step 1: 增量更新正式文档。**

README 的日常流程说明替换为“选择项目和 ROI coverage languages，默认全选”，并说明无 LLM 显示零节省、缺失语言产生 subtotal；Popup 配置文档将单一 target locale 规则替换为项目级语言勾选和 project × locale 并集；E2E checklist 增加单项目默认全选、多项目不相交语言、手动取消、AI 关闭、缺费率五类场景。

- [ ] **Step 2: 运行全量自动化测试并写入临时验证记录。**

Run: `mkdir -p temp/test_multilingual_roi && for file in test/*.test.js; do node "$file"; done > temp/test_multilingual_roi/verification.txt 2>&1 && python3 -m unittest test.test_export_local_rates -v >> temp/test_multilingual_roi/verification.txt 2>&1`

Expected: 所有 JavaScript 与 Python 测试退出码 0。

- [ ] **Step 3: 检查真实测试输出和静态产物。**

Run: `sed -n '1,260p' temp/test_multilingual_roi/verification.txt && node --check popup.js && node --check lib/run-config.js && node --check lib/multilingual-roi.js && git diff --check`

Expected: 结果中没有 FAIL、AssertionError、Traceback、NaN、默认费率、跨 vendor 回退或伪造的 0 score；语法和 diff 检查通过。

- [ ] **Step 4: 用 Chrome 真机完成最小 E2E。**

在一个具有至少两种 target locale 的可访问项目中运行两条英文文案：先关闭 AI，确认每个完整语言 scope 的 saving 均为 0；再启用 AI，确认结果显示 project × locale 进度、总金额或明确 subtotal，且缺少费率的语言仅作为 incomplete scope 出现。人工检查结果卡、Sheet A-G 和 Popup summary 的文案后，把脱敏观察结果追加到 `temp/test_multilingual_roi/verification.md`。
