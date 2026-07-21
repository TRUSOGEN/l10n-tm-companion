# L10n TM Companion — 安装与使用指南（分享版）

> Chrome 扩展：从飞书文档抓取英文原文 → 查 Starling TM 记忆库 → AI 改写提升 TM 命中率 → 算匹配度 → 写回飞书电子表格。
> 纯客户端，无后端，全程在本机运行。

---

## 一、它能做什么

输入一段英文文案（或从飞书文档批量抓取），扩展会：

1. 在 Starling TM 记忆库里找最相似的历史译文（Orig Match %）
2. 对命中率低于 85% 的条目，AI 改写原文让它更贴近 TM 已有原文（Rewritten Segment）
3. 算改写后的 New Match %
4. 给出对比结论（improved / same / different / no_tm）
5. 你选择采纳来源后，一键写回飞书电子表格

---

## 二、前置条件（重要）

本扩展依赖三个**本机环境**，缺一不可。请先确认你具备：

| 条件 | 说明 |
|------|------|
| macOS | 本教程基于 macOS（Windows/Linux 需自行调整路径） |
| Chrome 浏览器 | MV3 扩展 |
| Python 3 | 系统自带或 `python3 --version` 能跑 |
| **Starling CLI + AK/SK** | 字节内部 TM 工具。CLI 需安装；AK/SK 直接在扩展 Settings 配置 |
| **LLM 网关访问** | 用于 AI 改写。需有可用的 LLM endpoint + key |
| **飞书自建应用** | 已发布，开通 Sheets 读写权限，tenant_access_token 鉴权 |

> ⚠️ Starling CLI 与 LLM 网关是字节内部资源。若你不在字节内网或未开通，TM 查询与 AI 改写功能不可用，但扩展仍可加载。

---

## 三、安装步骤

### Step 1：加载 Chrome 扩展

1. 打开 Chrome，地址栏输入 `chrome://extensions`
2. 右上角开启「开发者模式」
3. 点「加载已解压的扩展程序」，选择解压后的 `l10n-tm-companion/` 目录
4. 记下扩展 ID（卡片上可见，形如 `bgnakecphongbinlnmgnhoefgjecdang`）

### Step 2：注册 Native Messaging Host

扩展通过 Native Messaging 调用本机 Python 脚本与 Starling CLI 通信，必须注册：

```bash
cd l10n-tm-companion/native-host
./register-native-host.sh <你的扩展ID>
```

脚本会：
- 把 `starling-bridge.py` 设为可执行
- 在 `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` 写入注册清单
- `allowed_origins` 自动绑定你传入的扩展 ID

> ⚠️ 注册清单中 `path` 必须是绝对路径，脚本已自动处理。重装导致扩展 ID 变化时需重新运行此脚本。

### Step 3：确认 Starling CLI 运行时

确保 `starling-cli` 已安装；AK/SK 不需要在 Terminal 配置：

```bash
starling-cli --version
```

### Step 4：在扩展设置页填参数

点扩展图标 → ⚙️ 设置，填写：

| 配置 | 说明 |
|------|------|
| Starling AK / SK | 完整填写两项，点击 `Save & Verify`；默认圆点遮挡，眼睛按钮显示完整值 |
| Starling CLI 路径 | 通常留空；Chrome 自动检测失败时再填绝对路径 |
| LLM Provider / Endpoint / Key / Model | Claude 或 OpenAI 兼容格式 |
| 飞书 App ID / Secret | 自建应用的凭证 |

`Save & Verify` 会把 AK/SK 同时写入 Chrome 本地副本和 Starling 官方配置，并真实加载权限项目。填完再点「测试 Native Host」「测试飞书连接」验证基础环境。

### Step 5：在 Popup 选择本次运行配置

Popup 自动列出当前 AK/SK 有权访问的项目。选择一个 vendor、一至十个同 source locale 的项目，再从共同 `targetLocales` 中选择一个 target locale。选择会立即记住；缺少任一项时读取与 TM 查询正确停止并展开引导。

### Step 6：飞书表格加应用为协作者

1. 打开目标飞书电子表格
2. 右上角「...」→「更多」→「添加协作者」
3. 搜索你的飞书应用名，授予「可编辑」权限

---

## 四、使用步骤

1. 在 Settings 完成 AK/SK `Save & Verify`
2. 在 Popup 选择 vendor、权限项目和 target locale
3. 从飞书 Spreadsheet 页面打开 Popup；当前表会自动成为 Working spreadsheet
4. 点击 `Read column A from current sheet`；文档 DOM 抓取位于折叠的 `Other sources`
4. 自动触发 Starling TM 相似度匹配，生成 Orig Match %
5. 查看每条文案的 Best TM Match、Orig Match % 与来源
6. 对未达标（<85%）的条目查看 AI 改写建议（Rewritten Segment）与 New Match %
7. 查看对比结论 Comment（improved / same / different / no_tm）
8. 在每张卡片选择「采纳AI」/「沿用TM」/「手动编辑」，可点「放大」查看详情
9. 点击「写回表格」，结果按真实行号写入飞书表格 B–F/H–J，G 列保留人工 CD review

