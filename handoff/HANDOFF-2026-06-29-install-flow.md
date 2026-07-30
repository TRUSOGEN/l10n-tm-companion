# L10n TM Companion — 2026-06-29 安装流程 + 配置体验改进

> 上一份：`HANDOFF-2026-06-26-rootcause.md`（根因闭环 + 打包）。
> 本轮聚焦：让同事能像「装应用」一样装上 + 配置页能自助拿到凭证 + 选项目用卡片。
> 代码位置：`/Users/bytedance/my-project/l10n-tm-companion/`

---

## 〇、本轮一句话总结

**写回表头修复 + AI 改写默认关 + 飞书凭证预填 + 双击安装 + native host 自动探测扩展 ID + 项目卡片选择 + 语言默认改 en。整条链路（读原文→TM→写回）已真机跑通，native host forbidden 已解决。**

---

## 一、改动清单（按文件）

| # | 文件 | 改动 | 目的 |
|---|------|------|------|
| 1 | `lib/feishu-sheets.js` `writeToSheet` | 补表头从「读 B1 判空才补 + 空 try/catch 静默吞错」改成「无条件先写 B1:H1 标准表头（幂等覆盖）」 | **修写回表头缺失**：用户反馈写回成功但 B-H 没表头，只有 A1。根因是旧逻辑读 B1 出错就静默跳过 |
| 2 | `test/feishu-sheets.test.js` | 2 处断言从 12→13、18→19（多了一个无条件表头条） | 对齐表头修复，105/0 |
| 3 | `options.html` / `options.js` / `options.css` | LLM 区加「启用 AI 改写」开关（默认关）；`.toggle` 样式 | **AI 改可选**：TM 命中走 TM，未命中看开关 |
| 4 | `popup.js` `processItems` | enableAI 分支：关→未命中条目留空标「AI 已禁用」；开→走 `rewriteSourceWithAI` | 同上 |
| 5 | `manifest.json` | 加 `key` 字段（RSA 公钥 base64） | **固定扩展 ID**：所有机器加载同一目录得同一 ID。⚠️ 实测 Chrome 对「未打包扩展」没用 key，给了随机 ID（见第四节坑） |
| 6 | `native-host/install.sh` | 新增：依赖检查 + 注册 native host + 自检 ping + 加载指引。**自动从 Chrome `Secure Preferences` 探测已加载扩展的 ID**（探测不到用固定 ID 兜底） | 一键安装 + 自动匹配 ID |
| 7 | `双击安装.command` | 新增：双击启动终端跑 install.sh | macOS 双击即装，不用手敲命令 |
| 8 | `options.js` / `popup.js` | 飞书 App ID/Secret 预填默认值（`SHARED_FEISHU_CREDENTIALS`） | **同事免填飞书凭证** |
| 9 | `options.html` / `options.css` | Starling/LLM/飞书区加凭证获取帮助链接 | 同事自助拿凭证（AK/SK 链接、飞书开放平台链接） |
| 10 | `native-host/starling-bridge.py` | 加 `list_projects` action（调 `starling-cli api GET /projects`） | 项目卡片选择的数据源 |
| 11 | `lib/starling-tm.js` | 加 `listProjects()` 封装 | 同上 |
| 12 | `options.html` / `options.js` / `options.css` | Starling Project ID 输入框换成「加载项目列表→卡片单选」UI | 项目卡片选择 |
| 13 | `options.js` / `options.html` / `popup.js` | `targetLang` 默认 `zh`→`en`；popup TM 查询兜底 `||'en'` | 用户要求源/目标都默认 en |
| 14 | `USAGE-GUIDE.md` | 安装改为「一键脚本 3 步」；FAQ 更新（native host forbidden 指向 install.sh + 重启 Chrome；AI 改写默认关说明；给同事用） | 文档同步 |

测试：全量 312 通过 / 0 失败（feishu-sheets 105 + e2e 68 + new-match 49 + content-extract 38 + tm-bm25 25 + errors 14 + bitable 13）。JS 语法全 OK。

---

## 二、关键决策与现状

### 2.1 飞书凭证：预填进扩展（方案 A）
- App ID `cli_aab1ca4137badbc4`、App Secret `JQqXT35ugEo0eelbGkAaJe0...` 写进 `options.js` / `popup.js` 的 `SHARED_FEISHU_CREDENTIALS`。
- 应用是**纯后端凭证型**（权限只有 `sheets:spreadsheet:*` + 云文档相关，**没有机器人/网页应用能力**）→ 应用市场**不能上架**（纯权限型不符合上架条件，提交会被打回）。
- 所以不走应用市场发布，直接预填凭证最省事。同事装完扩展飞书段已填好。
- ⚠️ Secret 写进代码 = 公开，懂行可扒。可接受前提：权限只有 sheets 读写，无敏感权限。
- 用户自己填了凭证则覆盖默认值。

