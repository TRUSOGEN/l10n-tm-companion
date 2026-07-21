# Starling 批量 TM API 测试方案

> **日期**：2026-07-13
> **作者**：Yegen Wu
> **背景**：翻译降本功能 — TM 语义复用与 AI 改写建议
> **关联插件**：L10n TM Companion (Chrome Extension v1.0.0)

## 当前验证结论（2026-07-13）

本节是目前可执行、已验证的测试路径；后文保留最初的调研计划，不能作为当前实现说明。

- **PPE Header 已确认**：请求必须携带 `x-use-ppe: 1` 与 `x-tt-env: ppe_openapi_integ`。
- **响应结构已确认**：`data[i]` 对应第 `i` 个 `sourceContents` 输入，候选数组首项是插件采用的最高分匹配；`total` 是所有输入候选数之和，不是输入条数。
- **功能已实测**：在线调试的 1 条和 3 条请求成功；2026-07-14 通过插件正式签名路径实测单次 10 条 `sourceContents` 成功返回 10 组结果，`Done→完成`、`Settings→隐私设置`、`Cancel→取消`。
- **上限已确认**：李明东于 2026-07-13 确认 `sourceContents` 和 `projectIds` 各最多 10 条。插件每批固定最多 10 条文案；项目数越多，搜索性能越受影响。
- **CLI Registry 限制**：`starling-cli api POST /corpus/tm/match/batch` 会因未注册 API 被 CLI Registry 拒绝。因此插件不猜测 `Authorization`、`Bearer`、Cookie 或自定义 AK/SK Header，而是复用已安装 `@byted/starling-agent-core` 的 `StarlingClient` 完成官方 `agw-auth` 签名。

### 可执行的真实测试

```bash
cd l10n-tm-companion
python3 testing/test-batch-api-v2.py
```

该脚本走插件的 `starling-bridge.py` 正式路径，默认以 PPE 查询 `Done`、`Settings`、`Cancel`，只打印脱敏后的业务摘要。它不会读取、输出或复制 AK/SK、Cookie、签名和请求 Header。

---

## 1. 背景

### 1.1 需求来源

LIVE CDO 团队正在推进「翻译降本」功能，核心流程：

1. 从飞书文档/电子表格中提取 ops 文案
2. 调 Starling TM 接口做语义相似度匹配，返回 Top 3 匹配
3. 相似度 ≥ 85% 的文案直接复用已有译文
4. 相似度 < 85% 的文案由 AI 改写后人工审核

### 1.2 向 Starling 团队提出的问题

| # | 问题 | Starling 回复 |
|---|------|--------------|
| Q1 | 单次 10 条检测太少，能否提高上限或支持异步？ | 可以在 PPE 测试：https://starling.bytedance.net/open/content/10573/nn28t5vo ；10 条上限需等明东休假回来确认 |
| Q2 | 能否同时指定多个 projectID？ | 已支持，最多一次输入 10 个 projectId |
| Q3 | 能否拉取整个项目的文案库做 AI 训练？ | 你说的是 https://starling.bytedance.net/open/content/10573/yj8okyiz 这个接口吗？ |

### 1.3 Starling 提供的两个 API

**API 1 — 记忆库匹配率（批量 TM Match）**

- 端点：`POST https://starling.bytedance.net/gateway/openapi/corpus/tm/match/batch`
- 文档：https://starling.bytedance.net/open/content/10573/nn28t5vo
- 参数：
  - `projectIds`（必填，最多 10 个项目 ID）
  - `sourceContents`（必填，正式最大条数尚待 Starling 确认；插件当前保守按 3 条）
  - `sourceLang`（必填，如 `en`）
  - `targetLang`（可选，如 `zh`）
  - `projectType`（可选，默认 1）
  - `offset`（可选）
  - `limit`（可选，默认 3，每条文案返回的匹配数）
  - `leastScore`（可选，最小相似度）
  - `topTMPriority`（可选）
