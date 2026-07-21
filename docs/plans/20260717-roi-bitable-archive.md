# ROI Bitable Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将多语言整车 ROI 的运行摘要和 `project × target locale` 明细追加归档到用户配置的飞书 Bitable Wiki App 中。
**Architecture:** 保持 Spreadsheet 的逐文案 A-G 写回流程不变，新建 `lib/roi-bitable-archive.js` 作为 ROI 归档的唯一 API 边界。它解析 Wiki 或 `/base/` URL、从 Wiki Node 获得真实 Bitable App Token、确保 `L10n ROI Runs` 与 `L10n ROI Scopes` schema、并按 `writing → complete|incomplete|write_failed` 状态机写入；Popup 只负责确认、组装当前 `multilingualRoiSummary` 与 `multilingualScopeRuns`，不直接发飞书请求。
**Tech Stack:** Manifest V3 Chrome Extension、原生 ES modules、飞书 OpenAPI、Node `assert` 回归测试、现有 `fetch` mock 测试模式。

## OAuth Amendment (2026-07-17)

飞书当前 `base:table:read` 权限仅提供用户身份，不能继续以 Sheets 的 `tenant_access_token` 调用 Bitable 表接口。新增 `native-host/feishu_oauth.py` 作为唯一的本机 OAuth 模块：Native Host 在 `http://localhost:39641/l10n-tm-companion/oauth/callback` 接收一次性 code、校验 state、向 `https://accounts.feishu.cn/oauth/v3/token` 兑换短期 `user_access_token`。Settings 显示固定回调 URL 和连接按钮；`lib/roi-bitable-archive.js` 仅将用户令牌用于 Bitable 表/字段/记录 API，Wiki Node 解析继续使用已发布应用的 tenant token。用户需在飞书安全设置登记该回调 URL，并以用户身份开通 `base:table:create`，因为首次归档会新建 `L10n ROI Runs` 与 `L10n ROI Scopes`；令牌到期前一分钟停止写入并要求重连。对应测试为 `test/feishu-oauth-test.py`、`test/feishu-oauth-bridge-test.py`、`test/options-roi-oauth.test.js` 和扩展后的 `test/roi-bitable-archive.test.js`。

## Global Constraints

- ROI 语义以 `docs/multilingual-roi.md` 为准：缺失 scope 时总状态必须为 `incomplete`，三个金额仅为已覆盖语言小计。
- 不完整 scope 的金额字段留空，不得写入 `0`、默认费率或跨语言回退金额。
- 用户只配置 Wiki 或 `/base/` URL；Wiki URL 必须用 `/open-apis/wiki/v2/spaces/get_node?token={nodeToken}` 解析，只有 `obj_type === 'bitable'` 时使用 `obj_token`。
- 新表固定命名为 `L10n ROI Runs` 和 `L10n ROI Scopes`，已存在时只校验并复用；字段缺失或类型不匹配必须失败。
- 既有 `tblhAsRIfpsbd9d1` 不读、不写、不作为归档 schema 的依据。
- Sheet A-G 写回、TM-only 快路径和 AI rewrite 行为不能改变。
- 飞书外部写入只发生在用户确认“初始化 ROI 归档”或“写入 ROI 归档”之后。
- 当前 `l10n-tm-companion/` 在根仓库中未被追踪，禁止 `git add l10n-tm-companion/`、提交或推送该目录。

---

## File Structure

- Create: `lib/roi-bitable-archive.js`，封装 URL 解析、Wiki 解析、schema 校验、Run/Scope payload 与写入状态机。
- Create: `test/roi-bitable-archive.test.js`，使用顺序化 `fetch` mock 验证 HTTP 请求形状、schema 与失败状态机。
- Create: `test/options-roi-bitable.test.js`，验证 ROI Bitable 设置页的可见字段、storage key 与保存行为。
- Modify: `options.html`、`options.js`，保存独立 `roiArchiveUrl`，不复用 Spreadsheet 目标。
- Modify: `popup.html`、`popup.js`、`popup.css`，新增归档确认预览与写入按钮，不改变原 Sheet 写回按钮。
- Modify: `test/popup-run-config.test.js`，验证 ROI archive UI 与调用门禁。
- Modify: `docs/multilingual-roi.md`、`docs/E2E-CHECKLIST.md`，把已实现归档能力和实际验证流程增量并入长期文档。
- Create: `temp/test_roi_bitable_archive/verification.md`，记录专用测试 Bitable 的端到端验证输入、输出与清理状态。

