# L10n TM Companion Handoff for Product Reporting

日期：2026-07-28

## 下一会话目标

基于当前 `1.3.3` 交付物完成管理层汇报，并在飞书应用新版本发布后完成最小真实 E2E：2–3 条非生产 source 的 Sheet Confirm、Final TM、ROI_Test 三表归档与 Operator 审计。

## 当前交付状态

- 唯一正式安装包：`/Users/bytedance/my-project/L10n-TM-Companion-线下安装包`
- 分享 ZIP：`L10n-TM-Companion-macOS.zip`
- ZIP SHA-256：`3f5bbf9abf44de234f5bf1bd50f12361ea79af89c984224d9ffed8f42d0a06cd`
- Chrome 实际加载目录已同步 `1.3.3`；使用前仍需在 `chrome://extensions` 刷新并完全重启 Chrome。
- 旧安装包已从项目根目录移走，项目中只保留一个正式最新版。

版本、业务逻辑、测试与风险的完整记录见：

- `/Users/bytedance/my-project/l10n-tm-companion/handoff/l10n-tm-companion-handoff-20260728.md`
- `/Users/bytedance/my-project/l10n-tm-companion/README.md`
- `/Users/bytedance/my-project/l10n-tm-companion/docs/user-guide.md`
- `/Users/bytedance/my-project/l10n-tm-companion/docs/popup-configuration.md`

## 一句话定位

这是一个面向 CD 与本地化团队的 Chrome Side Panel 插件，把英文 source 的 TM 查询、受控 AI 改写、人工确认、Final TM、Sheet 写回和多语言 ROI 审计串成同一个闭环。

## 已实现的核心能力

### TM 与输入

- 从飞书 Spreadsheet、Wiki 挂载 Spreadsheet、飞书文档全文或选中文字读取英文 source。
- 自动识别 Spreadsheet、Sheet、source 列、数据起始行和输出列，也允许显式覆盖。
- 一次选择 1–10 个 Starling 项目，以 Batch TM 查询 Top-3；CD 界面展示英文 TM source 与真实 Score A，不展示无关 target translation。
- Starling/API 失败时公开真实错误，禁止把请求失败伪装成 `No TM match`。

### 50–85 AI 候选链路

- 严格使用半开区间 `50 ≤ Score A < 85`：`49.99` 跳过、`50` 进入、`84.99` 进入、`85` 跳过。
- 每条 eligible source 只创建一个 Inspire task，最多保留三个候选。
- Prompt 集成版本化 TM Alignment、Content Review skill、Style Guide、Glossary，以及按场景选择的 Legal Guidelines。
- 候选依次通过结构、placeholder/protected token、URL、数字、Glossary、Legal、语义与风险校验。
- 每个通过结构校验的候选查询真实 Post-TM；只有安全且 `Score B > Score A` 的候选进入可选列表，其余显示 `None` 与可解释原因。

### CD 人工确认与写回

- `Focus` 是唯一审阅入口；CD 可以选择 AI 候选或直接编辑最终英文 C。
- 单条 Confirm 固定执行：本地校验 → 真实 Final TM → 当前 Sheet 行写入 → `confirmed`。
- `Confirm & write remaining` 批量处理未确认默认项，跳过已确认项，并按连续行区间减少 Sheet API 写入。
- 已确认条目再次编辑会转为 `dirty`，旧 Final TM 失效，必须重新确认。
- Sheet 写入六列：Best TM Match、Score A、最终 C、所选候选 Post-TM、是否达到 85、Final TM。

### 多语言 ROI 与使用者审计

- ROI 默认关闭，普通 CD 路径只等待一个展示语言，避免把全部语言计算放进首屏。
- 用户显式开启 ROI 并确认归档后，其余共享语言以最多三个 scope 受控并发补齐 A/B/C。
- 正式 ROI 定义为 `TM Cost(A) - TM Cost(C)`；B 只用于 AI 增益分析，不替代 CD 确认的 C。
- ROI_Test 使用 Runs、Scopes、Items 三层结构：Run 保存整车金额与漏斗，Scope 保存语言级金额与失败原因，Item 每个 source 每次运行只写一条 A/B/C 审计。
- 记录 Operator 的最小飞书身份字段，支持回答“谁在使用、谁执行了本次归档”。
- 幂等创建六个基础 grid view，写入前检查每张表 20,000 条记录上限；复杂分组、筛选、透视和仪表盘由 ROI Owner 在飞书中一次性维护。

## 可汇报的业务价值

