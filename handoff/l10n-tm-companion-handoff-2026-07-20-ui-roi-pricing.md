# L10n TM Companion 交接：UI 范围已外包，当前 ROI 计费口径错误待修正

**更新时间**：2026-07-20。  
**代码目录**：`/Users/bytedance/my-project/l10n-tm-companion/`。  
**当前状态**：本轮未修改项目代码、配置、飞书数据或 Git 状态；用户只需要一份交给公司 AI 的 UI/ROI 看板视觉化需求，并确认了当前 ROI 计算口径不符合业务定义。

## 已确认的业务决策

- 只保留一个插件，默认是 CD 快速工作流：首次 Starling TM（A）→ Inspire Writer 改写英文 Source → 改写后 Starling TM（B）→ CD 审核与写回。
- CD 不需要额外展示“B 是否大于 A”的结论；用户从 Orig Match % 与 New Match % 直接判断。
- ROI 是老板按需进入的能力，不得成为普通 CD 运行的默认成本或性能负担。
- ROI 表示同一整车在所有相关 target locale 上的翻译成本差异，按项目 × target locale 并集汇总；缺少任一 scope 时整体状态为 `incomplete`，只能展示已覆盖小计。
- 飞书 ROI_Test 是 ROI 数据、看板和权限的唯一入口。业务 Owner 使用飞书 Bitable 原生所有者、可管理、可编辑、可阅读权限处理查看者、负责人转交和管理员变更；不开发独立 RBAC/管理员后台。
- 用户 Starling AK/SK 永不上传云端；Inspire Writer key 仅保存在云端密钥管理中。此前用户曾在对话中暴露一个 personal API key，必须撤销并轮换，且不得写入任何代码、handoff、压缩包或日志。

## 交给公司 AI 的 UI 需求

已在当前会话提供了可直接转交的“仅 UI 与 ROI 看板视觉化重构需求”。关键范围如下：

- 仅改 UI/UX 和飞书看板视图；禁止改变 Starling TM、AI 改写、ROI 公式、Sheet 写回、Bitable 归档、Native Host、OAuth/API 协议和现有业务测试。
- 用 Chrome Side Panel 替代当前受高度限制的 action popup，解决结果卡片无法完整展开、失焦关闭和配置/结果混杂问题。
- 一级页面只保留 CD 工作台、结果与审核、设置；ROI 只能是结果页的按需次级入口。
- CD 默认首页不得显示 ROI coverage languages、费率、成本、Bitable URL 或归档配置。
- ROI_Test 需要管理层总览、Run 历史、语言贡献、覆盖异常、Source 审核等飞书原生视图/仪表盘。
- 公司 AI 接收的项目 ZIP 必须先脱敏，不得包含 `keys/`、`.env`、AK/SK、API key、OAuth token、调试日志或 `temp/` 输出。仓库历史存在硬编码敏感信息风险，不可把当前未审计 ZIP 直接交出。

## 当前 ROI 计费规则与已确认错误

业务期望是：`AI ROI = TM 成本(A) - TM 成本(B)`，也就是改写前英语文案按 A 分数的 TM 成本，减去改写后英语文案按 B 分数的 TM 成本。

当前实现不符合上述业务定义：

- `lib/roi-calculation.js` 的 `calculateRoiForItem()` 在第 163 行调用 `resolveFullTranslationBaseline()`；改写前金额固定为原英文词数 × AIPE 单价，**完全没有按 A 的 TM score 计费**。
- 改写后金额按 B 的 TM score 计费；最终 `estimatedSaving = full-translation baseline - B cost`。
- 因此 A=B 时当前实现仍会报正向“节省”；例如 10 词、AIPE USD 0.04/词、T-only USD 0.02/词、A=B=97%，当前会报 USD 0.36，正确的 AI 增量 ROI 应为 USD 0。
- A=97%、B=80% 时，当前实现仍可能显示正向节省，但正确口径应显示成本增加，即负 ROI。

当前 TM 分数折扣表位于 `lib/roi-calculation.js:55-80`：