### Task 1: 保存独立的 ROI Bitable 目标配置
**Files:**
- Create: `test/options-roi-bitable.test.js`
- Modify: `options.html`
- Modify: `options.js`

**Interfaces:**
- Produces: Chrome local storage key `roiArchiveUrl: string`，只保存用户粘贴的 Wiki 或 `/base/` URL。
- Consumes: 既有 `GENERAL_KEYS`、`READ_KEYS` 与 `save()` 设置持久化流程。

- [x] **Step 1: 写入设置页结构失败测试**

```js
assert('有 ROI archive URL 输入框', html.includes('id="roiArchiveUrl"'));
assert('ROI archive 不复用 Spreadsheet URL', !html.includes('id="roiArchiveUrl"') || !source.includes('roiArchiveUrl: data.sheetsUrl'));
assert('常规设置会保存 ROI archive URL', source.includes("'roiArchiveUrl'"));
```

- [x] **Step 2: 运行设置页测试并确认失败**

Run: `node test/options-roi-bitable.test.js`

Expected: FAIL，提示缺少 `roiArchiveUrl` 输入和 storage key。

- [x] **Step 3: 最小化增加独立配置字段**

在 `options.html` 的 Feishu card 中、Spreadsheet 内容之后加入以下控件与说明，并在 `options.js` 的 `GENERAL_KEYS` 和 `READ_KEYS` 中加入同名 key：

```html
<label>ROI archive Bitable
  <input type="url" id="roiArchiveUrl"
    placeholder="Paste a Feishu Wiki or /base/ Bitable link">
</label>
<p class="hint">This target stores ROI run history only. Spreadsheet write-back remains separate.</p>
```

`save()` 保持既有遍历逻辑，使其以 `element.value.trim()` 存储；不得将 `roiArchiveUrl` 映射到 `sheetsUrl`、`spreadsheetToken` 或 `sheetId`。

- [x] **Step 4: 运行设置页测试并确认通过**

Run: `node test/options-roi-bitable.test.js && node test/options-credentials.test.js`

Expected: 两个测试均 PASS，且原凭证保存契约不变。

### Task 2: 建立可测试的 ROI 归档数据契约
**Files:**
- Create: `lib/roi-bitable-archive.js`
- Create: `test/roi-bitable-archive.test.js`

**Interfaces:**
- Produces: `RUNS_TABLE_NAME`、`SCOPES_TABLE_NAME`、`parseRoiArchiveUrl()`、`buildRoiArchivePayload()`。
- Consumes: `summarizeMultilingualRoi()` 的 `{ status, selectedScopeCount, completeScopeCount, subtotalBefore, subtotalAfter, subtotalSaving, incompleteScopes }` 结果和 `runLocaleScopes()` 的 `{ scope, items, rate }[]`。

- [x] **Step 1: 写入 ROI payload 失败测试**

```js
import assert from 'node:assert/strict';
import { buildRoiArchivePayload, parseRoiArchiveUrl } from '../lib/roi-bitable-archive.js';

assert.deepEqual(
  parseRoiArchiveUrl('https://bytedance.larkoffice.com/wiki/J1R?table=tblA&view=vewA'),
  { kind: 'wiki', nodeToken: 'J1R', tableId: 'tblA', viewId: 'vewA' },
);

const payload = buildRoiArchivePayload({
  runId: 'roi-1', startedAt: '2026-07-17T00:00:00.000Z', vendor: 'Pactera',
  sourceSegmentCount: 2, projects: ['513'],
  summary: { status: 'incomplete', selectedScopeCount: 2, completeScopeCount: 1,
    subtotalBefore: 2, subtotalAfter: 1.5, subtotalSaving: 0.5,
    incompleteScopes: [{ key: '513:en:ar', reasons: ['rate_missing_language_pair'] }] },
  scopeRuns: [{ scope: { key: '513:en:fr', projectId: 513, sourceLocale: 'en', targetLocale: 'fr' },
    items: [{ roi: { status: 'complete', estimatedCostBefore: 2, estimatedCostAfter: 1.5, estimatedSaving: 0.5 } }] },
    { scope: { key: '513:en:ar', projectId: 513, sourceLocale: 'en', targetLocale: 'ar' },
      items: [{ roi: { status: 'incomplete', reason: 'rate_missing_language_pair' } }] }],
});
assert.equal(payload.run.fields['Write status'], 'incomplete');
assert.equal(payload.scopes[1].fields['Full translation USD'], undefined);
```

