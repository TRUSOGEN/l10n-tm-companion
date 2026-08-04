# L10n TM Companion Side Panel UX 升级设计

日期：2026-08-04

## 1. 背景与目标

L10n TM Companion 已从简单的 TM 查询插件演进为包含 Starling TM、AI 英文改写、人工确认、56 语言 ROI、vendor 费率路由与飞书归档的本地化审计工具。现有业务能力稳定，但用户难以判断系统当前状态、长任务剩余时间、错误原因及恢复方式。

本次设计以“工作流体验升级”为主，以局部结构重塑为辅。保留现有 Workflow / Review 双 Tab、A/B/C 业务语义和全部生产安全边界，不进行推倒重写。

目标：

- 所有关键状态都能回答“发生了什么、为什么、下一步怎么做”。
- 56 语言 ROI 长任务有可信的阶段、进度与 ETA。
- Feishu Secret 缺失时明确引导用户前往 Settings 配置。
- A/B/C、vendor 路由和正式金额口径可被非研发用户理解。
- 视觉简洁、专业、有辨识度，并满足键盘和 reduced-motion 要求。

## 2. 产品定位与设计原则

产品定位：Compact localization audit console。

设计原则：

1. 一屏一个主操作，次要操作降低视觉权重。
2. 状态变化必须在 100ms 内提供反馈。
3. 长任务先解释范围和预计耗时，再允许启动。
4. 错误必须包含原因、恢复动作和可展开的技术详情。
5. 颜色不能是唯一状态信号，必须同时使用文字或图标。
6. 动效只解释状态变化，不使用持续闪烁、粒子或装饰性背景动画。
7. 业务不变式优先于视觉改造。

## 3. 信息架构

保留两个主 Tab：

- Workflow：连接状态、项目、Spreadsheet、TM/AI、ROI 归档。
- Review：筛选、A/B/C 审阅、Focus View、确认与归档入口。

Workflow 维持四步：

1. Select projects
2. Choose spreadsheet
3. Run TM & AI
4. Review and archive ROI

顶部 Connection status 汇总 Feishu、Starling 和 AI 状态。每个状态只显示一个最明确的下一步动作。

Review 顶部增加可折叠的 ROI 口径说明，中部保留筛选和结果卡片，底部保留 sticky action bar，展示确认数量与 Archive ROI 主按钮。

## 4. Feishu Secret 与授权

采用 Settings 引导方案，不在 Side Panel 直接收集 Secret。

### 4.1 状态

- 已配置、未连接：显示 Ready to connect 和 Connect Feishu。
- Secret 缺失：显示 Feishu setup required 和 Open Settings。
- 已连接：显示用户身份、Reconnect 和 Disconnect。
- Broker 权威模式：保持 Broker 为唯一正式路径，不静默回退 legacy local auth。

### 4.2 缺失 Secret 的交互

用户点击授权但本机缺少 Secret 时：

1. Side Panel 显示明确诊断，不只显示底层错误。
2. 主按钮变为 Open Settings。
3. 点击调用 `chrome.runtime.openOptionsPage()`。
4. Settings 根据 URL/hash 或持久化导航意图定位 Feishu Secret 区块。
5. Secret 输入框获得焦点，显示“填写、保存，然后返回 Side Panel 继续授权”。

### 4.3 安全要求

- Secret 输入框为 password 类型。
- 已配置时只显示 Configured，不回显 Secret。
- Secret 不进入日志、错误详情、workflow snapshot 或 handoff。
- 不改变 OAuth callback 与 Broker/legacy 门禁。

## 5. ROI Archive 前摘要

点击 Archive ROI 后先展示 Side Panel 内确认面板，替代原生 `window.confirm`。

摘要包含：

- source rows
- confirmed rows
- language count
- vendor coverage
- unpriced language count
- estimated TM request count
- estimated duration range

明确提示：只有 confirmed rows 进入正式 ROI 金额。

操作：Cancel / Start archive。Start archive 是唯一主 CTA。

## 6. 长任务进度与 ETA

归档过程显示独立任务卡，阶段包括：

1. Preparing
2. Original TM (A)
3. Final TM (C)
4. Calculating ROI
5. Writing to Feishu
6. Complete

展示数据：

- languages completed / total
- TM requests completed / estimated total
- 当前活动 A/C scope
- elapsed time
- estimated time left
- overall percent

A/C 实际为流水线并发，UI 不把它伪装成严格串行。允许同时显示两个 active operations。

ETA 使用已完成请求耗时的移动平均；样本不足时显示 Estimating time，不承诺伪精确数字。进度更新使用 `aria-live="polite"`，数字使用 tabular figures。

## 7. Friendly Errors

新增纯模块 `lib/ui-errors.js`，输入原始错误，输出：

- title
- message
- primaryAction
- secondaryAction
- rawDetails
- severity

覆盖至少：

- Chrome storage quota
- headerless Sheet
- Feishu Secret 未配置
- Feishu OAuth/Broker 错误
- missing/incomplete word rate
- final TM missing/failed
- Starling credential、timeout、rate limit
- partial archive failure

UI 默认显示人话，raw error 放在可展开 Details 中并提供复制。映射不能吞掉 Request ID 或服务端错误码。

## 8. A/B/C 表达与 Review 卡片

Review 顶部解释：

- A：原始英文的 TM 成本。
- B：AI 改写的 TM 分数，只用于辅助审阅。
- C：人工确认最终英文的 TM 成本。
- 正式节省 = Cost(A) - Cost(C)，B 不直接进入金额。

