# TM Matching — 当前实现与方法说明（T15）

> 本文记录 L10n TM Companion 当前的 Translation Memory 匹配来源、方法、版本与局限。
> LOOP_SPEC §4.2 要求 TM match 必须确定性、可复现、不使用 LLM 打分。本文档化现状。

## 改写后二次真实 TM 快照（2026-07-16）

ROI 链路现在会对 `Orig Match % < 85` 且实际生成了非空 AI rewrite 的条目，再调用一次
`/corpus/tm/match/batch`。这次请求复用首轮的 source locale、target locale、projectIds、
PPE 开关和 Native Messaging 协议；请求正文中的 `sourceContents` 是改写后的 source text。

`lib/starling-tm.js` 的 `queryPostRewriteTmSnapshots()` 返回数组与本轮输入严格同序，且状态只有：

- `complete`：保存接口返回的真实 `score`、TM source、TM match、来源、方法和候选数；接口返回的 0 分仍是 `complete`，代表真实无命中。
- `not_required`：首轮已达到 85%，或本轮没有生成非空 rewrite，因此不发送第二次请求。
- `incomplete`：Native Messaging、HTTP、响应数量或 score 结构异常；保留首轮结果和错误原因，不产生伪造的 0 分。

该快照保存在 Popup 的本次运行条目中，用于卡片审计展示。普通 Sheet 只保留当前布局的六列 TM/CD 输出区，不写任何 ROI 金额；整车 A−C 金额只写入 ROI_Test 的 `L10n ROI Runs`。

## Sheet 的 A/B/C 审阅与 ROI 边界（2026-07-20）

普通 Sheet 的来源列、数据起始行和输出起始列按 Sheet 独立配置。输出区依次保存 Best TM Match、Score A、AI 候选 B、Score B、阈值状态和人工 review；CD 编辑候选并将 review 设为 Yes 后才形成最终 C。插件随后独立查询 C 的第三次真实 TM，正式 ROI 是 `TM cost(A) - TM cost(C)`。B 只用于审阅，不能作为正式 ROI。

Popup 结果卡片按当前可用的真实 TM Score 升序显示：CD 已确认且第三次查询完成时使用 Score C，其次使用候选 B 的 Score B，其他情况使用原文 Score A。没有可用 TM Score 的查询失败或未确认条目排在最后；同分时按 Sheet 原始行号排序。

本地预估采用已确认的收费表：`0–75`（含 75）为本地词数 × AIPE rate；`(75,85]`、`(85,95]`、`(95,99]` 分别为本地词数 × 60%、40%、20% × T-only rate；100% 依照返回分类或 `exact_unclassified_conservative` 处理。逐条公式输入保留完整精度。

当前 `starling-agent-cli v1.1.24` 的公开 API Registry 尚未提供 Elasticsearch 的实际字数、加权字数或 100% 命中分类。插件因此使用 `Intl.Segmenter('en')` 对 source 文本本地计词；100% 缺少分类、最终 C TM 快照失败、C 未确认或费率缺失时，ROI Status 必须为 `incomplete:<reason>`，ROI_Test 只显示已覆盖语言小计。

CD review 下拉通过飞书 Sheets `POST /sheets/v2/spreadsheets/{spreadsheetToken}/dataValidation` 创建，请求体使用单数动态范围 `"{sheetId}!{reviewColumn}{dataStartRow}:{reviewColumn}{本次最大输出行}"`，选项固定为 `Yes` 与 `No`，并设置 `multipleValues=false` 与 `highlightValidData=false`。插件未传选项颜色时，飞书要求颜色与每个选项一一对应才能开启高亮；范围只覆盖本次实际输出行，避免超出 grid。集合路径不能使用 `PUT`；后者仅用于携带 `sheetId` 与 `dataValidationId` 的既有规则更新。

## 当前批量实现（2026-07-13）

本文以下旧章节保留了单条 CLI 路径的历史设计；与本节冲突时，以本节为准。

主流程默认使用 `batch_ppe` 模式，调用链为：

```text
popup.js searchTM(tm_mode='batch')
  → background.js Native Messaging
  → starling-bridge.py search_tm_batch()
  → 每 10 条构造 POST /corpus/tm/match/batch
  → starling-batch-client.js
  → @byted/starling-agent-core 的 ESM StarlingClient 签名并发送请求
  → PPE 返回 data[i] 的候选数组
```

