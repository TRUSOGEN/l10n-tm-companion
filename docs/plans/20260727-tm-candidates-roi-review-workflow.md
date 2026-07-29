# Top-3 TM、AI 候选审阅与 ROI 漏斗 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Top-3 TM、50–85 英语改写、逐条最终确认、Sheet 同步和 ROI 漏斗收敛为设计文档定义的单一审阅流程。

**Architecture:** Native Host 负责保留 Starling 服务端 Top-3 数据，浏览器纯逻辑模块负责改写梯度、候选结构与安全门禁，`popup.js` 只编排查询和交互。Sheet adapter 与 Bitable adapter 分别实现兼容迁移和漏斗归档，任何协议、权限或 schema 异常均停止当前动作并保留真实错误。

**Tech Stack:** Chrome Extension MV3、Vanilla ES modules、Python Native Messaging、Starling Batch TM、Inspire Writer OpenAPI、Feishu Sheets/Bitable OpenAPI、Node/Python 脚本式测试。

## Global Constraints

- 自动改写区间严格为 `50 <= Score A < 85`，使用 Starling 原始数值，不先四舍五入。
- 每条 source 只创建一个 Inspire task，最多保留三个结构化候选。
- AI 文本只有在结构完整、受保护 token 完整、语义为 `same_meaning`、无规则风险、Post-TM 完成且 `Score B > Score A` 时展示。
- Top-3 查询继续使用一个 `limit=3` Batch 请求，不为三个候选重复查询原始 source。
- Post-TM 和 Final TM 的 delta 均以原始 Score A 为基线。
- 逐条确认严格执行最终文案校验、Final TM、Sheet 写回、confirmed 四阶段。
- 正式 ROI 始终为 `TM Cost(A) - TM Cost(C)`，B 只用于 AI 效果分析。
- 不新增 Source String Key、项目元数据、`/project/search` 或 `L10n ROI Items`。
- 不使用本地 BM25、旧分数、部分结果或 LLM 自评分伪装 Starling 成功。
- 当前工作区已有大量 modified/untracked 文件；禁止 broad stage、清理、提交或 push。
- 测试输出写入 `temp/test_tm_candidates_roi_review/` 并人工检查。

---

### Task 1: 固定 Top-3 TM 数据契约

**Files:**
- Modify: `native-host/starling-bridge.py`
- Modify: `test/batch-tm-test.py`
- Modify: `test/starling-tm-batch.test.js`

**Interfaces:**
- Consumes: Starling `{data: Array<Array<TMMatch>>}` 响应。
- Produces: 每条结果的 `tm_candidates` 数组及兼容的 `tm_match`、`tm_source`、`similarity` 第一名字段。

- [ ] **Step 1: 写失败测试**

测试固定候选按 `source + target` 去重、重复项保留最高分、服务端顺序稳定、缺失字段为空、非数值 score 正确失败，并验证浏览器请求明确发送 `limit: 3`。

- [ ] **Step 2: 运行并确认 RED**

Run: `python3 test/batch-tm-test.py && node test/starling-tm-batch.test.js`

Expected: 新增 `tm_candidates` 与 `limit` 断言失败，既有协议测试仍可运行。

- [ ] **Step 3: 实现最小映射**

在 `parse_batch_tm_response()` 中规范化候选，返回：

```python
{
    'source': str,
    'target': str,
    'score': float,
    'origin': str,
    'source_lang': str,
    'target_lang': str,
    'match_category': str | None,
    'tm_id': str,
}
```

`searchTM()` 的 Batch payload 显式发送 `limit: 3`，旧最佳匹配字段继续读取候选第一名。

- [ ] **Step 4: 运行并确认 GREEN**

Run: `python3 test/batch-tm-test.py && node test/starling-tm-batch.test.js`

Expected: Top-3、兼容字段和异常语义全部通过。

### Task 2: 固定 50–85 梯度与结构化候选

**Files:**
- Modify: `lib/ai-translate.js`
- Modify: `lib/inspire-writer.js`
- Modify: `test/e2e-logic.test.js`
- Modify: `test/inspire-writer.test.js`

**Interfaces:**
- Produces: `shouldRewriteSource(score)` 和最多三个带 `decision`、`semantic_status`、`risks`、`revision` 的候选。

- [ ] **Step 1: 写失败测试**

覆盖 `49.99 => false`、`50 => true`、`84.99 => true`、`85 => false`，并验证每条符合条件的 source 只有一个 Inspire task、最多三个候选、损坏 JSON 或缺字段候选被记录为 invalid。

- [ ] **Step 2: 运行并确认 RED**

Run: `node test/e2e-logic.test.js && node test/inspire-writer.test.js`

Expected: 低于 50 仍会调用、候选结构和三条上限断言失败。

- [ ] **Step 3: 实现梯度和解析**

Prompt 明确要求每个 revision 返回结构化 JSON：

```json
{"decision":"rewrite|no_change|needs_context|meaning_changed","semantic_status":"same_meaning|needs_context|meaning_changed","ai_translation":"...","reasoning":"...","changes":[],"risks":[],"reuse_tm":false}
```

