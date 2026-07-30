# L10n TM Companion — ROI 埋点与成本估算 Handoff

> 更新日期：2026-07-13。代码位置：`/Users/bytedance/my-project/l10n-tm-companion/`。
>
> 本文定义“AI 改写是否降低翻译成本”的数据口径、职责边界和后续实现顺序。它不授权修改 Starling 平台，也不把预估金额包装成实际结算金额。

---

## 2026-07-15 更新：85% 计费口径与待确认参数

本节是当前 ROI 计费口径，覆盖本文后续所有“75%”阈值表述。后续实现、报表标题、
字段名与验收都以本节为准；保留旧表述仅用于追溯 2026-07-15 前的设计背景。

### 2026-07-15 本地费率源与 vendor 选择冻结

本节记录业务方在取得 `local rate 费用表.xlsx` 与五月结算单样本后的最新决定，覆盖
本文后续“费率尚未提供”“由飞书 Pricing Rules 人工维护”以及从 TEP 派生 T-only
费率的旧建议。当前阶段先交付 vendor 选择、费率数据导入、严格解析与缺失费率错误；
实际金额只有在 Starling/Elasticsearch 提供真实字数和匹配分档后才允许计算。

1. 插件设置必须让用户从 `RWS`、`Pactera`、`Alconost`、`Skrivanek` 四个 vendor
   中选择一个。vendor 未选择时，ROI 费率解析与金额计算不可运行。
2. `local rate 费用表.xlsx` 是当前唯一费率来源。构建脚本将工作簿确定性转换为插件
   内置 JSON，并记录原文件名、SHA-256、sheet、原始行号、原始列名和转换版本。
3. 当前核验的源文件 SHA-256 为
   `99c95ce39300b86d755e99838cd7348512f56c5f7857827d0df8673072b478ef`；四个
   sheet 分别为 RWS 36 行、Pactera 24 行、Alconost 57 行、Skrivanek 57 行。
4. 费率只允许按 `vendor + source language + target language` 精确解析。禁止跨
   vendor 借价、语言回退、默认费率、从 TEP 乘比例派生 T-only 费率或用 0 填补缺失。
5. RWS 的字数计费字段映射为 `AI翻译+人工校准AIPE rate` 与
   `人工翻译 Human Translation rate`；Pactera 映射为 `AIPE rate` 与 `T rate`。
   原表数值按 USD/1000 words 保存，并在计算边界除以 1000 得到 USD/word。
6. Alconost 与 Skrivanek 当前只有 hourly rate。两个 vendor 仍可选择，但按字 ROI
   必须返回 `incomplete: missing_word_rate`，展示缺失原因并停止金额计算。
7. 真实 Starling TM score `<= 85` 进入 AIPE，使用 `实际字数 × AIPE rate`；
   score `> 85` 进入 T-only，使用 `加权字数 × T-only rate`。实际字数和加权字数
   只能采用 Starling/Elasticsearch 的真实输出，浏览器本地分词结果不得参与计费。
8. 金额计算全程保留精度，只在最终汇总金额执行向上取整到两位小数。任一真实 TM
   查询、字数输入或精确费率缺失时，记录标记为 `incomplete`，不得写成 0 或计入节省。

实现状态（2026-07-15）：第一阶段已完成。插件 Settings 已增加四选一 vendor，构建脚本
已从上述 SHA-256 的工作簿生成 `data/local-rates.json`，运行期 resolver 已覆盖 RWS、
Pactera 精确费率以及 Alconost、Skrivanek 的 `missing_word_rate`。金额计算仍保持关闭，
直到 Starling/Elasticsearch 的真实实际字数与加权字数输入契约完成并验证。

### Yuting 已确认的业务规则

1. 所有文案先进入 Starling TM 查询，且同一 source 在不同目标语言中的 TM match %
   需要分别计算。
2. 真实 TM match % 小于 85 时，预估成本为 `实际字数 × AIPE rate`。
3. 真实 TM match % 高于 85 时，预估成本为 `加权字数 × T only rate`。
4. 85% 门槛于本月初与主端对齐后调整，T only 对应的译员价格更低。
5. 译员侧不能提供插件改写前 source 的历史成本；插件必须保存改写前、改写后的
   Starling 实际快照，并自行计算两种场景的预估成本。

### 插件、Starling 与 vendor 的最终职责

| 责任方 | 必须提供或完成 | 不需要承担 |
| --- | --- | --- |
| Starling | 对每条文案、每个目标语言返回改写前与改写后的真实 TM score | 计算 vendor 金额、建设 ROI 前端或保存插件改写事件 |
| 插件 | 触发两次 Batch TM 查询、保存不可变运行快照、按 vendor 规则计算预估成本 | 把本地 New Match % 当作计费 score、声称预估金额等同实际结算 |
| 飞书管理员报表 | 保存运行明细、价格规则、按日期/项目/语言汇总 ROI | 新建独立后端或等待 Starling 开发后台 |
| Yuting / vendor | 提供可执行费率规则、规则生效日期和对账样本 | 反推插件改写前的历史 source 与 TM score |