- [x] **Step 2: 运行 payload 测试并确认失败**

Run: `node test/roi-bitable-archive.test.js`

Expected: FAIL，提示模块或导出函数不存在。

- [x] **Step 3: 实现纯函数与固定字段 schema**

在新模块中定义不可变 schema，字段类型使用飞书数值：文本 `1`、数字 `2`、单选 `3`、日期 `5`、多行文本 `1`。导出以下纯函数：

```js
export const RUNS_TABLE_NAME = 'L10n ROI Runs';
export const SCOPES_TABLE_NAME = 'L10n ROI Scopes';

export function parseRoiArchiveUrl(input) {
  const url = new URL(input);
  const tableId = url.searchParams.get('table') || null;
  const viewId = url.searchParams.get('view') || null;
  const wiki = url.pathname.match(/\/wiki\/([A-Za-z0-9]+)/);
  if (wiki) return { kind: 'wiki', nodeToken: wiki[1], tableId, viewId };
  const base = url.pathname.match(/\/base\/([A-Za-z0-9]+)/);
  if (base) return { kind: 'base', appToken: base[1], tableId, viewId };
  throw new Error('ROI archive URL must be a Feishu Wiki or Bitable link');
}
```

`buildRoiArchivePayload()` 必须把 incomplete Run 的 subtotal 明确写入金额字段、把 `Incomplete scopes` 写为 `scope key: reason1, reason2` 多行文本；每个 incomplete Scope 的三个金额字段必须省略。Scope 的 `Pricing notes` 从条目中收集去重后的 `match_category` 或计价说明，空值返回空字符串。

- [x] **Step 4: 运行纯函数测试并确认通过**

Run: `node test/roi-bitable-archive.test.js && node test/multilingual-roi.test.js`

Expected: PASS，且原多语言 ROI 汇总测试保持 PASS。

### Task 3: 实现 Wiki 解析、幂等 schema 与写入状态机
**Files:**
- Modify: `lib/roi-bitable-archive.js`
- Modify: `test/roi-bitable-archive.test.js`

**Interfaces:**
- Consumes: `getTenantToken(appId, appSecret)` from `lib/feishu-bitable.js`。
- Produces: `resolveRoiArchiveTarget(config)`、`ensureRoiArchiveSchema(target, token)`、`writeRoiArchive(input)`。
- API contract: `writeRoiArchive({ config, payload })` 返回 `{ runRecordId, scopeRecordCount, status }`，失败时抛保留飞书 `msg` 的 `Error`。

- [x] **Step 1: 写入 Wiki 与 schema 状态机失败测试**

```js
const result = await writeRoiArchive({ config, payload });
assert.equal(result.status, 'incomplete');
assert.equal(calls[1].url, 'https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=J1R');
assert.match(calls.at(-1).url, /records\/.+$/);
assert.equal(JSON.parse(calls.at(-1).body).fields['Write status'], 'incomplete');

await assert.rejects(
  () => resolveRoiArchiveTarget({ ...config, roiArchiveUrl: 'https://x/wiki/J1R' }),
  /not a Bitable/,
);
```

测试 mock 必须覆盖：Wiki 返回 `{ obj_type: 'bitable', obj_token: 'appROI' }`、同名两表存在且字段正确、首次创建表和字段、字段类型错误、Scope batch_create 失败后将 Run 更新为 `write_failed`。

- [x] **Step 2: 运行 adapter 测试并确认失败**

Run: `node test/roi-bitable-archive.test.js`

Expected: FAIL，提示目标解析、schema 或写入函数不存在。

- [x] **Step 3: 实现受限的飞书 API 边界**

实现以下请求顺序，并用一个内部 `requestJson(url, options)` 统一处理 `data.code !== 0`：

