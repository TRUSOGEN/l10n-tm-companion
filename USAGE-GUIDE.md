# L10n TM Companion 使用教程

> 本文是历史版本，其中固定工作表迁移、全局依赖安装、预填凭证和旧列布局等内容已经过期。普通用户请只使用 [`docs/offline-install-manual.md`](docs/offline-install-manual.md)：当前版本支持任意已授权 Sheet/Wiki 表格、私有运行时、固定 Inspire workspace 与 macOS Keychain 飞书凭证。

> L10n TM Companion —— 从飞书电子表格读英文原文 → 查 Starling TM 记忆库 → AI 改写原文提升 TM 命中率 → 算匹配度 → 写回表格。
> 纯客户端 Chrome MV3 扩展，无后端，全程在用户本机跑。
> 最后更新：2026-06-26（已修复「读不到原文」根因：扩展现在指向 wiki 表 QmG4w6…，A 列 39 条原文）

---

## 0. 这个工具是干嘛的

一条龙流程，全自动在你本机跑：

```
飞书电子表格 A 列（英文原文）
   ↓ 读原文（飞书 Sheets API）
查 Starling TM 记忆库 → Best TM Match + Orig Match %
   ↓
Orig ≥ 85%？→ Reached 85%? = TRUE，不重写
Orig < 85%  → AI 改写英文原文（让它更贴近 TM 已有原文）→ Rewritten Segment
   ↓
文本相似度算 New Match %
   ↓
AI vs TM 对比 → Comment
   ↓
写回表格 B-H 列（A 列原文不动，G 列留给人工 review）
```

表格列布局（第 1 行表头，第 2 行起数据）：

| 列 | 内容 | 谁写 |
|----|------|------|
| A | Original Source Segment（英文原文，**输入**） | 你 |
| B | Best TM Match（TM 译文） | 扩展 |
| C | Orig Match %（starling 相似度 0-100） | 扩展 |
| D | Rewritten Segment（AI 改写后的原文） | 扩展 |
| E | New Match %（文本相似度 0-100） | 扩展 |
| F | Reached 85%?（Orig ≥ 85 → TRUE） | 扩展 |
| G | CD review valid?（**留空，待你人工勾选**） | 你 |
| H | Comment（AI vs TM 对比说明） | 扩展 |
| I | Source String Key（默认快速 TM 流程留空） | 扩展 |
| J | Project（默认快速 TM 流程留空） | 扩展 |

---

## 1. 前置条件（你的机器必须满足）

本工具依赖三个本机组件，缺一个 TM/AI 功能就不可用。**给同事用前，对方机器也得装齐。**

### 1.1 Chrome 浏览器（macOS）
任意现代 Chrome 即可。本教程以 macOS 为准。

### 1.2 Python 3
macOS 自带（`/usr/bin/python3`，3.9+ 即可）。终端验证：
```bash
python3 --version
```

### 1.3 Node.js（starling-cli 依赖）
装好 Node 后验证：
```bash
node --version   # 建议 18+
```

### 1.4 starling-cli + AK/SK（TM 查询必需）
字节内部工具，只能本机跑：
```bash
# 安装（用字节内网 npm 源）
npm install -g @byted/starling-agent-cli --registry https://bnpm.byted.org

# 登录（浏览器 SSO，非交互）
starling-cli login --begin --no-qr
```

⚠️ **已知坑**：`starling-cli login` 在非交互 TTY 下可能只存 AK 不存 SK，导致 `doctor` 报 `secretKey is required`。
解决办法：手动把 AK/SK 写进 `~/.starling-cli/.starlingrc.json`（字段 `accessKey` / `secretKey`，`chmod 600`），AK/SK 可从 https://starling.bytedance.net/personal_center#aksk 获取。

验证：
```bash
starling-cli doctor          # 应全绿
starling-cli api GET /corpus/tm/match \
  --params '{"projectId":385,"sourceLocale":"en","targetLocale":"zh","sourceText":"Done","leastScore":0,"limit":1}'
# 应返回 完成 100
```

### 1.5 飞书自建应用（读写表格必需）
已建好：应用名 `L10n TM Companion`，App ID `cli_aab1ca4137badbc4`（Secret 在飞书开放平台「凭证与基础信息」取）。
- 已开通权限：`sheets:spreadsheet`（读写电子表格）
- 已发布审核通过
- 已被加为目标电子表格的协作者（可编辑）

> 这些都已为你配好。给同事用要重新建应用走一遍审批。

---

## 2. 安装（一键脚本，3 步）

### Step 1：解压本包
把 zip 解压到任意固定目录，例如 `~/l10n-tm-companion/`（**别放下载/桌面临时目录，路径变了 native host 会失效**）。

### Step 2：跑一键安装脚本
脚本会自动：检查依赖（python3/node/starling-cli）→ 注册 Native Messaging Host → 自检 bridge ping。

```bash
cd ~/l10n-tm-companion/native-host
./install.sh
```

> **扩展 ID 自动探测**：未打包扩展 Chrome 给随机 ID（机器相关），install.sh 会自动从 Chrome `Secure Preferences` 探测本机实际 ID 注册 native host，无需手动对 ID。

