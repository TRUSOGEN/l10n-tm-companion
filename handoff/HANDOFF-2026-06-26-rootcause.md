# L10n TM Companion — 「抓不到」根因闭环（2026-06-26）

> 本轮用飞书 API 直连实测，**彻底锁定「表格/文档都抓不到」的真正根因**，推翻之前所有 handoff 靠 DOM 猜测的结论。
> 代码位置：`/Users/bytedance/my-project/l10n-tm-companion/`

---

## 〇、根因（一句话）

**扩展的输出目标配错了表。** storage 里 `spreadsheetToken=Tjyfs3...`（615 行，**A 列全空**），而真正的原文在 wiki 链接 `QmG4w6...` 背后的另一张表（40 行，A 列 39 条干净英文原文）。`listSourceSegments` 死读 `Tjyfs3` 的 A2:A → 全空 → 永远报「未读到原文」。**不是抓取代码坏、不是权限、不是 DOM 选择器。**

---

## 一、实测铁证（飞书 API 直连，非读代码）

取 tenant token → 列 sheets → dump，3 个 curl 锁定：

| 实测 | 结果 |
|------|------|
| `Tjyfs3...` 表 A1:A615 全列 | **0 条非空**（615 行全空） |
| `Tjyfs3...` 表 B 列 | 186 条稀疏旧噪声残渣（之前 DOM 抓取跑过一次留下的 no_tm/different 状态） |
| wiki 链接 `QmG4w6...` | 背后是另一张电子表格，sheet_id `9a9d2d`，40 行 |
| `QmG4w6` 表 A1 | `Original Source Segment`（表头）✅ |
| `QmG4w6` 表 A2:A40 | **39 条干净英文原文**（`Divine Flame`、`Hawaiian Ukulele`、`Run a speed test...` 等）✅ |
| `QmG4w6` 表 B-H | 全空，待写入结果 |

**关键认知：飞书 wiki 中「挂载电子表格」的节点，wiki token（URL 里 `/wiki/<token>` 那段）本身就是该 spreadsheet 的 token，可直接用 Sheets API 读写。** 实测 `sheets/v3/spreadsheets/QmG4w6.../sheets/query` 返回 sheet 列表，读 `9a9d2d!A2:A` 拿到 39 条。

---

## 二、TM 链路本身没问题（实测）

- bridge 日志确认能收到 `search_tm` action（之前日志只有 ping，是因为读原文这步就空了，根本没走到 TM）
- starling-cli 直接查项目 385：`Done→完成(100)`、`Confirm→確認(100)`、`Cancel→取消(100)`、`Settings→隐私设置(58)` 全命中 ✅
- 那 39 条原文（`Divine Flame` 等）在项目 385 TM 库里**确实无匹配**（`total:0`）——这是正常业务情况（新文案 TM 库没有），不是 bug。会显示 No TM match → 走 AI 改写。

---

## 三、本轮代码修复

| 文件 | 改动 | 目的 |
|------|------|------|
| `lib/feishu-sheets.js` `parseFeishuUrl` | 加 `/wiki/<token>` 识别 → 当 sheet 类型，wiki token 即 spreadsheetToken | **核心 bug**：之前不认 wiki 链接，贴 wiki URL 解析不出 token → 报「未设置写入目标」 |
| `lib/feishu-sheets.js` `parseSheetsUrl` | 同步加 wiki 识别 | health check 也能识别 wiki 目标 |
| `popup.js` | 加 `migrateWrongSheetToken()`：检测 storage token=`Tjyfs3...` 自动切到 `QmG4w6...` 并提示 | 用户一开扩展就自动修好指向，无需手动改配置 |
| `popup.js` `readFromSheet` | 读空时报错加可操作指引（贴 wiki 链接/确认挂载的是表格） | 不再含糊报「未读到原文」 |
| `lib/feishu-sheets.js` `writeToSheet` | 写数据前补 B1:H1 表头（仅当 B1 空，不碰 A1） | 结果表有列名可读 |
| `test/feishu-sheets.test.js` | wiki 解析断言改为「支持」；valueRange 数量 12→13 | 对齐新行为 |

测试：feishu-sheets 105/0。全 JS 语法 OK。

---

## 四、接手者下一步（真机闭环，剩这一步）

代码已修，剩下用户在扩展里跑一次完整闭环：

