# L10n TM Companion — 2026-06-29 流程简化对比（before → after）

> 对象：对照「本轮改动之前」的状态，说清楚这一轮把哪些流程简化了。
> 配套：`HANDOFF-2026-06-29-config-key-i18n.md`（改动清单 + 技术细节）。
> 代码位置：`/Users/bytedance/my-project/l10n-tm-companion/`

---

## 总览

这轮把**「同事装一个工具」从「填一堆技术字段 + 猜协议 + 手对 ID + 自己建应用」简化成「双击安装 → 选个 Provider 填个 Key → 点卡片选项目 → 用」**。

核心的 **TM 优化原文流程**（查 TM → AI 改写原文 → 算 New Match → 写回）全程没动，简化的是**配置和接入门槛**。

---

## 1. Starling 区：CLI 路径折叠 + AK/SK 去本页

| | 之前 | 之后 |
|---|------|------|
| CLI 路径 | 主界面输入框，不知填什么、留空行不行 | 移入「高级」折叠区，留空自动用 PATH 里的 |
| AK/SK | 给了申请链接但**没说填哪**，同事以为填扩展 | 文案讲清：不在本页填，申请后跑 `starling-cli login` |
| 测试按钮 | 「测试 Native Host」黑话 | 「测试连接」 |

**流程变化**：装完跑 `login`，啥都不用填 → 之前要填 CLI 路径 + 迷茫 AK/SK 填哪。

---

## 2. LLM 配置：4 字段 + 猜协议 → 选 Provider + 填 1 个 Key

| | 之前 | 之后 |
|---|------|------|
| 字段数 | Provider + Endpoint + API Key + Model = **4 个** | Provider 下拉 + **API Key** = 2 个（endpoint/model 选 Provider 自动填）|
| Provider 选择 | 有下拉但代码本有 auto，手选多余 | 保留为「一键切换」，选完自动填 endpoint/model |
| 文案 | 误导「字节内网 token 同 Starling 个人中心」 | 删掉，中性说明 |

**流程变化**：选 Provider + 填 1 个 Key → 之前填 4 个字段 + 猜协议。

---

## 3. DeepSeek 接入：填了不调用/超时 → 选 Provider 就通

| | 之前 | 之后 |
|---|------|------|
| 填 DeepSeek | endpoint/model 还是 Claude 默认 → 401 不调用 | DeepSeek preset 预配火山方舟 endpoint + `deepseek-v4-flash-260425`，选一下自动填对 |
| 协议判断 | 简单 `provider != claude → OpenAI`，custom 歧义误判 | claude→Anthropic，deepseek→OpenAI 兼容，custom→按 endpoint 猜 |
| 超时 | 60s，偶发卡死直接挂 | 120s + 单条失败自动重试一次 |

**流程变化**：选 Provider 就通，偶发抖动自动重试兜住 → 之前填了调不通 + 超时挂。

---

## 4. 项目选择：手填 Project ID → 点卡片选

| | 之前 | 之后 |
|---|------|------|
| 选项目 | 手填 `385` 之类的 ID | 「加载项目列表」→ 卡片单选（513/385/278 全部列出）|

**流程变化**：点卡片选 → 之前手填数字 ID。

---

## 5. 飞书凭证：各自建应用 → 预填好

| | 之前 | 之后 |
|---|------|------|
| 凭证 | 每个同事去飞书开放平台建应用拿 ID/Secret | 预填进扩展，装完飞书段已填好 |

**流程变化**：装完即用 → 之前建应用 + 填凭证。
（应用纯凭证型不能上架应用市场，预填是内部最优解。）

---

## 6. 安装：手敲命令 + 手对 ID → 双击安装

| | 之前 | 之后 |
|---|------|------|
| 安装 | 手跑脚本 | 双击 `双击安装.command` |
| 扩展 ID | 要确认对不对（manifest key 对未打包扩展无效 → forbidden）| install.sh 自动探测本机实际 ID |
| 重启提示 | 没强调 | 文档明确「Cmd+Q 重启 Chrome」（forbidden 90% 是没重启）|

**流程变化**：双击 + 重启 → 之前手敲命令 + 调 ID。

---

## 7. UI 语言：中文 → 英文

| | 之前 | 之后 |
|---|------|------|
| 文案 | options / popup / 状态提示 / 错误信息全中文 | 用户可见文案全英化（注释/console.log 保留中文不影响）|

---

## 没简化的（保持原样）

- **TM 优化原文核心流程**：查 TM → AI 改写原文（`buildRewritePrompt` 把 `tm_match` 译文喂 AI）→ 算 New Match → 写回。本来就对，没动。
- **表格列布局 A-H**：TM key 的 I 列已回退（starling 拿不到 keyText，见 config-key-i18n handoff 1.4 节）。

---

## 一句话

**简化的是配置和接入门槛，不是核心功能。** 同事从「填一堆技术字段 + 猜协议 + 手对 ID + 自己建应用」变成「双击安装 → 选 Provider 填 Key → 点卡片选项目 → 用」。
