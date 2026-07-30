# L10n TM Companion — 2026-06-29 配置体验 + DeepSeek + 英化

> 上一份：`HANDOFF-2026-06-29-install-flow.md`（安装流程 + native host 闭环）。
> 本轮聚焦：设置页对同事太技术化 → 简化；DeepSeek 接入（火山方舟）；插件 UI 英化；新打包覆盖桌面 zip。
> ⚠️ TM key 功能已回退（见第四节，starling 数据模型拿不到）。
> 代码位置：`/Users/bytedance/my-project/l10n-tm-companion/`

---

## 〇、本轮一句话总结

**设置页大简化（CLI 路径折叠、AK/SK 去本页、LLM Provider 一键切换）；DeepSeek 接火山方舟并真机跑通；插件 UI 全英化；新打包覆盖桌面 zip。TM key 功能已回退（starling 不支持）。**

---

## 一、改动清单（按主题）

### 1.1 设置页简化（针对同事反馈"太技术化"）

| # | 文件 | 改动 | 目的 |
|---|------|------|------|
| 1 | `options.html` / `options.js` | Starling 区文案改清楚：AK/SK 自己去申请 + `starling-cli login` 配，不在本页填 | 同事不再困惑"AK/SK 填哪" |
| 2 | `options.html` | Starling CLI 路径移入「高级」折叠区，留空自动用 PATH | 同事根本不用看这字段 |
| 3 | `options.html` | 「测试 Native Host」按钮 → 「测试连接」 | 大白话 |
| 4 | `options.js` | Starling 项目加载文案、测试结果文案英化 | 配合英化 |
| 5 | `USAGE-GUIDE.md` | Step 3-4 重写、FAQ 更新（安装、AI 失败、给同事用） | 文档对齐 |

### 1.2 LLM Provider 一键切换（解决"字段太多看不懂"）

| # | 文件 | 改动 | 目的 |
|---|------|------|------|
| 6 | `options.html` | 加 LLM 提供商下拉：Claude / DeepSeek / 自定义；选完自动填 endpoint/model | 同事只填 API Key |
| 7 | `options.js` | `LLM_PRESETS` 表 + `onProviderChange` 切换自动填；KEYS 加回 `llmProvider` | 一键切换 |
| 8 | `options.js` | 删冗余的独立 Provider 选择（代码本有 auto 按协议判断） | 简化 |

### 1.3 DeepSeek 接入（火山方舟，真机跑通）

| # | 文件 | 改动 | 目的 |
|---|------|------|------|
| 9 | `options.js` | DeepSeek preset 配火山方舟：`ark.cn-beijing.volces.com/api/v3/chat/completions` + `deepseek-v4-flash-260425` | 用户的 ark key 是火山方舟的，非 DeepSeek 官方 |
| 10 | `lib/ai-translate.js` | `callLLM` / `callLLMViaBackground` 协议判断修对：custom 不传 provider 按 endpoint 猜，claude 明确走 Anthropic，deepseek 走 OpenAI 兼容 | 避免误判协议 |
| 11 | `popup.js` | config 兜底恢复 claude 一致（provider=claude 配套 Claude endpoint/model） | 避免 provider/endpoint 不一致 |
| 12 | `native-host/starling-bridge.py` | `LLM_TIMEOUT` 60→120s | 火山偶发卡死，60s 太紧 |
| 13 | `lib/ai-translate.js` | 单条失败自动重试一次 | 兜火山偶发 read timeout |

### 1.4 TM key 功能 — 已回退（starling 数据模型不支持）

**结论：starling 的 TM match 接口（`/corpus/tm/match`）返回里没有 keyText（语义化 key），TM 记忆库不绑 key。无法实现"写回 TM 命中条目的 key"。已全部回退。**

