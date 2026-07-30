# L10n TM Companion Handoff

日期：2026-07-28

## 当前版本

线下交付版本已推进到 `1.3.3`。正式交付目录是 `/Users/bytedance/my-project/L10n-TM-Companion-线下安装包`，分享 ZIP 的 SHA-256 为 `3f5bbf9abf44de234f5bf1bd50f12361ea79af89c984224d9ffed8f42d0a06cd`。上一版整包保留在 `/Users/bytedance/my-project/L10n-TM-Companion-线下安装包.previous-v1.3.2`，更早版本仍保留在同级备份目录。

Chrome 当前加载目录 `/Users/bytedance/L10n TM Companion - Chrome 加载这个文件夹` 已同步为 `1.3.3`；Native Messaging Host 已注册到该目录，因此刷新扩展并完全重启 Chrome 后会使用同一份新版 Native Host。

## 本轮完成

Review 首屏只执行一个展示语言 scope。开启 ROI mode 不再让初始查询等待全部共享语言；单条 Confirm 与 `Confirm & write remaining` 也只查询展示 scope 的 Final TM，并在 Spreadsheet 写入成功后立即成为 confirmed。

用户点击 `Write ROI archive` 时先看到固定目标和 `1 Run + N Scopes + M source Items`。取消不会补算延后语言或写入飞书；确认后，其余语言以最多三个 scope 受控并发补齐 A/B/C。每个 scope 内 Batch 并发固定为一，避免跨 scope 并发与批次并发相乘。

同一批 source 只创建一次 Inspire 决策。延后语言复用同一组 AI 候选，再分别查询各语言真实 Score A、Score B 和 Score C；任何 scope 失败都保留真实 incomplete 原因，禁止使用展示语言分数填充。

## ROI_Test 三层结构

- `L10n ROI Runs`：每次运行一条，保存整车金额、Coverage、Operator 与 A/AI/Review 漏斗。
- `L10n ROI Scopes`：每个 target locale 一条，保存语言级金额、覆盖数、确认数、漏斗与失败原因。
- `L10n ROI Items`：每个 source 每次运行一条，保存 A/B/C 文案与真实 TM score、AI 是否采用、Review 状态和 Operator；不与 locale 做笛卡尔积。

插件幂等创建六个基础 grid view：Runs 的 `Management overview`、`Operator adoption`、`Quality funnel`，Scopes 的 `Locale performance`、`Exceptions`，Items 的 `Source review audit`。飞书新增视图 API 只支持名称与类型，复杂分组、筛选、字段显隐和仪表盘继续由 ROI_Test Owner 在飞书界面一次性维护。

写入顺序固定为 `Run(writing) → Scopes → Items → Run(complete|incomplete)`。写入前分别读取三张表记录总数，任一表在追加后超过飞书 20,000 条上限时直接失败；Scope 和 Item 批量写入遵守每次最多 500 条。

## 飞书授权

OAuth 请求同时包含 `base:record:read`、`base:record:retrieve`、`base:view:read`、`base:view:write_only`。`base:record:read` 用于特定记录读取，容量预检调用的“列出记录”接口需要 `base:record:retrieve`；基础视图使用两项 view scope。应用 Owner 已开通这些权限后仍需发布包含权限的新应用版本；已有用户需要在 Side Panel 首页重新授权一次，旧 token 不会自动获得新增 scope。

当前仍是 `direct_user` 写入：用户本人必须有 ROI_Test 编辑权限。若产品要求插件用户可写但不能查看 ROI_Test，仍需要应用身份代理；App Secret 不能进入插件或分享给普通用户。

## 2026-07-28 真实授权事件

真实 ROI_Test 归档在读取/创建基础视图时返回飞书 `99991679 Unauthorized`，错误明确指出当前 user token 缺少 `bitable:app`、`bitable:app:readonly` 或 `base:view:read` 中至少一项。代码和 Native Host 的 OAuth URL 已经请求 `base:view:read` 与 `base:view:write_only`，因此事件根因位于授权发布链路：后台开通权限不会让旧 token 自动获得新 scope，应用管理员必须发布包含新权限的应用版本，当前用户随后必须重新授权。

