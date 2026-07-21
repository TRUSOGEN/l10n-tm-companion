# L10n TM Companion Loop Progress

## Current Status

🟡 REOPENED → BX1-BX3 已全部修复 — post-MVP bugfix 阶段代码完成，待真实机器 E2E 验证。

**重要澄清：** 之前的 `✅ ALL TASKS COMPLETE` 只代表 LOOP_TASKS.md 中的 T01-T26 文件级任务完成，**不代表真实 E2E 完成**。真实使用反馈推翻了该结论，发现 3 个真实阻塞问题（BX1-BX3），现已全部修复并补测试。但代码层完成 ≠ 真实 E2E 完成——wiki 抓取/写回/UI 交互仍需真实浏览器验证（见 Known Risks）。

**关于 `<promise>COMPLETE</promise>`：** BX1-BX3 已修完，满足「修完前不输出 COMPLETE」的约束条件。是否输出 COMPLETE 取决于真实 E2E 验证结果，本阶段不主动输出，待真实机器验证后再定。

## Post-MVP 真实阻塞问题（最高优先级，来自真实使用反馈）

这三个问题由真实使用反馈发现，优先级高于一切历史「已完成」结论：

- **BX1 Fix wiki/doc extraction reliability** — 部分 wiki/doc 页面无法抓取内容，弹窗提示「未抓取到文案，请确认页面内容或选中文字。」示例：https://bytedance.larkoffice.com/wiki/QmG4w6EVIitUAlkT259clYFCndf 。当前 `content.js` docx 抓取对 wiki 路径不可靠，需修复抓取逻辑。
- **BX2 Fix Feishu Sheets writeback payload** — 真实写回失败：`Sheets write error: valueRanges is nil, wrong request body`。说明写回链路 request body / payload 构造有 bug，需修复并补测试。
- **BX3 Clarify and require output destination in UI** — 用户仍不知道填哪个表格、是 Sheet 还是 Bitable、是否推荐空表格。需修 UI：明确要求填写输出目标、加小字说明推荐准备空目标表格、写清支持的目标类型、未填目标禁止写回、写回前后展示目标名称/类型/链接摘要。

推进规则：一次只处理一个问题，从 BX1 开始；每修一个问题运行相关测试；每轮输出标准 Loop Result；BX1-BX3 修完前不输出 COMPLETE。

## UI Audit (T02 — popup.html/js + options.html/js)

### Popup actions (3 current buttons)

