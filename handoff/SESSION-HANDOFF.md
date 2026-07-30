# SESSION-HANDOFF — 对话交接文档

> **新对话必读**。本文档记录了 L10n TM Companion 项目从启动到 2026-06-30 的完整进展、所有关键决策、环境配置和操作历史。新开对话时，读完此文档即可无缝继承上下文。
>
> 最后更新：2026-07-03（多项目支持 + 搜索容错 + 表格 J 列项目来源）　|　状态：**✅ 真机端到端已跑通；popup 显示 key；2026-07-03 新增多项目选择+自定义新增、搜索词大小写/符号容错、表格 J 列展示项目来源，代码全过测（319/0）待真机刷新验证**

---

## 0. 给新对话的第一句话

> 「我已经读了 SESSION-HANDOFF.md。项目 L10n TM Companion 是 TM 优化工具：从飞书电子表格读英文原文→Starling TM 查 Best TM Match+Orig%→AI 改写原文→文本相似度算 New Match%→写回表格；同时按原文查 Source String Key 写 I 列（/project/search 接口）。代码全过测试，真机端到端已跑通（sheets 权限+协作者+端到端验证都过了）。请告诉我你想继续做什么。」

如果你是新对话的 Claude，请：① 先读 `/Users/bytedance/my-project/agent.md`（用户要求每次对话都读，并遵守其「～」输出风格）；② 再读本文件；③ 读 `handoff/IMPLEMENTATION_PLAN.md` 顶部的「实施进度总览」。

---

## 1. 项目背景

- **项目**：L10n TM Companion（Chrome MV3 扩展）
- **一句话**：飞书文档抓原文 → Starling TM 查匹配 → AI 翻译推荐 → AI vs TM 对比 → 写入飞书多维表格
- **代码位置**：`/Users/bytedance/my-project/l10n-tm-companion/`
- **用户**：wuyegen@bytedance.com，字节 TikTok LIVE-Design-LIVE-Content Design and Localization (CD&LOC) 实习生，工号 7771760
- **agent.md 身份**：L10n Readiness Agent，Localization Readiness & Translation Brief Assistant，核心工具就是 Starling / Lark Docs / Tracker，与扩展完全对口
- **设计依据**：`docs/superpowers/specs/2026-06-23-l10n-tm-companion-design.md` + `handoff/IMPLEMENTATION_PLAN.md`

---

## 2. 当前完成状态（一句话总览）

**✅ 真机端到端已跑通（2026-06-30）。** 用户已开通 `sheets:spreadsheet` 权限+重新发布、应用已加为电子表格协作者、端到端验证通过。本轮（2026-06-30）新增「按原文查 Source String Key」能力：bridge `search_key` action 走 `/project/search`（源文案搜索，带 key，非 TM match），实测 `Official Videos`→`music_video_official`、`Done`→`tiktoktv_matchCode_halfsheet_cta` 精确命中，写 I 列。测试：feishu-sheets 108/0、e2e 68/0、search_key 13/0，全过。待用户提供 merchant 项目 ID 验证 KTP key。

### 2.1 代码完成度

| 文件 | 状态 | 说明 |
|------|------|------|
| `manifest.json` | ✅ | MV3，含 nativeMessaging/storage/scripting 权限；host/content matches 已加 `larkoffice.com`（字节内部域名）+ `/wiki/*` |
| `background.js` | ✅ | Service Worker，透明转发 popup↔content、popup↔native host（payload 透传，含 projectId/source_lang/target_lang） |
| `content.js` | ✅ | 飞书文档抓取（批量/选中/上下文/UI 过滤），选择器待真机验证（已加 wiki/base 域名匹配） |
| `lib/starling-tm.js` | ✅ | JS 封装，含 pingNativeHost；searchTM 透传 source_lang/project_id |
| `lib/ai-translate.js` | ✅ | 含 `translateWithAI`(旧翻译，保留) + **`rewriteSourceWithAI`/`buildRewritePrompt`**(TM优化改写原文，核心) |
| `lib/diff.js` | ✅ | compareAIvsTM 基于 Orig/New Match% 语义对比；**新增 `textSimilarity`**(Jaccard+Levenshtein，算 New Match%) |
| `lib/feishu-sheets.js` | ✅ **新** | **电子表格 API 封装**（替代 bitable）：读 A 列原文、按列写 B-H、URL 解析、连接测试 |
| `lib/feishu-bitable.js` | ✅ 保留 | tenant_access_token(被 sheets.js 复用) + 原始 Bitable 读写（已弃用但留作备选） |
| `popup.html/css/js` | ✅ | 卡片渲染/进度/写入；**新增「📋 从当前表格读原文」按钮**（表格驱动入口）；主流程是 TM 优化工作流 |
| `options.html/css/js` | ✅ | Starling(Source Lang/Project ID) + LLM + 飞书凭证 + **Sheets URL 贴链接自动解析** + 列布局说明 |
| `native-host/starling-bridge.py` | ✅ | 真实 `starling-cli api GET /corpus/tm/match`；返回 tm_match/tm_source/similarity/origin |
| `native-host/register-native-host.sh` | ✅ | macOS 一键注册（已对用户扩展 ID bgnakecphongbinlnmgnhoefgjecdang 注册过） |
| `icons/icon{16,48,128}.png` | ✅ | Python 生成 |
| `test/e2e-logic.test.js` | ✅ | **49 用例全过**（diff + textSimilarity + ai-translate 改写 + 端到端 pipeline） |
| `test/feishu-bitable.test.js` | ✅ | **13 用例全过**（token 缓存/切批/新字段映射） |

### 2.2 测试验证情况

```
node test/e2e-logic.test.js      → 49 通过 / 0 失败
node test/feishu-bitable.test.js → 13 通过 / 0 失败
node test/feishu-sheets.test.js → 20 通过 / 0 失败（2026-06-25 新增，覆盖错位回归）
python3 -m py_compile native-host/starling-bridge.py → OK
所有 JS 文件 node --check → OK
bridge 端到端实测（Native Messaging 协议）：
  Done → 完成完成(100%) / Confirm → 確認(100%) / Cancel → 取消(100%)
bridge 返回 tm_source 字段（TM 库原文，算 New Match 用）已验证
```

### 2.3 未完成 / 待验证（⚠️ 本轮结束时的真实状态）

**✅ 2026-06-30：真机端到端已跑通。** 用户已开通 `sheets:spreadsheet` 权限+重新发布、应用已加为电子表格协作者、端到端验证通过。之前的三大阻塞全部解除。

