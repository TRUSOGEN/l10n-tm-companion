# OAuth Broker 与异步 ROI 实现契约

本文固定 `docs/oauth-broker-async-roi.md` 的安全边界、API schema、持久状态和归档一致性。开发时可以增加字段，不得改变本文字段含义、授权规则、金额语义和失败行为。所有时间为 UTC RFC 3339；`session_id`、`grant_id`、`run_id`、`snapshot_id` 等服务端资源 ID 使用 UUIDv7；`installation_id`、`client_run_id`、`item_id` 和 `source_key` 是客户端生成、最多 128 字节的 opaque ID。

文本 hash 的 canonical bytes 固定为：把 CRLF 与 CR 转为 LF，对 Unicode 执行 NFC，不裁剪或折叠空白，再编码为 UTF-8 并计算 SHA-256 小写十六进制。服务端必须按相同规则重算，不能只信任客户端 hash。

## 信任边界

公司 HTTPS 网关必须完成员工身份认证，删除外部请求携带的身份头，再注入不可伪造的 `subject_id`、`tenant_id` 和认证强度。Native Host 如何取得公司身份凭证必须使用公司批准的 SSO、mTLS 或设备身份方案；该方案未确认时只能部署关闭 feature flag 的服务。

OAuth session 创建同时要求网关身份和 `installation_id`。exchange 后签发随机 256-bit `device_session_token`，Native Host 将其保存在 macOS Keychain；服务端只保存 token hash、所属 subject、installation、grant、创建时间、绝对过期时间和撤销时间。默认绝对有效期 30 天，配置只能缩短。所有 ROI 对象按 `tenant_id + owner_subject_id` 过滤；普通调用方只能读写自己的 run。运维跨用户访问必须使用单独 service role、工单原因和审计日志。

数据库中的 refresh token、Feishu access token、source A、final C 和 Sheet 标识使用公司 KMS envelope encryption。日志只允许记录 request ID、subject hash、run ID、状态、耗时和稳定错误码。数据库备份继承相同加密与删除策略。ROI_Test 的 tenant token 只能被 archive Worker 使用，API 和插件均不得取得。

## 通用 HTTP 契约

OAuth session 创建与 exchange 要求公司身份；exchange 还必须匹配 session owner 与 installation。exchange 后的全部 OAuth、ROI 读写接口同时要求有效 device session 和网关注入的同一公司 subject。所有写请求还要求 `Idempotency-Key` 和 `X-Plugin-Version`。幂等键作用域为 `tenant + subject + method + canonical_path`，保存 30 天；同 key 同 payload hash 重放原 status/body，同 key 不同 payload 返回 `409 idempotency_payload_conflict`。并发同 key 只有一个执行，其余等待后重放。

成功响应为业务对象。错误统一为：

```json
{"error":{"code":"stable_code","message":"safe_message","request_id":"uuid","retryable":false}}
```

校验错误返回 400，身份失败 401，权限失败 403，对象不存在 404，状态或幂等冲突 409，频控 429，上游或服务暂不可用 503。响应和日志不得包含 secret、token、authorization code、verifier、完整 source/C、Feishu 原始错误 body 或堆栈。

## OAuth 数据与接口

`oauth_sessions` 是五分钟、一次性的授权过程，字段至少为 `session_id`、owner、installation、redirect_uri、state_hash、code_challenge、requested_scopes、status`(pending|exchanging|complete|exchange_uncertain|expired)` 和 expires_at。

`oauth_grants` 是长期用户授权，字段至少为 `grant_id`、owner、Feishu user/open ID、actual_scopes、encrypted_access_token、access_expires_at、encrypted_refresh_token、token_version、status`(active|refreshing|refresh_uncertain|revoked)`、refresh_attempt_id 和 refresh_started_at。

`oauth_device_sessions` 连接 installation 与 grant，保存 device token hash、expires_at 和 revoked_at。`DELETE /v1/oauth/device-sessions/current` 只撤销当前设备，200 返回 `{"device_session_status":"revoked"}`。`DELETE /v1/oauth/grants/{grant_id}` 撤销该 owner 的全部设备并异步尝试 Feishu 远端撤销，202 返回 `{"grant_status":"revoked","remote_revoke_status":"pending"}`。远端不支持或失败时本地仍保持 revoked，并记录审计事件和最终 remote status。