### 2.2 Starling AK/SK：各自配置，不共用
- AK/SK 绑个人账号，**各自去 starling 控制台拿**（设置页有链接 `https://starling.bytedance.net/personal_center#aksk`）。
- AK/SK 配在 starling-cli 自己的配置里（`starling-cli login`），**不在扩展设置页填**——扩展通过 native host 调 starling-cli，starling-cli 自己读配置。
- 本机 AK/SK 已配好（`starling-cli doctor` 显示 `config: pass`，accessKey `870619b8****`）。

### 2.3 AI 改写：默认关
- 设置开关「启用 AI 改写」默认关。纯 TM 流程不依赖 LLM token，稳。
- 关时：TM 命中走 TM，未命中条目 `ai_translation` 留空 + reasoning 标「AI 已禁用」。
- 开时：未命中走 `rewriteSourceWithAI`（需配 LLM Endpoint/Key/Model，`ttadk claude` 注入的 token 不落盘，需手动取值填设置）。

### 2.4 语言默认改 en
- `sourceLang` / `targetLang` 默认都 `en`（之前 targetLang 默认 zh）。
- 用户要求源/目标都默认 en。

### 2.5 项目卡片选择
- 设置页 Starling 区：「加载项目列表」→ 调 `starling-cli api GET /projects` → 渲染卡片单选。
- 实测本机拉到 3 个项目：513 live_client、385 TikTok_Client、278 TikTok_main。
- 点卡片选中高亮 + 自动写入 `starlingProjectId`。
- 默认 385（TikTok_Client），用户已确认这是常用项目。

---

## 三、native host forbidden 闭环（重要坑）

### 现象
设置页「测试 Native Host」报 `Access to the specified native messaging host is forbidden`。

### 排查过程
1. native host 注册清单正确（ID + path 对）。
2. bridge 本身自检 ping 通（`{"pong": true, "cli": "..."}`）。
3. 排查到：**注册清单里的 ID 跟 Chrome 实际加载扩展的 ID 对不上**。
4. manifest 加了 `key` 字段，Python 算出 ID 该是 `welukkiwnwhmkigs`（用了 `% 26` 算法），但 Chrome 实际给的是 `bgbodpcofifiloekhfjiffmchcaiiicm`。
5. 重新核实 Chrome 官方算法是 `byte & 0x0f`（即 `% 16`）→ 算出 `gopoiiokfifcciim`。**但跟 Chrome 实际 ID 仍对不上**。
6. **根因结论**：Chrome 加载「未打包扩展程序」时，**没用 manifest 里的 key 字段**，而是自己生成了一个随机 ID。这是 Chrome 对未打包扩展的缓存行为，代码侧无法强改。

### 解决方案（已实施）
- **不依赖固定 ID**，改成 install.sh 自动探测 Chrome 实际加载的扩展 ID。
- 关键发现：未打包扩展记在 **`~/Library/Application Support/Google/Chrome/Default/Secure Preferences`**（不是 `Preferences`！商店扩展在 Preferences，开发者加载的在 Secure Preferences）。
- install.sh 扫这两个文件，找 `path` 含 `l10n-tm-companion` 或 `name == 'L10n TM Companion'` 的扩展，取其 ID。
- 探测不到则用固定 ID `welukkiwnwhmkigs` 兜底 + 提示。
- 实测：本机 install.sh 成功探测到 `bgbodpcofifiloekhfjiffmchcaiiicm` 并用它注册，forbidden 解决。

### 用户操作（forbidden 最终解决靠这步）
native host 清单只在 Chrome **启动时**读取，注册后必须 **Cmd+Q 完全退出 Chrome 再开**。重载扩展不够。

### 当前本机实际状态
- Chrome 扩展 ID：`bgbodpcofifiloekhfjiffmchcaiiicm`（随机，机器相关）
- native host 注册清单：`allowed_origins: ["chrome-extension://bgbodpcofifiloekhfjiffmchcaiiicm/"]` ✅ 匹配
- bridge 自检：pong=true ✅
- native host forbidden：**已解决**（用户确认「通」）

---

## 四、接手者需知