看到 `✅ 安装完成！` 即成功。若提示依赖缺失，按提示装齐再重跑。

### Step 3：加载扩展 + 注册 native host
1. 解压分发包
2. 双击「双击安装.command」→ 自动：检查依赖（python3/node/starling-cli）+ 注册 native host（自动探测本机扩展 ID）+ 自检 ping
3. 打开 `chrome://extensions` → 右上角开「开发者模式」→「加载已解压的扩展程序」，选 `l10n-tm-companion` 目录
4. **Cmd+Q 完全退出 Chrome 再开**（native host 清单只在 Chrome 启动时读，重载扩展不够，否则报 forbidden）

> 扩展 ID 是随机的（未打包扩展 Chrome 给随机 ID，机器相关），install.sh 会自动探测本机实际 ID 注册，无需手动对 ID。

### Step 4：设置项目与自动识别工作表
点扩展图标 → 右上角 ⚙️ 设置：
- **飞书凭证**：已预填（App ID/Secret 内置），不用自己建应用。用户自己填了则覆盖。
- **工作表**：在原文 Spreadsheet 或其 wiki 页面打开 Popup，插件会自动使用当前页，无需粘贴链接。它从同一张表的 A 列读取原文，写回同一行的 B–F 与 H–J 列，并始终保留 G 列给人工 CD review。只有要使用另一张表时，才展开 Step 2 的 `Use a different spreadsheet` 并粘贴链接。
- **Starling 项目**：点「加载项目列表」→ 卡片单选（本账号下能看到的所有项目，通常 513 live_client / 385 TikTok_Client / 278 TikTok_main），默认选 385 TikTok_Client
- **Starling AK/SK**：不在本页填。去 [Starling 个人中心](https://starling.bytedance.net/personal_center#aksk) 申请 AK/SK → 终端跑 `starling-cli login` 配好。`starling-cli doctor` 查是否配好。
- **CLI 路径 / 语言**：在「高级」折叠区，留空默认即可，一般不用动。源/目标语言默认 `en`。
- **LLM（可选）**：AI 改写默认关，不开也能正常用 TM。想开：
  - 顶部勾「启用 AI 改写」
  - LLM 提供商下拉选 **Claude** 或 **DeepSeek**（选完 API 地址/模型名自动填好）
  - 填 API Key 即可。DeepSeek preset 已配火山方舟：`https://ark.cn-beijing.volces.com/api/v3/chat/completions` + `deepseek-v4-flash-260425`。要换模型改「模型名」即可（火山方舟用模型 id，如 `deepseek-v4-pro-260425`、`doubao-seed-2-1-pro-260628` 等，在火山方舟控制台「模型」页能看到）。

保存。点「测试飞书连接」应显示「电子表格可访问」；点「测试连接」查 native host 是否通。

### Step 5：准备原文表
你的电子表格必须：
- A1 = 表头（`Original Source Segment`）
- A2 起逐行放英文原文
- B-H 留空（扩展会写表头 B1:H1 + 数据）

> ✅ 当前原文表 `QmG4w6…`（wiki 链接那张）已满足：A1 是表头，A2-A40 共 39 条原文，B-H 全空。写回会无条件补齐 B1:H1 表头（幂等）。

---

## 3. 使用（9 步）

### Step 1：打开原文表页面
在 Chrome 打开你的飞书电子表格页（或任意 larkoffice.com 页面）。

### Step 2：点扩展图标
弹出窗口，顶部「环境检测」显示就绪状态（全绿即可用）。

> ⚠️ 若顶部提示「检测到输出目标指向空表，已自动切换到原文表 QmG4w6…」——说明之前配置过旧空表，已自动修正，按提示重试即可。

### Step 3：读原文
点「📋 从当前表格读 A 列原文」。
扩展用飞书 API 直接读 A 列，零 DOM 噪声。应显示「从表格读到 39 条原文」。

> 「抓取全文」「抓取选中文字」是备选入口（DOM 抓取，可能有噪声），主流程用「读 A 列」。

### Step 4：TM 查询
自动开始查 Starling TM，逐条匹配。39 条约 1-2 分钟（bridge 并发，~0.15s/条）。

### Step 5：AI 改写
对 Orig Match % < 85 的条目，AI 改写英文原文。需要 LLM 配好。

### Step 6：看结果
自动切到「结果」tab，逐条卡片显示：原文 / TM 匹配 / AI 改写 / 对比。点「放大」看大图。

### Step 7：选择采纳
每条可选「保持原文 A」「使用 AI 候选 B」「手动编辑」。只有结构 token 完整且真实 Score B 高于 Score A 时默认采用 B，其余情况默认保持 A。

### Step 8：写回
点底部「写回表格」。扩展按真实行号写到 B-H 列，自动补 B1:H1 表头，A 列原文不动，G 列留空。

### Step 9：人工 review
写回后去表格，逐行看 G 列「CD review valid?」人工勾选 TRUE/FALSE。

---

## 4. 常见问题

**Q：点「读 A 列」报「未读到原文」？**
A：先确认表格 A2 起真的有原文（飞书打开看一眼）。若贴的是 wiki 链接，确认该 wiki 节点挂载的是电子表格而非文档。展开「原始错误」看 `firstRowsDump` 定位原文实际在哪列。常见原因：扩展配置指向了空表——打开扩展若没自动提示切换，手动把目标 URL 改成你的原文 wiki 链接再点「确认目标」。

**Q：环境检测「Native Messaging Host 不可用 / forbidden」？**
A：native host 清单只在 Chrome 启动时读——重跑 `双击安装.command`（或 `native-host/install.sh`，会自动探测本机扩展 ID 注册）后，**Cmd+Q 完全退出 Chrome 再开**。重载扩展不够。扩展 ID 是随机的，install.sh 会自动匹配，无需手动对。

**Q：TM 查询全空 / 全 No TM match？**
A：先看 `/tmp/l10n-bridge-debug.log` 有没有 `recv action=search_tm`。只有 `ping` = 没走到 TM，是读原文这步就空了。有 `search_tm` 但全空 = 这批原文在 TM 库确实没匹配（新文案正常）。**AI 改写默认是关的**——想让它兜底改写，去设置开「启用 AI 改写」并填好 LLM 配置。用 `starling-cli doctor` 查 AK/SK 是否配好。

**Q：AI 改写失败 / 报错？**
A：先确认设置里勾了「启用 AI 改写」、选了 LLM 提供商、填了 API Key。常见报错：
- `AI Error: ...timeout`：火山方舟偶发卡死，已加超时 120s + 单条自动重试一次，重跑通常就好。
- `HTTP 401 invalid api key`：API Key 填错，或 key 跟 endpoint 不匹配（火山方舟 key `ark-...` 要打火山 endpoint，不是 DeepSeek 官方）。
- `HTTP 404 ... not exist`：模型名填错。火山方舟用**模型 id**（如 `deepseek-v4-flash-260425`），在火山方舟控制台「模型」页复制。
- reasoning 列写「>= 85, no rewrite needed」：不是报错，是这条原文 TM 命中已达标，按设计不改写。

AI 改写只影响 Orig<85 的条目，不影响 TM 查询和写回。不需要 AI 时保持关闭即可，纯 TM 流程最稳。

**Q：写回报「valueRanges is nil」？**
A：旧 bug，已修。若再出现，看「原始错误」贴给我。

**Q：给同事用？**
A：把整个 zip 给对方，对方只要装齐 starling-cli + AK/SK + Python + Node，双击「双击安装.command」（自动注册 native host + 探测本机扩展 ID + 自检），再加载扩展、**Cmd+Q 重启 Chrome**、填设置即可。飞书凭证已预填，飞书表记得「共享给飞书应用」一次。

---

## 5. 调试

- **bridge 日志**：`/tmp/l10n-bridge-debug.log`（记录 PATH / starling-cli 路径 / 收到的 action / 崩溃堆栈）。排查步骤：`rm -f /tmp/l10n-bridge-debug.log` → 刷新扩展 → 触发 → `cat` 看。
- **扩展自己的日志**：`chrome://extensions` → 扩展卡片「检查视图 service worker」/「检查视图 popup」→ Console。
- **跑单测**（确认代码没坏）：
  ```bash
  cd ~/l10n-tm-companion
  node test/feishu-sheets.test.js     # 表格读写
  node test/e2e-logic.test.js         # 端到端逻辑
  node test/tm-bm25.test.js           # BM25 兜底
  ```

---

## 6. 文件说明

| 文件 | 作用 |
|------|------|
| `manifest.json` | 扩展清单（MV3，权限/host） |
| `background.js` | Service Worker，转发消息（popup↔content、popup↔native host） |
| `content.js` | 飞书文档 DOM 抓取（次要入口） |
| `popup.html/css/js` | 弹窗 UI + 主流程编排 |
| `options.html/css/js` | 设置页 |
| `lib/feishu-sheets.js` | ⭐ 飞书电子表格 API（读 A 列 / 写 B-H / URL 解析含 wiki） |
| `lib/starling-tm.js` | TM 查询 JS 封装 |
| `lib/ai-translate.js` | AI 改写原文 |
| `lib/diff.js` | 文本相似度 + AI vs TM 对比 |
| `lib/tm-bm25.js` | TM 不可用时的本地 BM25 兜底 |
| `lib/errors.js` | 可操作错误信息 |
| `native-host/starling-bridge.py` | Python 桥接（search_tm / llm_call / ping） |
| `native-host/install.sh` | 一键安装：检查依赖 + 注册 native host + 自检（推荐） |
| `native-host/register-native-host.sh` | 仅注册 native host（需手填扩展 ID，install.sh 内部也调它同款逻辑） |
| `test/*.js` | 单测 |

---

> 一句话：装齐 starling-cli + AK/SK + 注册 native host + 填设置（飞书凭证 + wiki 原文表链接）→ 打开原文表 → 点「读 A 列」→ 等它跑完 → 「写回表格」→ 去 G 列人工 review。完事。