1. **重载扩展**（chrome://extensions → 🔄），让代码生效。
2. 打开扩展 → `migrateWrongSheetToken` 会自动把目标从 `Tjyfs3` 切到 `QmG4w6`（看到提示「已自动切换」）。
3. 点「📋 从当前表格读 A 列原文」→ 应读到 39 条（不再是「未读到原文」）。
4. 走 TM 查询（bridge 会收到 search_tm，日志可查 `/tmp/l10n-bridge-debug.log`）→ 39 条多半 No TM match（TM 库没有，正常）→ 走 AI 改写。
5. 点「写回表格」→ 结果写到 `QmG4w6` 表 B-H 列（B1:H1 自动补表头）。
6. 读回 B2:B40 确认有内容。

**若 AI 改写失败**：LLM token 问题（用户找不到 `ANTHROPIC_AUTH_TOKEN`，`ttadk claude` 运行时注入不落盘）。AI 改写只影响 Orig<75 条目，不影响 TM 查询/写回验证。

---

## 五、最大教训

1. **「抓不到」不要先怀疑 DOM 抓取**。先用飞书 API 直连 dump 真实表内容，确认原文到底在哪张表哪列。本轮 3 个 curl 就锁定了，之前转 20+ 轮全在猜 DOM 选择器。
2. **wiki 链接背后可能挂着电子表格**，wiki token 即 spreadsheet token，直接用 Sheets API 读。别把 wiki 链接当「只能 DOM 抓取」。
3. **扩展 storage 配的 token 可能指错表**。读不到内容时，先 dump 该 token 对应表的真实内容，而不是改抓取代码。
4. **bridge 日志只有 ping = 读原文这步就失败了**，没走到 TM。看日志判断流程走到哪一步。

---

## 六、真机闭环确认 + 打包（2026-06-26 收尾）

### 闭环已验证
用户重载扩展后，点「📋 从当前表格读 A 列原文」**成功读到 39 条原文**，根因闭环。「读不到原文」问题解决。

### 已打包分发
把软件运行必需文件 + 使用教程打成 zip：

- **包位置**：`~/Desktop/L10n-TM-Companion-20260626.zip`（66K）
- **包内只有运行必需文件**，排除所有开发文档（test/、handoff/、旧 README/TUTORIAL/SETUP-GUIDE）：

```
l10n-tm-companion/
├── USAGE-GUIDE.md          ← 使用教程（236 行，唯一入口文档）
├── manifest.json           ← 扩展清单
├── background.js / content.js / popup.* / options.*  ← 扩展主体
├── lib/                    ← 8 个核心模块（feishu-sheets.js 含本轮 wiki 解析修复）
├── native-host/            ← starling-bridge.py + 注册脚本
└── icons/                  ← 图标
```

### USAGE-GUIDE.md 内容
`l10n-tm-companion/USAGE-GUIDE.md`（项目根目录也有一份），含：
1. 工具是干嘛的 + 表格列布局（A 原文 / B-H 输出 / G 留人工）
2. 前置条件（Python/Node/starling-cli+AKSK/飞书应用 sheets:spreadsheet 权限）
3. 安装 5 步（解压→加载扩展→注册 native host→填设置→准备原文表）
4. 使用 9 步（打开原文表→读 A 列→TM→AI改写→看结果→写回→人工 review）
5. 常见问题（读不到原文 / native host 不可用 / TM 全空 / AI 失败 / 给同事用）
6. 调试方法（bridge 日志 / 单测）
7. 文件说明

教程已写明本轮两个修复点：**贴 wiki 链接自动解析成 spreadsheet token**、**检测到指向空表自动切换到正确原文表**。

### 给同事用的注意
对方机器必须装齐 starling-cli + AK/SK + Python + Node + 注册 native host，还要有飞书应用权限。先建议对方按 `USAGE-GUIDE.md` 的「安装 5 步」走。

---

## 七、当前状态总览（接手者看这）

| 项 | 状态 |
|----|------|
| 读原文（QmG4w6 表 A 列 39 条） | ✅ 真机验证通过 |
| bridge TM 查询 | ✅ 能收到 search_tm 并查询 |
| starling-cli / 项目 385 | ✅ 命中正常（Done→完成 100 等） |
| wiki 链接解析成 spreadsheet token | ✅ 代码已修，测试 105/0 |
| 错误 token 自动切换 | ✅ migrateWrongSheetToken 已加 |
| 写回 B-H + 补表头 | ✅ 代码已修，待真机写一次确认落盘 |
| AI 改写（LLM） | ⚠️ 依赖 LLM token，`ttadk claude` 注入不落盘，用户需自行取值填设置 |
| 打包分发 | ✅ `~/Desktop/L10n-TM-Companion-20260626.zip`（66K）+ USAGE-GUIDE |

**唯一待真机确认**：点「写回表格」后去 `QmG4w6` 表看 B2:H40 是否有数据落盘。代码逻辑已修（按 row 定位写 + 补表头），预期没问题。
