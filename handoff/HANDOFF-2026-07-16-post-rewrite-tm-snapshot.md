# L10n TM Companion 改写后二次 TM 快照 Handoff

## 当前状态

2026-07-16 已完成 ROI 链路的首个可运行阶段：对首轮 `Orig Match % < 85` 且实际生成非空 AI rewrite 的条目，Popup 会使用相同的项目、source locale、target locale、PPE 开关和 Native Messaging 路径，再调用一次真实 Starling Batch TM。

这次查询的结果保存在 `item.post_rewrite_tm`：`complete` 含真实 `score`、TM match、TM source、来源、方法和候选数；`not_required` 表示无需二次查询；`incomplete` 含真实失败原因且不含伪造 score。普通 Sheet 的 A-G schema 与 B-F 写回保持不变。

## 实现位置

| 目标 | 文件 | 当前行为 |
| --- | --- | --- |
| 二次快照查询 | `lib/starling-tm.js` | `queryPostRewriteTmSnapshots()` 筛选非空 rewrite，复用 `searchTM()`，按输入顺序返回快照 |
| Popup 接入 | `popup.js` | AI rewrite 后查询并保存 `item.post_rewrite_tm`，本地 `New Match %` 继续只用于 CD 对比 |
| 结果审计 | `popup.js` | 卡片显示 `Post-TM <score>%` 或 `Post-TM incomplete`，详情显示真实快照或失败原因 |
| 协议回归 | `test/starling-tm-batch.test.js` | 锁定成功、无需查询、请求失败与非法 score 的失败语义 |
| Popup 回归 | `test/popup-fast-path.test.js` | 锁定主流程调用并保存 post-rewrite 快照，且不移除本地 New Match |

## 数据与失败契约

1. 只有 `reached_threshold !== true` 且 `ai_translation.trim()` 非空的条目发送第二次请求。
2. 接口返回的 `similarity = 0` 是完整的真实无命中快照，状态为 `complete`。
3. Native Messaging 错误、接口错误、返回数量不一致、非对象结果或非有限数 score 会使全部本次候选条目标记为 `incomplete`。
4. `incomplete` 不会阻断首轮 TM 优化结果，不会写成 0 分，不会计入 ROI 金额。
5. 当前快照只在 Popup 本次运行内保存，不能当作跨运行审计记录或可结算 ROI 数据。

## 已验证样本

`temp/test_post_rewrite_tm_snapshot/verification.md` 记录了完整验证证据，`live-batch-smoke.json` 是正式 Native Host 的脱敏只读输出。该 smoke test 在项目 385、`en→zh` 下返回 4/4 有序结果；`Settings` 的真实 score 为 58.333333333333336，候选数为 3。

验证命令：

```bash
node --check popup.js
node --check lib/starling-tm.js
for file in test/*.test.js; do node "$file"; done
python3 -m unittest test.test_export_local_rates -v
python3 temp/test_batch_tm/run_batch_smoke.py
```

完整 JavaScript 回归和 Python exporter 测试均通过；浏览器 Popup 真机测试尚未执行。

## 下一步

1. 先冻结飞书多维表格 `Run Detail` 的追加式字段与权限配置，将两次真实 TM 快照、运行 ID、项目、语言、状态和错误原因持久化；不得覆盖历史运行。
2. 再接入 Starling 或 Elasticsearch 的真实实际字数和加权字数，并把缺失值严格标记为 `incomplete`。
3. 冻结 vendor 费率版本、85% 边界和 rounding contract 后，才实现 Estimated Cost Before、Estimated Cost After、Estimated Saving 与 ROI Status。
4. 用五月结算单逐行对账；通过前只能称结果为运行内 TM 审计，不能称 ROI 金额可用。

## Git 与凭证边界

`l10n-tm-companion/` 在根仓库中仍是 untracked 本地插件目录。提交前必须选择正确的已跟踪插件仓库，并完成 Feishu Secret 轮换与移出源码；禁止直接把整个目录加入根仓库暂存。

## 2026-07-17 更新：整车多语言 ROI

ROI 的运行范围已从单一 `targetLocale` 改为每个已选项目的 `project × target locale` scope。Popup 默认勾选每个项目全部 `targetLocales`，允许用户取消语言；多项目只要求相同 source locale，不再要求共同 target locale。

每个 scope 独立调用首轮 Starling TM、可选的改写后二次 TM，并按该语言精确 vendor 费率计算。Popup 汇总所有完整 scope 的 Before、After 与 Saving；任一 scope 费率、TM 快照或金额不完整时，结果显示 `incomplete` 和“已覆盖语言小计”，同时列出 scope 与失败原因。AI 关闭时完整 scope 复用首轮快照，Saving 为 0，仍计入基线成本。

普通 Sheet A-G 仍只使用一个可查看 scope 的结果，避免将整车多语言明细错误展开到普通 Sheet；本次整车总额仅在 Popup 结果中展示。详细业务契约见 `docs/multilingual-roi.md`。