排查经过：
1. dump `/corpus/tm/match` 完整 raw，字段只有：`id`/`tmId`/`score`/`source`/`target`/`updater`/`keywords`/`hightlightSource`/`tmItemType`/`createdAt`/`updatedAt`。**没有 keyText**。
2. 语义化 key（如 `ttlsMerchant_..._msg1`、`Fifa_comment_discover`）是**源文案的 keyText**，只有 namespace 源文案接口（`/project/namespace/sources`）才有。
3. 尝试用 TM 命中 source 去 namespace sources 反查 keyText——前 5 个 namespace 全 0 命中（TM 记忆是去重历史记忆，可能来自已删/别的项目文案，不在当前 namespace）。
4. TM match 返回的数字 `id`（1011906）在 starling 界面也搜不到对应 TM 条目，不可定位。
5. 用户真实诉求是"用 TM 优化自己的 original"——这个流程扩展本来就在做（`buildRewritePrompt` 把 `tm_match` 译文喂给 AI 改写原文），**不需要 key**。

已回退的改动（曾实现后撤销）：
- `starling-bridge.py` 的 `tm_key` 字段
- `lib/tm-bm25.js` 的 `tm_key`（5 处）
- `popup.js` 的 tm_key 透传 + `tmKeySection` 函数 + Copy 按钮绑定 + focus 视图 key 行
- `lib/feishu-sheets.js` 的 I 列（COLUMN_MAP / REQUIRED_HEADERS / writeToSheet B1:I1 / 修复表头 A1:J1）
- `test/feishu-sheets.test.js` 的断言全部还原（13/9/A1:I1/BCDEFH/6）
- `options.html` 列布局说明去掉 Col I

⚠️ 接手者别再尝试给 TM match 结果加 keyText——starling 数据模型层面就拿不到。要 key 只能从源文案接口拿（按 namespace 拉，且要原文在自己 namespace 里才有）。

### 1.5 插件 UI 英化

| # | 文件 | 改动 | 范围 |
|---|------|------|------|
| 20 | `options.html` | 整页英化（标题、字段、按钮、列布局说明） | 用户可见文案 |
| 21 | `popup.html` | 整页英化（Workflow/Results、步骤、按钮、focus 导航） | 用户可见文案 |
| 22 | `popup.js` | showStatus/showProgress/showError、卡片按钮（Use AI/Use TM/Manual/Focus）、写回提示、健康检查全英化 | 用户可见文案 |
| 23 | `background.js` | 3 处用户可见 error 英化（No active tab / Cannot communicate / 注入失败） | 用户可见文案 |
| 24 | `content.js` | docTitle 兜底「飞书文档」→「Feishu doc」 | 用户可见文案 |

**保留中文**：代码注释、console.log、语言选项名（中文/日本語/한국어）、`双击安装.command` 文件名。

---

## 二、关键决策与现状

### 2.1 DeepSeek = 火山方舟（不是 DeepSeek 官方）
- 用户的 key `ark-...` 是火山引擎方舟格式，不是 DeepSeek 官方 key。打 DeepSeek 官方 endpoint 返回 401 invalid。
- 火山方舟 endpoint：`https://ark.cn-beijing.volces.com/api/v3/chat/completions`（鉴权通过）。
- 模型用**模型 id**（如 `deepseek-v4-flash-260425`），不是接入点 ep-xxx，也不是通用名 `deepseek-chat`。
- 真机验证：bridge → 火山方舟 → deepseek-v4-flash-260425 返回 `bridge works` ✅ 整条链路通。

### 2.2 TM key — 拿不到（已回退，详见 1.4）
- starling 的 `/corpus/tm/match` 返回**不含 keyText**（语义化 key）。
- 语义化 key（`Fifa_comment_discover` 等）只在 `/project/namespace/sources` 的源文案里有。
- 用户真实诉求"用 TM 优化原文"靠 TM 译文 `tm_match` 喂 AI，不依赖 key，该流程正常工作。

### 2.3 协议判断逻辑
- `provider='claude'` → Anthropic 格式（x-api-key + anthropic-version）
- `provider='deepseek'` → OpenAI 兼容格式（Bearer + {model,messages,temperature}）—— DeepSeek/火山方舟都认这个
- `provider='custom'` → 不传 provider，bridge 按 endpoint 含 'anthropic' 猜，灵活兜底

### 2.4 LLM 超时 + 重试
- 火山方舟偶发 read timeout（60s 一个字节没返回），不是模型慢（实测连发 10 条最慢 6.1s）。
- 解法：超时提 120s + 单条失败自动重试一次（重试通常即恢复）。

---

## 三、接手者需知