- 返回：`data` 数组，每个元素是该文案的匹配数组，包含 `{id, tmId, score, source, target, sourceLang, targetLang, updater, keywords, hightlightSource, tmItemType, createdAt, updatedAt}`

**API 2 — 记忆库导出（TM Export）**

- 端点：`GET https://starling.bytedance.net/gateway/openapi/corpus/tm/text/export`
- 文档：https://starling.bytedance.net/open/content/10573/yj8okyiz
- 参数：`id`（必填，TM ID）、`fileType`（必填，`xlsx`/`csv`）
- 异步：返回 task ID 供后续查询
- **注意**：按 TM ID 导出，不是按 project ID

### 1.4 PPE 测试环境

Starling 团队要求在 PPE 环境测试，需要带两个 header：

```
x-use-ppe: 1
x-tt-env: ppe_openapi_integ
```

---

## 2. 插件现状分析

### 2.1 架构概览

```
飞书文档页面
    ↓ (content.js 抓取文案)
popup.js (弹窗 UI)
    ↓ (chrome.runtime.sendMessage)
background.js (Service Worker)
    ↓ (chrome.runtime.sendNativeMessage)
starling-bridge.py (Native Messaging Host, Python)
    ↓ (subprocess: starling-cli api GET /corpus/tm/match)
Starling API
```

### 2.2 关键文件

| 文件 | 作用 |
|------|------|
| `manifest.json` | Chrome Extension MV3 配置，声明 nativeMessaging 权限 |
| `background.js` | Service Worker，转发消息到 Native Host 或 Content Script |
| `content.js` | 注入飞书页面，抓取文案 |
| `popup.js` | 弹窗 UI，协调查询 → AI 改写 → 回填流程 |
| `options.js` | 设置页，项目多选、飞书凭证、LLM 配置 |
| `lib/starling-tm.js` | JS 封装层，`searchTM()` / `searchKeys()` / `pingNativeHost()` / `listProjects()` |
| `native-host/starling-bridge.py` | Python 桥接脚本，调用 starling-cli |
| `lib/feishu-sheets.js` | 飞书电子表格读写 |
| `lib/ai-translate.js` | AI 改写逻辑 |

### 2.3 当前 TM 查询方式（旧 API）

`starling-bridge.py` 中的 `search_tm()` 函数：

- 对每条文案单独调用 `starling-cli api GET /corpus/tm/match`
- 参数：`projectId`（单个）、`sourceLocale`、`targetLocale`、`sourceText`、`leastScore`、`limit`
- 用 `ThreadPoolExecutor` 并发（最多 8 线程），但仍需为每条文案 spawn 一个 CLI 进程
- 单次最多处理 10 条文案（逐条并发），不支持跨项目搜索

```python
# 当前命令（旧 API，逐条查询）
starling-cli api GET /corpus/tm/match \
  --params '{"projectId":385,"sourceLocale":"en","targetLocale":"zh",
             "sourceText":"Done","leastScore":0,"limit":1}'
```

### 2.4 新旧 API 对比

| 维度 | 旧 API | 新 API（批量） |
|------|--------|---------------|
| HTTP 方法 | `GET` | `POST` |
| 端点 | `/corpus/tm/match` | `/corpus/tm/match/batch` |
| 每次查询 | 1 条文案 × 1 个项目 | 最多 10 条文案 × 10 个项目 |
| 调用方式 | starling-cli 逐条并发 | 一次 POST 批量返回 |
| 多项目 | 不支持 | 原生支持 `projectIds` 数组 |
| 返回 Top N | `limit` 参数 | `limit` 参数（默认 3） |
| PPE 支持 | 未测试 | 需带 `x-use-ppe` + `x-tt-env` header |

---

## 3. 原始测试方案（历史记录，请勿执行）

