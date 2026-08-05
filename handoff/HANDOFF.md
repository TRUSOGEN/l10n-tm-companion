# L10n TM Companion OAuth Broker 与异步 ROI Backend Handoff

## 2026-08-05 v1.6 本地发布入口

v1.6.0 已在本地分支 `codex/publish-v1.5.0` 完成版本、紧凑 Review UI 文档、离线包、内容/安全校验与真实测试记录；未 push。最新交接请先阅读：

- `handoff/l10n-tm-companion-handoff-20260805-v1.6.md`
- `docs/release-v1.6.0.md`

最终 ZIP 为 `/Users/bytedance/my-project/L10n-TM-Companion-线下安装包/L10n-TM-Companion-v1.6.0-macOS.zip`，SHA-256 为 `efc24f10b5ed679f6dcf9d9023e160bfe4d640ef20027fc00a88c5c75a79898d`。Backend pytest 因系统 Python 缺 pytest 未执行，未安装依赖，也不宣称全量全绿。

## 2026-08-04 AI 审阅候选可见性更新

安全且 Post-TM 查询完整的 AI 改写现在即使分数下降也可在 Review 与 Focus 中显示和人工选择；自动初始 Final 仍只采用 `Post-TM > Score A` 的候选。详情、验证、安装包 SHA-256 与未验证边界请先阅读：

- `handoff/l10n-tm-companion-handoff-20260804-starling40.md` 的“2026-08-04 增量：下降 Post-TM 的安全 AI 候选仍可审阅”章节。

当前提交为 `0a2b4a3`，位于本地 `codex/publish-v1.5.0` 分支，未推送远端。主离线包已同步更新；下降候选只有在人工选择并确认 Final 后才会写回 Sheet 或影响正式 A-C ROI。

## 2026-08-04 Starling 40 条默认批次入口

本轮已根据 Starling 批量 TM 单请求 `sourceContents=40` 的批准，将插件和关闭态 Backend 的默认 batch size 更新为 40，并把内置 `@byted/starling-agent-cli` 升级到稳定版 1.1.41。完整状态、安装包 SHA-256、验证结果与未验证边界请先阅读：

- `handoff/l10n-tm-companion-handoff-20260804-starling40.md`

当前提交为 `d324657`，位于本地 `codex/publish-v1.5.0` 分支，尚未按本轮请求推送。`projectIds` 始终最多 10 个，Native Host 每批默认 40 条 source、最多 5 个批次并发；真实 PPE 40 条 payload 和 P95 尚未由本轮直接调用验证。

## 2026-08-03 1.5 发布入口

最新已提交、已上传并完成安装包验证的 1.5 状态请先阅读：

- `handoff/l10n-tm-companion-handoff-20260803-v1.5.md`

最终提交为 `d39bb31`，远端分支为 `codex/publish-v1.5.0`，Draft PR 为 `https://github.com/TRUSOGEN/l10n-tm-companion/pull/2`。主交付目录已同步 1.5.0 干净安装包；Starling 40 条真实配额和 PPE P95 尚未验证，因此默认 batch 仍为 10，生产 Broker/异步 ROI feature flags 仍关闭。以下较早条目保留历史背景，不代表最新发布状态。

## 2026-08-03 当前入口

最新 ROI 与 Starling PPE 实测请先阅读：

- `handoff/l10n-tm-companion-handoff-20260803.md`

本轮完成了 ROI 单开关自动覆盖非英语语言、RWS/Pactera 复用同一套 TM snapshot，以及延后语言不重复查询 Score B 的本地实现，但都仍处于 dirty working tree，未提交或发布。PPE 已直接验证 `/corpus/tm/match/batch` 的 `sourceContents` 单次最多 10 条；下一步是向 Starling RD 申请 40/100 条扩容或等价大批量接口，并取得并发/QPS/P95 指标后再改客户端限制。

## 2026-07-31 当前入口

最新真实状态请先阅读：

- `handoff/l10n-tm-companion-handoff-20260731.md`

当前项目本体 HEAD 已更新为 `8f6603b`，并完成 Inspire Prompt 移除 Style Guide/Glossary；项目本体仍没有 `backend/` 和 Broker 客户端。`/Users/bytedance/Downloads/l10n-tm-companion.zip` 含外部 Agent 的 Backend 候选实现，但尚未受控导入，且缺少后续口头报告中声称新增的 A4 门禁测试/证据。下一步必须先对齐项目本体与 ZIP，再继续 Phase B/C。本文以下内容保留为 2026-07-29 Backend 任务背景，不再代表当前完整工作区状态。