**2026-06-30 新增能力：按原文查 Source String Key**
- 用户反馈「TM 找不到对应文案的 Key，starling 的人说 TM 有 key」→ 根因：**之前 bridge 用错了接口**。`/corpus/tm/match` 返回的 TM 条目不存 key（只有 source/target/score/updater）；key 在源文案层，必须用 `/project/search`（searchScope=0 按源文案搜）查 `keyText`。
- 修复：`starling-bridge.py` 加 `search_key` action + `_parse_search_output`（精确命中：sourceContent trim 后完全相等 → exact=True）；`lib/starling-tm.js` 加 `searchKeys`；`popup.js` Step 1.5 调用；`writeToSheet` 新增 I 列 = Source String Key。
- 实测：`Official Videos`→`music_video_official`(exact=True,score=112.6)、`Done`→`tiktoktv_matchCode_halfsheet_cta`(exact=True)。
- ⚠️ **项目范围**：用户给的 `ttlsMerchant_gneMerchantRejectMsgKTP_msg1` 带 `ttlsMerchant_` 前缀，属 merchant 类项目，**不在默认 385(TikTok_Client) 项目**（实测 385 里搜 KTP 全文返回空）。需在 Options 改 Project ID 为 merchant 项目。**✅ 2026-06-30 用户已确认：merchant 项目 = Project ID 278（TikTok_main / TTLS Merchant Rejection Messages KTP and POI，任务 335649280002）。bridge 在 278 实测 KTP 完整原文 → `ttlsMerchant_gneMerchantRejectMsgKTP_msg1`（exact=True）命中。**

**仍待办（非阻塞）：**
1. ⚠️ 用户提供 merchant 项目 ID 后，在 Options 配置并验证 KTP 那条 key 能查到。
2. ⚠️ content.js 文档抓取选择器仍待真机微调（次要入口，主流程是表格驱动）。
3. ✅ ~~Sheets 权限未开通~~ — 已开通+重新发布，生效。
4. ✅ ~~电子表格协作者未加~~ — 已加。
5. ✅ ~~端到端真机~~ — 已跑通。
6. ✅ ~~Bitable 字段映射~~ — 已弃用 Bitable，改 Sheets 按列读写。
7. ✅ ~~Starling CLI 未装~~ — 已装通。

---

## 3. 环境配置（用户真实机器实测，2026-06-24）

### 3.1 本机基础

| 项 | 值 |
|----|----|
| 芯片 | Apple Silicon arm64 |
| macOS | 26.4.1 |
| Homebrew | 6.0.3 `/opt/homebrew/bin/brew` |
| Python | 3.9.6 `/usr/bin/python3`（系统自带，够用） |
| Xcode CLT | 已装 `/Library/Developer/CommandLineTools` |
| ttadk | 1.0.19 `/opt/homebrew/bin/ttadk`（TikTok AI-Driven Development Kit） |
| claude CLI | `/Users/bytedance/.local/bin/claude` → v2.1.187 |

### 3.2 LLM 网关（关键！无需外部 API Key）

用户用 `ttadk claude` 启动，自动配了字节内部 LLMBox 网关（环境变量）：

```
ANTHROPIC_BASE_URL = https://llmbox-global.byteintl.net/
ANTHROPIC_AUTH_TOKEN = at-fe3cda6f8643901276b4883845f36065c476a711
CLAUDE_CODE_SUBAGENT_MODEL = glm-5.2
ANTHROPIC_CUSTOM_HEADERS = X-Source: ttadk
```

**扩展 Options 里 LLM 填法：**
| 字段 | 值 |
|------|----|
| API Provider | Claude (Anthropic) |
| LLM API Endpoint | `https://llmbox-global.byteintl.net/v1/messages` |
| LLM API Key | `at-fe3cda6f8643901276b4883845f36065c476a711` |
| LLM Model | `glm-5.2`（或 `claude-sonnet-4-6`，看网关支持） |

> ⚠️ **已知风险**：LLMBox 是给命令行 `ttadk claude` 用的，Chrome 浏览器跨域直连可能撞 CORS。扩展已加 `anthropic-dangerous-direct-browser-access: true` 头。若真撞 CORS，备选方案是写 20 行本地代理脚本配合 Native Messaging 转发（未实现）。
>
> token 过期（SSO 约 2 周）后重跑 `ttadk claude` 续签，再 `echo $ANTHROPIC_AUTH_TOKEN` 取新值填回。

### 3.3 飞书自建应用（已发布 ✅）

| 项 | 值 |
|----|----|
| 应用名 | L10n TM Companion |
| 租户 | 正式应用@ByteDance |
| 版本 | 1.0.0 |
| 状态 | ✅ **已发布审核通过**（2026-06-24） |
| 鉴权方式 | tenant_access_token（应用身份正式版） |

**已开通的应用身份权限（写入记录所需）：**
- `base:app:update`（更新多维表格）✅ 核心
- `base:block:create` / `base:block:delete` / `base:block:read` / `base:block:update` ✅

**App ID / App Secret**：用户在飞书开放平台「凭证与基础信息」获取，存于扩展 Options（chrome.storage.local）。**本文档不记录明文**，新对话如需可让用户从 Options 里读或重新去后台取。

> 关键决策：用户曾纠结走 user_access_token（免审立即用）还是 tenant_access_token（等审批）。最终应用发布审核通过，**采用 tenant_access_token 正式版方案，代码不用改**。user_access_token 方案作为备选保留（未实现）。

### 3.4 Starling CLI（已装通 ✅，2026-06-24）

实测全链路打通：CLI 已装、AK/SK 已配、TM 查询接口实测命中。

**安装与配置：**
- CLI = `starling-cli`（npm 包 `@byted/starling-agent-cli`），**不是** handoff 早期写的 `starling`
- 安装命令：`npm install -g @byted/starling-agent-cli --registry https://bnpm.byted.org`（已执行，v1.1.16）
- 路径：`/Users/bytedance/.local/bin/node/bin/starling-cli`
- 登录：`starling-cli login --begin --no-qr`（非阻塞，浏览器 SSO 创建应用账号）→ 自动拿 AK/SK
- ⚠️ **已知坑**：`starling-cli login` 在 Claude Code `!` 非交互 TTY 会话下，SK 可能不落盘（只存 AK），导致 `doctor` 报 `secretKey is required`、`auth status` 报 `starling: configured: false`。
  - 解决：手动把 AK/SK 写进 `~/.starling-cli/.starlingrc.json`（字段 `accessKey` / `secretKey`，chmod 600）
  - AK/SK 也可从 https://starling.bytedance.net/personal_center#aksk 手动获取

**TM 查询接口（实测可用）：**
```
starling-cli api GET /corpus/tm/match \
  --params '{"projectId":385,"sourceLocale":"en","targetLocale":"zh","sourceText":"Done","leastScore":0,"limit":1}'
```
- 返回 `{ ok, data: { data: [{ source, target, score, updater, ... }], total } }`
- `data.data[0]` 即最相似匹配（已按相似度降序）；`target`=TM译文, `score`=相似度0-100, `updater`=来源
- ⚠️ **语种关键**：项目 TikTok_Client (id=385) **源语言是英文 en**，源语种必须用 `en` 不是 `zh`，否则全空
- 已知匹配样本：Done→完成(100)、Confirm→確認(100)、Settings→隐私设置(58)、Live→LIVE will begin shortly(22)

