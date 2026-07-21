# L10n TM Companion Loop Tasks

## P-BLOCKER — Post-MVP 真实阻塞问题（最高优先级，排在所有历史任务之前）

来源：真实使用反馈推翻了之前 T01-T26 的 COMPLETE 结论。这三个问题优先级高于一切历史「已完成」结论，必须先修。一次只处理一个，从 BX1 开始。

- [x] BX1 Fix wiki/doc extraction reliability — 部分 wiki/doc 页面无法抓取内容（示例 https://bytedance.larkoffice.com/wiki/QmG4w6EVIitUAlkT259clYFCndf ），弹窗提示「未抓取到文案，请确认页面内容或选中文字。」需修复 `content.js` 抓取逻辑并补测试。
- [x] BX2 Fix Feishu Sheets writeback payload — 写回失败 `Sheets write error: valueRanges is nil, wrong request body`。需修复 request body / payload 构造并补测试。
- [x] BX3 Clarify and require output destination in UI — 明确要求填写输出目标；加小字推荐空目标表格；写清支持的目标类型；未填目标禁止写回；写回前后展示目标名称/类型/链接摘要。
- [x] BX3b Bitable 写回不支持防护 — Bitable 目标 writeToSheet 不支持，需明确标注「暂不支持写回」并禁写，避免用户点写回后失败（BX3 自审补强）。

推进规则：BX1-BX3 修完前不输出 `<promise>COMPLETE</promise>`。

---

## P0 — Spec and Safety (历史 T01-T03，结论已失效，仅作记录)

- [x] T01 Read existing handoff files and summarize current architecture into LOOP_PROGRESS.md
- [x] T02 Audit current UI actions and list which buttons/options should be removed, hidden, or moved to advanced settings
- [x] T03 Add or verify regression tests for row alignment and current writeback behavior

## P1 — Product Simplification

- [x] T04 Keep only two primary source actions in popup: Capture full text and Capture selected text
- [x] T05 Remove or hide language selectors from the main UI
- [x] T06 Replace emoji-heavy UI with professional labels and a step-based layout
- [x] T07 Add automatic setup health check on popup open

## P2 — Link Detection and Output Destination

- [x] T08 Implement or refactor Feishu URL parser to detect Sheet vs Bitable
- [x] T09 Add output destination preview before writeback
- [x] T10 Show final writeback destination after successful writeback
- [x] T11 Add tests for Sheet URL, Bitable URL, invalid URL, and missing permission cases

## P3 — Required Output Format

- [x] T12 Enforce exact output headers: Row, Original Source Segment, Best TM Match, Orig Match %, Rewritten Segment, New Match %, Reached 75%?, CD review valid?, Comment
- [x] T13 Ensure CD review valid? is left blank by default
- [x] T14 Add header validation and, if appropriate, header creation or repair flow

## P4 — TM Reliability

- [x] T15 Document current TM matching source, method, and limitations
- [x] T16 Implement deterministic ES-like/BM25 fallback if Starling API is unavailable or unreachable
- [x] T17 Add stable scoring tests for TM match results
- [x] T18 Add method/version metadata to TM match output or logs

## P5 — AI Match Rate / New Match %

- [x] T19 Refactor New Match % into a deterministic scoring module
- [x] T20 Implement fixed normalization and fixed scoring weights
- [x] T21 Add unit tests for stable New Match % cases
- [x] T22 Ensure LLM is only used for rewriting, not scoring

## P6 — UX Polish and Final Validation

- [x] T23 Add clearer error messages for native host, Feishu permission, invalid link, and TM unavailable
- [x] T24 Add manual E2E checklist
- [x] T25 Run all tests
- [x] T26 Update LOOP_PROGRESS.md with final status and remaining known risks