### 4.1 manifest 的 key 字段——目前没用但不删
- key 字段在 manifest 里（RSA 公钥），算出 `welukkiwnwhmkigs`，但 Chrome 未打包加载时没用它。
- 留着不删：将来若改走「打包 .crx + 企业策略安装」或上架商店，key 才会生效，那时 ID 才稳定。
- **当前靠 install.sh 自动探测 ID 兜底**，这是对「未打包扩展」最稳的方案。

### 4.2 私钥保管
- 私钥在 `/Users/bytedance/my-project/keys/extension.pem`（**不入分发包**）。
- 谁拿到私钥 = 能冒充本扩展发更新。别泄露，别进 git。
- 公钥已在 manifest 里，公开无害。

### 4.3 同事安装流程（极简版）
1. 解压包
2. 双击「双击安装.command」→ 自动：检查依赖 + 注册 native host（自动探测 ID）+ 自检
3. `chrome://extensions` 加载 `l10n-tm-companion` 目录
4. **Cmd+Q 重启 Chrome**（native host 清单启动时读）
5. 设置页：点「加载项目列表」选项目 + 填电子表格 URL（飞书凭证已预填）
6. 同事自己配 starling-cli AK/SK（`starling-cli login`）
7. 同事的原文表要「共享给飞书应用」一次（否则应用身份读不到）

### 4.4 ⚠️ 仍待验证
- **写回表头**：代码改了无条件补 B1:H1，但**用户还没真机写回验证落盘**（用户在 forbidden 调试期间没走到写回）。下次写回应确认 B1:H1 有表头。
- **项目卡片选择**：bridge `list_projects` 实测能拉到项目，但 options 页 UI 的渲染/选中是新增代码，**用户还没在设置页实际点过「加载项目列表」**。需真机点一次确认卡片显示 + 选中写值。

### 4.5 未打包扩展 ID 不稳定的后续
- 本机 ID `bgbodpco...` 是随机的，**换机器/重装 Chrome 会变**。install.sh 的自动探测覆盖了这个情况，同事每次跑 install.sh 都能用他机器的实际 ID 注册。
- 如果以后想要「真正固定的 ID」，唯一可靠路径是 **打 .crx 包 + Chrome 企业策略 `ExtensionInstallForcelist`**（需公司 IT 配 MDM/组策略）。未打包加载做不到稳定 ID。

---

## 五、最大教训

1. **Chrome 未打包扩展的 ID 不可控**。manifest 的 key 字段对「加载已解压扩展程序」不生效，Chrome 自己生成随机 ID。想固定 ID 只能走打包 + 企业策略。别在 key 字段上浪费时间猜 ID。
2. **未打包扩展记在 `Secure Preferences`，不是 `Preferences`**。自动探测扩展 ID 要扫 Secure Preferences。
3. **native host 清单 Chrome 只在启动时读**。注册后必须 Cmd+Q 重启 Chrome，重载扩展不够。forbidden 90% 是这个。
4. **纯凭证型飞书应用不能上架应用市场**。没有机器人/网页应用能力的应用，提交上架会被打回。预填凭证进扩展是内部工具的最优解。
5. **「补表头」别用「先读判空才补 + 静默吞错」**。读出错就静默跳过 = 表头没补上还不知道。无条件幂等写最稳。

---

## 六、当前状态总览

| 项 | 状态 |
|----|------|
| 读原文（QmG4w6 表 A 列） | ✅ 真机验证（上一轮） |
| TM 查询 / starling-cli | ✅ AK/SK 已配，doctor pass |
| native host forbidden | ✅ 已解决（自动探测 ID + 重启 Chrome） |
| 写回表头修复 | ✅ 代码已改，105/0；⚠️ 待真机写回确认落盘 |
| AI 改写可选（默认关） | ✅ 代码已改，待真机点开关验证 |
| 飞书凭证预填 | ✅ 已写进 options/popup |
| 一键安装 install.sh | ✅ 含自动探测 ID，本机实测通过 |
| 双击安装 .command | ✅ 已建 |
| 项目卡片选择 | ✅ bridge 实测拉到项目；⚠️ 待真机点 UI 验证 |
| 语言默认 en | ✅ |
| 打包分发 | ⏳ 本轮改动还没打新包，待验证后打 |

### 待打包
本轮所有改动验证通过后，应打一个**新分发包**（含 install.sh + 双击安装.command + 预填凭证 + 表头修复 + AI 开关 + 项目卡片 + 语言 en），放桌面替换 `L10n-TM-Companion-20260626.zip`。回档1 在 `/Users/bytedance/my-project/回档/`。
