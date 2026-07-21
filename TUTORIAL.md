# L10n TM Companion 完整使用教程～

> 从零到跑通：飞书文档 → Starling TM → AI 翻译 → 对比 → 写入多维表格，全流程手把手～

本教程专为字节 TikTok LIVE CD&LOC 团队定制，基于你的真实机器环境（wuyegen@bytedance.com）。按顺序完成 6 步即可使用，每步都附「常见问题」排错～

---

## 📋 准备清单（你的现状）

我已在你这台 Mac 上检测过，结果如下：

| 条件 | 状态 | 说明 |
|------|------|------|
| Chrome 浏览器 | ✅ 已有 | — |
| Homebrew | ✅ 已装 | 6.0.3 |
| Python 3 | ✅ 已装 | 3.9.6（`/usr/bin/python3`） |
| Xcode 命令行工具 | ✅ 已装 | — |
| LLM 网关 | ✅ 已配好 | LLMBox，走 SSO，无需申请 Key～ |
| Starling CLI | ❌ 需装 | 内部工具，见 Step 4～ |
| 飞书自建应用 | ❌ 需建 | 见 Step 2～ |
| 多维表格 | ❌ 需建 | 见 Step 3～ |

好消息：你**不需要装 Python**（系统自带），也**不需要申请任何外部 API Key**（内部 LLM 网关已配好）～ 你真正要做的只有：装 Starling CLI、建飞书应用、建多维表格～

---

## Step 1️⃣ 加载 Chrome 扩展～

1. 打开 Chrome，地址栏输入 `chrome://extensions`～
2. 右上角打开「开发者模式」开关～
3. 点左上角「加载已解压的扩展程序」～
4. 选择目录：`/Users/bytedance/my-project/l10n-tm-companion`～
5. 扩展列表出现 **L10n TM Companion**，记下它的 **ID**（一串小写字母，如 `abcdefghijklmnopqrstuvwxyzabcdef`），Step 5 注册 Native Messaging Host 要用～

**常见问题：**
- *无法加载*：确认选的是含 `manifest.json` 的目录本身～
- *看不到 ID*：开启开发者模式后点扩展卡片展开即可见～

---

## Step 2️⃣ 新建飞书自建应用（从零，保姆级）～

### 2.1 进入开放平台～

1. 浏览器打开 https://open.feishu.cn/app～
2. 用飞书账号登录（你的字节账号会自动跳转）～
3. 点「创建企业自建应用」～

### 2.2 填基本信息～

- **应用名称**：`L10n TM Companion`～
- **应用描述**：`飞书文档翻译辅助：抓取原文 → TM 查询 → AI 翻译 → 写入多维表格`～
- 应用图标随便传一个（或用扩展 icons 里的）～
- 点「创建」～

### 2.3 拿凭证（App ID + Secret）～

1. 进入应用 → 左侧菜单「凭证与基础信息」～
2. 看到：
   - **App ID**：`cli_xxxxxxxxxx` ← 复制保存～
   - **App Secret**：点「显示」→ 复制 → **立刻存到记事本**（只显示一次！）～

### 2.4 开通权限（关键）～

1. 左侧菜单「权限管理」→ 顶部「API 权限」标签～
2. 搜索 `bitable`，把相关权限全部勾上并申请开通：
   - `bitable:app`（查看、评论、编辑和管理多维表格）～
   - 搜索 bitable 出现的读写权限都勾～
3. 点「申请开通」走审批～

> 字节内部应用审批一般几小时到一天，实习生可能需 leader 批准～

### 2.5 发布应用～

1. 左侧菜单「版本管理与发布」～
2. 「创建版本」：版本号 `1.0.0`，更新说明随意～
3. 「申请发布」→ 等审批通过～

> ⚠️ 审批通过前，扩展测试飞书连接会报权限错误，属正常～

---

## Step 3️⃣ 新建多维表格 + 预置字段～

### 3.1 建表～

1. 飞书首页 https://www.feishu.cn →「云文档」→「新建」→「多维表格」～
2. 起名，比如 `L10n TM Tracker`～

### 3.2 取 App Token 和 Table ID～

看地址栏 URL：
```
https://xxx.feishu.cn/base/bascnXXXXXXXXXXXX?table=tblYYYYYYYYYYYY
```
- **App Token** = `bascn` 后面那串～
- **Table ID** = `tbl` 后面那串～
复制保存～

### 3.3 建 6 个字段（名字必须完全一致）～

点表头「+」新建字段：