- 把人工复制、TM 查询、AI 改写、质量检查、最终确认和回写合并为一个工作流，减少工具切换与重复操作。
- AI 只处理中间 TM 匹配区间，高分直接复用、低分保留人工决策，控制模型成本与错误风险。
- 每个 AI 候选都必须通过规则门禁和真实 Post-TM，最终结果还要经过 CD 与 Final TM，形成 human-in-the-loop 质量闭环。
- ROI 使用正式 A-C 口径，并保留语言覆盖、失败原因和 Operator，便于管理层查看节省、质量提升与使用 adoption。
- Items 采用 source-grain，18 条 source × 35 个语言仍只生成 18 条 Item，避免 630 条热路径明细造成快速膨胀。

## 当前不能对外宣称已完成的事项

- ROI_Test 真实三表写入仍未完成最终 E2E。当前飞书 token 尚未证明包含已发布版本中的 `base:record:retrieve`；Owner 需要发布包含当前用户身份 scopes 的应用新版本，然后使用 `1.3.3` 重新授权。
- 当前是 `direct_user` 写入，用户必须拥有 ROI_Test 编辑权限，因此“用户能提交但完全不能查看 ROI_Test”尚未实现；该目标需要应用身份代理。
- 当前纯客户端 token 兑换依赖 App Secret。受控小范围 Pilot 可以由 Owner 线下提供，并由每台 Mac 的系统隐藏输入框保存到 Keychain；Secret 不进入插件页面、安装包或日志。正式多人分发需要服务端 OAuth broker，普通用户只点击 Authorize。
- 安装器为 ad-hoc 签名，适合受控 Pilot；企业级无提示分发仍需要 Developer ID、notarization 或 MDM。
- 尚无真实 35-locale P50/P95 性能数据；当前只能汇报结构性优化，不能承诺生产时延。
- ROI 三表没有跨表事务和按 Run ID 的自动 repair/幂等恢复；大规模使用前应补齐失败恢复与 rollover。

## 验证证据

- JavaScript 全量测试：36 个脚本通过，0 失败。
- Python：Batch TM 30/30、OAuth bridge 3/3、OAuth 17/17、search-key 21/21、Starling credentials 5/5、rate exporter 4/4。
- 覆盖边界与关键状态：49.99/50/84.99/85、每 source 单 task、Top-3、最多三候选、Post-TM、安全门禁、Focus、Final TM、单行/批量写入、ROI 三层归档、20,000 条容量、实际 OAuth scope 与 `99991679` token 失效。
- JavaScript syntax、Python `py_compile`、`git diff --check`、App 签名和 ZIP 完整性校验通过。
- 以上属于本地实现与安装包验证；不得替代尚未完成的真实 ROI E2E。

## 建议汇报口径

L10n TM Companion 已经形成从 source 读取、Top-3 TM、受控 AI 改写、CD 人工确认、Final TM、Sheet 写回到多语言 ROI 审计的完整产品链路。AI 只处理 50–85 的中间区间，每条 source 只创建一个任务、最多三个候选，并通过 token、URL、数字、Glossary、Legal、语义和真实 Post-TM 多重校验。CD 只需要在 Focus 修改例外项，其余内容可以批量确认。ROI 采用正式 A-C 成本差，能够按整车、语言和 source 三层查看节省、覆盖、质量漏斗与使用者。当前版本适合受控 Pilot；正式规模化前还需要完成飞书权限发布后的真实三表 E2E、服务端 OAuth broker、应用身份代写、企业签名和生产性能测量。

## 下一步

1. Owner 发布包含 `base:record:retrieve`、`base:view:read`、`base:view:write_only` 等当前用户身份权限的新应用版本。
2. 刷新 Chrome 中的 `1.3.3`，完全重启 Chrome，在 Side Panel 首页点击 Reconnect。
3. 用 2–3 条非生产 source 验证 Sheet Confirm 与 ROI_Test 的 1 Run、N Scopes、M Items、Operator、金额和六个基础视图。
4. 再使用 18 条 source 与完整语言集合记录阶段耗时、请求数、失败数和 API 限流情况。
5. 正式多人分发前实现 OAuth broker：App Secret 仅保存在服务端，由服务端兑换授权码；普通用户只点击 `Authorize`，安装包和用户电脑均不保存 Secret。随后实现应用身份 ROI 代写，再处理 Developer ID/notarization。

## Git 边界

工作区已有大量历史修改和未跟踪文件，本轮未 stage、commit、push、reset 或清理。继续开发前必须精确核对变更归属；禁止 `git add .` 或把当前 dirty tree 直接作为可审计发布状态。

## Suggested skills

- `systematic-debugging`：继续定位真实飞书 OAuth、ROI_Test 或 Starling/Inspire E2E 问题。
- `verification-before-completion`：在宣称生产可用前复核真实写入、Operator、金额、视图、包体与权限。
- `handoff`：下一阶段结束时生成新的临时交接文件，并引用本文件及项目正式文档。
- `browser:control-in-app-browser` 或 `chrome:control-chrome`：在用户已登录的飞书环境中执行只读 UI 核对或受控 E2E。