`1.3.1` 增加本地 token scope 完整性检查。旧 token 即使尚未过期，只要缺少当前必需 scope，就不会继续被视为 connected；Side Panel 首页会列出缺失权限并显示 `Reconnect`，避免等到 ROI API 调用阶段才暴露长错误。该修复只提前失败和引导授权，不会伪造权限或绕过飞书资源访问控制。

随后真实容量预检再次返回 `99991679`，这次明确缺少 `base:record:retrieve`。根因是实现把“特定记录读取”`base:record:read` 错当成“列出/查询记录”权限；官方权限表确认列出记录属于 `base:record:retrieve`。`1.3.2` 已在 JS 和 Native Host OAuth 中加入该 scope，并以 RED → GREEN 回归锁定。用户后台即使已开通该权限，也必须用 1.3.2 重新授权，旧 token 不包含插件此前从未请求的 scope。

真实重连后仍返回同一 `99991679`，进一步定位到 1.3.2 的 scope provenance 缺陷：Native Host 在 token 响应缺少 scope 时回填申请 scope，浏览器侧也使用同样 fallback，导致“请求过”被误记成“已授予”。`1.3.3` 删除两层 fallback，Native Host 与浏览器都校验实际 scope 子集；旧 token 通过 auth schema version 一次性失效；API 再返回用户身份 `99991679` 时立即废弃 token，并明确提示 Owner 创建并发布包含新增权限的应用版本后再 `Reconnect`。

## 验证证据

- `node --test test/*.test.js`：36 个脚本通过，0 失败。
- Python：`batch-tm` 30/30、OAuth bridge 3/3、OAuth 17/17、search-key 21/21、Starling credentials 5/5、rate exporter 4/4。
- 新增定向测试：快速展示 scope、跨 scope 最大并发、延后补算、source-grain Items、三层顺序写入、六个基础视图、20,000 条容量失败、实际 OAuth scope、旧 token 迁移、`99991679` token 失效、Popup 确认顺序。
- JavaScript syntax、Python `py_compile`、Info.plist、`git diff --check` 全部通过。
- v1.3.3 App 与内置 manifest 版本一致，`codesign --verify --deep --strict` 通过。
- 打包后的私有 Python 3.9.6、Node 24.16.0、Starling CLI 1.1.24 dry-run 通过；原生进度组件 self-test 通过。
- 业务源码敏感模式扫描未发现真实 `sk-`、`wak_` 或 App Secret。
- OAuth scope 回归遵循 RED → GREEN：缺失实际 scope、缺少 `base:record:retrieve`、1.3.2 旧 schema 与 `99991679` 四种场景均先复现失败再修复；全量 JavaScript 36/36 和全部 Python 分组重新通过。

## 真实 E2E 当前边界

真实授权已经走到 ROI_Test API，但当前实际 token 尚未证明包含已发布版本中的 `base:record:retrieve`，因此仍没有完成三表写入。也未用真实 35-locale 运行测量 Starling PPE wall-clock 时间、实际请求数和 QPS。当前只能称为本地实现与安装包验证完成，不能称为生产 E2E 完成。

下一步顺序固定为：

1. Owner 在飞书开放平台创建并发布包含用户身份 `base:record:retrieve`、`base:view:read`、`base:view:write_only` 等当前 scope 的新应用版本。
2. 在 Chrome 扩展页刷新 `1.3.3`，完全重启 Chrome，回到 Side Panel 首页点击 `Reconnect`。
3. 用两至三条非生产 source 完成一次真实 Sheet Confirm 和 ROI_Test 归档，核对 1 Run、N Scopes、M Items、Operator、金额、字段类型与六个基础视图。
4. 再用 18 条 source 和完整语言集合记录各阶段 wall-clock、请求数、失败数和 API 限流情况；未取得实测前不承诺 35-locale 时延。

## 实现者复盘

最主要的问题是把大量 mock 和本地契约测试推进得很完整，却没有尽早用真实飞书 token 做最小写入闭环。结果是权限发布、旧 token scope 和真实视图 API 问题直到最后才暴露。以后任何新增飞书 scope 都应该先完成“一条测试记录 + 一个真实资源操作”的最小 E2E，再扩展 schema 和 UI。