**Starling Agent CLI 文档（本地存档）：** `/Users/bytedance/存档/Starling Agent CLI — 让 AI Agent 操作 Starling 平台.md`

### 3.5 飞书电子表格（Sheets，⚠️ 权限待开）

**⚠️ 重要转向（本轮）：表格产品从多维表格 Bitable 改成电子表格 Sheets。** 原因：用户团队实际用的是电子表格（`/sheets/` 链接），不是多维表格（`/base/`）。代码已整体重写为 Sheets API（`lib/feishu-sheets.js`），Bitable 版本（`feishu-bitable.js`）保留但弃用。

**当前使用的电子表格：**
- URL: `https://bytedance.my.larkoffice.com/sheets/Tjyfs3Tg5hYG6btMTiom3UA3yYd`
- Spreadsheet Token: `Tjyfs3Tg5hYG6btMTiom3UA3yYd`
- Sheet ID: 留空（代码自动取第一个工作表，可在 Options 手填）
- ⚠️ **必须开通 `sheets:spreadsheet` 权限 + 重新发布版本 + 把应用加为该表协作者（可编辑）**，三者缺一读写都报权限错 —— **当前最大阻塞，未做**

**电子表格列布局（第 1 行表头，第 2 行起数据，按列固定读写，无字段映射）：**

| 列 | 内容 | 代码角色 |
|----|------|------|
| A | Original Source Segment（英文原文，**输入**） | 读来源 |
| B | Best TM Match（TM 译文，starling 返回的 target） | 写 |
| C | Orig Match %（starling 返回的 score，0-100） | 写 |
| D | Rewritten Segment（AI 改写后的原文） | 写 |
| E | New Match %（文本相似度算出，0-100） | 写 |
| F | Reached 75%?（Orig Match % ≥ 75 自动 TRUE/FALSE） | 写 |
| G | CD review valid?（**留空，待人工勾选**，代码不写） | — |
| H | Comment（AI vs TM 对比说明） | 写 |
| I | Source String Key（Starling 源文案 key，`/project/search` 查，2026-06-30 新增） | 写 |

> ⚠️ 用户表确认：第 1 行是表头，原文在 A 列（第 2 行起）。

**Sheets API 接口（代码已实现）：**
- 读 A 列原文：`GET /sheets/v2/spreadsheets/{token}/values/{sheet}!A2:A`
- 批量写 B-H 列：`POST /sheets/v2/spreadsheets/{token}/values_batch_update`
- 查 sheet 列表：`GET /sheets/v3/spreadsheets/{token}/sheets/query`
- 所需权限：`sheets:spreadsheet`（读写电子表格）

> 弃用的多维表格：`https://bytedance.my.larkoffice.com/base/NNAubNCm9amBXXsS8BVmFKeTykg`（Bitable，URL 里有 `/base/`）。早期 wiki 表 `https://bytedance.larkoffice.com/wiki/TsllwqyJ5ipnzVklOp5cG3TFnIf` 也弃用。

---

## 3.6 TM 优化工作流（核心业务逻辑，本轮重设计）

**⚠️ 本轮纠正了之前对工作流的错误理解。** 用户最初描述的流程被 Claude 误解为「AI 翻译」，实际是「TM 优化」——不翻译，只改写英文原文以提升 TM 命中率。

**完整工作流（代码已实现，见 `popup.js processItems`）：**

```
1. 读原文：从电子表格 A 列读 Original Source Segment（英文）
   ↓ listSourceSegments()  → lib/feishu-sheets.js
2. 查 TM：每条原文调 starling → 拿 Best TM Match(B列) + Orig Match %(C列) + TM原文(tm_source)
   ↓ searchTM() → bridge → starling-cli api GET /corpus/tm/match
2.5. 查 Key：每条原文调 starling /project/search → 拿 Source String Key(I列)
   ↓ searchKeys() → bridge search_key action → starling-cli api GET /project/search
   ⚠️ TM match 接口不存 key！key 在源文案层，必须用 /project/search（searchScope=0）。2026-06-30 修复
3. 判断达标：Orig Match % ≥ 75 → Reached 75%?(F列)=TRUE，不重写，D列填原文本身
   ↓ rewriteSourceWithAI(items, config, 75)  → lib/ai-translate.js
4. AI 改写：仅 Orig<75 的条目，AI 改写英文原文让它更接近 TM 已有原文 → Rewritten Segment(D列)
   ⚠️ 改写的是源语言英文原文，不是翻译！prompt 明确禁止翻译
5. 算 New Match：textSimilarity(Rewritten Segment, TM原文tm_source) → New Match %(E列)
   ↓ lib/diff.js textSimilarity()  ⚠️ 不调第二次TM！本轮纠正点
6. 对比：compareAIvsTM 基于 Orig/New Match% 生成 Comment(H列)
7. 写回：批量写 B/C/D/E/F/H/I 列到电子表格（G列留空待人工）
```

**关键纠正点（之前实现错的，本轮已修）：**
1. ❌ 之前 New Match% 调了第二次 starling TM → ✅ 改为文本相似度算法（Jaccard + Levenshtein），算 `Rewritten Segment` vs `TM库原文(tm_source)`
2. ❌ 之前 bridge 返回的 `source_text` 被 TM 原文覆盖 → ✅ 修复，TM 原文单独存 `tm_source` 字段，用户原文保持不变
3. ❌ 之前 `similarity` 写入时 ×100 → ✅ 改，starling 返回的 score 已是 0-100 百分制
4. ❌ 之前工作流是「AI 翻译」→ ✅ 改为「AI 改写原文」（prompt 完全不同）

**LLM 改写 prompt 要点（`buildRewritePrompt`）：**
- 角色：TikTok LIVE localization TM optimization expert
- 任务：rewrite the SOURCE text（不是 translate！），保持语义不变，只调整表达贴近 TM 已有原文风格
- 必须保持源语言（不翻译）、保留占位符/变量
- 返回 JSON：`{ai_translation, reasoning, reuse_tm}`（复用 ai_translation 字段存改写结果）