### 创建 OAuth session

`POST /v1/oauth/sessions`

```json
{
  "installation_id":"local-random-id",
  "redirect_uri":"http://127.0.0.1:39641/l10n-tm-companion/oauth/callback",
  "code_challenge":"base64url-sha256",
  "code_challenge_method":"S256",
  "plugin_version":"1.4.0"
}
```

Broker 精确匹配 redirect allowlist，并固定请求当前 `FEISHU_USER_SCOPE` 的全部 scope 加 `offline_access`。不得接受客户端自定义缩减 scope。201 返回：

```json
{"session_id":"uuid","state":"opaque","authorize_url":"https://...","expires_at":"..."}
```

### 兑换授权码

`POST /v1/oauth/sessions/{session_id}/exchange`

```json
{"code":"opaque","state":"opaque","code_verifier":"opaque"}
```

Broker 校验 owner、installation、state、PKCE、redirect URI、过期和一次性状态，再交换 token。实际 scope 必须包含请求集合；缺任一项返回 `403 oauth_scope_missing` 并列出缺失 scope 名称。200 返回：

```json
{
  "grant_id":"uuid",
  "device_session_token":"opaque",
  "device_session_expires_at":"...",
  "user_access_token":"opaque",
  "access_expires_at":"...",
  "actual_scopes":["offline_access","..."],
  "user":{"open_id":"...","user_id":"...","name":"...","avatar_url":"..."}
}
```

exchange 前先把 session 从 `pending` 提交为 `exchanging`，再调用 Feishu，成功后在一个事务中写 grant、device session 并标记 complete。若进程在外部成功后、数据库提交前崩溃，恢复器将超时的 `exchanging` 标记 `exchange_uncertain`，返回 `409 oauth_reauthorization_required`；禁止重放 authorization code 或伪装成功。

### 获取或刷新 access token

`POST /v1/oauth/grants/{grant_id}/token` 使用 device session token，body 为 `{"known_token_version":3}`。服务端按 grant 串行处理：

1. 锁定并校验 owner、device、grant 和 scope；当前 access token 剩余超过 120 秒时直接返回缓存 token。
2. 将 grant 提交为 `refreshing`，写入唯一 attempt ID 和开始时间，再调用 Feishu；不得在数据库事务内等待外部网络。
3. 成功后在事务内原子保存新 access/refresh token、递增 token_version 并恢复 active。
4. 第二个并发请求等待第一个到达终态；active 时返回相同 token/version，uncertain 时要求重新授权，禁止再次消费 refresh token。
5. 进程在 Feishu 可能已轮换后崩溃时，恢复器把超时 `refreshing` 标为 `refresh_uncertain`。由于外部副作用无法与数据库原子提交，正确恢复方式是重新授权。

200 返回 `{"user_access_token":"opaque","access_expires_at":"...","token_version":4,"actual_scopes":["..."]}`。`refresh_uncertain`、远端撤销、scope 缺失或不可恢复 4xx 返回 401/403 和 `reauthorization_required=true`，客户端清理 access token 和 device session。

## ROI policy 与金额契约

每个 policy locale 记录 `policy_version`、`source_locale`、`target_locale`、`vendor`、`rate_catalog_key`、`currency`、`aipe_usd_per_word`、`t_only_usd_per_word`、`effective_from` 和 `rate_catalog_hash`。currency 当前必须为 USD；hourly、缺失、重复或跨 vendor 回退均使整份 policy 无法启用。policy 不提供 Starling project IDs。

服务端金额必须逐字段对齐 `lib/roi-calculation.js`：

- 使用与 `Intl.Segmenter('en')` 的 `isWordLike` 等价并经 golden fixtures 验证的英文计词。
- Score `0–75` 使用 AIPE 全词数；`(75,85]`、`(85,95]`、`(95,99]` 分别使用 T-only 的 60%、40%、20%；未分类 100% 保守使用 T-only 20%。
- A 和 C 分别按自己的真实 score 与文本词数计价，saving 允许为负，等于 Cost A − Cost C。
- 单行保留完整精度；聚合沿用当前 `sumMoney`，总和四舍五入到 10 位小数。完全无 complete line 时金额为 null。

服务端必须先从当前 JS 模块生成边界、Unicode、空文本、负 saving、缺费率和 incomplete golden fixtures；Python port 对每个字段零差异后才可进入 shadow compute。