> 该方案写于接口可用性尚未确认时，其中的 `--params`、`--body`、`--header` 组合和直接 HTTP 凭证猜测已经被实际验证否定。当前仅使用本文开头的 `testing/test-batch-api-v2.py` 与插件正式 Bridge 路径进行测试。

### 3.1 测试策略

分两步走：

1. **第一步：直接测试 API 可用性**（不改插件，用 Python 脚本验证）
2. **第二步：改插件集成新 API**（确认 API 可用后再改代码）

### 3.2 第一步：直接测试新批量 API

#### 3.2.1 测试脚本

使用测试脚本 `test-batch-api-v2.py`，自动执行三个步骤：

**Step 1 — 探测 CLI 能力**

运行 `starling-cli api --help` 和 `starling-cli api POST --help`，确认：
- CLI 是否支持 `POST` 方法
- CLI 是否支持 `--headers` 参数（PPE 环境必须带自定义 header）
- CLI 是否支持 `--body` 参数（POST body）

**Step 2 — 通过 CLI 测试批量 API**

尝试 4 种参数组合：

| 尝试 | 命令格式 | 说明 |
|------|----------|------|
| 1 | `--params '{...}' --headers '{...}'` | JSON 格式参数 + header |
| 2 | `--params '{...}' --header x-use-ppe=1 --header x-tt-env=ppe_openapi_integ` | 单键值对 header |
| 3 | `--params '{...}'`（不带 PPE header） | 测 API 基本可达性 |
| 4 | `--body '{...}' --headers '{...}'` | 用 --body 传 POST body |

**Step 3 — 直接 HTTP 调用**

如果 CLI 方式全失败，读 `~/.starling-cli/.starlingrc.json` 中的凭证，用 Python `urllib` 直接 POST：

```
POST https://starling.bytedance.net/gateway/openapi/corpus/tm/match/batch
Content-Type: application/json
x-use-ppe: 1
x-tt-env: ppe_openapi_integ
Authorization: Bearer <token>  (或 X-Api-Key / X-App-Id)
```

#### 3.2.2 测试参数配置

脚本顶部修改：

```python
# 改成你自己的项目 ID 和测试文案
TEST_PROJECT_IDS = [385]                      # TikTok_Client 项目
TEST_TEXTS = ['Done', 'Settings', 'Cancel']   # 测试文案
TEST_SOURCE_LANG = 'en'
TEST_TARGET_LANG = 'zh'
TEST_LIMIT = 3                                 # Top 3 匹配
```

#### 3.2.3 运行方式

```bash
# 下载脚本后运行
python3 test-batch-api-v2.py
```

#### 3.2.4 预期结果

脚本会输出完整的测试过程，最终总结：

- **成功**：显示 API 返回的匹配结果（score、source、target）
- **失败**：列出所有尝试过的方案和错误信息

### 3.3 第二步：根据测试结果决定集成方式

| 测试结果 | 集成方式 | 改动量 |
|----------|----------|--------|
| CLI 支持 POST + `--headers` | 在 `starling-bridge.py` 加 `search_tm_batch()` 函数，替换逐条查询 | 小 |
| CLI 支持 POST 但不支持 `--headers` | 确认 PPE header 是否必须；如不必须可直接用 | 小 |
| CLI 不支持 POST | 在 `starling-bridge.py` 加 HTTP 直连路径，绕过 CLI | 中 |

### 3.4 第三步：改插件集成

确认 API 可用后，改动涉及 3 个文件：

#### 3.4.1 `starling-bridge.py` — 新增 `search_tm_batch()`

新增函数，调用 `POST /corpus/tm/match/batch`：