- 0–75（含 75）：100% AIPE 单价。
- (75, 85]：60% 加权词数 × T-only 单价。
- (85, 95]：40% 加权词数 × T-only 单价。
- (95, 100)：20% 加权词数 × T-only 单价。
- 100%：ICE 与 exact_no_review 为 0%，exact_review 为 10%，repetition 为 20%；Starling Batch TM 缺少 100% 分类时保守按 20%。

当前 `wordCount` 使用 JavaScript `Intl.Segmenter('en')` 的 `isWordLike` 英文词数，不是 Excel/Feishu 的 `LEN()` 字符数。对正常空格分隔英语，表格近似公式可用：

```excel
=IF(TRIM(A4)="",0,LEN(TRIM(A4))-LEN(SUBSTITUTE(TRIM(A4)," ",""))+1)
```

该表格公式仅用于人工抽查，不能替代插件正式金额口径，因为标点、连字符、换行与特殊空白可能不同。

费率规则：

- 费率来自插件内 `data/local-rates.json`，按 vendor + source locale + target locale 精确匹配，不跨语言或 vendor 回退。
- RWS 有 35 个完整按词语言对，Pactera 有 23 个完整按词语言对。
- Alconost 与 Skrivanek 当前只有 hourly rate，缺少 AIPE/T-only 按词费率；结果必须是 `missing_word_rate`，不可将 hourly rate 擅自换算成 ROI 金额。

## 正确的后续改动方向

在用户明确要求修复后，先写回归测试，再将单条金额拆成三个清晰字段：

- `fullTranslationBaselineCost`：原文词数 × AIPE 单价，仅作“完全不用 TM”的参考指标。
- `tmCostBeforeOptimization`：原文词数 × A 分数对应的 TM 计费规则。
- `tmCostAfterOptimization`：改写后词数 × B 分数对应的 TM 计费规则。
- `aiOptimizationSaving = tmCostBeforeOptimization - tmCostAfterOptimization`：唯一用于 AI ROI 的数值。

ROI 看板与 Bitable 字段应相应重命名，避免把全量翻译基线写成“改写前 TM 成本”。保留全量翻译基线时必须明显标为参考值。

## 不要擅自改动的部分

- 现有 ROI_Test 表、视图、已有记录。
- A-G Sheet schema，尤其是 G 列 CD 人工审核内容。
- 已验证的 Batch TM only 默认路径；不要重新引入默认 Key lookup 或 `/project/search`。
- 旧 handoff 指出的 `buildRewritePrompt()` 的 `tm_source` 语义问题，除非用户明确要求在本次修复中一并处理。
- 未审计的 Git 边界；插件目录在父仓库 untracked，且有敏感历史风险，禁止整目录 `git add`、提交或推送。

## 参考文件

- 最新 ROI Bitable 归档状态：`handoff/l10n-tm-companion-handoff-2026-07-17-roi-archive.md`。
- 旧业务/LLM 背景：`handoff/l10n-tm-companion-handoff-2026-07-17.md`。
- ROI 实现：`lib/roi-calculation.js`、`lib/multilingual-roi.js`、`lib/pricing-rules.js`、`popup.js`。
- ROI 回归测试：`test/roi-calculation.test.js`、`test/multilingual-roi.test.js`。
- 归档验证：`temp/test_roi_bitable_archive/verification.md`。

## Suggested skills

- `brainstorming`：在实施 ROI 口径修复或进一步扩展 UI 范围前，先确认老板要看“AI 增量节省”还是“TM 相对全量翻译总节省”，两者应作为独立指标。
- `test-driven-development`：先写 A=B 为零、B<A 为负数、跨语言完整/不完整汇总的回归测试，再改 ROI 函数与 Bitable 字段。
- `frontend-design`：收到公司 AI 的 UI 改动后，核对 Side Panel 信息层级、可读性与不改变流程的边界。
- `systematic-debugging`：处理 Starling TM、Feishu OAuth/Bitable 或费率不完整错误。
- `verification-before-completion`：任何实现完成后，检查真实输出、Bitable 写入和敏感信息，而不是只看测试命令是否退出成功。
