# L10n TM Companion OAuth Broker 与异步 ROI Backend Handoff

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