```python
def search_tm_batch(message):
    """批量 TM 查询（新 API）。
    
    一次 POST 最多 10 条文案 × 10 个项目。
    返回格式与旧 search_tm 兼容（每条文案一条结果）。
    """
    texts = message.get('texts', []) or []
    project_ids = message.get('project_ids', [DEFAULT_PROJECT_ID])
    source_lang = message.get('source_lang', 'en')
    target_lang = message.get('target_lang', 'zh')
    least_score = message.get('least_score', 0)
    limit = message.get('limit', 3)
    cli = resolve_cli(message.get('cli_path'))
    use_ppe = message.get('use_ppe', False)  # PPE 开关

    # 分批：API 限制每次最多 10 条文案
    BATCH_SIZE = 10
    all_results = []
    
    for i in range(0, len(texts), BATCH_SIZE):
        batch = texts[i:i + BATCH_SIZE]
        body = {
            'projectIds': project_ids[:10],
            'sourceContents': batch,
            'sourceLang': source_lang,
            'targetLang': target_lang,
            'limit': limit,
            'leastScore': least_score,
        }
        
        headers = {}
        if use_ppe:
            headers['x-use-ppe'] = '1'
            headers['x-tt-env'] = 'ppe_openapi_integ'
        
        # 构造 CLI 命令（待第一步测试确认具体参数格式）
        cmd = [cli, 'api', 'POST', '/corpus/tm/match/batch',
               '--params', json.dumps(body, ensure_ascii=False)]
        if headers:
            cmd += ['--headers', json.dumps(headers)]
        
        # 执行并解析...
        # （具体实现根据第一步测试结果确定）
    
    return {'results': all_results}
```

在 `main()` 的 action 分发中添加：

```python
if action == 'search_tm_batch':
    send_message(search_tm_batch(message))
```

#### 3.4.2 `lib/starling-tm.js` — 新增 `searchTMBatch()`

```javascript
export async function searchTMBatch(texts, sourceLang, targetLang, opts = {}) {
  const payload = {
    action: 'search_tm_batch',
    texts: texts || [],
    source_lang: sourceLang || 'en',
    target_lang: targetLang || 'zh',
  };
  if (opts.cliPath) payload.cli_path = opts.cliPath;
  if (Array.isArray(opts.projectIds) && opts.projectIds.length) {
    payload.project_ids = opts.projectIds.map(Number).filter(n => !isNaN(n));
  }
  if (opts.usePPE) payload.use_ppe = true;

  const response = await chrome.runtime.sendMessage({
    action: 'native_search_tm',
    payload,
  });

  if (chrome.runtime.lastError) {
    throw new Error(chrome.runtime.lastError.message);
  }
  if (response?.error) {
    throw new Error(response.error);
  }
  return response?.results || [];
}
```

#### 3.4.3 `options.js` — 无需修改

设置页已支持多项目选择（`starlingProjectIds` 数组），无需改动。

#### 3.4.4 `popup.js` — 调用新函数

将 TM 查询调用从 `searchTM()` 改为 `searchTMBatch()`，传入 `projectIds` 数组：

```javascript
// 旧代码
const results = await searchTM(texts, sourceLang, targetLang, { 
  cliPath, projectId 
});

// 新代码
const results = await searchTMBatch(texts, sourceLang, targetLang, {
  cliPath,
  projectIds,  // 从 storage 读取的 starlingProjectIds 数组
  usePPE: true, // PPE 测试期间开启
});
```

---

## 4. 完整测试流程（Step by Step）

### 4.1 环境准备

1. 确认 `starling-cli` 已安装并登录：
   ```bash
   starling-cli login
   # 确认 ~/.starling-cli/.starlingrc.json 存在
   ```

2. 确认 Native Messaging Host 已注册（Chrome 能找到 `starling-bridge.py`）

3. 在 Chrome 中加载扩展（`chrome://extensions` → 开发者模式 → 加载已解压的扩展）

### 4.2 API 测试

1. 下载测试脚本 `test-batch-api-v2.py`
2. 修改脚本顶部的 `TEST_PROJECT_IDS` 和 `TEST_TEXTS`
3. 运行：`python3 test-batch-api-v2.py`
4. 查看输出，确认 API 是否可用

### 4.3 插件集成测试