低于 50 和达到 85 的条目不创建 task；Inspire revisions 最多保留前三个可解析候选，原始服务分数不参与业务排名。

- [ ] **Step 4: 运行并确认 GREEN**

Run: `node test/e2e-logic.test.js && node test/inspire-writer.test.js`

Expected: 四个边界、单 task 和候选上限通过。

### Task 3: 建立候选安全门禁和多候选 Post-TM

**Files:**
- Modify: `lib/source-rewrite-policy.js`
- Modify: `lib/starling-tm.js`
- Modify: `test/source-rewrite-policy.test.js`
- Modify: `test/starling-tm-batch.test.js`

**Interfaces:**
- Produces: `evaluateRewriteCandidates(item, snapshots)`，返回 `validCandidates`、`representativePostTm`、`displayText` 和拒绝原因。

- [ ] **Step 1: 写失败测试**

覆盖 placeholder、URL、数字、模板 token 变化，`needs_context`、`meaning_changed`、非空 risks、Post-TM incomplete、持平、下降和上升排序；验证三个候选通过一个 Batch TM 调用查询且按输入映射。

- [ ] **Step 2: 运行并确认 RED**

Run: `node test/source-rewrite-policy.test.js && node test/starling-tm-batch.test.js`

Expected: 多候选 API 和完整门禁缺失导致失败。

- [ ] **Step 3: 实现纯逻辑门禁**

候选只有 `semantic_status === 'same_meaning'`、`risks.length === 0`、token 完整、Post-TM complete 且分数严格高于 A 时进入 `validCandidates`；有效候选按真实 Post-TM 降序，最多三条。

- [ ] **Step 4: 运行并确认 GREEN**

Run: `node test/source-rewrite-policy.test.js && node test/starling-tm-batch.test.js`

Expected: 安全候选、`None`、代表分数和拒绝原因全部通过。

### Task 4: 建立逐条确认状态机

**Files:**
- Create: `lib/review-workflow.js`
- Create: `test/review-workflow.test.js`
- Modify: `popup.js`

**Interfaces:**
- Produces: `createReviewState()`、`editFinalText()`、`beginConfirmation()`、`completeConfirmation()`、`failConfirmation()`。

- [ ] **Step 1: 写失败测试**

覆盖 `draft -> confirming -> confirmed`、查询失败、Sheet 写入失败、confirmed 后编辑变 dirty、空文案和 token 变化拒绝确认。

- [ ] **Step 2: 运行并确认 RED**

Run: `node test/review-workflow.test.js`

Expected: 模块不存在导致失败。

- [ ] **Step 3: 实现状态机并接入 Popup**

`completeConfirmation()` 只接受 complete Final TM 和成功 Sheet 写入结果；失败保留草稿、错误和未确认状态，编辑后清空过期 Final TM。

- [ ] **Step 4: 运行并确认 GREEN**

Run: `node test/review-workflow.test.js && node --check popup.js`

Expected: 状态转换和 Popup 语法通过。

### Task 5: 迁移 Sheet 六列契约并实现逐条写回

**Files:**
- Modify: `lib/sheet-layout.js`
- Modify: `lib/feishu-sheets.js`
- Modify: `test/sheet-layout.test.js`
- Modify: `test/feishu-sheets.test.js`

**Interfaces:**
- Produces: 第六列 `Final TM %` 安全迁移和 `writeConfirmedReviewItem()`。

- [ ] **Step 1: 写失败测试**

覆盖空 `CD review valid?` 列自动改名、非空列停止迁移、未知 schema 停止、逐条写入最终文案/Post-TM/Final TM/Reached 85。

- [ ] **Step 2: 运行并确认 RED**

Run: `node test/sheet-layout.test.js && node test/feishu-sheets.test.js`

Expected: 旧表头与批量写回行为不符合新契约。

- [ ] **Step 3: 实现安全迁移和原子业务顺序**

读取旧第六列数据后才允许改名；逐条写回仅在 Final TM complete 后调用，接口失败原样抛出，调用方不得标记 confirmed。

- [ ] **Step 4: 运行并确认 GREEN**

Run: `node test/sheet-layout.test.js && node test/feishu-sheets.test.js`

Expected: schema 迁移和逐条写回通过。

### Task 6: 增加 ROI Run 漏斗和部分确认语义

**Files:**
- Modify: `lib/multilingual-roi.js`
- Modify: `lib/roi-bitable-archive.js`
- Modify: `test/multilingual-roi.test.js`
- Modify: `test/roi-bitable-archive.test.js`

**Interfaces:**
- Produces: `buildRoiFunnelMetrics(items)` 及 Runs 新字段，Operator 写空字符串。

- [ ] **Step 1: 写失败测试**

覆盖 A/有效 B/已确认 C 达标数量、AI/Review uplift、同一确认分母、零确认禁止归档、部分确认 `incomplete` 小计、缺字段创建和类型冲突失败。

- [ ] **Step 2: 运行并确认 RED**

Run: `node test/multilingual-roi.test.js && node test/roi-bitable-archive.test.js`