## 4. 关键决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 无后端 | ✅ 纯客户端 | 内部工具，TM 留本地 |
| MV3 | ✅ | MV2 已停 |
| Native Messaging 调 CLI | ✅ | 唯一能从扩展调本地 CLI 的方式 |
| Popup 而非 Sidepanel | ✅ | 轻量 |
| Vanilla JS | ✅ | 避免构建链 |
| 飞书 REST API | ✅ | JS-SDK 仅飞书内嵌浏览器可用 |
| LLM 用内部网关 | ✅ LLMBox | 用户是字节员工有 SSO，无需外部 Key |
| 飞书鉴权 | ✅ tenant_access_token | 应用已发布，比 user_access_token 的 OAuth 流程简单 |
| Starling bridge 命令 | ✅ 已适配 | 本轮用真实 `starling-cli api GET /corpus/tm/match`（不再占位）|
| **表格产品** | ✅ **电子表格 Sheets**（本轮转向）| 用户团队实际用 Sheets（`/sheets/`），非多维表格 Bitable。Bitable 代码保留弃用 |
| **原文入口** | ✅ **表格驱动 + 文档抓取** | 主入口读电子表格 A 列，保留文档 docx 抓取作次要入口 |
| **New Match% 算法** | ✅ **文本相似度**（本轮纠正）| 不调第二次 TM，用 textSimilarity(Rewritten 原文, TM原文)。之前错调了第二次 TM |
| **AI 任务** | ✅ **改写英文原文**（本轮纠正）| 不是翻译！AI 把英文原文改写得更贴近 TM 已有原文表达，提升命中率 |
| **飞书域名匹配** | ✅ 加 `larkoffice.com` | 字节内部域名是 larkoffice.com，原只匹配 feishu.cn 导致无法通信 |

---

## 5. 用户偏好的工作方式（feedback）

1. **每次对话必须先读 `/Users/bytedance/my-project/agent.md`**（已存记忆 `always-read-agent-md`），并遵守其 Output Style：自然语言句尾加「～」（代码/表格/JSON/链接不强制）
2. 倾向详细、手把手、分步骤的中文说明，配合表格
3. 涉及字节内部系统（飞书/Starling/LLMBox/ttadk）需贴合真实环境，不要给通用外部方案
4. 报错时用户会贴完整页面文本/报错，需要据此定位
5. 实习生，对内部审批链路敏感，倾向免审/快速验证方案先跑通 MVP

---

## 6. 完整操作历史（本次对话）

按时间顺序记录关键节点，供新对话了解「我们是怎么走到这一步的」：

### 阶段 A：代码实现（按 handoff 8 个 Phase）

1. 读 `handoff/IMPLEMENTATION_PLAN.md`，确认从零开始
2. 建 `l10n-tm-companion/` 目录结构
3. Phase 1：写 `manifest.json` + `background.js` 骨架
4. Phase 2：写 `content.js`（飞书抓取）
5. Phase 3：写 `native-host/starling-bridge.py` + 注册清单 + `register-native-host.sh` + `lib/starling-tm.js`
6. Phase 4：写 `lib/ai-translate.js` + `lib/diff.js`
7. Phase 5：写 `lib/feishu-bitable.js`
8. Phase 6：写 `popup.html/css/js`
9. Phase 7：写 `options.html/css/js`
10. Phase 8：Python 生成图标、写 README、语法检查全过、bridge ping 实测通过

### 阶段 B：端到端逻辑验证

11. 写 `test/e2e-logic.test.js`（29 用例）→ 全过
12. 写 `test/feishu-bitable.test.js`（11 用例）→ 首次发现 token 缓存 bug
13. **修复真实 bug**：`feishu-bitable.js` token 缓存原为模块级单变量，用户改 App ID 后会误用旧 token → 改为按 appId 索引的 Map，暴露 `_resetTokenCache()`
14. 修复后两套测试全过

### 阶段 C：文档与教程

15. 写 `TUTORIAL.md`（使用教程）
16. 写 `SETUP-ENV.md`（环境搭建）→ 后来删除
17. 实测用户机器：发现 Python 已装、ttadk 已装、查到 LLMBox 网关环境变量
18. 写 `SETUP-BYTEdance.md`（字节定制版）→ 后来合并
19. 整合：三份合并成单一 `TUTORIAL.md`，删冗余
20. 存记忆 `always-read-agent-md`：每次对话读 agent.md

### 阶段 D：飞书应用配置（用户实操，多轮排查）

21. 用户卡在「搜 bitable 搜不到」→ 发现搜的是文档站不是应用后台；正确入口是「开发配置→权限管理→开通权限」
22. 用户开通一批权限，贴出来排查
23. 关键混淆点：用户分不清「用户身份（user_access_token，免审）」vs「应用身份（tenant_access_token，需发布审核）」——反复澄清
24. 用户应用身份 `base:app:update` 实际已开通（核心写入权限够用）
25. 发现应用「待上线」，应用身份权限未正式生效，必须发布审核
26. 介绍两条路：A=改代码用 user_access_token 免审 / B=走正式发布审核（代码不改）
27. 用户进版本管理与发布页，填版本号 1.0.0、申请理由（我写了模板）、可用范围加自己、对外共享不勾
28. 用户问「允许刷新 user_access_token 为何只能选否」→ 解释：未开机器人能力/OAuth 权限，但非必需，跳过
29. 用户提交发布申请，进入审核中
30. **用户报告：审批通过，应用已发布** ✅ → 确定走 tenant_access_token 正式版，代码不用改
31. 用户要求：① 更新 handoff ② 写对话交接文档（即本文件）

### 阶段 E：当前

32. 更新 `handoff/IMPLEMENTATION_PLAN.md` 顶部「实施进度总览」+ 前置依赖表 + 验收清单
33. 写本文件 `handoff/SESSION-HANDOFF.md`

### 阶段 F：Starling 装通 + 工作流重构（2026-06-24 晚，本对话）

34. 本地探测确认无 starling → 读 `/Users/bytedance/存档/Starling Agent CLI...md` → 发现真工具是 `starling-cli`（npm `@byted/starling-agent-cli`）
35. `npm install -g @byted/starling-agent-cli --registry https://bnpm.byted.org` → 装好 v1.1.16
36. `starling-cli login --begin --no-qr` 非阻塞 SSO 登录 → 创建 ByteCloud 应用账号（常规权限 ON / 敏感 OFF）→ AK/SK 自动保存
37. ⚠️ 发现 login 在非交互 TTY 下 SK 不落盘（doctor 报 secretKey is required）→ 手动写 AK/SK 进 `~/.starling-cli/.starlingrc.json`
38. 搜 TM 接口：`api-list --search match` → 找到 `GET /corpus/tm/match`（根据文案获取 TM 匹配和匹配度）
39. 实测发现项目 TikTok_Client (id=385) **源语言是英文**，`sourceLocale` 必须用 `en`，用 zh 全空 → en→zh 命中 Done→完成(100) 等
40. **改 `starling-bridge.py`**：`build_search_cmd` 改成 `starling-cli api GET /corpus/tm/match --params '{...}'`，`_parse_cli_output` 解析新返回结构取 best match（target/score/updater），加 projectId/least_score/limit 参数，DEFAULT_CLI='starling-cli'，DEFAULT_PROJECT_ID=385
41. Native Messaging 协议端到端实测：3 条文案全命中（Done→完成 100、Confirm→確認 100、TikTok LIVE→13.33）
42. **改 TM 优化工作流**（用户决策）：原「AI 翻译」流程改为「TM 优化」流程——查TM得Orig%→判断≥75(Reached 75%?)→<75则AI改写原文(Rewritten Segment)→改写后原文再查TM(New Match%)→对比(Comment)
43. 改 `ai-translate.js`：新增 `rewriteSourceWithAI`/`buildRewritePrompt`（改写原文 prompt，不翻译，保留原 translateWithAI 不动）
44. 改 `feishu-bitable.js`：DEFAULT_FIELDS 改成英文字段名（Original Source Segment 等），去掉 origin/finalTranslation，加 newMatch/reached75/cdReview；similarity 不再 ×100（starling 返回已是百分制）
45. 改 `popup.js` 主流程：编排 TM优化流程（两次 TM 查询 + 阈值判断 + 改写）
46. 改 `diff.js`：compareAIvsTM 改成基于 Orig/New Match% 的语义对比（不再逐词文本对比，因改写原文与TM译文语言不同）；阈值 0.95→95
47. 改 `options.html/js`：加 Source Language select + Starling Project ID input + 新字段映射 UI
48. 更新测试：e2e-logic 41/0（从29扩到41）、feishu-bitable 13/0（从11扩到13），全过
49. 用户在云空间根目录新建多维表格（非 wiki）→ 拿到 `/base/` 直链 App Token=NNAubNCm9amBXXsS8BVmFKeTykg

