# L10n TM Companion 输出 schema 与 ROI locale Handoff

## 当前状态

2026-07-15 已完成 Popup locale 语义和普通飞书 Sheet 输出收敛。`en→en` 是有效 TM 查询配置；local rate 缺少该语言对时 TM optimization 继续运行，只有 ROI amount 标记为不可用。

普通 Sheet 标准 schema 已从 A-J 收敛为 A-G。插件读取 A、写入 B-F；G 为 CD 人工 review，插件在 G2:G5000 设置 `Yes/No` 单选下拉并保持新记录空白。`Comment`、`Source String Key`、`Project` 已退出标准 schema，旧 H-J 历史数据不删除、不覆盖。

当前仍没有本次运行金额。插件只展示 AIPE/T-only unit rate；真实 ROI amount 必须等待第二次 Starling TM 查询以及 Elasticsearch 实际字数、加权字数输入。

## 已确认业务语义

1. AI rewrite 发生在 source 侧，当前业务是 English-to-English rewrite。
2. Popup 的 `Translation target / ROI locale` 决定 Batch TM `targetLang` 和 vendor rate，不表示 AI rewrite 语言方向。
3. 允许 source 与 target 都为 `en`。若所选 vendor 没有 `en→en` 费率，TM 查询继续，ROI 返回 incomplete。
4. 费率缺失不得产生默认价格、零金额、跨 vendor 借价或语言回退。
5. `CD review valid?` 只允许 `Yes`、`No`，空白表示未 review，`No` 表示已 review 且判定无效。

## 实现位置

| 目标 | 文件 | 当前行为 |
| --- | --- | --- |
| Locale 配置 | `lib/run-config.js` | `en→en` 与其他共同 target 一样有效，不做同语言过滤 |
| Popup 字段 | `popup.html` | 标签为 `Translation target / ROI locale`，说明 AI rewrite 保持英文 |
| 费率提示 | `popup.js` | 缺精确费率时显示 TM 可运行、ROI amount 不可用 |
| Sheet schema | `lib/feishu-sheets.js` | `REQUIRED_HEADERS` 为 A-G 七列；数据只写 B-F |
| CD review 下拉 | `lib/feishu-sheets.js` | 写回前调用 `PUT /sheets/v2/spreadsheets/{token}/dataValidation` 幂等设置 G2:G5000 |
| UI 回归 | `test/popup-run-config.test.js`、`test/popup-fast-path.test.js` | 锁定 locale 说明和 B-F 帮助文案 |
| Sheet 回归 | `test/feishu-sheets.test.js` | 锁定七列表头、B-F 写入、Yes/No 请求和失败语义 |

## Sheet 数据契约

| 列 | 字段 | 所有者 |
| --- | --- | --- |
| A | Original Source Segment | 用户或来源表 |
| B | Best TM Match | 插件 |
| C | Orig Match % | 插件 |
| D | Rewritten Segment | 插件 |
| E | New Match % | 插件 |
| F | Reached 85%? | 插件 |
| G | CD review valid? | CD 人工 Yes/No |

写回顺序先设置 G2:G5000 data validation，再提交 B1:G1 表头和 B-F 数据。data validation 失败会抛出 `Sheets CD review dropdown error`，不会继续提交 values，从而正确失败。

表头修复只写 A1:G1。现有 H-J 不属于 required headers；`validateHeaders()` 会把它们视为 extra，但不会因为 extra 判定失败。

## 已验证样本

`temp/test_output_roi_ui/verify-output.mjs` 直接调用当前 `validateRunConfig()`、`resolveWordRate()` 和 `writeToSheet()`，已人工检查输出：

- RWS、Project 513、`en→en` 返回 run config ready。
- RWS `en→en` 返回 `incomplete: missing_language_pair`。
- data validation 请求严格为 G2:G5000、`Yes/No`、single select。
- value ranges 只有 B1:G1 表头与 B2:F2 数据，没有 G2 值和 H-J 请求。

详细检查记录见 `temp/test_output_roi_ui/verification.md`。

## 验证命令与结果

```bash
node --check popup.js
node --check lib/feishu-sheets.js
for file in test/*.test.js; do node "$file"; done
python3 -m unittest test.test_export_local_rates
node temp/test_output_roi_ui/verify-output.mjs
```

当前结果：16 个 JavaScript 测试文件 0 失败；`feishu-sheets` 111/111、`popup-run-config` 16/16、`popup-fast-path` 9/9、`pricing-rules` 24/24；Python exporter 4/4。

## ROI 金额仍未完成

本轮没有新增 Cost 或 Saving 字段，也没有把本地 `New Match %` 当作计费分数。完整 ROI 仍必须满足：

1. 改写后再次调用 Starling Batch TM，保存第二个真实 score。
2. 从 Starling/Elasticsearch 获取真实实际字数与加权字数。
3. 按 `HANDOFF-2026-07-13-roi-measurement.md` 的 vendor、语言对、85% 边界和精度规则计算。
4. 金额主视图进入飞书多维表格，至少包含 Estimated Cost Before、Estimated Cost After、Estimated Saving、ROI Status。
5. 与五月结算单逐行对账并解决 `ROUND(..., 3)` 与最终 `ROUNDUP(..., 2)` 的业务冲突后，才允许宣称 ROI 金额可用。

## 接手顺序

1. 先读本文件，理解当前 UI 与 Sheet schema。
2. 再读 `HANDOFF-2026-07-13-roi-measurement.md`，理解完整 ROI 金额边界。
3. 修改 Sheet schema 时必须同步 `feishu-sheets.test.js` 的 valueRange 数量、表头和 data validation 断言。
4. 开始金额开发前先冻结实际字数、加权字数、第二次 TM 和 rounding contract，禁止从浏览器本地分词补数据。

## Git 与凭证边界

当前 `/Users/bytedance/my-project` 根仓库没有跟踪 `l10n-tm-companion/`，插件目录在 Git 中整体表现为 untracked。不要直接执行 `git add l10n-tm-companion`，否则会把整个本地插件快照作为新增内容引入。

提交前审计还确认历史 `popup.js` 含硬编码 Feishu App Secret。该问题不是本轮新增，但会使“把整个 untracked 文件加入根仓库”的操作泄露凭证明文。本轮已撤销插件目录暂存，所有实现保留在本地工作区；根仓库只提交了不含凭证的设计文档 `13c60b6`。

后续需要先选择正确的已跟踪插件仓库，并完成 Feishu Secret 轮换与移出源码，再迁移本轮代码变更。禁止在 handoff、commit message、测试输出或日志中记录 Secret 原值。