Expected: 新指标和字段 schema 断言失败。

- [ ] **Step 3: 实现漏斗和 schema 增量**

Runs 增加 `Operator`、`Pretranslation ≥85`、`After AI ≥85`、`AI uplift to ≥85`、`CD reviewed segments`、`After Review ≥85`、`Review uplift to ≥85`；金额继续复用 A−C 汇总。

- [ ] **Step 4: 运行并确认 GREEN**

Run: `node test/multilingual-roi.test.js && node test/roi-bitable-archive.test.js`

Expected: 漏斗、partial 和 schema 失败语义通过。

### Task 7: 收敛 Side Panel 审阅 UI

**Files:**
- Modify: `popup.html`
- Modify: `popup.css`
- Modify: `popup.js`
- Modify: `lib/i18n.js`
- Modify: `test/popup-fast-path.test.js`
- Modify: `test/popup-run-config.test.js`
- Modify: `test/side-panel-i18n.test.js`

**Interfaces:**
- Consumes: Task 1–6 的候选、状态机、Sheet 和 ROI 接口。
- Produces: 单一 Focus 审阅入口和逐条确认按钮。

- [ ] **Step 1: 写失败测试**

固定主按钮文案、卡片字段、Top-3 Focus、AI `None`、逐条确认/重新同步、删除两个全局写回按钮、展开详情、AI rewrite 徽标、CD review 下拉和 Final C 全局按钮。

- [ ] **Step 2: 运行并确认 RED**

Run: `node test/popup-fast-path.test.js && node test/popup-run-config.test.js && node test/side-panel-i18n.test.js`

Expected: 旧控件仍存在导致失败。

- [ ] **Step 3: 修改 UI 与编排**

批处理只读 Sheet 并生成审阅结果；用户在 Focus 中采用候选或编辑最终文案，逐条确认成功后才更新卡片和 ROI 可用状态。

- [ ] **Step 4: 运行并确认 GREEN**

Run: `node test/popup-fast-path.test.js && node test/popup-run-config.test.js && node test/side-panel-i18n.test.js && node --check popup.js`

Expected: UI 契约和语法通过。

### Task 8: 增量同步正式文档与交付契约

**Files:**
- Modify: `README.md`
- Modify: `docs/user-guide.md`
- Modify: `docs/TM-MATCHING.md`
- Modify: `docs/multilingual-roi.md`
- Modify: `docs/popup-configuration.md`
- Modify: `docs/E2E-CHECKLIST.md`
- Modify: `docs/offline-install-manual.md`
- Modify: `test/installer-contract.test.js`

- [ ] **Step 1: 更新文档契约测试并确认 RED**

Run: `node test/installer-contract.test.js`

Expected: 旧 Sheet/UI 文案仍被安装契约接受。

- [ ] **Step 2: 增量更新正式文档**

同步 Top-3、50–85、候选门禁、逐条确认、Final TM 列、ROI 漏斗和真实 E2E 未验证边界，不重写历史设计文档。

- [ ] **Step 3: 运行文档与安装契约**

Run: `node test/installer-contract.test.js && rg -n "CD review valid\\?|确认最终 C|写回表格" README.md docs/user-guide.md docs/TM-MATCHING.md docs/multilingual-roi.md docs/popup-configuration.md docs/E2E-CHECKLIST.md docs/offline-install-manual.md`

Expected: 测试通过；搜索命中只存在于迁移说明或明确的旧 schema 描述。

### Task 9: 完整验证和交接

**Files:**
- Create: `temp/test_tm_candidates_roi_review/verification.txt`
- Create: `/private/tmp/l10n-tm-companion-handoff-20260727-implementation.md`

- [ ] **Step 1: 运行全量自动化验证**

Run:

```bash
for file in test/*.test.js; do node "$file"; done
python3 test/batch-tm-test.py
python3 -m unittest test/feishu-oauth-test.py test/feishu-oauth-bridge-test.py test/starling-credentials-test.py test/test_export_local_rates.py -v
node --check popup.js
node --check background.js
python3 -m py_compile native-host/starling-bridge.py native-host/feishu_oauth.py
git diff --check
```

Expected: 所有测试退出码为 0，语法和 diff 检查无错误。

- [ ] **Step 2: 人工检查验证输出**

确认测试数量、边界样本、失败语义、安装契约和输出内容符合设计；不得只依据退出码判断完成。

- [ ] **Step 3: 记录真实 E2E 边界和 handoff**

真实 Inspire、Feishu Sheet 与 ROI_Test 未经用户授权时标记为未验证；handoff 记录修改文件、验证结果、权限状态、工作区边界和下一步，不记录凭证。

## Self-Review

- Spec coverage: Top-3、梯度、候选门禁、统一基线、逐条确认、Sheet 迁移、ROI 漏斗、UI 删除项、失败语义、文档和验证均有对应任务。
- Placeholder scan: 计划不含 TBD、TODO 或未定义的实现占位。
- Type consistency: `tm_candidates`、`semantic_status`、`validCandidates`、`representativePostTm`、review 状态和 ROI 字段在生产与测试任务中保持一致。