### 阶段 G：Sheets 重构 + New Match 算法纠正（2026-06-24 深夜，本轮）

50. 用户加载扩展（ID=`bgnakecphongbinlnmgnhoefgjecdang`）+ 注册 Native Host（`register-native-host.sh` 已跑）→ Options 测 Native Host ✅ `starling-cli`
51. 用户填 Options（Starling Project ID=385 / 源语言 en / LLM LLMBox 网关 / 飞书凭证）→ 测飞书连接 ✅
52. 真机抓取报「无法与页面通信」→ 根因：manifest 的 content_scripts/host_permissions 只匹配 `feishu.cn`/`larksuite.com`，**没匹配字节内部域名 `larkoffice.com`** → 加上 `*://*.larkoffice.com/*` + `/docx/*` + `/wiki/*`
53. 用户又报「无法与页面通信」→ 发现用户打开的是 `/base/` 多维表格页（不是文档 docx 页），表格页没有文案可抓 → 澄清入口区别
54. **写入报错**：`Access denied. scopes required: [bitable:app, base:record:create]` → 飞书应用缺 Bitable 写记录权限
55. 用户说开通了 `base:record:create`，但给了新链接 `https://bytedance.my.larkoffice.com/sheets/Tjyfs3Tg5hYG6btMTiom3UA3yYd`（**电子表格 Sheets，不是多维表格**）
56. **重大转向**：用户团队实际用电子表格 Sheets（`/sheets/`），非多维表格 Bitable。现有 `feishu-bitable.js` 调的是 Bitable API，对 Sheets 无效 → 必须重写表格层
57. 多轮澄清工作流（用户纠正了之前错误理解）：
    - 原文来自**表格 A 列**（不是文档抓取），但保留文档抓取作为次要入口
    - TM 查一次即可拿 Best TM Match + Orig Match%（TM match 固定，不用查第二次）
    - **New Match% = 文本相似度算法**算 `Rewritten Segment`(改写后英文原文) vs `TM库原文`，**不调第二次 TM**（之前实现错了）
    - Reached 75%? 判断的是 **Orig Match %** ≥75
    - Rewritten Segment 是 **AI 改写英文原文**（不是翻译！让原文更接近 TM 已有表达）
58. **改 `starling-bridge.py`**：修复 bug——原来 `source_text` 被 TM 原文覆盖导致写表错误；TM 原文单独存 `tm_source` 字段返回
59. **改 `lib/diff.js`**：新增 `textSimilarity`（Jaccard token 重叠 0.6 + Levenshtein 字符相似 0.4，兼容中英文，0-100）
60. **改 `popup.js`**：去掉第二次 searchTM 调用，Step3 改用 `textSimilarity(Rewritten, tm_source)` 算 New Match
61. **新建 `lib/feishu-sheets.js`**：Sheets API v2 封装——`listSourceSegments`(读 A2:A 原文)、`writeToSheet`(按列写 B-H)、`parseSheetsUrl`、`testSheetsConnection`、`getDefaultSheetId`；列布局固定 A-H，无字段映射
62. **改 `popup.js`**：import 切到 feishu-sheets；loadConfig 读 `spreadsheetToken`/`sheetId`（非 bitableAppToken/bitableTableId）；新增「📋 从当前表格读原文」按钮 + `readFromBitable` 函数（调 listSourceSegments）
63. **改 `options.html/js`**：Bitable 区改成「飞书电子表格」区，贴 Sheets URL 自动解析 spreadsheetToken/sheetId；删字段映射（Sheets 按列无映射）；加列布局说明 details
64. 更新测试：e2e-logic 加 textSimilarity 用例 → **49/0**；feishu-bitable 13/0；所有语法 OK；Sheets URL 解析实测正确
65. 回答用户「扩展怎么给别人用」：3 种分发方式（zip 私发 / Chrome Web Store 上架 $5 / 字节企业内部策略）+ 提醒本机依赖（starling-cli+AK/SK+native host 注册）别人也得装
66. 用户要求把本轮详细操作写入 handoff（即本次更新）

### 阶段 H：真机跑通 + TM key 修复（2026-06-30）