| 字段名 | 类型 |
|------|------|
| 原文案 | 多行文本 |
| TM最相似翻译 | 多行文本 |
| 相似度 | 数字 ⚠️ 不是文本 |
| TM来源 | 单行文本 |
| AI推荐翻译 | 多行文本 |
| AI vs TM对比 | 多行文本 |

> 建表自带第一个「文本」字段，直接改名「原文案」省事～

### 3.4 把应用加进表格（否则写不进去！）～

1. 表格右上角「...」→「更多」→「添加文档应用」～
2. 搜 Step 2 建的应用 `L10n TM Companion`～
3. 添加 → 权限选「可编辑」～

> 这步最易漏，漏了会报 `permission denied`，务必做～

---

## Step 4️⃣ 安装 Starling CLI～

这是 TikTok 内部 TM 查询工具，没装在公共源里。按以下顺序找～

### 4.1 先查是不是其实已经装了～

```bash
which starling
ls ~/.local/bin/starling 2>/dev/null
find /opt /usr/local /Users/$USER -name "starling" -type f 2>/dev/null | head
```
找到就记下路径，Options 里 Starling CLI 路径填它～

### 4.2 走内部渠道（推荐顺序）～

1. **问你的 LPM / mentor**：你是 LIVE-CD&LOC 实习生，团队里肯定有人用过 Starling，直接问最快～
2. **查内部知识库**：内部 Wiki / Confluence 搜「Starling CLI 安装」，或 code.byted.org 搜 `starling`～
3. **走 ttadk plugin**（你这台装了 ttadk）：
   ```bash
   ttadk plugin list
   ttadk plugin search starling
   ttadk plugin install starling
   ```

### 4.3 装好后验证～

```bash
starling --version
starling tm search --help   # 顺便确认参数格式
```

> ⚠️ **Starling 没装也能用扩展其他功能**：TM 查询会优雅降级（显示空 TM），但 AI 翻译、对比、写入飞书都能正常工作～ 先把 LLM + 飞书配好跑通，Starling 慢慢装～

### 4.4 装好后告诉我命令格式～

装好后跑 `starling tm search --help`，把输出贴给我，我改 `native-host/starling-bridge.py` 里的 `build_search_cmd` 和 `_parse_cli_output` 两个函数～ **你不用碰代码**，贴 `--help` 给我就行～

---

## Step 5️⃣ 注册 Native Messaging Host～

这一步让 Chrome 能调用本地 Starling CLI～

1. 终端执行：
   ```bash
   cd /Users/bytedance/my-project/l10n-tm-companion/native-host
   ./register-native-host.sh <粘贴 Step 1 的扩展 ID>
   ```
2. 看到 `✅ Native Messaging Host 已注册` 即成功～
3. 验证桥接：
   ```bash
   echo '{"action":"ping"}' | python3 -c \
     "import sys,json,struct; m=sys.stdin.read().encode(); sys.stdout.buffer.write(struct.pack('=I',len(m))+m)" \
     | python3 starling-bridge.py
   ```
   返回 `{"pong": true, ...}` 即正常～

> ⚠️ 注册清单里 `path` 必须绝对路径，脚本已自动处理，**不要移动 `l10n-tm-companion` 目录**，否则路径失效需重新注册～

**常见问题：**
- *ping 不通*：确认注册清单文件存在、`allowed_origins` 里的扩展 ID 与实际一致、重启 Chrome～
- *Starling 还没装也能 ping 通*：ping 只测 Python 桥接，不调 CLI～

---

## Step 6️⃣ 填配置 + 连接测试～

点扩展图标 → ⚙️，分三块填：

### 6.1 🤖 LLM API（用内部网关，已配好）～

我查到你机器上有这套环境变量（`ttadk claude` 自动配的）：
```
ANTHROPIC_BASE_URL=https://llmbox-global.byteintl.net/
ANTHROPIC_AUTH_TOKEN=at-fe3cda6f8643901276b4883845f36065c476a711
```

直接照抄填入：

| Options 字段 | 填这个值 |
|------|------|
| API Provider | `Claude (Anthropic)` |
| LLM API Endpoint | `https://llmbox-global.byteintl.net/v1/messages` |
| LLM API Key | `at-fe3cda6f8643901276b4883845f36065c476a711` |
| LLM Model | `glm-5.2`（或 `claude-sonnet-4-6`，看网关支持哪个） |
| 目标语言 | 按需选 ja/ko/zh/en |

> ⚠️ Endpoint 末尾要加 `/v1/messages`～
> token 过期（约 2 周）后，重跑 `ttadk claude` 续签 SSO，再 `echo $ANTHROPIC_AUTH_TOKEN` 拿新值填回～