## 任务目标

在现有仓库内新增 `backend/` 服务，完成两项生产能力：

- OAuth Broker：Feishu App Secret 只存在公司 Secret Manager 和服务端进程，普通用户安装生产插件后直接点击 Authorize。
- 异步 ROI：全语言 A/C TM 查询、计价和 ROI_Test 归档由持久 Worker 完成，关闭 Side Panel 不终止任务；`Confirm & save` 和 `Archive ROI` 不再等待全语言计算。

正式实施规格是：

- `source/docs/oauth-broker-async-roi.md`
- `source/docs/oauth-broker-async-roi-contract.md`

金额和插件交互的长期契约是：

- `source/docs/multilingual-roi.md`
- `source/docs/popup-configuration.md`

若本文与正式规格冲突，以正式规格为准。

## 当前状态

- Source snapshot：`source/`
- 原始分支：`codex/publish-v1.3.3`
- 原始 baseline commit：`28293ac`
- 快照已包含原工作区尚未提交的 1.3.4 UI、分页、i18n、文档和测试修改；这些修改属于当前产品工作，不得覆盖。
- OAuth Broker 和异步 ROI backend 尚未实现或部署。
- 现有生产代码仍从本机 Keychain 读取 App Secret，并在 Side Panel 内同步补齐延后 ROI scope。

交付包不包含 `.git`。导入公司代码库后先建立独立开发分支，划定自己的文件边界，并只提交本任务文件。

## 第一批行动

1. 完整阅读正式规格和两份长期契约，检查现有 OAuth、ROI、Native Messaging 和归档代码接入点。
2. 向服务 Owner 收齐“部署前阻塞项”六项答案；缺少答案时可部署关闭 feature flag 的服务，不得启用生产流量。
3. 先实施阶段 A OAuth Broker；完成无 Secret 新 Mac 授权、refresh rotation、revoke、缺 scope 和安全失败测试。
4. 再实施阶段 B ROI Worker；先 shadow compute，不写生产 ROI_Test，逐 item、locale 对齐现有 A−C 金额与 incomplete/subtotal 语义。
5. 交付 OpenAPI、migration、部署配置、secret 名称清单、dashboard、runbook、故障注入和 3/18/100 条已检查测试结果。

## 硬性业务约束

- 正式 ROI 只使用 `TM Cost(A) - TM Cost(C)`；B 只用于审阅证据。
- 当前展示 scope 的 Final TM 和 Working Sheet 写入成功后，条目才可确认。
- 失败 scope 必须保持 `incomplete`，有效覆盖只能显示 subtotal。
- Starling Batch 每次最多十条 source、最多十个 project ID；真实 QPS 和并发由 Starling Owner 批准，禁止猜测。
- 服务端 locale→vendor→rate policy 必须版本化且每个 locale 唯一映射；会议中的 Pactera/RWS 数量不是可直接上线的规则。
- OAuth refresh token 是轮换凭证；同一 grant 的刷新必须串行化，并按实现契约处理外部调用与数据库之间的 `refresh_uncertain` 崩溃窗口。
- Backend 故障时显示真实失败并支持显式重试，禁止静默回退本机 Secret 或旧同步全语言生产路径。

## 推荐技能

- `codebase-design`：冻结模块边界、状态机和数据流。
- `tdd`：从 OAuth rotation、幂等键和 ROI 金额一致性开始。
- `systematic-debugging`：处理 Starling、Feishu 和队列故障注入。
- `verification-before-completion`：逐项检查部署和测试产物。
- `handoff`：记录 commit、环境、真实地址、feature flag 和未验证边界。

## 完成定义

仅有代码或服务进程启动不算完成。阶段 A 完成要求从未配置 Secret 的生产构建成功授权并自动刷新；阶段 B 完成要求 Side Panel 关闭后任务仍完成、归档幂等、金额与旧实现逐 scope 一致、生产开关受六项门禁控制。最终 handoff 必须区分本地测试、PPE 部署、Pilot 启用和生产启用四种状态。