67. ✅ 用户报告：`sheets:spreadsheet` 权限已开通+重新发布、应用已加为电子表格协作者、**端到端真机已跑通**——之前三大阻塞全部解除。
68. ⚠️ 用户反馈：「TM 找不到对应文案的 Key，不可能，starling 的人说 TM 是有 key 的，是你能力不足」。举例 KTP 长文案搜出来应返回 `ttlsMerchant_gneMerchantRejectMsgKTP_msg1`。
69. 排查：实测 `Done` 的 `/corpus/tm/match` 完整返回，确认 TM 条目结构只有 `id/tmId/score/source/target/updater/keywords` 等**没有 key 字段**——TM 库本身不存 key，是源文案层概念。
70. `starling-cli api-list` 找源文案查询接口 → 发现 `GET /project/search`（描述「项目下搜索，支持从源文案、key、翻译文案不同的场景下搜索」），schema 参数 `searchScope`(0=源文案/2=key)/`searchKey`/`projectId`。
71. 实测验证：`/project/search` searchScope=0 用原文 `Official Videos` 精确返回 `keyText=music_video_official`(score=112.6)；返回 item 字段含 `keyText/sourceContent/targetContent/score/namespace`。
72. 确认 KTP 那条不在 385：`/project/search` 在 385 搜 KTP 全文返回的全是 copyright 类文案（无 merchant KTP），且 `search_key` bridge 实测返回空 → 证明是**项目范围问题不是接口问题**。`ttlsMerchant_` 前缀属 merchant 类项目。
73. **改 `starling-bridge.py`**：加 `search_key` action + `build_search_key_cmd`（`/project/search` + searchScope=0）+ `_parse_search_output`（精确命中：sourceContent trim 后完全相等 → exact=True，否则取最高分 exact=False）+ `_key_err` + `search_key` 批量并发函数。
74. **改 `lib/starling-tm.js`**：加 `searchKeys` 封装（走 `native_search_tm` 透传，与 searchTM 同通道）。
75. **改 `lib/feishu-sheets.js`**：列布局加 I 列 = Source String Key；`COLUMN_MAP` 加 `key:'I'`；`REQUIRED_HEADERS` 加 `'Source String Key'`（10 列）；`writeToSheet` 表头 B1:H1→B1:I1 + 每行加 `I{row}:I{row}` 写 `it.key`；`repairHeaders` A1:I1→A1:J1。
76. **改 `popup.js`**：import 加 `searchKeys`；Step 1（TM 查询）后加 Step 1.5 调 `searchKeys`（失败不阻塞，I 列留空），挂 `item.key/key_exact/key_score`。
77. **新增 `test/search-key-test.py`**（15 用例）：精确命中/模糊匹配/无匹配返回 None/API 错误字符串/trim 容错/_key_err 字段/空白归一化。
78. **KTP 验证 + 二次修复**：用户贴出 merchant 项目链接 → 解析出 Project ID=278。bridge 在 278 实测 KTP 完整原文，发现两个问题并修：①**空白归一化**——`exact` 原用字符串严格相等，但 starling 返回 sourceContent 用 `\n\n` 分段、用户原文用单空格（`system. Selfie` vs `system.\n\nSelfie`），永远 False；改 `_normalize_ws` 折叠所有空白后比较 → KTP 立即 exact=True。②**接口重试**——`/project/search` 偶发 total:0（5 次 1 次空，服务端不稳定），`search_key_single` 加重试最多 3 次仍空才降级。**最终实测 KTP → `ttlsMerchant_gneMerchantRejectMsgKTP_msg1`（exact=True, score=801.8）成功命中。**
79. 全量回归：feishu-sheets 108/0、e2e 68/0、new-match-scoring 49/0、tm-bm25 25/0、content-extract 38/0、errors 14/0、feishu-bitable 13/0、search_key 15/0。bridge 协议实测 search_key 跑通。
78. **同步更新 `test/feishu-sheets.test.js`**：6 列→7 列输出、9→10 表头、missing 数量、A1:J1、I 列写 key 断言。
79. 全量回归：feishu-sheets 108/0、e2e 68/0、new-match-scoring 49/0、tm-bm25 25/0、content-extract 38/0、errors 14/0、feishu-bitable 13/0、search_key 13/0。bridge 协议实测 search_key 跑通。
80. 更新记忆 `l10n-tm-companion-known-bugs` + 本 handoff（即本次更新）。**待用户贴 merchant 项目 ID 验证 KTP key。**

### 阶段 I：popup 显示 Source String Key（2026-07-03）

81. 用户需求：「在插件里面看到对应 key，写入的表格里面也需要有 key」。排查现状：`item.key` 已在 Step 1.5 查到（popup.js line 413-415 挂 `key/key_exact/key_score`），表格 I 列已写（`feishu-sheets.js` line 374 `it.key`），**但 `renderCard`（line 506）和 `renderFocus`（line 586）两个视图都没把 key 显示出来**——只在表格里有，popup 看不到。
82. 用户确认显示方案（AskUserQuestion）：①卡片视图顶部 + ②聚焦大图视图都显示；③key + 命中状态徽章（exact 绿 / fuzzy 黄）；④没查到显示「未查到」灰色。
83. **改 `popup.css`**：加 `.key-row` / `.key-value`（ui-monospace 等宽）/ `.key-badge.exact`（绿 `#e6f7ed`/`#1a7a3d`）/ `.key-badge.fuzzy`（黄 `#fff7e0`/`#b76b00`）/ `.key-none`（灰斜体）样式。
84. **改 `popup.js`**：新增 `keyRow(item)` 辅助函数（卡片+聚焦共用，按 `item.key` / `item.key_exact` 三态渲染：有 key+exact=绿徽章、有 key+fuzzy=黄徽章、无 key=灰「未查到」）；`renderCard` 的 `card.innerHTML` 顶部插入 `${keyRow(item)}`（在 card-summary 前）；`renderFocus` 的 Source 区下方插入独立 Key 区块（带 inline 样式 + exact/fuzzy 徽章 + 「精确命中/模糊命中」文字）。
85. 验证：`node --check popup.js` OK；测试全过——e2e-logic 68/0、feishu-sheets 108/0、feishu-bitable 13/0。表格 I 列写 key 逻辑未动，保持原样。
86. **待真机验证**：`chrome://extensions` → 🔄 刷新扩展 → popup 跑流程 → 看卡片顶部 `Key: xxx [exact/fuzzy]` + Focus 大图 Source 下方独立 Key 区块。表格 I 列照常写 key。

### 阶段 J：多项目支持 + 搜索容错 + 表格 J 列项目来源（2026-07-03）

87. 用户需求四点：①设置页可多选项目库，没有的可自定义新增（填名称或 ID）；②搜索词做大小写/拼写/符号容错（找不到可能因这个）；③表格展示每条 key 来自哪个项目库；④从 starling-cli 找 key，遵循 CLI 规则。
88. **探查 starling 接口能力**：读 starling-shared skill + 查 `/project/search` schema → 发现接口支持 `caseSensitive`（默认 false，大小写不敏感已由接口处理），但**不支持 fuzzy/拼写容错参数** → 拼写/符号容错必须在客户端实现。实测大写 `OFFICIAL VIDEOS` 模糊搜能命中 `Official Videos`（大小写不敏感生效）。
89. **bridge 改造（`native-host/starling-bridge.py`）**：
    - 新增 `_normalize_loose(s)`：lowercase + 去掉所有非字母数字，用于「拼写/符号容错」——如 `gold-medal!` 与 `Gold Medal` 归一化后都成 `goldmedal`，相等即视为命中。
    - `_parse_search_output` 三层匹配：①严格精确（`_normalize_ws` 空白归一化后相等）→ ②宽松精确（`_normalize_loose` 去标点+大小写不敏感后相等）→ ③取 score 最高（模糊命中）。exact 判断覆盖符号/大小写/空白差异。
    - `search_key` 改成接收 `project_ids` 数组：解析去重 → 反查每个项目名（`_resolve_project_name` 调 `/projects`）→ 每条原文在所有项目并发查 → `_pick_best` 取最优一个（exact 优先 → score 优先 → 跳过空 key）。返回结果带 `project_id`/`project_name`。
    - `_key_err`/`search_key_single` 同步带 project 信息。