### 6.2 📊 飞书多维表格～

| Options 字段 | 填 |
|------|------|
| 飞书 App ID | Step 2.3 拿的 `cli_...` |
| 飞书 App Secret | Step 2.3 拿的 Secret |
| 多维表格 App Token | Step 3.2 拿的 `bascn...` |
| 多维表格 Table ID | Step 3.2 拿的 `tbl...` |

### 6.3 🌐 Starling CLI～

- Starling CLI 路径：填 `starling` 或绝对路径（Step 4.1 查到的）～

### 6.4 连接测试 + 保存～

1. 点「测试 Native Host」→ ✅～
2. 点「测试飞书连接」→ ✅（审批通过后才会成功）～
3. 点底部「💾 保存设置」～

---

## Step 7️⃣ 使用流程～

1. 打开飞书文档（URL 形如 `https://xxx.feishu.cn/docx/...`）～
2. 点 Chrome 工具栏的 **L10n TM Companion** 图标～
3. 选抓取方式：
   - **📥 抓取全文**：自动提取所有段落～
   - **✋ 选中查询**：先在文档选中一段文字再点此按钮～
4. 等进度条走完：`查询 TM → AI 翻译 → 对比`～
5. 每张卡片选「采纳AI」/「沿用TM」/「手动」，点「详情」看完整对比～
6. 点底部「📤 写入飞书表格」，弹出 `✅ 写入成功` 即完成～

### 结果卡片状态说明～

| 标签 | 含义 | 建议 |
|------|------|------|
| `no_tm` | TM 无匹配 | 采纳 AI |
| `same` | AI 与 TM 一致 | 沿用 TM |
| `improved` | AI 优于 TM（低相似 TM） | 采纳 AI |
| `different` | AI 与 TM 不同（高相似 TM 仍有差异） | 人工确认 |

> 🛡 agent.md 的 Safety & Guardrails 要求：金钱/收益/处罚/未成年人/法律/高曝光活动等高风险内容，AI 只能辅助，**必须人工确认后才写入**～

---

## ⚠️ 关于 LLM 网关浏览器直连的提醒～

LLMBox 网关是给 `ttadk claude`（命令行）用的，**不一定允许 Chrome 浏览器跨域直连 (CORS)**～ 扩展代码已加 `anthropic-dangerous-direct-browser-access: true` 头，但如果测试报 CORS 错误，说明该网关不允许浏览器直连，这时候有两个选择：

- (A) 换一个允许浏览器访问的内部网关 endpoint（问 AI2D 同事）～
- (B) 让我给你写个本地代理脚本（约 20 行），配合 Native Messaging 转发请求，绕过浏览器 CORS～

---

## ✅ 完成自检～

终端执行：
```bash
python3 --version                    # 期望 Python 3.9.6+
echo "LLM Token: $ANTHROPIC_AUTH_TOKEN"   # 不为空
which starling && starling --version      # 装好后才通过
```

记事本备齐这 5 样：
- [ ] LLM Token = `at-fe3cda6f8643901276b4883845f36065c476a711`（过期就重跑 ttadk claude）～
- [ ] LLM Endpoint = `https://llmbox-global.byteintl.net/v1/messages`～
- [ ] 飞书 App ID + App Secret～
- [ ] 多维表格 App Token + Table ID～
- [ ] Starling CLI 路径（没装可暂缺）～

**全部齐了后**，按 Step 6 填配置即可 🎉

---

## 🐞 调试技巧～

| 想看什么日志 | 在哪看 |
|------------|-------|
| Service Worker（消息转发 / Native Messaging） | `chrome://extensions` → 扩展 →「Service Worker」 |
| Content Script（飞书页面抓取） | 飞书文档页面 → F12 → Console |
| Popup 逻辑 | 右键扩展图标 →「检查弹出内容」 |
| Options 逻辑 | Options 页 → F12 → Console |
| Python bridge | 终端手动跑 bridge 脚本看输出 |

> 改了 `starling-bridge.py` 后，需**重启 Chrome**让 native host 重新加载～

---

## 🆘 卡住时找谁～

| 问题 | 找谁 |
|------|------|
| Starling CLI 装不上 | 团队 LPM / mentor |
| 飞书应用审批慢 | 部门管理员 / leader |
| LLM 网关 CORS / token 过期 | AI2D 同事 / ttadk 文档 |
| 多维表格字段写不进 | 把报错发给我，我帮定位 |

任何一步报错，把**完整错误信息**发我～
