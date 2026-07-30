# L10n TM Companion 交接：整车 TM 节省与公司 LLM 接入准备

**更新时间**：2026-07-17。  
**代码目录**：`/Users/bytedance/my-project/l10n-tm-companion/`。  
**当前 Git 边界**：该插件目录在 `/Users/bytedance/my-project` 根仓库中仍是 untracked；历史源码含敏感信息风险，禁止直接 `git add l10n-tm-companion/`、提交或推送整目录。

## 本轮已落地

### 多语言整车 ROI

- ROI 按 `project × target locale` scope 运行，项目下 target locale 默认全选，支持全选和取消全部。
- 每个 scope 独立查询 Starling TM 与精确 vendor 费率；汇总只累计完整 scope，并明确展示覆盖范围和失败原因。
- 查询仍按 scope 串行执行，因此 `Querying ... (n/total)` 表示当前项目和语言，不是单次批量覆盖全部语言。

### 费用表与 Arabic

- 用户提供的 `/Users/bytedance/Downloads/local rate 费用表.xlsx` 与 `data/local-rates.json` 的 SHA-256 一致：`99c95ce39300b86d755e99838cd7348512f56c5f7857827d0df8673072b478ef`。
- `en→ar` 的按字费率只在 Pactera 中可用：AIPE `56.71 USD/1000 words`、T-only `80.25 USD/1000 words`。
- RWS 没有该精确语言对；Alconost 和 Skrivanek 只有 hourly rate，不能用于按字 ROI。

### ROI 业务口径已改正

- 用户要的指标是“整车完整翻译成本减去当前 TM 预估成本”，不是单纯 AI rewrite 前后成本。
- `lib/roi-calculation.js` 现在以 `完整英文词数 × AIPE 单价` 作为完整翻译基线，再以真实 Starling TM score 计算 TM 预估成本；关闭 LLM 仍能得到当前 TM 带来的节省。
- Starling Batch TM 不返回 100% 命中的 ICE / repetition / review 计费分类。用户确认按保守规则处理：未分类的 100% 统一按 `T-only × 20%`，运行结果标为 `exact_unclassified_conservative`，不再 `incomplete`。
- Pactera `en→ar` 的 10 个英文词、100% TM 验证结果：完整翻译 `0.5671 USD`、TM 预估 `0.1605 USD`、节省 `0.4066 USD`。
- Popup 的汇总与逐语言详情已使用 `Full translation`、`TM estimated`、`Saving` 文案。

### TM source / target 展示已修正

- Starling 返回 `tm_source`（英文 TM 原文）与 `tm_match`（目标语言译文）。
- Popup 卡片和聚焦页将 `tm_source` 显示为 `Best TM source match (English)`；`tm_match` 作为独立的 `TM target translation` 显示。
- 飞书 Sheet B 列仍名为 `Best TM Match`，但现在写 `tm_source`，若旧/异常结果缺 `tm_source` 才回退写 `tm_match`。
- `Use TM` 最终复用路径保持使用 `tm_match`，因此不会把英文 source 当成 Arabic 翻译写回。

## 已验证

本轮运行并检查过：

```bash
for file in test/*.test.js; do node "$file"; done
python3 -m unittest test.test_export_local_rates -v
node --check popup.js
python3 -m py_compile native-host/starling-bridge.py
git diff --check
```

全部 JavaScript 测试、Python 费用表导出测试、语法检查和 diff 检查通过。最新可查输出位于：

- `temp/test_tm_savings_roi/verification.txt`
- `temp/test_tm_source_display/verification.txt`

## 公司 LLM / Inspire 接入：已确认的方向

用户目标是让模型把英文 source 改写得更贴近英文 TM source，在不改变含义的前提下提升真实 Starling TM score。

建议先做“受约束的推理 + Starling 验证闭环”，不要直接训练：

1. 输入：当前英文 source、Top-K 英文 TM source、术语表、页面/功能上下文、占位符与格式约束。
2. 输出：结构化英文 rewrite 或 `no_change`。
3. 门禁：占位符/ICU/URL 不变、术语合规、语义等价、二次 Starling TM score 不降低。
4. 只把人工确认且实际 score 提升的记录沉淀为 SFT/LoRA 训练正样本；必须保留语义损坏和无需改写的负样本。

需要向 LIVE 和主端索取的数据：string ID、英文 source、项目/页面/功能上下文、文案类型、版本、长度限制、产品术语、禁用同义词、占位符/格式规则、敏感等级。Localization / Starling 侧还需提供英文 TM source、tmId、项目、目标语言、时间、真实 score，以及人工审核结论与原因。

需要向公司 AI 平台确认：数据留存与是否用于训练、项目级权限隔离、固定模型版本、JSON Schema、批量与并发配额、超时与 Trace ID、模型回滚、SFT/LoRA/RAG、离线评测、成本、地域与数据删除能力。

## 下一位接手者的第一优先级

`lib/ai-translate.js` 的 `buildRewritePrompt()` 目前仍将 `item.tm_match` 写进 `Closest TM source match`。这是历史错误：`tm_match` 是目标语言译文，英文 rewrite 模型应输入 `item.tm_source`。在接公司 LLM 前必须先修复，并新增回归测试确认 Arabic target 不会进入 source rewrite prompt。

同时检查 `docs/TM-MATCHING.md` 的旧表述；它仍把未分类 100% 写成 `incomplete`，与当前实现不一致，应在下一次正式文档更新中做增量修正。

## 建议接手顺序

1. 先确认公司 AI 平台名称、调用协议、数据安全策略与第一阶段是否只做推理。
2. 用 `brainstorming` 明确 rewrite 成功定义、风险容忍度、人工审核入口和数据 owner。
3. 先修 `buildRewritePrompt()` 的 `tm_source` 传递并用 `test-driven-development` 增加失败用例。
4. 用户批准设计后，用 `writing-plans` 形成公司 LLM adapter、审计记录、评测与灰度的实现计划。
5. 不要把历史全量 TM 或目标语言译文无差别复制到新训练库；优先使用受权限控制的检索快照和已审核反馈集。

## 建议技能

- `brainstorming`：冻结产品目标、数据边界和 AI 平台选型。
- `writing-plans`：用户批准设计后拆分实现任务。
- `test-driven-development`：先为英文 `tm_source` prompt 与语义/占位符门禁写失败测试。
- `systematic-debugging`：接入公司平台时排查协议、鉴权、超时与返回结构。
- `starling-shared`：需要查询 Starling 平台能力、TM 数据权限或内部流程时使用。