当前 OAuth 架构仍未满足“插件用户可提交，但不能查看 ROI_Test”的产品要求。`direct_user` 只能继承用户本人权限；让普通用户线下填写共享 App Secret 会扩大应用级凭证暴露面。正式多人分发应使用可信服务保存 Secret、以应用身份代写，并在服务端做目标白名单、调用者身份、幂等和审计。

性能优化目前只有结构性证据：首屏只跑一个展示 scope、延后 scope 最多三并发、单 scope Batch 并发为一。实现还没有把 phase duration 和 request count 稳定写入 ROI_Test，也没有真实 35-locale 的 P50/P95 数据，因此不能把“有并发上限”表述成“已经很快”。

AI 是否进入 50–85 链路由首个展示 scope 的 Score A 决定，同一 source 的 AI 决策随后复用于其他 locale。这个选择保证每条 source 只创建一个 Inspire task，也让首屏更快，但其他 locale 的 Score A 可能跨越 50 或 85 边界。产品必须明确它是“参考 locale 的 source-level gate”；若业务要求任一 locale 独立判断资格，就需要先查询全部 locale 的 A，首屏性能和一 source 一 task 的调度逻辑都要重新设计。

Items 采用 source-grain，避免 source × locale 的记录爆炸；代价是无法在 Items 中逐条审计每个 source × locale 的 A/B/C。Scopes 只有语言级聚合。如果将来需要 forensic audit，应该增加按需冷导出或独立明细表，不能重新把热路径直接改成笛卡尔积。

飞书三表写入没有跨表事务。Run 会先标为 `writing`，失败时尽量改为 `write_failed`，但 Scopes 或 Items 可能已经部分写入；当前也没有按 Run ID 恢复、去重或清理的 repair 工具。重复点击可能形成新的逻辑运行记录。大规模使用前应增加幂等键、恢复/修复入口和失败运行视图。

schema 校验目前检查字段名与字段 type，不校验既有 single-select 的 options 等 property。三张表的 20,000 条容量检查会正确失败，但没有自动 rollover 或历史归档策略。基础视图也只是 API 能创建的命名 grid shell，筛选、分组、字段显隐、透视和仪表盘仍需 ROI_Test Owner 在飞书里一次性配置。

权限面需要收敛。用户展示的飞书应用权限远超本插件需要的 Sheet、Wiki、Bitable 和基本用户信息范围；即使插件 OAuth 只请求较小 scope，应用级权限过大仍会增加凭证泄露后的 blast radius。专用应用上线前应删除 Aily、群聊、日历、文档 AI 等无关权限，并重新发布。

当前线下安装器是 ad-hoc 签名，没有 Apple notarization，适合受控 Pilot，不等同于企业级无提示分发。ROI_Test 保存姓名、user ID、open ID 和头像 URL，属于个人数据；需要限制分享范围、设置保留周期，并接受头像 URL 可能过期。

工作区长期处于大量已修改和未跟踪文件混合状态，交付包已经前进到 `1.3.3`，但 Git 仍没有一个可审计的提交点。这是维护风险。必须先人工区分历史改动与本轮改动，再精确 stage；禁止在当前目录执行 `git add .`。

## 使用者需要注意

- 不要把 App Secret 放进插件、ZIP、聊天、文档或普通用户电脑；当前 Keychain 模式仅用于 Owner/受控 Pilot。
- 后台开通权限后必须发布应用新版本，已有用户必须重新授权；只刷新页面不会升级旧 token scope。
- ROI_Test 只分享给需要看数据的人。当前 `direct_user` 用户若要写入，必须拥有对应资源权限，因此暂时无法同时实现“能写但完全不能看”。
- 不要随意改名或删除 `L10n ROI Runs`、`L10n ROI Scopes`、`L10n ROI Items` 及其固定字段；复杂视图只由 Owner 维护一次。
- 定期监控三张表记录数与 `write_failed` 运行，接近 20,000 条前制定 rollover；删除失败记录前先核对是否已有部分 Scopes/Items。
- 发布给更大范围前先做 2–3 条真实 E2E，再做 18 条和全 locale 性能测量；任何 `incomplete`、费率缺失或 TM API 错误都应保留，不要手工填分或补默认金额。

## Git 边界

工作区在本轮开始前已有大量未提交修改，并且本轮继续修改了相同核心文件。没有执行 broad stage、commit、push、reset 或清理，避免把无法安全区分的历史改动误提交。