```js
GET  /wiki/v2/spaces/get_node?token={nodeToken}
GET  /bitable/v1/apps/{appToken}/tables?page_size=100
POST /bitable/v1/apps/{appToken}/tables                 // 缺少 Runs/Scopes 表时
GET  /bitable/v1/apps/{appToken}/tables/{tableId}/fields
POST /bitable/v1/apps/{appToken}/tables/{tableId}/fields // 仅新建表的固定字段
POST /bitable/v1/apps/{appToken}/tables/{runsId}/records
POST /bitable/v1/apps/{appToken}/tables/{scopesId}/records/batch_create
PUT  /bitable/v1/apps/{appToken}/tables/{runsId}/records/{runRecordId}
```

`resolveRoiArchiveTarget()` 接受 `/base/{appToken}` 时直接使用 token，接受 `/wiki/{nodeToken}` 时校验 `obj_type === 'bitable'` 与非空 `obj_token`。`ensureRoiArchiveSchema()` 发现同名表时必须列出字段并按“字段名 + type”严格比对；任何差异抛出 `ROI archive schema mismatch: ...`，不得补列或重命名用户已有表。

`writeRoiArchive()` 必须先新建 Run 的 `Write status: writing`，再按最多 500 条追加 Scope records，最后将 Run 更新为 payload summary 的 `complete` 或 `incomplete`。Scope 追加或最终更新失败时，使用同一 Run record 更新 `Write status: write_failed` 和 `Incomplete scopes: archive_write_failed: {originalError}`，随后重新抛出原始错误。若失败发生在创建 Run 之前，不创建任何记录。

- [x] **Step 4: 运行 adapter 回归测试并确认通过**

Run: `node test/roi-bitable-archive.test.js && node test/feishu-bitable.test.js && node test/feishu-sheets.test.js`

Expected: PASS，且旧 Bitable 文案写入与 Sheet URL 解析测试不回归。

### Task 4: 将 ROI 归档接入 Popup 的确认与写入流程
**Files:**
- Modify: `popup.html`
- Modify: `popup.css`
- Modify: `popup.js`
- Modify: `test/popup-run-config.test.js`

**Interfaces:**
- Consumes: `loadConfig().roiArchiveUrl`、`multilingualRoiSummary`、`multilingualScopeRuns`、`processedItems`、`runVendor`、`selectedProjectIds` 与 `writeRoiArchive()`。
- Produces: 用户显式确认后的归档动作，成功后显示 `Run ID`、Scope 条数和最终状态。

- [x] **Step 1: 写入 Popup 结构与门禁失败测试**

```js
assert('结果页存在 ROI archive 按钮', html.includes('id="btn-write-roi-archive"'));
assert('存在 ROI archive 预览区域', html.includes('id="roi-archive-preview"'));
assert('归档读取独立配置', source.includes('roiArchiveUrl'));
assert('归档只调用 ROI writer', source.includes('writeRoiArchive('));
assert('原 Sheet 写回仍调用 writeToSheet', source.includes('await writeToSheet(itemsToWrite, config)'));
```

- [x] **Step 2: 运行 Popup 测试并确认失败**

Run: `node test/popup-run-config.test.js`

Expected: FAIL，提示 ROI archive 按钮、预览或调用门禁缺失。

- [x] **Step 3: 实现确认预览和单一写入入口**

在结果页添加独立按钮与预览容器：

```html
<button id="btn-write-roi-archive" class="btn btn-success" disabled>Write ROI archive</button>
<div id="roi-archive-preview" class="dest-preview hidden"></div>
```

在 `popup.js` 增加 `writeCurrentRoiArchive()`：当 `multilingualRoiSummary`、`multilingualScopeRuns` 或 `config.roiArchiveUrl` 缺失时显示精确可操作错误并返回；否则生成 `crypto.randomUUID()` Run ID、调用 `buildRoiArchivePayload()`，在 `window.confirm()` 中展示目标 URL、`L10n ROI Runs`、`L10n ROI Scopes`、一条 Run 和 scope 数，只有确认后调用 `writeRoiArchive()`。

