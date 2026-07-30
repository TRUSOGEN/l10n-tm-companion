# L10n TM Companion 交接

更新时间：2026-07-15。当前线上代码仓库为 `https://github.com/TRUSOGEN/Localization-TM-Companion`，分支为 `main`。

## 2026-07-15 性能取舍确认：默认只查 TM（当前状态）

- 用户确认当前不需要 Source String Key、项目归属或记录 URL，主流程只使用 Batch TM Match 返回的 match score 与 TM 结果。
- `popup.js` 已移除 `searchKeys` 调用及 Key UI，TM 查询后直接进入 AI 改写、本地 New Match 和对比阶段。
- `/project/search` 在默认路径零调用。它没有批量文本输入，最坏会产生 `文本数 × 项目数` 个请求，是本次体感卡顿的直接原因。
- Sheet 的 I/J 列为兼容现有表格而保留，默认写空。`search_key` bridge action 与 `searchKeys` 封装暂时保留，但没有 UI 或主流程调用入口。
- 回归已验证：`node test/popup-fast-path.test.js` 断言 `processItems` 不含 `searchKeys(`、不写 `item.project`，且结果卡片不展示未查询的 Key；完整 Python 与 JavaScript 测试套件均通过。
- 未做本轮真实 Chrome smoke test。下一步是用户在 `chrome://extensions` 重新加载解压版扩展，并用相同的 10 条以内文本、10 个以内项目复测；此时 Network/bridge 日志中不应出现 `/project/search`。

下方“Key 必填修正”是此前短暂状态的历史记录，已被本节覆盖。

## 2026-07-15 85% 门槛更新（当前状态）

- 插件主流程、AI 改写分流、New Match 判定、Sheet/Bitable 表头已统一采用 `TM_MATCH_THRESHOLD = 85`。
- 语义固定为 `Orig Match % >= 85` 达标并复用 TM，`Orig Match % < 85` 才调用 AI 改写；85.00% 归入达标档。
- 运行时字段由历史的 `reached_75` 改为中性的 `reached_threshold`，飞书 F 列表头为 `Reached 85%?`，避免字段名与业务门槛再次脱节。
- 已新增 84%/85% 边界回归：84% 触发改写且结果为不同，85% 不改写且结果为达标。金额的严格边界和不同语言的费率仍以 Yuting/vendor 后续确认的书面规则为准。

下方包含 75% 的文字属于此前阶段的历史记录，已被本节覆盖。

## 2026-07-15 Key 必填修正（当前状态）

- 本次真实 PPE 检查确认：Batch TM Match 单次 10 条请求返回的候选中没有 `key` 或 `keyText`。`tmId` 是 TM 记录标识，`keywords` 只是原文分词，均不能作为 Source String Key。
- Source String Key 已恢复为主流程必填步骤。TM 查询后，插件必须用 `/project/search` 查询相同原文与已选项目；缺 Key 或仅模糊命中会停止本轮流程，不会写回空 Key 或错误 Key。
- 旧实现每次 Key 查询都会启动 `starling-cli`。现在由 `native-host/starling-key-batch-client.js` 在单个官方 `StarlingClient` 进程内以最多 8 个并发执行，保留文本 × 项目完整查询语义。实测一项目一条 `Done` 精确 Key 为 6.819 秒；一项目十条为 15.879 秒，其中 8 条精确命中、2 条在项目 385 中无对应源文案。
- Batch TM 的 `sourceContents`、`projectIds` 各最多 10 项。Key 阶段没有等价批量 API，10 条文案 × 10 个项目最多形成 100 个 `/project/search` 请求；应只选择实际需要的项目，并接受缺失 Key 的显式失败。

下方“默认跳过 Key 查询”的描述是此前 `ac9aef7` 状态的历史记录，已被本节覆盖。

## 当前已完成

- Starling TM 查询改为 PPE Batch API：`POST /gateway/openapi/corpus/tm/match/batch`，由 `native-host/starling-bridge.py` 使用既有官方签名链路调用。
- PPE Header 固定为 `x-use-ppe: 1` 与 `x-tt-env: ppe_openapi_integ`。调用不应手工复制浏览器 Cookie、鉴权头或任何凭据。
- Starling 已确认 `source_contents`、`project_ids` 各最多 10 条。Bridge 已按每批 10 条 `sourceContents` 分批，11 条会发为 `10 + 1`。
- Batch 调用遇到 PPE 下游 `error_code=1204` 会有限重试；重试后仍失败时，UI 显示“PPE TM 服务超时”，提示提供响应 `x-tt-logid` 给 Starling，而非误导用户检查 AK/SK。
- 扩展图标已调整为白底、黑色单一连接符号。
- 默认处理链路已跳过 Source String Key 查询。原 Key 查询会执行 `/project/search`：10 条文本 × 10 个项目最多形成 100 个网络请求，是用户感受到卡顿的主要来源。
- 现在卡片显示 `Key: 未查询`，写回时 I/J 列默认留空。`search_key` bridge action 与 `searchKeys` 前端封装仍保留，供未来“用户明确需要时再查询”的独立功能使用。

## 最近提交

`main` 当前提交为 `ac9aef7 perf: skip key lookup in default TM flow`。

相关提交按时间倒序：

- `ac9aef7`：默认主流程不查询 Key，增加 `test/popup-fast-path.test.js` 回归保护。
- `7313ccc`：文档注释与十条 Batch 上限对齐。
- `aae7f27`：TM 文案按每批十条发送，替代旧的每批三条。
- `fac15f9`：PPE `1204` 错误提示准确化。
- `d0af789`：引入 PPE Batch TM Match。

