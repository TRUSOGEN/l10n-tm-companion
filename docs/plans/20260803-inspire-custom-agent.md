# Inspire Custom Agent 接入计划

## 目标

L10n TM Companion 1.5.0 将 Inspire Provider 从通用 `POST /openapi/tasks` 改为已发布 Custom Agent 的 `POST /openapi/agents/:agentId/tasks`。每个满足 `50 ≤ Score A < 85` 的 source 只创建一个 Agent task；Agent 通过 Writer 原生 `copies[]` 返回一至三个候选，客户端验证后继续执行 protected-content、真实 Post-TM 与人工确认门禁。

## 已取得的真实证据

- 2026-08-03 使用本机 PAT 对文档所写 `UTA92F0aPv` 调用 Agent 详情、版本列表和创建任务均返回 `404 Custom agent not found`。
- Inspire Writer 页面显示 `TM_inspire` 的真实 Agent ID 为 `6a7036d4ef9ca901ee5c7a65`，已发布 Version 3，当前没有 draft。
- 使用真实 Agent ID 创建任务返回 200，创建响应确认 `agentType=markdown`、`agentVersionNumber=3`，状态、copies 与任务详情接口均可用。
- Version 3 当前启用 Terminology review、Writing rules review 与 Scene classification。真实任务进入 `termReview` 和 `styleToneReview`，输出三条 review copy，没有返回 Agent Prompt 要求的 JSON envelope；因此 Version 3 不能作为插件有效候选源。
- Version 5 使用 Chat 输出但仍保留旧 Prompt；真实任务进入 write 模式并生成两条 copy，证明 Custom Agent 的可用输出容器是 `copies[].copy`，不是 JSON envelope。
- Version 6 使用 Markdown report 且关闭全部附加规则；真实任务的 review 阶段均 skipped，但没有生成候选，只原样返回 source，证明 Markdown output 不适合本业务。
- Version 7 使用与 Writer 原生契约一致的 Prompt、Chat 输出并关闭全部附加规则。真实任务返回 `mode=write`、`agentType=chat`、两个 `status=pass` copy，term/rules/style 三个 review 阶段全部 skipped；生产客户端模块 smoke test也成功读取相同两条候选。

## 接口与失败语义

- 创建路径固定为 `/openapi/agents/6a7036d4ef9ca901ee5c7a65/tasks`，Body 发送 `prompt`、`llmModel`、`thinkingLevel` 与 `version=7`；客户端锁定已完成真实 E2E 的发布版本，后续升级必须重新验证并显式修改版本常量。
- 状态轮询继续使用 `/openapi/tasks/:taskId/status`；终态失败后读取 `/openapi/tasks/:taskId` 的 `failedReason`。
- 完成后读取 `/openapi/tasks/:taskId/copies`，只接受 `status=pass` 且非空的 `copy`，按规范化文本去重并最多保留三条；`fail` copy 不得进入候选链路。
- Agent Prompt 每个 native copy 只返回改写后的 source 文本。Agent 原样返回 source 表示没有安全改写空间，客户端过滤该结果并展示明确原因；零个可用 pass copy 正确失败。
- 客户端把 native copy 包装为既有内部候选，再执行 protected token、URL、数字、全大写、单字符或 CamelCase 品牌 token、语义状态、风险和真实 Post-TM 门禁。

## 实施切片

1. 先为 Custom Agent 创建路径、Body、轮询、任务详情、copies 聚合和失败详情补 public-interface 测试。
2. 修改 `lib/inspire-writer.js`，保持一个深模块隐藏异步任务协议与响应容器差异。
3. 修改 `lib/ai-translate.js`，只接受 Custom Agent 的 pass copy，并过滤原样 source；内部结构化候选继续作为安全门禁和 UI 接口。
4. 将真实 Agent ID 集中在 `lib/inspire-models.js`，普通用户仍只配置个人 Access Key、模型和 thinking level。
5. 在 Inspire 页面关闭额外 guideline/scene 模块，将输出类型改为 Chat，发布 Version 7；随后用无敏感 E2E 与生产客户端模块确认最终文本容器。
6. 增量更新 README、用户手册、配置原理和 E2E Checklist，再运行全量回归、安装包构建与产物检查。

## 验收标准

- 创建请求命中 Custom Agent 路径且不再发送 `teamId`；真实 Agent ID 只有一个权威定义。
- 一个 eligible source 只创建一个 task，轮询、详情和 copies 请求全部经过同一 QPS gate并计入使用量。
- Agent 返回一至三个 pass copy 时保留去重候选；原样 source 不生成候选；fail copy、Markdown report 或空 copies 均显示真实错误。
- Version 7 的无敏感 E2E 与生产客户端模块均返回两个可解析候选，并保存去敏后的请求次数、状态、版本和输出容器证据。
- 完整 JavaScript、Python、Backend、安装包与凭证扫描验证通过后才提交和推送。

## 当前进度

真实 Agent Version 7、Custom Agent 创建链路、原生 pass copy 解析、失败详情读取、原样 source 过滤和品牌 token 门禁已经完成。全部 JavaScript 与 Python 测试、Backend 15 项 pytest、语法与编译检查均已通过；1.5.0 线下安装包已构建、解包并核验签名、内置版本、Agent 配置与凭证扫描。本计划的实现与验收项均已完成，随 1.5.0 源码一并交付。