> 💡 wiki/doc 页若「抓取全文」抓不到，可选中文字用「抓取选中文字」（走 `window.getSelection()`，不依赖 DOM 选择器，几乎一定能抓到）。

> ⚠️ 条目多时 TM 查询较慢（每条 1-2s 串行查询），请耐心等待进度完成。

---

## 五、写回的表格字段

写回按以下表头定位（默认英文，可在 Options「字段映射」覆盖）：

| 列 | 字段 |
|----|------|
| A | Original Source Segment（原表已有原文） |
| B | Best TM Match |
| C | Orig Match % |
| D | Rewritten Segment |
| E | New Match % |
| F | Reached 85%? |
| G | CD review valid?（始终留空，人工审核） |
| H | Comment |
| I | Source String Key（默认快速流程留空） |
| J | Project（默认快速流程留空） |

---

## 六、常见问题

### Q: 点「抓取全文」提示「未抓取到文案」
A: 飞书 wiki/doc 页面 DOM 结构多变。请改为**选中文字后点「抓取选中文字」**，走 `window.getSelection()`，几乎一定能抓到。

### Q: TM 全部显示「No TM match」
A: 多半是 Chrome 启动 native host 子进程时 PATH 极简，找不到 `starling-cli`。排查：
```bash
rm -f /tmp/l10n-bridge-debug.log   # 清日志
# 刷新扩展 → 触发流程 →
cat /tmp/l10n-bridge-debug.log     # 看 which starling-cli 是否 None
```
若 `which starling-cli` 是 None，说明 Chrome 环境找不到 CLI，需在设置页填绝对路径（终端跑 `which starling-cli` 拿到）。

### Q: Popup 没有项目或提示 Setup required
A: 打开 Settings，完整填写 AK/SK 后点击 `Save & Verify`。项目列表只接受真实 `/projects` 结果；AK/SK、Native Host 或权限验证失败时不会使用默认项目继续查询。

### Q: 提示「Error when communicating with the native messaging host」
A: 通常是 MV3 Service Worker 空闲休眠，首条消息撞 SW 未唤醒。刷新扩展重新唤醒即可。若持续报错，检查 Step 2 的 Native Messaging Host 注册是否成功（扩展 ID 是否匹配）。

### Q: 写回失败「valueRanges is nil」
A: 检查目标表格是否为飞书电子表格（不是多维表格 Bitable）。本扩展暂不支持 Bitable 写回。

### Q: AI 改写没反应
A: AI 改写仅对 Orig Match % < 85% 的条目触发。若原文已高匹配，不会改写。同时确认 LLM 设置页的 Endpoint / Key / Model 已正确填写。

---

## 七、调试

```bash
# 手动测试 bridge（Native Messaging 协议）
echo '{"action":"ping"}' | python3 -c \
  "import sys,json,struct; m=sys.stdin.read().encode(); sys.stdout.buffer.write(struct.pack('=I',len(m))+m)" \
  | python3 native-host/starling-bridge.py

# native host 排查日志
rm -f /tmp/l10n-bridge-debug.log
# 刷新扩展 → 触发流程 →
cat /tmp/l10n-bridge-debug.log
```

各层日志位置：
- Service Worker：`chrome://extensions` → 该扩展 → 「Service Worker」
- Content Script：飞书页面的 DevTools Console
- Popup：右键扩展图标 → 「检查弹出内容」

---

## 八、安全

- Starling AK/SK 同时存于 Chrome 本地存储和 Starling 官方配置；两处均为本机持久化，不承诺硬件级加密
- AK/SK 可以完整回填，默认遮挡；日志、错误与飞书写回不得记录凭证明文
- 飞书 App Secret 与 LLM API Key 存于 `chrome.storage.local`，不经过项目自建后端
- TM 数据留在用户本地机器
- 高风险内容（金钱/法律/未成年人相关）请人工确认后再写入表格

---

## 九、文件结构

```
l10n-tm-companion/
├── manifest.json              # MV3 清单
├── background.js              # Service Worker，消息转发 + Native Messaging
├── content.js                 # 飞书文档抓取（含全文兜底）
├── popup.html / .css / .js    # 弹窗 UI（双 tab：主流程/结果）
├── options.html / .css / .js  # 设置页
├── lib/                       # starling-tm / run-config / pricing-rules / feishu-sheets 等
├── native-host/               # bridge + Starling 凭证/批量请求 helper + 注册脚本
├── test/                      # JavaScript/Python 回归与协议测试
├── icons/
├── README.md
└── GUIDE-分享版.md            # 本文件
```
