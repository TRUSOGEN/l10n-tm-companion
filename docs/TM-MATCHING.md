# TM Matching — 当前实现与方法说明（T15）

> 本文记录 L10n TM Companion 当前的 Translation Memory 匹配来源、方法、版本与局限。
> LOOP_SPEC §4.2 要求 TM match 必须确定性、可复现、不使用 LLM 打分。本文档化现状。

## Top-3 与逐候选真实 TM 快照（2026-07-27）

Batch 首轮显式发送 `limit=3`，每个 source 返回按原始顺序保留、以 source+target 去重的最多三个 TM 候选；非数值或非有限 score 正确失败。只有 `50 ≤ Orig Match % < 85` 的 source 创建 Inspire task，每个 task 最多解析三个结构化 AI 候选。结构有效候选再通过一次 Batch TM 请求查询真实 Post-TM，请求复用首轮的 source locale、target locale、projectIds、PPE 开关和 Native Messaging 协议。

`lib/starling-tm.js` 的 `queryRewriteCandidateTmSnapshots()` 将全部 source 的候选扁平化为一次 Batch 调用，再恢复为严格同序的逐 source / 逐候选快照。快照状态包括：

- `complete`：保存接口返回的真实 `score`、TM source、TM match、来源、方法和候选数；接口返回的 0 分仍是 `complete`，代表真实无命中。
- `not_required`：不满足 50–85 门禁、结构无效或没有候选，因此不发送第二次请求。
- `incomplete`：Native Messaging、HTTP、响应数量或 score 结构异常；保留首轮结果和错误原因，不产生伪造的 0 分。

候选只有在结构、protected token、URL、数字、`semantic_status=same_meaning`、空风险列表以及 `Post-TM > Orig TM` 全部通过时才进入 Focus 可选列表。Prompt 保留按场景选择的 Legal 证据。普通 Sheet 只在单条确认成功后保存当前六列，不写任何 ROI 金额。

Focus 以 `tm_candidates` 作为 Top-3 的权威数据。若检测到旧版 Native Host 只返回首条 `tm_source`、`tm_match` 与 `similarity`，界面保留这条真实命中并显示 `Native Host update required`，不得在已有正分时误报 `No TM match`。AI 没有有效候选时继续显示 `None`，并同步显示生成关闭、配置缺失、API 失败、结构错误或安全门禁原因；`None` 本身不代表未调用 Inspire。

Inspire Writer `/copies` 的真实契约是每个 `revision` 返回一条普通改写文本，而不是 JSON envelope。Prompt 首尾固定 Writer revision 协议，要求一条同语言改写或明确的 `[[SKIP:INSUFFICIENT_REWRITE_SPACE]]`；一个 task 最多读取三个 revision，客户端将每条包装为结构化候选，再执行 protected token、URL、数字与真实 Post-TM 门禁。旧版 JSON envelope 继续兼容，疑似损坏的 JSON 仍正确失败。规则证据总预算不超过 5,200 字符，完整 prompt 硬上限为 12,000 字符。普通 CD 路径既不展示 target locale，也不展示 TM target translation；Starling 仍要求 locale 参数，因此程序确定性采用所选项目共同 locale 排序后的第一项，全部相同项目选择会得到相同查询 scope。

## Sheet 的 A/B/C 审阅与 ROI 边界（2026-07-20）

普通 Sheet 的来源列、数据起始行和输出起始列按 Sheet 独立配置。输出区依次保存 Best TM Match、Score A、最终 C、所选 AI 候选的 Post-TM、Final TM 阈值状态和 Final TM。CD 在 Focus 编辑 C 并点击 Confirm 后，插件依次完成本地校验、Final TM、当前行六列写入，再将状态标为 confirmed。正式 ROI 是 `TM cost(A) - TM cost(C)`；B 只用于审阅。

Popup 结果卡片严格按 Sheet 原始行号显示，异步 TM 与 Inspire 完成顺序不得改变审阅顺序。普通卡片只提供 Focus 入口；Focus 展示 Top-3 TM、有效 AI 候选、分数差、最终 C、Final TM 与状态。

本地预估采用已确认的收费表：`0–75`（含 75）为本地词数 × AIPE rate；`(75,85]`、`(85,95]`、`(95,99]` 分别为本地词数 × 60%、40%、20% × T-only rate；100% 依照返回分类或 `exact_unclassified_conservative` 处理。逐条公式输入保留完整精度。

当前 `starling-agent-cli v1.1.24` 的公开 API Registry 尚未提供 Elasticsearch 的实际字数、加权字数或 100% 命中分类。插件因此使用 `Intl.Segmenter('en')` 对 source 文本本地计词；100% 缺少分类、最终 C TM 快照失败、C 未确认或费率缺失时，ROI Status 必须为 `incomplete:<reason>`，ROI_Test 只显示已覆盖语言小计。

旧 Sheet 的第六列表头为 `CD review valid?` 时，插件只在该列全部数据为空时将它迁移为 `Final TM %`；存在任意人工值时停止并提示备份或清理，禁止覆盖历史确认状态。第四列旧名 `New Match %` 同步改为 `Post-TM %`。

## 当前批量实现（2026-07-13）

本文以下旧章节保留了单条 CLI 路径的历史设计；与本节冲突时，以本节为准。

主流程默认使用 `batch_ppe` 模式，调用链为：

```text
popup.js searchTM(tm_mode='batch')
  → background.js Native Messaging
  → starling-bridge.py search_tm_batch()
  → 默认每 10 条构造 POST /corpus/tm/match/batch，最多 5 个批次并发
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
- **批次上限与调度**：2026-08-03 PPE 直接验证 `sourceContents` 默认上限为 10，`projectIds` 上限仍为 10；Bridge 默认每批发送 10 条文案，并按输入顺序以最多 5 个批次并发查询。1.5 客户端支持 `L10N_STARLING_TM_SOURCE_LIMIT` 取 1–40，只有 RD 批准并用真实 40 条 payload 验证响应顺序、候选完整性与 P95 后才能设置为 40；无效值或请求超过已配置上限会正确失败。结果按原批次顺序合并，任一批失败会使本次查询真实失败。
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
- **version**: `starling-cli v1.1.24`（bridge 调用的 CLI 版本）
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
{ "method": "starling", "method_version": "starling-cli-1.1.24", "candidate_count": <N> }
```
供日志与可解释性使用。