按钮启用条件为有多语言 ROI 结果且已配置 `roiArchiveUrl`，不依赖 `activeDisplayScopeKey`。原 `writeToFeishu()`、`destWritable()`、`btn-write-bitable` 与 `btn-write-results` 保持 Sheet 专用行为；不得把 Bitable URL 放入 `sheetsUrl`。

- [x] **Step 4: 运行 Popup 回归测试并确认通过**

Run: `node test/popup-run-config.test.js && node test/popup-fast-path.test.js && node --check popup.js`

Expected: PASS，且无语法错误；无 ROI archive URL 时按钮禁用或给出配置提示。

### Task 5: 完成文档增量与真实端到端验证
**Files:**
- Modify: `docs/multilingual-roi.md`
- Modify: `docs/E2E-CHECKLIST.md`
- Create: `temp/test_roi_bitable_archive/verification.md`

**Interfaces:**
- Consumes: Task 1-4 的已通过测试和一个用户确认可写的专用测试 Bitable。
- Produces: 可复现的真实飞书验证记录，生产表不作为无确认测试目标。

- [x] **Step 1: 更新长期业务文档和 E2E 清单**

在 `docs/multilingual-roi.md` 的“用户交互”与“执行流程”中增量加入：Bitable 归档使用两张表、Run ID 文本连接键、`incomplete` 只展示已覆盖小计、写入状态机与不修改现有 Sheet。向 `docs/E2E-CHECKLIST.md` 增加以下检查项：

```markdown
- [ ] 粘贴 Wiki Bitable URL 后，插件解析到 `obj_type=bitable`，而不是将 Wiki token 当作 App Token。
- [ ] 首次确认初始化仅创建 `L10n ROI Runs` 与 `L10n ROI Scopes`，二次初始化不产生同名表。
- [ ] 完整与不完整运行的 Run/Scope 数、金额、覆盖率和失败原因与 Popup 一致。
- [ ] 中断 Scope 写入时 Run 显示 `write_failed`，Popup 不显示归档成功。
```

- [x] **Step 2: 执行完整本地测试套件**

Run:

```bash
for file in test/*.test.js; do node "$file"; done
python3 -m unittest test.test_export_local_rates -v
node --check popup.js
node --check options.js
git diff --check
```

Expected: 所有 JavaScript、Python 和语法检查通过，`git diff --check` 无空白错误。

- [ ] **Step 3: 在专用测试 Bitable 中执行已确认的真实写入**

使用一条 `complete` 和一条 `incomplete` scope 的受控运行，点击 Popup 的归档确认按钮。记录真实生成的 App Token（脱敏）、Runs/Scopes table ID、Run ID、Run 状态、写入 Scope 数、三个金额字段、失败原因字段与时间戳到 `temp/test_roi_bitable_archive/verification.md`。

Expected: 两张表各只存在一次；`complete` Run 金额完整；`incomplete` Run 只显示已覆盖语言小计并列出未覆盖 scope；incomplete Scope 的金额单元格为空。

- [ ] **Step 4: 复核真实输出并完成交接**

逐项对照 `docs/E2E-CHECKLIST.md` 与 `verification.md` 的真实记录，检查表名、字段类型、记录数量、Run 状态、金额和失败原因。将最终实现状态、飞书权限要求、测试 Bitable 清理结果和生产表是否写入追加到 `handoff/` 的新日期交接文件；不得把 App Secret、tenant token 或未脱敏 App Token 写入文档。

## Plan Self-Review

- **Spec coverage:** Task 1 覆盖独立目标配置；Task 2 覆盖 Run/Scope payload 与不完整金额语义；Task 3 覆盖 Wiki App Token 解析、两表初始化、schema 严格校验和写入状态机；Task 4 覆盖用户确认与 Popup 集成；Task 5 覆盖长期文档、全套回归和真实验证。
- **Placeholder scan:** 本计划不含 TBD、TODO、以后实现或未定义接口；所有新函数、字段名、状态值、HTTP 路径与测试命令在相应任务中明确给出。
- **Type consistency:** `roiArchiveUrl` 是唯一配置 key；`buildRoiArchivePayload()` 输出 `{ run, scopes }`；`writeRoiArchive({ config, payload })` 是唯一网络写入入口；Run 状态统一为 `writing`、`complete`、`incomplete`、`write_failed`。