90. **sheets 改造（`lib/feishu-sheets.js`）**：COLUMN_MAP 加 `project: 'J'`；REQUIRED_HEADERS 加 `'Project'`（11 列）；`writeToSheet` 表头 B1:J1、每行写 `it.project`；`repairHeaders` range `A1:K1`（11 列）。
91. **starling-tm.js**：`searchKeys` 透传 `projectIds` 数组（兼容旧 `projectId` 单值）。
92. **popup.js**：`tmOpts` 构造加 `projectIds`（优先数组，兼容旧单值）；Step 1.5 把 `k.project_id`/`k.project_name` 组合成 `item.project = 'name (id)'`；`keyRow` 函数加项目来源显示（`From: name (id)`）；`renderFocus` Key 区块加 `From project:`。
93. **options 多选 + 自定义新增（`options.html/css/js`）**：
    - HTML 加自定义新增输入框（`customProjectInput` + Add 按钮）；提示文案改「multi-select, click to toggle」。
    - CSS 加 `.custom-project-row` + `.project-card.custom-card`(虚线边框区分自定义)。
    - JS 重写项目选择：`selectedIds` 数组运行期；卡片多选 toggle；`syncSelectedSummary` 显示已选清单；`addCustomProject` 填名称→从缓存反查 ID、纯数字→当 ID、找不到→提示先 Load；save 时持久化 `starlingProjectIds` 数组 + 兼容字段 `starlingProjectId`（第一个）；load 时旧 `starlingProjectId` 单值迁移进数组。
94. **测试同步**：feishu-sheets 测试列数 10→11、表头断言、valueRange 数量、`A1:K1`、Project 列断言全更新；新增 J7 写 project 断言。
95. **验证**：JS 全部 `node --check` OK；bridge `py_compile` OK；7 套测试 319/0 全过（content-extract 38、e2e 68、errors 14、feishu-bitable 13、feishu-sheets 112、new-match-scoring 49、tm-bm25 25）；Python search-key 15/0。
96. **待真机**：chrome://extensions 🔄 刷新扩展 → Options 多选项目 + 自定义新增 → popup 跑流程 → 看卡片 `Key: xxx [exact/fuzzy] From: name (id)` + Focus 同款 → 表格 I 列 key + J 列 project 来源。

---

## 7. 下一步建议（新对话从这接续）⚠️ 当前真实状态

**✅ 2026-06-30：真机端到端已跑通。** 用户已开通 `sheets:spreadsheet` 权限+重新发布、应用已加为电子表格协作者、端到端验证通过。之前三大阻塞（权限/协作者/真机）全部解除。

> 🔧 **2026-06-30 新增：按原文查 Source String Key（已完成 + bridge 实测通过）**
> 用户反馈「TM 找不到对应文案的 Key，starling 的人说 TM 有 key，不可能查不到」。**根因：之前 bridge 用错了接口**。
> - 旧 `/corpus/tm/match`（TM 库匹配）返回的 TM 条目**不存 key**（只有 source/target/score/updater/id/tmId）。TM 库本身没有 key 概念。
> - 新 `/project/search`（源文案搜索，`searchScope=0` 按源文案搜）返回 `keyText`（key）+ `sourceContent` + `score`。**这就是 starling 平台搜 key 走的接口。**
> - 实现：`starling-bridge.py` 加 `search_key` action + `_parse_search_output`（精确命中判断：sourceContent trim 后完全相等 → exact=True，否则取最高分 exact=False）；`lib/starling-tm.js` 加 `searchKeys` 封装；`popup.js` Step 1.5 调用（失败不阻塞主流程，I 列留空）；`writeToSheet` 新增 I 列写 key（表头 B1:I1 / repairHeaders A1:J1 共 10 列）。
> - **实测**：`Official Videos`→`music_video_official`(exact=True,score=112.6)、`Done`→`tiktoktv_matchCode_halfsheet_cta`(exact=True)。
> - ⚠️ **项目范围关键**：用户给的 `ttlsMerchant_gneMerchantRejectMsgKTP_msg1` 带 `ttlsMerchant_` 前缀，属 merchant 类项目，**不在默认 385(TikTok_Client)**（实测 385 搜 KTP 全文返回空）。要在 Options 改 Project ID 为 merchant 项目。**✅ 2026-06-30 用户已确认 merchant 项目 = 278（TikTok_main / TTLS Merchant Rejection Messages KTP and POI），bridge 在 278 实测 KTP → `ttlsMerchant_gneMerchantRejectMsgKTP_msg1`（exact=True）命中。**
> - 🔧 **空白归一化（2026-06-30 二次修复）**：第一版 `exact` 用 `sourceContent.strip()==query.strip()`，但 KTP 实测发现 starling 返回 sourceContent 用 `\n\n` 分段、用户原文用单空格（第 138 字符 `system. Selfie` vs `system.\n\nSelfie`），严格相等永远 False。改 `_normalize_ws`（所有连续空白折叠成单空格再 trim）比较 → KTP 立即 exact=True。
> - 🔧 **接口重试（2026-06-30 二次修复）**：`/project/search` 偶发返回 total:0（实测 5 次 1 次空，服务端不稳定/限流），非代码问题。`search_key_single` 加重试：空结果重试最多 3 次（共 4 次），仍空才降级。
> - 新增 `test/search-key-test.py`（**15 用例**）覆盖精确命中/模糊匹配/无匹配/API 错误/trim 容错/空白归一化。**测试总计：feishu-sheets 108/0、e2e 68/0、new-match-scoring 49/0、tm-bm25 25/0、content-extract 38/0、errors 14/0、feishu-bitable 13/0、search_key 15/0。**

> 🔧 **2026-06-25 代码审计修复（已完成，真机已验证）**：
> 1. 🔴 **D 列错位根治**：`feishu-sheets.js` 的 `writeToSheet` 原来按下标整列写 `B2:B`，A 列有空行时（`listSourceSegments` 跳空行）B-H 全部错位。改成按 `it.row` 真实行号定位每行写 `B{row}:B{row}`。连带的 `popup.js` 原来没保留 `row` 字段（还引用了不存在的 `record_id`），改成 `row: s.row`。
> 2. 🟡 **卡片 TM% 双倍**：`popup.js renderCard` 里 `similarity * 100`——similarity 早是 0-100 百分制，又 ×100 变 8500。去掉 ×100。
> 3. 🟡 **improved 判定过宽**：`diff.js compareAIvsTM` 的 `delta > 0` 改成 `delta >= 5`，避免文本相似度噪声（New Match 是 Jaccard+Levenshtein，与 starling 真实命中率两套度量）把本该 `different` 的误判 `improved`。
> 4. 新增 `test/feishu-sheets.test.js`（20 用例）覆盖 parseSheetsUrl / 读 A 列跳空行保留行号 / 按 row 写不错位 / 缺配置报错 / API 错误。**测试总计：e2e 54/0、bitable 13/0、sheets 20/0。** 详细 bug 清单见记忆 `l10n-tm-companion-known-bugs`。
> 5. 🔴 **LLMBox CORS 根治（2026-06-25，真机已验证打通）**：扩展直连 LLMBox 被 Chrome CORS 拦截（`No 'Access-Control-Allow-Origin'`）。改走 native host——`starling-bridge.py` 加 `llm_call` action（urllib 直连网关，无 CORS），`background.js` 加 `native_llm_call` 转发，`ai-translate.js callLLM` 扩展环境优先走 native host（node 测试环境仍走 fetch）。**实测**：bridge 直连 LLMBox `pong` 命令返回正确文本。⚠️ glm-5.2 响应 `content` 数组含 `thinking` 块，真实文本在 `type=='text'` 块——bridge 已遍历跳过 thinking 取 text。
> 6. 🔴 **CORS 修复判断条件错误（2026-06-25 二次修）**：第一次 CORS 修复的判断条件 `chrome.runtime?.sendNativeMessage` **在 popup 上下文里是 false**（`sendNativeMessage` 只有 SW 有，popup/content 无此 API）→ popup 里永远走直连 fetch → CORS 依旧。**根因**：popup 不能直接调 native host，必须经 SW 中转。改成判断 `chrome.runtime?.sendMessage`（扩展环境都有），popup 发 `native_llm_call` 给 SW，SW 调 `sendNativeMessage`。⚠️ MV3 `await chrome.runtime.sendMessage(...)` 是 promise 形式，错误走 reject 不是 `lastError`，用 `.catch` 捕获。**这是必踩坑：凡是要从扩展页面调 native host 的逻辑，判断条件用 `sendMessage` 不是 `sendNativeMessage`，真正的 `sendNativeMessage` 只在 background.js 里调。**