## ROI API

### 创建并封存 A

`POST /v1/roi/runs` 一次性提交本 run 全部 source，数据库事务同时创建 run、items、A jobs 和 outbox 事件。请求失败不得留下半个 run。

```json
{
  "client_run_id":"stable-local-id",
  "started_at":"...",
  "sheet":{"document_token":"...","sheet_id":"...","source_range":"A2:A19"},
  "projects":[{"project_id":"278","name":"TikTok_main"}],
  "display_scope":{"source_locale":"en","target_locale":"fr","project_ids":["278"]},
  "items":[
    {"item_id":"row-2","source_key":"key","sheet_row":2,"source_text":"Text","source_hash":"sha256"}
  ]
}
```

服务端忽略客户端 vendor、rate 和全语言范围，按当前有效 policy 解析并固化 snapshot。`projects` 是用户在插件中选择的一至十个项目；服务端必须使用 Starling 的 subject-aware 项目发现能力重新取得当前可访问项目、source locale 与 target locales，并要求请求 ID/名称匹配且每个 policy locale 被全部已选项目支持。无法按用户身份验证项目权限时，`ASYNC_ROI_ENABLED` 不得打开。每个 locale scope 使用同一完整已验证 project ID 集合，由一次 Batch TM 返回跨项目最佳结果；禁止客户端或 Worker自行拼接不同项目结果。`display_scope.project_ids` 必须与已验证集合完全相等。`client_run_id` 在 owner 内唯一。201 返回：

```json
{
  "run_id":"uuid",
  "revision":1,
  "a_state":"queued",
  "review_state":"open",
  "c_state":"idle",
  "archive_state":"not_requested",
  "policy_version":"...",
  "locale_count":56,
  "accepted_item_count":18
}
```

run 创建后禁止新增、删除或修改 A item；源数据变化必须创建新 run。每个 Starling job 包含最多十条 source 和完整的一至十个已验证 project ID，实际请求数为 `locale_count × ceil(items/10)`。响应必须逐 source 完整映射，缺行只标记对应 line incomplete。

### 提交 confirmed C

`PUT /v1/roi/runs/{run_id}/items/{item_id}/final`

```json
{
  "expected_revision":1,
  "final_text":"Confirmed text",
  "final_text_hash":"sha256",
  "confirmed_at":"...",
  "sheet_write_receipt":{
    "document_token":"...",
    "sheet_id":"...",
    "row":2,
    "output_range":"B2:G2",
    "output_hash":"sha256"
  },
  "display_final_tm":{"score":87.5,"match_category":null}
}
```

服务端校验 run owner、item、Sheet identity、hash 和 `review_state=open`，在同一事务中保存 C、递增 revision、创建 C jobs 和 outbox。相同 final hash 重放已有结果；不同 hash supersede 该 item 旧 C result 并只重算该 item。`expected_revision` 过期返回 409。202 返回 `{"run_id":"uuid","item_id":"row-2","revision":2,"c_state":"queued"}`。

### 查询进度

`GET /v1/roi/runs/{run_id}` 使用同 owner 的 device session，返回创建响应中的全部状态字段、revision、policy version、item/locale counts、按稳定错误码聚合的 `failures:[{"code":"...","count":1}]` 和：

```json
{
  "coverage":{
    "expected_a_lines":1008,
    "complete_a_lines":1000,
    "expected_c_lines":896,
    "complete_c_lines":890,
    "complete_a_c_pairs":884
  },
  "archive":{"record_id":null,"requested_at":null,"completed_at":null}
}
```

line 粒度是 `item × policy locale`。C 分母只包含 Archive 封存时已 confirmed 的 item；封存前 UI 可用当前 confirmed 数动态预览。pending 不算 incomplete。Archive 后每个已受理 job 必须先到 `complete` 或 `terminal_failure`，terminal failure 和未 confirmed item 才进入最终 incomplete。

### 封存并归档

`POST /v1/roi/runs/{run_id}/archive` 请求为 `{"expected_revision":18,"requested_at":"..."}`。至少一个 confirmed item 才可受理。事务内锁定 run，把 `review_state` 改为 sealed、固化 confirmed/unconfirmed item、policy、A/C job 集合和 archive snapshot ID，并创建 archive job；`roi_archive_snapshots.run_id` 与 archive job 的 `run_id` 均有数据库唯一约束。此后 final PUT 返回 `409 roi_run_sealed`。同一 run 使用任意 Idempotency-Key 重复 Archive 时不得创建新 snapshot：处理中重放原 202，终态返回 200 和现有 archive 状态。

