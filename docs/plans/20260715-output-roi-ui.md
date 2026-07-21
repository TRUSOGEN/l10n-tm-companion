# Output Schema and ROI Locale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 保留 `en→en` TM 查询，澄清 Target locale 的 TM/ROI 语义，把普通飞书 Sheet 收敛为 A–G 七列，并为 `CD review valid?` 创建空白默认的 Yes/No 单选下拉。

**Architecture:** Popup 继续使用现有 run-config 与 strict local rate resolver，只调整可见语义和缺费率提示。`lib/feishu-sheets.js` 继续负责 Sheet schema，并在数据写入前通过官方 `dataValidation` API 幂等设置 G2:G5000 下拉；旧 H–J 数据不删除、不覆盖。

**Tech Stack:** Chrome MV3、Vanilla JavaScript、Node.js 内置测试、Feishu Sheets v2 REST API。

## Global Constraints

- `en→en` 是有效 TM 查询配置，费率缺失只让 ROI 金额不完整，不阻塞 TM。
- 标准 Sheet 只有 A–G；插件只写 B–F，G 永远由 CD 人工填写。
- G2:G5000 单选值只有 `Yes` 与 `No`，新记录保持空白。
- 不清除旧 H–J 数据，不再写入或要求 `Comment`、`Source String Key`、`Project`。
- API 失败必须明确暴露，禁止把下拉设置失败或费率缺失伪装为成功。

---

### Task 1: Popup 语言语义与缺费率提示

**Files:**
- Modify: `test/run-config.test.js`
- Modify: `test/popup-run-config.test.js`
- Modify: `popup.html`
- Modify: `popup.js`

**Interfaces:**
- Consumes: `validateRunConfig(input)`、`resolveWordRate(catalog, selection)`。
- Produces: `en→en` 可运行配置、`Translation target / ROI locale` UI、TM 可运行但 ROI 不完整的明确状态。

- [x] **Step 1: 写失败测试**

在 `test/run-config.test.js` 增加 source 与 target 同为 `en` 的 ready 断言，在 `test/popup-run-config.test.js` 增加字段标签、说明和缺费率提示断言：

```js
const englishTarget = normalizeProject({
  id: 999,
  name: 'English target',
  sourceLocale: 'en',
  targetLocales: ['en'],
});
assert.equal(validateRunConfig({
  vendor: 'RWS', projects: [englishTarget], projectIds: [999], targetLocale: 'en',
}).status, 'ready');

assert('Target 使用 TM/ROI 语义', html.includes('Translation target / ROI locale'));
assert('说明 source rewrite 固定为英文', html.includes('AI rewrites the English source in English'));
assert('缺费率不阻塞 TM', source.includes('TM optimization can run; ROI amount is unavailable'));
```

- [x] **Step 2: 运行测试并确认失败**

Run: `node test/run-config.test.js && node test/popup-run-config.test.js`

Expected: run-config 新增断言通过，Popup 文案断言失败。

- [x] **Step 3: 实现最小 UI 修改**

`popup.html` 将标签改为 `Translation target / ROI locale`，并增加：

```html
<p class="field-help">AI rewrites the English source in English. This locale selects the TM target and vendor rate.</p>
```

`popup.js` 对 `missing_word_rate` 与 `missing_language_pair` 使用不阻塞表述：

```js
status.textContent = `${runVendor} has no exact word rate for ${sourceLocale}→${runTargetLocale}. TM optimization can run; ROI amount is unavailable for this vendor and language pair.`;
```

- [x] **Step 4: 运行定向测试**

Run: `node test/run-config.test.js && node test/popup-run-config.test.js && node test/pricing-rules.test.js`

Expected: 全部 PASS，`en→en` 不被 run-config 拒绝。

### Task 2: 七列 Sheet schema 与 Yes/No 下拉

**Files:**
- Modify: `test/feishu-sheets.test.js`
- Modify: `lib/feishu-sheets.js`

**Interfaces:**
- Produces: `REQUIRED_HEADERS` 七列表头、`ensureCdReviewDropdown(spreadsheetToken, sheet, accessToken)`、只写 B–F 的 `writeToSheet()`。

- [x] **Step 1: 把现有 Sheet 测试改成新 schema，并先确认失败**

核心期望固定为：

```js
assert('7 个表头', REQUIRED_HEADERS.length === 7);
assert('最后一列为 CD review', REQUIRED_HEADERS[6] === 'CD review valid?');
assert('单条只写 B–F', [...dataColumns].sort().join('') === 'BCDEF');
assert('不写旧 H–J', !['H', 'I', 'J'].some((col) => dataColumns.has(col)));
assert.deepEqual(validationBody.ranges, ['SHT1!G2:G5000']);
assert.deepEqual(validationBody.dataValidation.conditionValues, ['Yes', 'No']);
assert.equal(validationBody.dataValidation.options.multipleValues, false);
```