**当前待办（按优先级）：**

1. ✅ ~~开通 `sheets:spreadsheet` 权限~~ — 用户已开通+重新发布，生效。
2. ✅ ~~加电子表格协作者~~ — 用户已加应用为协作者（可编辑）。
3. ✅ ~~真机端到端~~ — 用户已跑通。
4. ✅ ~~LLMBox CORS~~ — 已走 native host 根治（2026-06-25）。
5. ✅ **多项目支持**（2026-07-03 阶段 J 已实现）：Options 可多选项目 + 自定义新增（填名称或 ID）。bridge `search_key` 接收 `project_ids` 数组并发查询取最优，返回带 project 来源，表格 J 列展示。
6. ⚠️ **重新加载扩展**（chrome://extensions → 🔄 刷新），让 2026-06-30 的 search_key + I 列代码生效后真机复跑，确认 I 列写入了 key。
7. ⚠️ **真机验证 popup 显示 key + 多项目**（2026-07-03 阶段 I+J）：刷新扩展后 Options 多选项目 + 自定义新增；popup 跑流程看卡片 `Key: xxx [exact/fuzzy] From: name (id)`、Focus 大图 Key 区块含项目来源；表格 I 列 key + J 列 project 来源。
8. **content.js 文档抓取**（次要入口）：若要用「📥 抓取全文」，需在真实飞书 docx 文档页验证选择器，可能微调 `FEISHU_BLOCK_SELECTOR`。

**给协作者/同事用前**：他们也得装 starling-cli + 配 AK/SK + 注册 native host，否则 TM 功能不可用。建议先做一键安装脚本（未实现）。

---

## 8. 文件导航

| 文件 | 作用 |
|------|------|
| `/Users/bytedance/my-project/agent.md` | Agent 定义 + 输出风格 + 领域 glossary（每次必读） |
| `handoff/IMPLEMENTATION_PLAN.md` | 完整实施计划 + 进度总览（顶部新增） |
| `handoff/SESSION-HANDOFF.md` | **本文件**，对话交接 |
| `l10n-tm-companion/TUTORIAL.md` | 手把手使用教程（7 步，字节定制） |
| `l10n-tm-companion/README.md` | 参考文档（功能/架构/文件结构） |
| `l10n-tm-companion/manifest.json` | MV3 清单（已加 larkoffice.com + wiki/base 匹配）|
| `l10n-tm-companion/lib/feishu-sheets.js` | ⭐ **当前表格层**：电子表格 API（读A列/写B-H/URL解析/连接测试）|
| `l10n-tm-companion/lib/feishu-bitable.js` | tenant_access_token（被 sheets.js 复用）+ 弃用的 Bitable 读写 |
| `l10n-tm-companion/lib/ai-translate.js` | `rewriteSourceWithAI`/`buildRewritePrompt`（改写原文，核心）+ 旧 translateWithAI |
| `l10n-tm-companion/lib/diff.js` | compareAIvsTM + `textSimilarity`（算 New Match%）|
| `l10n-tm-companion/native-host/starling-bridge.py` | Python 桥接（真实 starling-cli API，返回 tm_match/tm_source/similarity/origin）|
| `l10n-tm-companion/test/*.js` | 逻辑单测（e2e 49 + bitable 13 全过）|
| `/Users/bytedance/.claude/projects/-Users-bytedance-my-project/memory/` | 记忆目录（含 always-read-agent-md）|

---

## 9. 测试如何复现

```bash
cd /Users/bytedance/my-project/l10n-tm-companion
node test/e2e-logic.test.js        # 49 用例（含 textSimilarity + 改写 + pipeline）
node test/feishu-bitable.test.js   # 13 用例（token 缓存/新字段映射）
python3 -m py_compile native-host/starling-bridge.py
# bridge 协议往返（ping）
echo '{"action":"ping"}' | python3 -c "import sys,json,struct; m=sys.stdin.read().encode(); sys.stdout.buffer.write(struct.pack('=I',len(m))+m)" | python3 native-host/starling-bridge.py
# bridge 真实 TM 查询（3 条文案，验证 tm_source 返回）
python3 -c "
import json,struct,subprocess
msg={'action':'search_tm','texts':['Done','Confirm','Cancel'],'source_lang':'en','target_lang':'zh'}
m=json.dumps(msg).encode()
out=subprocess.run(['python3','native-host/starling-bridge.py'],input=struct.pack('=I',len(m))+m,capture_output=True)
l=struct.unpack('=I',out.stdout[:4])[0]
print(json.loads(out.stdout[4:4+l].decode()))
"
```

---

> **一句话交接**：**✅ 真机端到端已跑通 + TM key 问题已解决**。用户反馈「TM 查不到 key」根因 = 之前用 `/corpus/tm/match`（TM 库不存 key），改用 `/project/search`（源文案搜索，带 key）写 I 列。**实测 KTP 完整原文在 Project ID 278（TikTok_main / TTLS Merchant）→ `ttlsMerchant_gneMerchantRejectMsgKTP_msg1`（exact=True）命中**（之前在 385 搜不到是项目范围问题）。两个二次修复：①`_normalize_ws` 空白归一化（starling 用 `\n\n` 分段、原文用空格，归一化后才能判精确命中）；②`/project/search` 接口偶发 total:0 加重试。测试全过（feishu-sheets 108/0、e2e 68/0、search_key 15/0 等）。**待办**：多项目支持（278 merchant vs 385 TikTok_Client，当前单项目需手动切）。新对话读 agent.md + 本文件 + IMPLEMENTATION_PLAN.md 顶部即可无缝接续。