第一版管理员端定义为现有飞书表，而不是新建服务端：`Run Detail` 追加保存每条
source × target language 的两次真实 score，`Pricing Rules` 维护费率，`ROI Summary`
汇总改写前后预估成本与预估节省。

### 必须向 Yuting / vendor 索取的参数

Yuting 已给出计算公式，但尚未提供将公式落成插件或飞书公式所需的参数。开始金额
计算实现前，必须获得以下书面规则或现成费率表：

1. `85.00%` 的归档规则：它属于 AIPE，还是属于 T only。
2. 各 source-target language pair 的 AIPE rate 与 T only rate，以及币种。
3. “实际字数”的精确定义：计数文本、计数语言、word/character 转换与空白处理。
4. “加权字数”的精确公式、语言权重与取整方式。
5. 是否按字段、内容类型、项目类型或交付类型使用不同费率。
6. 最低收费、最高封顶、附加费、税费和其他会影响账单的规则。
7. 每条规则的生效日期与版本号，历史 ROI 是否按运行日的规则版本回算。
8. 一份可脱敏的已结算账单明细，至少包含语言、计费单位、TM match 分档与金额，
   用于校验插件的预估结果。

### 当前实现前置条件与禁止事项

- 必须把当前 UI、表头、字段和判断中的 75% 门槛统一升级为 85%，并使用中性的
  内部字段名，例如 `reached_threshold`，避免再次硬编码业务门槛。
- 必须对改写后的 source 再次调用 Starling Batch TM API；当前本地 `New Match %`
  只能作为改写参考，不能用于 TM 达标统计或金额计算。
- 必须按“每条 source × 每个目标语言”保存两次真实 score，因为语言间结果不同。
- 缺失任一次 Starling 查询或缺失匹配费率时，记录应标记为 `incomplete`，不得填 0
  或计入节省金额。
- 不向 Starling 请求金额计算或 ROI 前端，不把 TM Export 混入 ROI 链路，也不在
  没有对账样本前把结果称为实际节省。

---

## 当前结论

Starling 应提供的是每条文案在某个时点的真实 TM 查询结果，不应承担 ROI 前端或金额计算。插件负责记录改写前后的查询快照与业务维度，vendor 提供计费规则，飞书 ROI 报表完成汇总和展示。

第一版不新建服务端“管理员后台”。现有飞书 Sheet 扩展为两类受控表：运行明细表保存不可变快照，价格配置表保存 vendor 规则；汇总页通过公式或插件生成月度 ROI 报表。

## 必须澄清的现状

| 指标 | 当前实现 | 能否作为 ROI 成本依据 |
| --- | --- | --- |
| Orig Match % | Starling TM Match 返回的真实 `score` | 可以，代表改写前快照 |
| New Match % | 本地确定性文本相似度，比较 Rewritten Segment 与首次命中的 TM Source | 不可以，不能称为改写后 Starling TM 命中率 |
| Reached 75%? | 当前按 Orig Match % 判断 | 可以作为改写前命中标记 |
| 金额 | 当前未保存、Starling 也不展示 | 不可以，必须由 vendor 计费规则计算 |

当前的 `New Match %` 仍可保留给 CD 判断改写文本是否接近 TM 原文，但 ROI 统计必须新增 `Post-rewrite Starling TM Score`：对改写后的文案再次调用 `/gateway/openapi/corpus/tm/match/batch`，以该次返回的真实 `score` 判断改写后是否达到 75%。

## 目标口径

### 效果指标

对每条完成查询的文案记录以下布尔值：

- `orig_reached_75 = orig_starling_score >= 75`
- `post_rewrite_reached_75 = post_starling_score >= 75`
- `improved_to_75 = !orig_reached_75 && post_rewrite_reached_75`

汇总时同时统计“条数”和“可计费单位数”。条数用于观察覆盖率，可计费单位数用于金额计算；不能用条数直接换算金额，因为不同文案长度、语言和内容类型的成本不同。

### 金额指标

按每条文案的 vendor 规则计算预估成本：

```text
baseline_estimated_cost = Σ billable_units × rate(language_pair, content_type, orig_match_band)
post_estimated_cost     = Σ billable_units × rate(language_pair, content_type, post_match_band)
estimated_saving        = baseline_estimated_cost - post_estimated_cost
```

`match_band` 不能自行假设为只有“≥75% / <75%”两档。它必须来自 vendor 的实际计费表，例如 0–49、50–74、75–84、85–94、95–99、100 等分档及对应折扣。

这项结果的正式名称是“预估节省金额”。只有将同一批数据与 vendor 的真实账单核对通过后，才可以对外说明该口径与结算金额的误差范围。

## 数据职责边界

| 责任方 | 提供内容 | 不承担的内容 |
| --- | --- | --- |
| Starling | 改写前、改写后各一次的真实 TM 分数、匹配来源、项目范围 | 不计算 vendor 金额，不建设 ROI 页面 |
| 插件 | 触发两次查询、生成运行 ID、记录快照、写入明细和汇总输入 | 不伪造 Starling 结果，不维护 vendor 商业规则 |
| Vendor | 计费单位、语言/内容类型/匹配分档单价、最低收费和规则生效日期 | 不负责插件数据采集 |
| Yuting / 业务方 | 确认统计范围、时间周期、是否需要预估或账单级精度 | 不要求 Starling 用未知规则算金额 |