## 关键代码位置

| 目标 | 路径 | 说明 |
| --- | --- | --- |
| Popup 主流程 | `popup.js` 的 `processItems` | 仅 TM 查询 → AI 改写 → 本地 New Match 计算 → 写回，不再调用 `searchKeys`。 |
| Batch Bridge | `native-host/starling-bridge.py` | Batch 请求构造、十条分批、1204 重试、错误保留。 |
| TM 前端调用 | `lib/starling-tm.js` | 通过 Native Messaging 调 Bridge；Key 查询封装仍在这里。 |
| 写入 Sheet | `lib/feishu-sheets.js` | 写入 B/C/D/E/F/H/I/J；默认 `item.key` 与 `item.project` 为空。 |
| 错误提示 | `lib/errors.js` | PPE timeout 的用户可读提示。 |
| TM 协议文档 | `docs/TM-MATCHING.md` | Batch 输入、响应映射和失败语义。 |
| 接口测试说明 | `testing/starling-batch-api-test-plan.md` | 在线调试与批量测试记录。 |

本地工作副本：`/Users/bytedance/my-project/l10n-tm-companion/`。此前用于 GitHub 提交的临时 clone：`/private/tmp/l10n-tm-companion-remote-inspect/`；继续提交前先确认远端与本地状态，避免把临时文件带入仓库。

## 已验证行为

2026-07-14 的实际 PPE 单次十条请求成功返回十组结果，耗时约 3.7 秒。旧实现把十条拆成 `3 + 3 + 3 + 1`，同一测试约 5.8 秒。默认跳过 Key 查询后，主链路不再额外发出按项目展开的 `/project/search` 请求。

已在提交前通过：

- `node test/popup-fast-path.test.js`：确认 `processItems` 中没有 `searchKeys(`。
- `node --check popup.js`：语法检查。
- `python3 test/batch-tm-test.py`：18 项通过。
- `python3 test/search-key-test.py`：15 项通过。
- `for f in test/*.test.js; do node "$f"; done`：现有 JavaScript 测试全部通过。

## Starling 已知情况

- 在线调试出现 `Invalid API, Not Found` 时，优先核对请求方式为 POST、URL 为 `/gateway/openapi/corpus/tm/match/batch`、Body 合法 JSON、并带 PPE 两个 Header。
- `error_code=1204` 的含义是请求已进入 PPE，但 `ies.starling.corpora` 下游在当时的超时窗口内未返回；排障字段是响应 Header 的 `x-tt-logid`。
- Starling 反馈这是新接口，最初默认 1 秒超时，已调整；仍应将偶发超时视为服务端/网络故障，不能记为 TM 0 分或无命中。
- 文案或项目 ID 超过十条会影响搜索性能，插件会显式拒绝超过此限制的请求。

## 当前产品取舍

“Key”不是 Batch TM API 的返回字段。Batch 响应中的 `tmId` 是 TM 记录标识，不是 Source String Key；要获得 Key 必须走源文案搜索接口。因此默认主流程不查 Key 是有意识的性能取舍，不能把 `tmId` 填入 Key 列冒充 Key。

如果用户重新要求 Key，推荐做成结果页中用户主动点击的“查询 Key”操作，并只对选中的条目执行；先确认是否需要跨项目搜索、是否可接受每条对多个项目请求。不要恢复为每次自动查询全部文本、全部项目。

## ROI 后续工作

ROI 设计已单独记录在 `/Users/bytedance/my-project/handoff/HANDOFF-2026-07-13-roi-measurement.md`，本文件不重复其数据模型和验收细节。

最重要的前提：现有 `New Match %` 是本地文本相似度，只适合作为改写参考，不能当作改写后 Starling TM 命中率或金额依据。ROI 要实施时，必须在改写后再次调用 Batch TM API，保存两次真实 Starling 分数；金额由 vendor 的语言、内容类型、匹配分档、计费单位和生效日期规则计算为“预估”，并与真实账单样本对账。

开始 ROI 开发前仍需向 Yuting/vendor 确认计费规则和对账样本，向 Starling 确认正式环境路由、重试策略、并发和限流。

## 建议下一步

1. 用户实际重新加载扩展后，用 10 条以内文本、10 个以内项目做一次端到端测试，确认体感速度和写回的 I/J 留空符合预期。
2. 若还慢，记录 Chrome DevTools Network 时间与 `/tmp/l10n-bridge-debug.log`，区分 TM Batch、AI 改写、Feishu 写回三个阶段；不要直接推测是 TM 慢。
3. 只有用户重新提出 Key 需求时，再设计按需查询交互并先写回归测试。
4. 只有拿到 vendor 计费规则后，再按 ROI handoff 实施第二次真实 TM 查询与飞书报表。

## Suggested skills

- `systematic-debugging`：端到端性能或 PPE 超时复现时使用，先固定请求、LogID 与阶段耗时。
- `test-driven-development`：恢复按需 Key 查询或新增第二次真实 TM 查询前使用，先锁定失败与成功语义。
- `brainstorming`：新增管理员报表、Key 查询 UI 或 ROI 数据结构前使用，先确认产品边界和交互。
- `verification-before-completion`：涉及 Native Host、PPE 或飞书写回的改动完成前使用，要求真实 smoke test 与输出检查。