API 在不等待 Starling 或 Feishu 的情况下返回 202：

```json
{"run_id":"uuid","archive_state":"pending","snapshot_id":"uuid","status_url":"/v1/roi/runs/uuid"}
```

Archive Worker 等待 snapshot 中的 A/C jobs 到达终态，不把 pending 提前写成 incomplete。随后按现有固定契约写 `Run(writing) → Scopes → Items → Run(complete|incomplete)`。归档完成后 snapshot 不再修订；需要确认其他 item 时创建新 run。

## 状态、覆盖与归档防重

状态是四个正交字段：

- `a_state`: `queued|running|complete|partial`，partial 表示至少一个 A line terminal failure。
- `review_state`: `open|sealed`。
- `c_state`: `idle|queued|running|complete|partial`。
- `archive_state`: `not_requested|pending|writing|complete|incomplete|write_failed|write_uncertain`。

scope 是一个 policy target locale，使用该 run 固化的完整已验证 project ID 集合。某 scope 只有全部 source item 都有 complete A 且 Archive 时全部 source item 都 confirmed 并有 complete C 才是 complete；任一未确认或 terminal failure 使 scope incomplete。Run 的 `selected_scope_count` 是 policy locale 数，`complete_scope_count` 是 complete locale 数，coverage 显示二者。所有 complete item-locale pair 均进入 subtotal；任一 scope incomplete 时 Run 必须 incomplete。

`jobs` 表和业务写入在同一事务创建，既是 durable queue 也是 transactional outbox。任务唯一键至少为 `run_id + item_id + locale + stage + text_hash + policy_version`。Worker 使用 lease、单调递增 fencing token 和 `FOR UPDATE SKIP LOCKED`；每次外部写入前续租并核对 fencing token，失去 lease 的 Worker 不得继续。进程终止后 lease 到期可重领。只重试网络超时、429 和 5xx，并设置可配置上限；参数、协议、身份、权限、policy 和内容冲突直接 terminal failure。

ROI_Test 的字段、类型、表名、容量和 payload 以 `lib/roi-bitable-archive.js` 导出的 schema 与 builder golden fixtures 为迁移 oracle。每次写入前按 `Run ID` 精确查询 Runs：零条才创建，一条按 record ID 续写，多于一条立即 `duplicate_run_records` 失败。保存每个 Runs/Scopes/Items record ID、写入阶段与当前 fencing token；重试只补缺失记录。若 Run 创建请求结果不确定，状态改为 `write_uncertain`，后续 Worker 只能查询和对账，禁止再次创建；达到公司确认的 Feishu 一致性窗口仍无法判定时告警并等待人工处理。三表追加后任一超过 20,000 条时在创建 Run 前失败。

## Feature flags 与兼容

- `OAUTH_BROKER_ENABLED`：服务端和生产插件同时开启，依赖公司身份与 Feishu 发布完成。
- `ASYNC_ROI_ENABLED`：允许创建异步 run，依赖 policy、Starling 身份和 shadow parity。
- `ROI_ARCHIVE_WRITE_ENABLED`：允许写 ROI_Test，晚于 async shadow compute 开启。
- `LEGACY_LOCAL_SECRET_DEV_ONLY`：只存在开发构建，生产构建编译时必须为 false。

服务端还按 subject Pilot allowlist 逐步放量，并提供远程 kill switch。依赖关系为 archive write → async ROI → OAuth Broker。低于 API `min_plugin_version` 的旧插件返回 `426 plugin_upgrade_required`；生产环境不自动回退旧同步路径。

## 数据删除与审计

内容保留期由公司治理确认，未确认时生产 flag 保持关闭。建议 Worker 完成七天后清除 `roi_items.source_text`、`final_text` 和临时上游响应密文，保留内容 hash、词数、score、金额、policy snapshot、failure code、record ID 和审计事件。备份按相同期限或公司更严格规则过期。删除后只能审计计算输入摘要，不能恢复原文；需要更长排障窗口必须先获得治理批准。