## 建议的数据模型

每次插件运行生成一个 `run_id`，运行明细按“一条原文 × 一个目标语言 × 一个项目组合”写入。不要以重新查询的结果覆盖历史行。

| 字段 | 来源 | 用途 |
| --- | --- | --- |
| `run_id`、`queried_at`、`workflow_version` | 插件 | 固定统计批次和算法版本 |
| `project_ids`、`source_lang`、`target_lang` | 插件配置 | 解释查询范围和计费语言对 |
| `source_text`、`rewritten_text` | 插件输入与 AI 输出 | 审计与复核 |
| `billable_units`、`unit_type` | 插件按 vendor 规则计数 | 金额计算基础，例如 word 或 character |
| `orig_starling_score`、`orig_tm_source` | 第一次 Starling 查询 | 改写前真实快照 |
| `post_starling_score`、`post_tm_source` | 改写后第二次 Starling 查询 | 改写后真实快照 |
| `orig_reached_75`、`post_rewrite_reached_75` | 插件按固定阈值计算 | 覆盖率与提升统计 |
| `pricing_rule_version`、`estimated_cost_before`、`estimated_cost_after` | ROI 计算器 | 复现预估金额 |
| `run_status`、`failure_logid` | 插件 | 区分“无命中”和“查询失败” |

含文案原文的明细表应沿用现有飞书表格权限管理，不额外复制到公开的统计系统。

## 运行与失败语义

1. 第一次 Starling 查询失败时，整批标记为 `failed`，不能把分数记为 0 或当作“未达到 75%”。
2. 第二次 Starling 查询失败时，保留改写前快照，改写后状态标记为 `incomplete`，不纳入前后成本对比。
3. PPE 当前存在 `error_code=1204` 的偶发下游超时。重试耗尽后必须保存 LogID，并由 Starling 排查；插件不能用本地 New Match % 冒充第二次 Starling 结果。
4. TM 库会变化。ROI 报表只使用运行当时保存的分数和匹配源，不重算历史行。

## 第一版交付范围

### 插件新增

1. 对低于 75% 且生成了改写文案的记录，执行第二次真实 Starling Batch TM 查询。
2. 扩展飞书明细列，写入运行时间、项目范围、语言、计费单位、改写后真实分数、两次 75% 标记和运行状态。
3. 仅在两次 Starling 查询完整成功时产生可参与 ROI 的记录。

### 飞书 ROI 报表新增

1. `Pricing Rules` 表：由业务或 vendor 维护计费规则和生效日期。
2. `Run Detail` 表：插件追加式写入运行快照。
3. `ROI Summary` 表：按日期、项目、语言、字段类型汇总条数、可计费单位、改写前/后 ≥75% 数量、预估前后成本和预估节省金额。

### 不在第一版做

- 不请求 Starling 新建 ROI 前端或金额计算功能。
- 不承诺将预估金额作为 vendor 最终结算金额。
- 不自动补算历史运行，也不以当前 TM 库重算旧记录。
- 不新建独立后端服务；后续只有在多人维护价格规则、权限隔离或大规模报表性能确有需要时再评估。

## 外部确认清单

Yuting 向 vendor 确认以下规则后才能开始金额计算实现：

1. 计费单位是 word、character 还是其他单位，是否存在最小收费。
2. 价格是否按 source-target 语言对、字段/内容类型、交付类型区分。
3. TM 匹配分档与每档折扣或单价，75% 是否为真实价格分界线。
4. 规则是否随时间变更，历史报表应按哪一天的价格版本计算。
5. 是否能提供一份已结算样本账单，用于校验 ROI 公式。

Starling 只需确认以下技术条件：

1. `/corpus/tm/match/batch` 是否允许将改写文案再次作为 `sourceContents` 查询。
2. `sourceContents` 的正式上限、并发/速率限制和推荐重试策略。
3. PPE `error_code=1204` 的修复状态，或生产环境的正式路由与鉴权方式。

## 实施顺序与验收

1. 先拿到 vendor 书面计费规则和一份对账样本，冻结 `Pricing Rules` 数据结构。
2. 实现并验证第二次真实 Starling 查询，确认三条样本文案的改写前后分数均来自接口返回。
3. 为完整成功、第一次失败、第二次失败分别写自动化测试，确保失败从不计为 0 分或节省金额。
4. 写入一批受控样本到飞书明细表，人工检查字段、时间、项目、语言与两次分数。
5. 用 vendor 样本账单复算，记录预估金额与实际金额差异；误差不可接受时先修订计费规则，不修改历史快照。
6. 通过后再按月输出 ROI Summary，并在报表标题明确标注“预估”。

## 给下一位接手者的核心判断

不要把“本地 New Match % 提升”写成“Starling TM 命中率提升”或“节省了多少钱”。正确链路是：插件记录两次真实 Starling 快照 → vendor 规则将可计费单位映射为预估成本 → 飞书报表汇总 → 用真实账单校验。