1. 根据第一步结果修改 `starling-bridge.py`（新增 `search_tm_batch` action）
2. 修改 `lib/starling-tm.js`（新增 `searchTMBatch` 函数）
3. 修改 `popup.js`（调用新函数）
4. 在 Chrome 扩展页面点击「刷新」重新加载扩展
5. 打开飞书文档页面，点击扩展弹窗
6. 提取文案 → 触发 TM 查询 → 验证返回结果

### 4.4 多项目测试

1. 在设置页（options.html）点击「Load project list」加载项目
2. 选择多个项目（如 TikTok_Client + 其他 LIVE 项目）
3. 保存设置
4. 在飞书文档页面提取文案并查询
5. 验证返回结果是否包含多个项目的 TM 匹配

---

## 5. 关于 Q3（TM 导出 / AI 训练）的回复建议

Starling 团队问「你说的是 https://starling.bytedance.net/open/content/10573/yj8okyiz 这个接口吗？」

**分析**：

- API 2（`GET /corpus/tm/text/export`）是按 **TM ID** 导出，不是按 project ID
- 我们的需求是「拉取整个 project 的文案库」用于 AI 训练
- 这两者不完全匹配——需要先知道 project 对应哪些 TM ID，才能导出

**建议回复**：

> 感谢确认！关于 Q3，我看了一下 `yj8okyiz` 这个接口，它是按 TM ID 导出的，不是按 project ID。我们的需求是拉取整个 project 的源文案 + 译文对，用于 AI 模型训练。想确认：
> 
> 1. 一个 project 是否对应一个或多个 TM ID？如何获取 project 下所有 TM ID？
> 2. 有没有直接按 project ID 导出全部文案的接口？
> 3. 如果只能走 TM 导出，那导出的文件里是否包含源文案 + 译文 + key 的完整信息？
> 
> 另外 Q1 和 Q2 我们先在 PPE 环境测试批量 API，测试结果会同步给你。

---

## 6. 测试脚本下载

| 脚本 | 说明 |
|------|------|
| `test-batch-api-v2.py` | 完整版（推荐）— 探测 CLI 能力 + 4 种 CLI 调用方式 + HTTP 直连 |
| `test-batch-api.py` | 精简版 — CLI 调用 + HTTP 直连 |

### 使用方法

```bash
# 1. 下载脚本
# 2. 修改测试参数（项目 ID、文案）
# 3. 运行
python3 test-batch-api-v2.py

# 4. 把输出截图发回来，我根据结果帮你改插件代码
# 5. 如果全部失败，把输出截图发给 Starling 团队
```

---

## 7. 风险与注意事项

1. **PPE 环境数据**：PPE 环境的 TM 数据可能与生产环境不同，测试时不要期望匹配率一致
2. **starling-cli 版本**：当前版本 `1.1.16`，如果 CLI 不支持 POST，可能需要升级
3. **鉴权方式**：`starling-cli` 的 AK/SK 签名算法未公开文档，直接 HTTP 调用可能需要联系 Starling 团队获取签名方式
4. **API 限流**：批量 API 的限流策略未知，测试时注意不要高频调用
5. **返回格式兼容**：新 API 返回的字段（`sourceContents` → `data` 数组）与旧 API（`data.data` 数组）结构不同，`starling-bridge.py` 的解析逻辑需要适配
6. **飞书凭证安全**：`options.js` 中硬编码了共享飞书 App Secret，注释中已标注风险，后续应迁移到后端服务

---

## 8. 下一步行动清单

- [ ] 下载并运行 `test-batch-api-v2.py`，记录输出
- [ ] 如果 API 测试通过 → 联系我改插件代码
- [ ] 如果 API 测试失败 → 截图发给 Starling 团队，确认 CLI 能力和鉴权方式
- [ ] 给 Starling 团队回复 Q3（TM 导出按 TM ID 不是 project ID 的问题）
- [ ] 等明东休假回来确认 Q1（10 条上限能否提高）