- **请求体**：`projectIds`、`sourceContents`、`sourceLang`、`targetLang`、`limit`、`leastScore`；`projectIds` 严格限制最多 10 个。
- **环境 Header**：默认带 `x-use-ppe: 1` 和 `x-tt-env: ppe_openapi_integ`，不在浏览器或代码中保存 AK/SK；官方 Core 从本机 CLI 配置读取凭证并生成 `agw-auth`。
- **响应映射**：`data[i]` 与第 `i` 条输入一一对应，候选数组的首项写入 `tm_match`、`tm_source`、`similarity`，同时保存 `candidate_count`；空数组被记录为真实的 `No TM match`。
- **已验证行为**：PPE 实测单次 10 条 `sourceContents` 成功返回 10 组候选；`Done`、`Settings`、`Cancel` 分别返回 `完成`、`隐私设置`、`取消`。
- **失败语义**：HTTP、签名、返回结构等异常直接抛至 Popup 并停止本轮流程，禁止自动用同批文本的 BM25 结果冒充 Starling TM 命中。
- **PPE 短暂超时**：当后端返回 `error_code=1204` 且文本包含 `remote or network error` 时，Bridge 会以 0.25 秒、0.5 秒间隔重试，最多共 3 次；其他 400 请求错误仍立即返回，避免掩盖参数或权限问题。
- **批次上限**：李明东于 2026-07-13 确认 `sourceContents`、`projectIds` 各最多 10 条；Bridge 每批最多发送 10 条文案。项目数越多，服务端搜索负载和耗时越高。
- **兼容模式**：Options 可显式选择 `legacy_cli`，仅用于排障；它沿用原 `GET /corpus/tm/match` 单条查询。

## Source String Key（2026-07-15 更新）

`/corpus/tm/match/batch` 的真实 PPE 响应字段包含 `id`、`tmId` 与 `keywords`，但不包含 `key` 或 `keyText`。`tmId` 是 TM 条目 ID，`keywords` 是匹配原文的分词列表，两者都不能冒充 Source String Key；当前六列动态输出 schema 已移除 Key 与 Project 列。

默认主流程不查询 Source String Key。当前业务只需要 Batch TM Match 返回的匹配分数和 TM 结果，Key 与项目归属不参与本轮处理或写回判定。

`/project/search` 没有与 `sourceContents` 对应的批量输入，查询 Key 最坏会产生 `文本数 × 项目数` 个请求。该阶段是此前主流程卡顿的主要来源，因此仅保留实现供未来独立、按需的查询功能使用，不能恢复为自动全量查询。

## 1. 来源

TM 匹配**完全依赖 Starling CLI**，无本地 fallback。

调用链：
```
popup.js searchTM()
  → chrome.runtime.sendMessage({action:'native_search_tm', payload})
  → background.js Service Worker
  → chrome.runtime.sendNativeMessage('com.l10n.tm_companion', payload)
  → native-host/starling-bridge.py  (action='search_tm')
  → starling-cli api GET /corpus/tm/match
  → Starling TM 服务
```

底层 CLI 命令（`starling-bridge.py` `build_search_cmd`）：
```
starling-cli api GET /corpus/tm/match \
  --params '{"projectId":385,"sourceLocale":"en","targetLocale":"zh","sourceText":"<原文>","leastScore":0,"limit":1}'
```

## 2. 方法与版本

- **method**: `starling`
- **version**: `starling-cli v1.1.16`（bridge 调用的 CLI 版本）
- **project**: 385（TikTok_Client），源语言 `en` → 目标 `zh`
- **返回结构**（每条文案）：
  ```json
  {
    "tm_match":   "<TM 译文 target>",
    "tm_source":  "<TM 库里匹配到的原文 source>",
    "similarity": 82,        // Orig Match %，starling 返回的 score，0-100
    "origin":     "<updater 来源>"
  }
  ```
- 相似度由 Starling TM 服务端计算，返回的 `score` 已是 0-100 百分制（代码不再 ×100）。

## 3. 确定性

- **可复现**：相同 sourceText + 相同 project/locale → Starling 返回相同结果（TM 库内容不变时）。
- **无 LLM 参与**：TM match score 完全由 Starling 决定，AI 仅用于改写英文原文（不参与打分）。

## 4. 已知局限（待 T16 解决）

1. **无 fallback**：若 Starling CLI 不可用（未装 / AK/SK 失效 / 网络断），TM 查询静默失败，每条返回空，被当成 "No TM match"。无本地 BM25 兜底。
2. **串行慢**：bridge 逐条起 starling-cli 子进程（1-2s/条），条目多时慢（handoff 已记，未修）。
3. **方法单一**：只有 `starling` 一种 method，无 `local_bm25_v1` 备选。
4. **New Match% 与 Orig Match% 不同度量**：Orig 是 Starling 真实命中率，New 是本地文本相似度（diff.js textSimilarity），两套度量，T19/T20 会统一 New Match% 算法。

## 5. T16 计划（BM25 fallback）

按 LOOP_SPEC §4.2，实现固定的 ES-like/BM25 本地兜底：
- 当 Starling 返回空或不可用时，启用 `local_bm25_v1`：
  1. 文本 normalization
  2. BM25 / ES-like candidate retrieval
  3. deterministic re-rank
  4. 输出 best_tm_match / tm_source / orig_match_percent / method=local_bm25_v1 / candidate_count
- 加单测保证相同输入稳定结果。
- 可选实现：浏览器端 MiniSearch/Lunr，或 bridge Python 侧 BM25（不引入后端）。

## 6. method/version 元数据落点（T18）

每条 TM 结果当前不含 `method` 字段。T18 计划在 bridge 返回结构里加：
```json
{ "method": "starling", "method_version": "starling-cli-1.1.16", "candidate_count": <N> }
```
供日志与可解释性使用。