每张卡使用 A → B → C score rail 作为视觉签名：

- A：中性蓝灰。
- B：indigo，代表 AI suggestion。
- C：绿色，代表 confirmed final。
- 负向变化：amber，不使用 error red。
- 真正失败：error red + 文字原因。

安全但没有 TM 提升的候选显示：

- Safe rewrite available
- TM score did not improve, so it was not auto-applied.

卡片默认只展示决策所需信息，完整解释放入 Focus View。

## 9. Vendor Coverage

归档摘要与完成状态中展示：

- RWS language count
- Pactera language count
- unpriced language count
- routed language explanation

“不被某 vendor 服务”是正常路由，不显示为错误。只有服务该语言但费率不完整、TM 不完整或最终确认缺失才标记 incomplete。

Bitable `Pricing notes` 保留 vendor locale routing 说明。

## 10. Empty、Loading、Success 与 Recovery

覆盖状态：

- 没有需要 AI 改写的内容。
- 没有 confirmed rows。
- 没有可计费 vendor。
- Secret 未配置。
- Archive 部分成功。
- Archive 可安全重试。
- 运行快照已恢复。

所有状态都提供明确下一步。Retry 必须复用稳定 Run ID，不重复创建已完成 vendor Run。

## 11. 视觉系统

### 11.1 Semantic tokens

- canvas: `#F6F7F9`
- surface: `#FFFFFF`
- text-primary: `#172033`
- text-secondary: `#667085`
- primary: `#3366FF`
- ai: `#6558D9`
- confirmed: `#14805E`
- warning: `#A15C00`
- error: `#C9362B`

颜色通过 CSS semantic variables 使用，不在组件中散落 raw values。

### 11.2 Typography 与布局

- 使用系统字体栈，不增加网络字体依赖。
- 使用 4/8px spacing rhythm。
- 触控目标最小 44×44px。
- 卡片、按钮、输入和 focus ring 使用统一 token。
- Side Panel 小宽度下不产生水平滚动。
- Review 列表超过 50 项时避免一次性昂贵 DOM 更新，优先分批渲染或复用现有筛选机制。

## 12. 动效

- Step complete：150ms。
- 状态卡进入：180ms opacity + translateY(4px)。
- Focus View：200ms opacity/transform。
- Confirm 成功：A/B/C rail 单次高亮。
- Progress：平滑过渡但不回退。
- 所有动画仅使用 opacity/transform，避免布局抖动。
- `prefers-reduced-motion: reduce` 时关闭非必要动画。

## 13. 工程边界

新增纯模块：

- `lib/ui-errors.js`：错误到 UI 模型。
- `lib/archive-progress.js`：请求估算、阶段、百分比和 ETA。
- `lib/archive-summary.js`：rows、confirmed、languages、vendor coverage 与时间范围。

DOM 渲染继续由 `popup.js` 协调，但新计算逻辑不得继续堆入该大文件。已有 ID 与关键 DOM 顺序尽量保留，以避免破坏源码契约测试；需要调整时同步把脆弱字符串断言迁移到纯函数或行为测试。

## 14. 不可改变的业务不变式

- 正式 ROI 恒为 A-C。
- B 只用于审阅，不进入正式金额。
- Final TM 必须真实查询。
- Broker 权威路径不静默 fallback。
- Vendor 不跨语言借价、不填 0。
- 56 个非英文语言 scope 全覆盖。
- Sheet 只写已确认 final。
- Archive stable Run ID 与断点恢复继续有效。
- Secret、AK/SK、token 不写日志和快照。

## 15. 测试与验收

### 15.1 单元测试

- Secret 缺失模型与 Settings 导航。
- Headerless Sheet 错误映射。
- Archive summary 的 confirmed、language、vendor 统计。
- 100 rows × 56 languages × batch 40 的请求估算。
- Progress 不回退、ETA 样本不足、ETA 更新。
- A/B/C 文案与 negative saving。
- Vendor routing 不误报 error。
- Raw error / Request ID 保留。

### 15.2 UI 契约测试

- 必要 DOM ID、Tab、Stepper 和 action bar 保留。
- Settings deep-link 聚焦 Secret。
- Archive modal 可取消、可键盘操作、焦点不逃逸。
- Progress 使用 aria-live。
- Focus View 有明确关闭路径。
- reduced-motion 有 CSS 覆盖。

### 15.3 回归

- 全部 `test/*.test.js`。
- 顶层 Python 测试。
- JS syntax 和 Python compile。
- `standard-lint` 对本次改动文件执行；缺失依赖时按前端规范记录并跳过。
- Backend pytest 继续记录 Python 3.11+ 环境要求。

### 15.4 手工验收

- 缺 Secret → Open Settings → 聚焦 → 保存 → 返回授权。
- 100 rows / 56 languages Archive：摘要正确、进度持续更新、ETA 合理、写入成功。
- quota、rate missing、final TM failed、partial archive 的恢复路径可用。
- Side Panel 窄宽、键盘导航、reduced motion。

## 16. 实施批次

1. 功能正确性与恢复路径：Secret、friendly errors、headerless、quota recovery。
2. ROI 长任务：archive summary、进度、ETA、vendor coverage。
3. Review 与视觉：A/B/C rail、empty states、动效、a11y。
4. 回归与文档：测试、lint、用户指南、handoff。

每批独立提交，只有当前批测试通过后才进入下一批。