### 3.1 表格列布局（A-H，无 I 列）
- A: Original Source Segment（输入）
- B: Best TM Match ｜ C: Orig Match % ｜ D: Rewritten Segment
- E: New Match % ｜ F: Reached 75%? ｜ G: CD review valid?（留空人工）｜ H: Comment

writeToSheet 无条件补表头 B1:H1（幂等），修复表头写 A1:I1。
（TM key 的 I 列已回退，见 1.4）

### 3.2 LLM 配置现在只要选 Provider + 填 API Key
- 选 DeepSeek → endpoint/model 自动填火山方舟的，同事只填 `ark-` key。
- 想换模型改「模型名」即可（火山方舟用模型 id，在控制台「模型」页复制）。
- Claude preset 默认 `claude-sonnet-4-6`（代码默认值，非新写调用，按 memory 提示最新可用 Opus 是 4.8，但这里是用户自填默认不改行为）。

### 3.3 英化范围
只 UI 可见文案。代码注释、console.log、错误处理内部逻辑保留中文。改文案时别动 console.log（开发者诊断用）。

---

## 四、待真机验证

| 项 | 代码状态 | 待验证 |
|----|---------|--------|
| 写回表头落盘 | ✅ 105/0 | ⚠️ 真机写回确认 B1:H1 落盘 |
| 项目卡片 UI 点选 | ✅ | ⚠️ 真机点「加载项目列表」+ 选卡片 |
| DeepSeek AI 改写 | ✅ bridge 链路通 | ⚠️ 真机跑 Orig<75 条目确认 AI 改写写入 D 列 |

---

## 五、当前状态总览

| 项 | 状态 |
|----|------|
| 设置页简化 | ✅ CLI 折叠、AK/SK 去本页 |
| LLM Provider 下拉 | ✅ Claude/DeepSeek/自定义，一键切换 |
| DeepSeek 火山方舟 | ✅ preset 配好，bridge 链路真机通 |
| AI 超时/重试 | ✅ 120s + 单条重试 |
| TM key 写回 | ❌ 已回退（starling 不支持，见 1.4） |
| UI 英化 | ✅ options/popup/background/content 可见文案 |
| 测试 | ✅ 312/0（feishu 105 + e2e 68 + new-match 49 + content 38 + bm25 25 + errors 14 + bitable 13） |
| 打包 | ✅ `~/Desktop/L10n-TM-Companion-20260626.zip` 已覆盖（含全部本轮改动，不含已回退的 TM key） |

---

## 六、最大教训（本轮新增）

1. **`ark-` key 是火山方舟，不是 DeepSeek 官方**。DeepSeek 官方 key 是 `sk-`，打官方 endpoint；火山方舟 key `ark-` 要打 `ark.cn-beijing.volces.com`。两个都是 OpenAI 兼容，但 endpoint + key 必须配套，混用 401。
2. **火山方舟用模型 id 不是接入点 ep-**。模型列表能拉到（`GET /api/v3/models`），用 id 当 model 字段。
3. **starling 的 TM match 不返回 keyText**。语义化 key（`Fifa_comment_discover` 等）是源文案的 keyText，只有 `/project/namespace/sources` 才有；TM 记忆库（`/corpus/tm/match`）不绑 key，返回的数字 `id` 在 starling 也搜不到对应条目。**别再尝试给 TM 命中结果加 key**——数据模型层面拿不到。用 TM 优化原文靠 TM 译文 `tm_match` 喂 AI，不依赖 key。
4. **英化只动可见文案，注释别动**。console.log 也不算用户可见，留着中文方便诊断。
5. **协议判断要处理 custom 的歧义**。custom 可能填 anthropic endpoint，不能简单 `provider != claude → OpenAI`，要按 endpoint 猜。

---

## 七、打包信息

- 位置：`~/Desktop/L10n-TM-Companion-20260626.zip`（82 KB，31 文件）
- 含：设置页简化 + Provider 下拉 + 火山方舟 preset + 英化 + AI 超时重试（TM key 已回退，不含）
- 排除：test/、docs/、LOOP_*、SETUP-GUIDE.md、TUTORIAL.md、.pem、.DS_Store
- 中文文件名 `双击安装.command` 解压正常（macOS unzip 按 UTF-8 解出）