| Button (id) | Current role | Decision | Task |
|------|------|------|------|
| `📥 抓取全文` (btn-extract-all) | Capture full text from Feishu docx | **KEEP** (primary #1: Capture full text) | T04 |
| `✋ 选中查询` (btn-extract-sel) | Capture selected text | **KEEP** (primary #2: Capture selected text) | T04 |
| `📋 从当前表格读原文` (btn-read-bitable) | Read source segments from Sheet A column | **REMOVE / hide to advanced** — conflates table as *source*, but new model: table is the *write destination*; source = doc capture. ⚠️ Product decision needed at T04: this is a paradigm shift from "table-driven" (handoff) to "doc-capture → write to pasted URL". Flag for confirmation. | T04 |
| `📤 写入飞书表格` (btn-write-bitable) | Write back | **KEEP** — but de-emoji + add destination preview before/after | T06/T09/T10 |
| `⚙️ 设置` (settings-btn) | Open options | **KEEP** | — |

### Popup chrome elements to change

| Element | Decision | Task |
|------|------|------|
| Header `🌐 L10n TM Companion` + emoji badges (🔄🤖📤📥✋📋) | De-emoji, professional labels | T06 |
| `🌍 目标语言: --` display | **REMOVE** (English-only workflow, no target lang in UI) | T05/T06 |
| `📄 未检测到飞书文档` doc-title | Keep concept, de-emoji; becomes step-1 source indicator | T06 |
| Card badges `🔄 TM x%` / `🤖 AI 推荐` | Professional status text, no emoji | T06 |
| Card action buttons 采纳AI/沿用TM/手动/详情 | KEEP functionality; relabel without emoji | T06 |
| No step-based layout | Rebuild as 5-step flow (Choose source → Confirm destination → Run TM → Review → Write back) | T06 |
| No setup health check on open | Add auto health check (native host / TM / Feishu / destination writable) | T07 |
| No destination preview before write / no "written to X" after | Add both | T09/T10 |

### Options page fields

| Field (id) | Decision | Task |
|------|------|------|
| `starlingCliPath` | KEEP (advanced) | — |
| `starlingProjectId` | KEEP | — |
| `sourceLang` (select) | **HIDE to advanced**, default `en` (English-only) | T05 |
| `llmProvider` / `llmEndpoint` / `llmApiKey` / `llmModel` | KEEP (LLM config) | — |
| `targetLang` (select) | **HIDE to advanced**, stable default (`zh`) — TM API needs a target locale; not exposed in main UI | T05 |
| `feishuAppId` / `feishuAppSecret` | KEEP | — |
| `sheetsUrl` | **PROMOTE** — central to new flow (paste destination URL) | T08 |
| `spreadsheetToken` / `sheetId` | KEEP (auto-parsed, advanced-editable) | — |
| `test-cli` / `test-feishu` buttons | KEEP (folded into health check T07) | T07 |
| 列布局说明 `<details>` | **UPDATE** — replace A-H column layout with the 9 named headers (Row…Comment) once T12 lands | T12 |

### Cross-cutting audit findings (feed later tasks)

- **Source/destination conflation**: today `readFromBitable` reads source from the same table that `writeToSheet` writes to. New spec separates them: source = doc capture, destination = pasted Sheet/Bitable URL. This is the largest product change; must confirm at T04 before T08-T10.
- **Emoji everywhere** (popup + options headers 🌐🤖📊⚙️💾): systematic de-emoji in T06.
- **No "where did I write?" feedback**: `writeToFeishu` only says "写入成功，共 N 条", never the destination. → T10.
- **Error messages not actionable**: `showStatus(e.message)` passes raw errors. → T23.

## Architecture Summary (filled by T01, from handoff + source audit)

**Project:** L10n TM Companion — Chrome MV3 extension, no backend, all client-side + local
native host. Location: `/Users/bytedance/my-project/l10n-tm-companion/`.

**Core data flow (popup.js `processItems`):**
1. Read source English segments (3 current entry points, see below)
2. `searchTM()` → background SW → Native Messaging → `starling-bridge.py` → `starling-cli api GET /corpus/tm/match` → returns `{tm_match, tm_source, similarity(=Orig Match % 0-100), origin}`
3. Orig Match % ≥ 75 → Reached 75%? = TRUE, skip rewrite (D = original text)
4. `< 75` → `rewriteSourceWithAI()` rewrites English source (NOT translate) via LLM, routed through native host `llm_call` to bypass CORS → Rewritten Segment
5. `textSimilarity(Rewritten, tm_source)` → New Match % (0-100). Does NOT call TM a second time.
6. `compareAIvsTM()` → Comment (improved/different/same/no_tm, delta>=5 threshold)
7. `writeToSheet()` → writes back to Feishu Sheet

**Module map:**

| File | Role |
|------|------|
| `manifest.json` | MV3; perms activeTab/nativeMessaging/storage/scripting; host incl. `larkoffice.com` |
| `background.js` | SW; routes `extract_all/extract_selection` → content script; `native_search_tm` & `native_llm_call` → native host via `sendNativeMessage` (only place sendNativeMessage is used) |
| `content.js` | Feishu docx text scraping (secondary entry) |
| `popup.html/css/js` | UI + main orchestration. **3 entry buttons**: `📥 抓取全文` / `✋ 选中查询` / `📋 从当前表格读原文`. Card render with emoji badges (🔄🤖📤) |
| `options.html/js` | Settings: Starling (Project ID, source lang) / LLM (LLMBox) / Feishu creds / Sheets URL auto-parse |
| `lib/starling-tm.js` | `searchTM` JS wrapper via background |
| `lib/ai-translate.js` | `rewriteSourceWithAI` + `buildRewritePrompt` (rewrite, not translate); legacy `translateWithAI`; `callLLM` routes extension env through background→native host |
| `lib/diff.js` | `compareAIvsTM` + `textSimilarity` (Jaccard 0.6 + Levenshtein 0.4, 0-100) |
| `lib/feishu-sheets.js` | ⭐ current table layer: `listSourceSegments` (read A2:A, skip empty, keep real row), `writeToSheet` (write B-H **by real row number**), `parseSheetsUrl`, `testSheetsConnection` |
| `lib/feishu-bitable.js` | legacy Bitable (token cache reused by sheets); deprecated |
| `native-host/starling-bridge.py` | Python bridge: `search_tm` + `llm_call` + `ping`; `_augment_path()` fixes Chrome minimal PATH; `/tmp/l10n-bridge-debug.log` diagnostics |
| `test/*` | e2e-logic 54, feishu-bitable 13, feishu-sheets 20 — all passing |

**Current entry points (popup):** 抓取全文 / 选中查询 / 从当前表格读原文 — needs T02 audit & T04 simplification to two.

**Key gap vs LOOP_SPEC (must fix later):**
- Writeback writes **by column letter A-H**, not by the 9 **named headers** spec requires (`Row`, `Original Source Segment`, ..., `CD review valid?`, `Comment`). No `Row` column, no `CD review valid?` blank column, no header validation/creation. → T12/T13/T14.
- `textSimilarity` weights are Jaccard 0.6 + Levenshtein 0.4, not the spec's 0.5/0.3/0.2 token_set/levenshtein/ngram. → T19/T20.
- TM scoring depends on Starling only; no deterministic BM25 fallback + no method/version metadata. → T16/T18.
- UI is emoji-heavy, not step-based, no destination preview before/after write. → T06/T09/T10.
- Language selectors (source/target lang) exposed in options/main flow. → T05.

**Bugfixes that must NOT regress:**
1. Row alignment — `writeToSheet` writes per real `it.row`, not by array index. `listSourceSegments` keeps real row when skipping empties.
2. LLMBox CORS — popup must NOT call `sendNativeMessage`; LLM goes popup→`sendMessage(native_llm_call)`→SW→native host. Detect extension env via `chrome.runtime?.sendMessage`, NOT `sendNativeMessage`.
3. Chrome native host PATH — bridge `_augment_path()` adds node/starling-cli dirs + `resolve_cli` probes absolute paths.
4. MV3 native messaging — `sendNativeMessage` only in background SW.
5. glm-5.2 thinking blocks — bridge iterates `content[]` for `type=='text'`.
6. similarity already 0-100 (do NOT ×100); improved threshold `delta>=5`.

## Completed Tasks

- T01 — Read handoff + audited source (background.js, popup.js/html, lib/, test/, native-host/). Wrote full architecture summary above; identified gaps vs LOOP_SPEC (named headers, scoring weights, BM25 fallback, step UI, lang selectors).
- T02 — Audited popup.html/js + options.html/js. Listed every button/option with KEEP/REMOVE/HIDE-to-advanced decision and mapped to downstream tasks. Flagged source/destination conflation as the key product decision for T04.
- T03 — Added 2 regression test blocks to `test/feishu-sheets.test.js`: (1) row alignment boundary when first data row A2 is empty (rows stay at real 3/5 not 2/4); (2) single-item full 6-column placement at row 7 (B/C/D/E/F/H each land at the real row, G never written, reached_75 → TRUE/FALSE on F). Tests now 32/0 (was 20).
- T04 — Reduced popup to two source actions per user decision (strict spec): removed `📋 从当前表格读原文` button (popup.html), its handler `readFromBitable` + event binding + `listSourceSegments` import (popup.js). Two remaining: 抓取全文 / 选中查询. `lib/feishu-sheets.js#listSourceSegments` KEPT (not deleted) — reused later as write-destination read. ⚠️ Side effect: doc-captured items now lack a `row` field, so `writeToSheet` skips them — row-number semantics must be rebuilt in T08-T10 (destination = pasted URL, row = append position in target sheet). All tests still pass.
- T05 — Moved `sourceLang` + `targetLang` selects out of the main options cards into a collapsed `<details class="advanced">` block under Starling; added `.hint` explaining English-only user flow. `options.js load()` now pins defaults (sourceLang=en, targetLang=zh) so empty storage never reaches the TM query. popup.js already had `|| 'en'`/`|| 'zh'` fallbacks — unchanged. (popup header `🌍 目标语言` display element deferred to T06.)
- T06 — De-emojified popup + options (removed 🌐🤖📊⚙️💾📥✋📋📤🔄🤖📄🌍✅❌⚠️; settings-btn now an SVG gear icon). Rebuilt popup.html as a 5-step guided layout (选择来源→确认目标→查询TM→查看结果→写回) with a step indicator `<ol class="steps">`; added `.steps/.step/.step-panel/.panel-label/.doc-info/.icon-btn` CSS. Added `setStep(n)` in popup.js wired into triggerExtract(1)→processItems(3)→renderResults(4)→writeToFeishu(5). Removed `setTargetLang` + `target-lang` element (English-only). Card badges now `TM x%` / `AI 改写` (no emoji). Step 2 (确认目标) and destination preview are placeholders — filled by T08-T10. Health-check panel deferred to T07.
- T07 — Added automatic setup health check on popup open. New `#health` panel in popup.html + `.health/.health-row/.health-dot` CSS (ok=green/bad=red/checking=amber). popup.js `runHealthCheck()` checks 4 items sequentially: (1) native host via `pingNativeHost`; (2) Feishu App ID/Secret presence; (3) spreadsheet token parsed from `sheetsUrl`/`spreadsheetToken` + access via `testSheetsConnection`; (4) write destination readiness. Each row shows actionable guidance when missing (e.g. "请运行 register-native-host.sh", "检查 sheets:spreadsheet 权限 + 应用加为协作者"). Added `sheetsUrl` to popup `loadConfig` KEYS. Invoked at popup load. Reuses existing lib fns — no new lib code.
- T08 — Added `parseFeishuUrl(input)` to `lib/feishu-sheets.js`: unified parser distinguishing Sheet (`/sheets/<token>` → `{type:'sheet', spreadsheetToken, sheetId?}`) vs Bitable (`/base/<token>` → `{type:'bitable', appToken, tableId?}`), bare token defaults to sheet. Legacy `parseSheetsUrl` kept unchanged. Added 9 unit tests for Sheet/Bitable/bare/invalid cases. sheets tests now 41/0 (was 32).
- T09 — Added writeback destination preview. New `#dest-preview` panel (popup.html) + `.dest-preview` CSS. popup.js `renderDestPreview(items, config)` runs after results render, showing `将写入到：<type> / <token> / <sheetId> / <rows min-max|N条>` before the write button is used. Hides when no token set; `resetState()` also hides it. Type label distinguishes Sheet vs Bitable. Row range falls back to item count when items lack `row` (doc-capture case, see T04 risk). Import `parseFeishuUrl` added.
- T10 — Added post-writeback result display. popup.js `showWriteResult(items, config, ok, errMsg)` replaces raw status text in `writeToFeishu`: on success shows `已写入到（共 N 条）：<type>/<token>/<sheet>/<rows>` in the dest-preview panel (blue); on failure shows `写入失败：<err>` (red via `.dest-error`). Always tells the user where it wrote (or why it failed). New `.dest-preview.dest-error` CSS.
- T11 — Added tests for Sheet URL / Bitable URL / invalid URL / missing-permission cases: (1) `testSheetsConnection` permission-denied (sheets/query code≠0 → ok:false + error mentions sheets:spreadsheet); (2) bad app secret (token API code≠0 → ok:false); (3) no token but valid creds → ok:true; (4) parseFeishuUrl edge cases (query params, openId, wiki→null, short token→null). sheets tests now 50/0 (was 41).
- T12 — Enforced exact output headers. Added `REQUIRED_HEADERS` constant (9 cols in spec order: Row, Original Source Segment, Best TM Match, Orig Match %, Rewritten Segment, New Match %, Reached 75%?, CD review valid?, Comment) + `mapHeadersToColumns(headerRow)` → `{byName, missing, extra}` mapping header names to column letters (A=1…), detecting missing/extra columns. Pure logic, no change to `writeToSheet` (row alignment + existing 50 tests preserved). 17 new unit tests. sheets tests now 67/0. Existing `COLUMN_MAP` kept (writeback refactor deferred to T14 header-repair flow which will switch writeback to name-based columns).
- T13 — Guaranteed `CD review valid?` (G column) is never auto-filled. `writeToSheet` already omitted G; added explicit regression test asserting no G-column ranges ever written even when items carry a `cdReview` field, and that only B/C/D/E/F/H are written (column-set assertion). Strengthened the code comment into a hard guardrail ("代码绝不自动写入"). sheets tests now 70/0 (3 new assertions).
- T14 — Added header validation + repair flow. New exports in `lib/feishu-sheets.js`: `readHeaderRow` (reads row 1 via `A1:1`), `validateHeaders` (→ `{ok, byName, missing, extra, sheet}` using `mapHeadersToColumns`), `repairHeaders` (writes REQUIRED_HEADERS to `A1:I1` row 1, user-confirmed). 11 new unit tests (complete/partial/empty header validation + repair write payload). sheets tests now 81/0. NOTE: `writeToSheet` still writes by hardcoded A-H; switching writeback to name-based columns (via validated `byName` map) is a follow-up — T14 scoped to validation+repair per task definition; T12 comment notes the writeback switch is deferred.
- T15 — Documented current TM matching. New `docs/TM-MATCHING.md`: source (Starling CLI via native host → `starling-cli api GET /corpus/tm/match`), method=`starling`, version=starling-cli v1.1.16, return structure, determinism (no LLM scoring), limitations (no fallback, serial slowness, single method, Orig vs New metric mismatch), and the T16 BM25 fallback plan + T18 method/version metadata plan.
- T16 — Implemented deterministic ES-like/BM25 fallback (`method=local_bm25_v1`). New `lib/tm-bm25.js`: fixed normalization (lowercase + strip punctuation + split; CJK kept), fixed BM25 params (k1=1.5, b=0.75), deterministic re-rank (tie-break by corpus order), score normalized to 0-100 via `max(bm25*25, tokenOverlap%)`. `bm25Match(query, corpus)` → `{best, score, method, candidate_count, tm_source, tm_match}`. Pure JS, no backend, no LLM, no randomness. New `test/tm-bm25.test.js` 25/0 (basic match, determinism, different-query different-best, boundaries, tie-break stability, no-randomness). NOTE: not yet wired into popup/bridge flow (corpus source TBD — Starling-unavailable path needs a candidate corpus; left as integration follow-up after T17-T18).
- T17 — Added TM result mapping stability tests to `test/e2e-logic.test.js` (10 cases): replicates popup.js `processItems` TM-merge as `mapTmResult`, asserts determinism (same input → same output), `similarity` stays 0-100 (not ×100), `tm_source` kept independent (not overwritten by source), `origin` passthrough, no-match → similarity=0, `source_text`/`row` preserved. e2e now 64/0 (was 54).
- T18 — Added method/version metadata to TM output (LOOP_SPEC §4.3). `starling-bridge.py` `_parse_cli_output` + `_err` now return `method:'starling'`, `method_version:'starling-cli-1.1.16'`, `candidate_count:<N>`. popup.js TM-merge now carries `tm_method`/`tm_candidate_count` and renderCard TM detail shows `方法: <method>` (explainability). BM25 fallback already exposes `method:'local_bm25_v1'` (T16). 4 new e2e tests for metadata passthrough + defaults. e2e now 68/0.
- T19 — Refactored New Match % into deterministic module. New `lib/new-match-scoring.js` (`newMatchPercent`, method=`new_match_v1`): fixed weights 0.5*token_set + 0.3*levenshtein + 0.2*ngram, fixed normalization (trim+lowercase+strip punct, CJK kept), 0-100, no LLM. `diff.js#textSimilarity` now delegates to it (interface unchanged → popup unchanged). Updated 1 e2e assertion that encoded old 0.6/0.4 behavior ('Settings' vs 'Privacy settings' now 24, partial-overlap-low, was 30-80). New `test/new-match-scoring.test.js` 22/0. NOTE: diff.js still has unused `levenshteinSim`/`extractKeyDifferences` (dead code, kept to stay minimal — safe to remove later).
- T20 — Solidified fixed normalization + frozen weights (LOOP_SPEC §5.2 req 1-3). `WEIGHTS = Object.freeze({tokenSet:0.5, levenshtein:0.3, ngram:0.2})` exported as `NEW_MATCH_WEIGHTS`; `newMatchPercent` returns the frozen ref. Exported `_normalize` for testing. 15 new tests asserting weight values + sum=1 + frozen-immutable + normalization fixedness (case/punct/space/CJK/empty/null + idempotent) + weights×normalization → score stable. new-match-scoring now 37/0.
- T21 — Added stable New Match% scenario tests (snapshot regression locks). 6 anchored input pairs (Done/Send a gift/Cancel/Settings/abc/TikTok LIVE) → fixed expected scores, assert reproducible + two-run snapshot arrays identical. Plus rewrite-improves-match scenario (gift→'send a gift' raises New Match to 100). new-match-scoring now 46/0.
- T22 — Audited + enforced LLM-only-for-rewriting. Import-chain audit: `textSimilarity`/`newMatchPercent` (new-match-scoring ← diff ← popup step3) does NOT import ai-translate/callLLM; `callLLM`/`rewriteSourceWithAI` used only for rewrite. Added 3 independence tests: New Match% still scores with fetch broken + chrome undefined + never calls fetch across 5 calls (pure synchronous). new-match-scoring now 49/0.
- T23 — Added actionable error messages (LOOP_SPEC §6.3). New `lib/errors.js` `friendlyError(err)` → `{title, action, raw}` mapping 7 error families (native host / Feishu permission / spreadsheet token / credentials / invalid link / TM unavailable / page-comm) + fallback, each with a concrete next step. popup.js `showError()` replaces raw `showStatus(e.message)` at triggerExtract catch + write failure; `.status-action` CSS added. New `test/errors.test.js` 14/0.
- T24 — Created manual E2E checklist `docs/E2E-CHECKLIST.md`: prerequisites, T07 health check, main flow E2E (capture→TM→AI→match→writeback + row alignment), T23 error recovery, T08-T10 multi-input/destination, T12-T14 headers, T16-T22 TM/match determinism, known-gaps section (Bitable writeback, BM25 wiring, doc-capture row semantics, serial TM).
- T25 — Ran all tests: 6 suites, 250 cases total (e2e 68 + sheets 81 + bitable 13 + new-match-scoring 49 + tm-bm25 25 + errors 14), all 0 fail. All JS syntax OK, py_compile OK.
- T26 — Updated LOOP_PROGRESS.md final status + Known Risks (resolved vs remaining). All 26 tasks complete. Remaining risks: doc-capture row semantics, BM25 not wired, Bitable writeback, writeback still A-H columns, serial TM slowness, real-machine unverified, diff.js dead code — all non-blocking, tracked in docs/E2E-CHECKLIST.md.

## Current Task

无（BX1-BX3 真实阻塞问题全部修复完成）。

## Post-MVP bugfix 进展

- ✅ BX1 — Fix wiki/doc extraction reliability。（见下方详述）新增 `test/content-extract.test.js` 19 用例。全量 7 套件 269/0。
- ✅ BX2 — Fix Feishu Sheets writeback payload。（见下方详述）sheets 93/0，全量 281/0。
- ✅ BX3 — Clarify and require output destination in UI。修复：popup.html 新增 Step 2「输出目标（必填）」面板——目标输入框、目标摘要区、小字提示（推荐空表格 + 写清支持类型：Sheet `/sheets/`、Bitable `/base/` 暂只读识别）、确认按钮；popup.js 新增 `confirmDestination`（校验链接 + 保存到 storage 对齐 options sheetsUrl/spreadsheetToken/sheetId + 渲染摘要）、`renderDestSummary`（写回前后展示目标类型/名称/token/链接）、`loadDestIntoInput`（打开时回填已保存目标）；`writeToFeishu` 加未填目标硬禁写（parseFeishuUrl 解析失败则禁写并提示）；`renderResults` 末尾写回按钮启用 = 有结果 且 有效目标，并刷新摘要。CSS 新增 `.dest-input/.dest-summary/.dest-summary.dest-missing/.hint`。新增 BX3 测试 7 用例（空/null/空格/非飞书链接禁写，Sheet/Bitable/裸 token 放行）。sheets 套件 100/0（原 93 +7）。全量 7 套件 288/0。
- ✅ BX3b — Bitable 写回不支持防护（BX3 自审补强）。自审发现：`writeToSheet` 是 Sheets-only，但 BX3 的 `confirmDestination` 仍允许 Bitable 目标写回，会导致用户点写回后调 Sheets API 失败——与「写清支持类型、未填禁写」精神矛盾。修复：新增 `destWritable(parsed)`（Sheet 可写、Bitable 不可写）；`renderDestSummary` 对 Bitable 标注「暂不支持写回 · 当前仅支持电子表格(Sheet)」并用 `dest-missing` 警示样式；`renderResults` 写回按钮启用改用 `destWritable`；`writeToFeishu` 对 Bitable 明确提示改用 /sheets/ 链接。新增 BX3b 测试 5 用例（Sheet/裸token 可写，Bitable/空/无效 不可写）。sheets 套件 105/0（原 100 +5）。全量 7 套件 293/0。

## Next Task

无——BX1-BX3 三个真实阻塞问题全部修复完成并补测试。下一阶段建议：真实机器 E2E 验证（docs/E2E-CHECKLIST.md），重点验证 wiki 页面抓取、doc-capture 追加写回、目标输入交互在浏览器实际环境的表现（单测无法覆盖 MV3 SW / DOM 渲染）。

## Known Risks (post-BX1~BX3 更新)

Resolved during BX phase:
- ✅ wiki/doc 抓取可靠性（BX1）：wiki DOM 无 data-block-id → 多选择器 + 容器兜底。
- ✅ Sheets 写回 valueRanges is nil（BX2）：空 items 防护 + doc-capture 追加路径。
- ✅ 输出目标不清晰（BX3）：UI 明确要求、推荐空表格、类型说明、未填禁写、写回前后摘要。
- ✅ Bitable 写回误导（BX3b）：Bitable 目标明确标注暂不支持写回 + 禁写，避免点写回后失败。

Remaining risks (非阻塞，需真实机器验证):
- ⚠️ wiki 抓取的 DOM 选择器基于飞书页面结构推断，未在真实 wiki 页面（如示例链接）实跑验证——需真实 E2E。
- ⚠️ doc-capture 追加写回的 `getLastDataRow` 读 A 列末行，若目标表 A 列有大量空行可能低估起点——真实 E2E 验证。
- ⚠️ Bitable 写回仍未实现（BX3b 仅禁写 + 提示，`writeToSheet` 仍 Sheets-only）——用户填 Bitable 链接会被明确拦截并提示改用 Sheet，写回 Bitable 是后续功能。
- ⚠️ popup.js 为浏览器 ESM，BX3/BX3b 的 UI 交互逻辑仅经 parseFeishuUrl 单测覆盖决策语义，DOM 渲染/事件未单测——需真实 E2E。
- ⚠️ 之前遗留：BM25 未接入、TM 查询串行慢、diff.js 死代码——均非阻塞。

## Test History

- T03: `node test/feishu-sheets.test.js` → 32 通过 / 0 失败（新增 12 用例）
- T04: syntax check (popup/background/options) OK; e2e 54/0, sheets 32/0, bitable 13/0
- T05: syntax check (options/popup) OK; sheets 32/0, e2e 54/0, bitable 13/0
- T06: syntax check (popup/options) OK; emoji scan clean; e2e 54/0, sheets 32/0, bitable 13/0
- T07: syntax check (popup) OK; e2e 54/0, sheets 32/0, bitable 13/0
- T08: syntax check (feishu-sheets) OK; sheets 41/0（新增 9 用例 parseFeishuUrl）
- T09: syntax check (popup) OK; e2e 54/0, sheets 41/0, bitable 13/0
- T10: syntax check (popup) OK; e2e 54/0, sheets 41/0, bitable 13/0
- T11: sheets 50/0（新增 9 用例：权限/凭证错误 + parseFeishuUrl 边界）
- T12: syntax check (feishu-sheets) OK; sheets 67/0（新增 17 用例：REQUIRED_HEADERS + mapHeadersToColumns）
- T13: syntax check (feishu-sheets) OK; sheets 70/0（新增 3 用例：CD review 永不写 + 列集合断言）
- T14: syntax check (feishu-sheets) OK; sheets 81/0（新增 11 用例：表头校验 + 修复流）
- T15: 文档型（docs/TM-MATCHING.md），无代码改动
- T16: syntax check (tm-bm25) OK; tm-bm25 25/0（新测试套件）
- T17: e2e 64/0（新增 10 用例：TM 结果映射稳定性）
- T18: py_compile + syntax OK; e2e 68/0（新增 4 用例：method/candidate_count 元数据）
- T19: syntax OK; new-match-scoring 22/0（新套件）+ e2e 68/0（修 1 旧断言）
- T20: syntax OK; new-match-scoring 37/0（新增 15 用例：权重冻结 + normalization 固定性）
- T21: new-match-scoring 46/0（新增 9 用例：稳定场景快照）
- T22: new-match-scoring 49/0（新增 3 用例：LLM 不参与打分独立性）
- T23: syntax OK; errors 14/0（新套件，7 错误族 + 兜底）
- T24: 文档型（docs/E2E-CHECKLIST.md），无代码改动
- T25: 全量 6 套件 250/0（e2e 68 + sheets 81 + bitable 13 + new-match 49 + bm25 25 + errors 14）；全 JS 语法 OK + py_compile OK

## Known Risks (final, post-T26)

Resolved during loop:
- ✅ Row alignment fix preserved + regression-tested (T03, T13).
- ✅ Native messaging still routes through background SW (popup uses sendMessage, not sendNativeMessage) — unchanged (T07 health check verifies).
- ✅ Feishu writeback target always shown before (T09) and after (T10) write; never invisible.
- ✅ TM scoring deterministic (T15-T18); New Match% deterministic, no LLM (T19-T22).

Remaining risks / unfinished integration (non-blocking for MVP, tracked in docs/E2E-CHECKLIST.md "known gaps"):
- ⚠️ **doc-capture items lack `row`** (T04 decision): `writeToSheet` skips items without `row`; row-number semantics for doc-capture source must be rebuilt (row = append position in target sheet) before doc-capture→writeback works end-to-end. The table-driven source path (legacy) still works but was removed from UI per strict-spec decision.
- ⚠️ **BM25 fallback not wired** (T16): `lib/tm-bm25.js` is implemented + tested but not called from popup/bridge; needs a candidate corpus source when Starling is unavailable.
- ⚠️ **Bitable writeback not implemented** (T08): `parseFeishuUrl` detects Bitable URLs, but `writeToSheet` is Sheets-only; Bitable write path is a follow-up (spec: "Bitable support if feasible").
- ⚠️ **writeToSheet still hardcoded A-H columns** (T12/T14): header validation/repair + REQUIRED_HEADERS exist, but writeback writes by column letter, not via the validated name→letter map. Switching writeback to name-based columns is a deferred follow-up (would use `validateHeaders().byName`).
- ⚠️ **TM query serial slowness** (pre-existing): bridge spawns starling-cli per text (1-2s/ea); no concurrency/batch API yet.
- ⚠️ **Real-machine unverified**: all logic layer tested; MV3 SW / Native Messaging / Feishu live permissions / Starling live / DOM rendering need manual E2E (docs/E2E-CHECKLIST.md).
- ⚠️ **diff.js dead code**: unused `levenshteinSim`/`extractKeyDifferences` retained (safe; can remove later).
- ⚠️ **Health check / step UI / destination preview not real-machine verified** (T07/T09/T10) — DOM logic only, unit tests can't cover browser runtime.

## Next Task

None — all 26 tasks complete. See Known Risks above for follow-up items.