Run: `node test/feishu-sheets.test.js`

Expected: 旧 11 列、B–F/H–J 写回和缺少 dataValidation 请求相关断言失败。

- [x] **Step 2: 实现下拉设置函数**

在 `lib/feishu-sheets.js` 增加导出函数：

```js
export async function ensureCdReviewDropdown(spreadsheetToken, sheet, accessToken) {
  const resp = await fetch(`${FEISHU_BASE}/sheets/v2/spreadsheets/${spreadsheetToken}/dataValidation`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ranges: [`${sheet}!G2:G5000`],
      dataValidationType: 'list',
      dataValidation: {
        conditionValues: ['Yes', 'No'],
        options: { multipleValues: false, highlightValidData: true },
      },
    }),
  });
  const data = await resp.json();
  if (data.code !== 0) throw new Error(`Sheets CD review dropdown error: ${data.msg || data.code}`);
}
```

- [x] **Step 3: 收敛表头和写回范围**

将 `REQUIRED_HEADERS` 改为七项，`COLUMN_MAP` 删除 comparison/key/project；`writeToSheet()` 写 `B1:G1` 和每条 B–F，并在 values 写入前调用 `ensureCdReviewDropdown()`；`repairHeaders()` 写 `A1:G1`。

- [x] **Step 4: 运行 Sheet 测试并检查请求体**

Run: `node test/feishu-sheets.test.js`

Expected: 全部 PASS；mock 输出中每次有效写回包含一次 `/dataValidation` 请求，数据 valueRange 不含 G–J。

### Task 3: 可见文案、正式文档与回归同步

**Files:**
- Modify: `popup.js`
- Modify: `README.md`
- Modify: `docs/popup-configuration.md`
- Modify: `docs/E2E-CHECKLIST.md`
- Modify: `docs/TM-MATCHING.md`
- Modify: `test/popup-fast-path.test.js`

**Interfaces:**
- Produces: UI、README、原理文档、E2E checklist 与七列 schema 一致。

- [x] **Step 1: 写失败断言并搜索全部旧文案**

Run: `rg -n "B–F/H–J|B-F/H-J|11 列|11 个表头|Source String Key|Project.*保留|Comment.*写|writes B" README.md docs popup.js test lib/feishu-sheets.js`

Expected: 找到所有需要增量更新的旧 schema 引用，不修改历史 handoff 的追溯内容。

- [x] **Step 2: 更新当前文档和 UI 文案**

统一使用：

```text
Reads A; writes B–F; preserves G for CD review (Yes/No).
```

README 和 `docs/popup-configuration.md` 明确 H–J 历史数据不清除，ROI 金额当前不可见，未来进入飞书多维表格。

- [x] **Step 3: 运行当前 JavaScript 全套测试**

Run: `for file in test/*.test.js; do node "$file"; done`

Expected: 所有测试退出码为 0，输出中没有旧 11 列断言。

### Task 4: 端到端检查、正式文档与 Handoff

**Files:**
- Modify: `handoff/README.md`
- Create: `handoff/HANDOFF-2026-07-15-output-roi-ui.md`
- Modify: `docs/plans/20260715-output-roi-ui.md`

**Interfaces:**
- Produces: 可复现验证记录和下一位接手者入口。

- [x] **Step 1: 运行完整自动化验证**

Run: `node --check popup.js && node --check lib/feishu-sheets.js`

Run: `for file in test/*.test.js; do node "$file"; done`

Run: `python3 -m unittest test.test_export_local_rates`

Expected: 全部退出码 0。

- [x] **Step 2: 检查构造出的真实请求样本**

在 `temp/test_output_roi_ui/` 保存测试输出，人工核对：Target label、缺费率提示、A–G 表头、B–F 写回、G2:G5000 的 Yes/No 单选请求，以及不存在 H–J 数据写回。

- [x] **Step 3: 增量写 handoff**

handoff 记录已实现行为、关键文件、测试命令、已验证样本、ROI 金额仍未实现的原因，以及完整 ROI 必须接入第二次 Starling 查询和 Elasticsearch 字数的边界。

- [x] **Step 4: 完成计划状态并执行 Git 安全边界检查**

把本计划所有完成项改为 `[x]` 并运行 `git diff --check`。当前根仓库没有跟踪 `l10n-tm-companion/`，且历史 `popup.js` 含硬编码凭证；因此不得把插件目录作为新增部分快照提交。保留工作区实现，只提交不含凭证的根级设计文档，待迁移到正确的已跟踪仓库并完成凭证治理后再提交代码。
