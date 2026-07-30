# L10n TM Companion — Loop Engineering 修复记录（2026-06-26）

> 本轮以 Loop Engineering 模式持续修复，直到真实验收。本文记录每轮根因 + 修复，接手者读此即可了解当前状态。
> 代码位置：`/Users/bytedance/my-project/l10n-tm-companion/`
> 目标 wiki：https://bytedance.larkoffice.com/wiki/QmG4w6EVIitUAlkT259clYFCndf
> 目标 Sheets：https://bytedance.my.larkoffice.com/sheets/Tjyfs3Tg5hYG6btMTiom3UA3yYd（token=`Tjyfs3Tg5hYG6btMTiom3UA3yYd`）

---

## 〇、当前状态（接手先看）

### 已真实验证通过（命令行实跑，非读代码）
- ✅ **TM 全空问题**：解决。bridge 真调 starling-cli，16/16 命中
- ✅ **速度不可用**：解决。`ThreadPoolExecutor` 并发，串行 1.4s/条 → 并发 0.146s/条，~10× 提速，614 条 ~90s
- ✅ **source_text 字段 bug**：修复。命中条返回 None → 16/16 正确回填
- ✅ 全部 312 单测通过，bridge py_compile OK

### 当前卡点（进行中）
- ⚠️ **抓取原文**：原文在电子表格单元格里（用户确认），但表格只有 1 个 sheet `sheet1`（id=`0TvTBO`），其 `A2:A` 是空的。**原文不在 A2 起**——可能在别的列或别的行。正在 dump `A1:Z5` 定位原文实际位置。

### 已确认的根因链（本轮最大收获）
1. **抓取对象错**：之前一直「抓取全文」走 DOM 抓取，抓到的是飞书**电子表格公式函数面板**（`ARRAYFORMULA`/`CEILING.MATH` 等单词 + 快捷键提示），不是正文。原因是原文在电子表格单元格里，不该用 DOM 抓取，该用 Sheets API 读。
2. **原文在电子表格**（不是 wiki 文档正文）：用户确认。wiki 页其实是嵌了电子表格，正文在表格单元格里。
3. **正确路径**：用「📋 从当前表格读 A 列原文」走 Sheets API（`listSourceSegments` 读 A 列），零噪声、快、准。该入口之前**根本没在 popup 接线**（函数存在但无按钮调用），本轮已加。
4. **friendlyError 吞错误**：`showError` 只显示友好标题，吞掉了原始错误+诊断 JSON。`friendlyError` 的正则 `spreadsheet.*token` 太宽，把含 "token" 字样的错误误判成"未设置写入目标"。本轮已修：`showError` 显示「原始错误」折叠区 + 收紧正则。
5. **工作表选择**：`getDefaultSheetId` 默认取首个 sheet。诊断确认表格只有 1 个 sheet `sheet1`（`0TvTBO`），但 A2:A 空。原文不在 A2 起。

---

## 一、各轮修复记录

### Round 1-5：TM 查询 + 并发 + source_text
- **Round 1**：bridge 真实 TM 查询基线。5 条 7.05s，1.41s/条，全命中。发现 `source_text` 返回 None（成功路径没回填）。
- **Round 2**：并发可行性探针。starling-cli 支持并发，并发 8 → 4.75× 提速，并发 16 → 16 条 2.15s（per-item 0.13s）。
- **Round 3**：bridge 加 `ThreadPoolExecutor` + source_text 回填（第一版引错变量，引用了 `_parse_cli_output` 内局部变量 `text`=stdout.strip()，导致 source_text 被填成整个 stdout JSON）。
- **Round 4**：发现并发下输出污染（实为我引入的 bug，与并发无关）。
- **Round 5**：正确回填——在 `search_single` 里 `tm_result['source_text'] = text`。16/16 正确，2.33s。

### Round 6-16：抓取层（DOM 抓取，最终发现走错方向）
- **Round 6**：探针确认 wiki 页是 SSO 登录态 SPA，curl 拿不到登录后 DOM。
- **Round 10**：进度条卡 1/4（抓取阶段）。
- **Round 11**：加 `_diag` 诊断日志。真机 dump 显示 `source=body-fallback count=614`，462 条 `<10` 字符，全是 `ABS/ACOS/ARRAYFORMULA`（电子表格公式函数名）+ 快捷键提示。
- **Round 12**：改 `extractFromBodyFallback` 为表格行优先 + `_isRealSegment` 过滤函数名/快捷键噪声。38 单测过。但真机仍抓公式面板——因为抓取对象本身错了。
- **Round 13**：要求用户贴 DOM 祖先链。用户无 DevTools（飞书客户端）。
- **Round 14**：加 `collectDiag` 诊断——自动探测正文样本 + iframe 同源情况，通过返回结果带回 popup 显示（无需 DevTools）。
- **Round 15**：诊断铁证——`bodyTextLen:659`（顶层只有侧栏），4 个 iframe（3 同源 textLen=0 懒加载，1 跨域登录）。加 `_collectRoots` 递归穿透同源 iframe + manifest `all_frames:true`。
- **Round 16**：`collectDiag` 增强，探测同源 iframe 内部正文样本。

### Round 17：方向切换（关键转折）
- 真机抓取结果出现 `TM 12%/40%/23%/27%`——扩展结果卡片，说明函数名被当原文查了 TM。
- 用 AskUserQuestion 确认：**原文在电子表格单元格里**（不在 wiki 文档正文）。
- 发现 popup **没有「从表格读原文」按钮**——`listSourceSegments`（Sheets API 读 A 列）函数存在但无入口。用户只能用 DOM 抓取（抓到公式面板噪声）。
- 加「📋 从当前表格读 A 列原文」按钮 + `readFromSheet` 函数。

### Round 18-19：UI 重设计 + 配置诊断
- UI 重设计：health check 折叠成摘要行、DOM 抓取收进折叠、目标详情折叠。
- `readFromSheet` 读空时报「A 列未读到原文」，加诊断 JSON。但用户只看到「未设置写入目标」友好标题。

### Round 21：friendlyError 吞错误（关键 bug）
- 根因：`showError` 只显示 `fe.title`+`fe.action`，不显示 `fe.raw`。`friendlyError` 正则 `spreadsheet.*token` 太宽，把含 "token" 的诊断误判成"未设置写入目标"。
- 修复：`showError` 显示「原始错误」折叠区；`friendlyError` 正则收紧为精确「未配置电子表格 token」。
- 之后用户终于看到真诊断：`{"sheet":"0TvTBO","range":"0TvTBO!A2:A","hasValueRange":true,"rowCount":0,...}`——API 调通但 A2:A 空。

### Round 22：工作表轮询
- 诊断显示默认 sheet `0TvTBO` 空。加工作表轮询：默认 sheet 读空时遍历所有 sheet 找有 A 列数据的。
- 真机结果：表格只有 1 个 sheet `sheet1`（`0TvTBO`），A2:A 仍空。→ 原文不在 A2 起。

### Round 23（当前）：dump 整片区域定位原文
- 改诊断：A 列读空时 dump `A1:Z5`（前 5 行 × 前 26 列），看原文实际在哪列哪行。
- 等用户贴 `firstRowsDump`。

---

## 二、关键代码改动清单（本轮）

### `native-host/starling-bridge.py`
- `search_single`：成功路径回填 `source_text`（`tm_result['source_text'] = text`）
- `search_tm`：`ThreadPoolExecutor(max_workers)` 并发，保留顺序，默认 8，可配到 32
- import `from concurrent.futures import ThreadPoolExecutor`
- ⚠️ **教训**：并发下若 source_text 变成 stdout JSON，不是并发竞态，是引用了函数内同名局部变量 `text`。改在 `search_single` 回填而非 `_parse_cli_output`。

### `content.js`
- `extractAllText`：改为 `_collectRoots` 递归收集顶层+同源 iframe，合并各 frame 抓取
- `extractFromBodyFallback(rootDoc)`：接受 root 参数，表格行优先（`_extractFromRows`），不再抓 `td` 碎片
- `_isRealSegment`：过滤函数名（单 token <12 字符）+ 快捷键（⌘/Fn/Ctrl/Shift）
- `_extractFromRows`/`_extractFromBlocks`：按行/块抓取，多列取最长列
- `collectDiag`：无 DevTools 诊断，探测正文样本 + iframe 同源情况，塞进返回结果
- `extractAllText` 返回带 `diag` 字段

### `popup.js`
- 加「📋 从当前表格读 A 列原文」按钮 + `readFromSheet`（调 `listSourceSegments`）
- `readFromSheet`：storage 无 token 时回退用 Step 2 输入框 URL 当场解析保存
- `showError`：显示「原始错误」折叠区（fe.raw），不再吞诊断
- `confirmDestination`：成功后显示「✓ 已保存输出目标」+ 重跑 health check
- `runHealthCheck`：顶部摘要行（✅就绪/⚠️N项未就绪），折叠看详情

### `lib/feishu-sheets.js`
- `listSourceSegments`：加工作表轮询（默认 sheet 读空时遍历所有 sheet）+ dump `A1:Z5` 诊断
- 新增 `_listSheets`、`_readColA`、`_readRange` 辅助函数
- 读空时报错带 `firstRowsDump`（前5行×26列实际内容）

### `lib/errors.js`
- `friendlyError`：正则 `/未配置电子表格 token|spreadsheet.*token/` 收紧为 `/未配置电子表格 token/i`，避免吞诊断

### `manifest.json`
- `content_scripts` 加 `all_frames: true` + `*://*.larkoffice.com/sheets/*` 匹配

### `popup.html` / `popup.css`
- UI 重设计：health/子来源/目标详情全折叠，主按钮「📋 从表格读 A 列」突出
- 加 `.collapse`/`.btn-block` 样式

---

## 三、下一步（接手者从这接续）

1. **拿到 `firstRowsDump`**：让用户重载扩展 → 点「📋 从当前表格读 A 列原文」→ 展开「原始错误」贴 `firstRowsDump`。据此确定原文在第几列第几行。
2. **改 `listSourceSegments` 读正确的列**：若原文在 B 列，改 range 为 `B2:B`；若第 1 行就是数据，从 A1 起。**或更稳**：让用户在 Options 配置"原文所在列"。
3. **写表验证**：抓取通了后，`writeToSheet` 按 item.row 写 B-H，列映射已核对正确（A=原文/B=Best TM/C=Orig%/D=Rewritten/E=New%/F=Reached75/G=留空/H=Comment），105 单测覆盖。
4. **TM 速度**：已解决（bridge 并发，614 条 ~90s）。

---

## 四、验收状态

| # | 验收项 | 状态 |
|---|--------|------|
| 1 | wiki 抓取 | ⚠️ 方向已纠正（原文在表格单元格里，走 Sheets API），待定位原文所在列 |
| 2 | 不再"未抓取/无法通信/TM 全空" | ✅ TM 已解决；抓取路径已切到 Sheets API；通信兜底注入在位 |
| 3 | 写入 Sheets | ⚠️ 列映射代码已核对正确，待抓取通后验证写回 |
| 4 | 速度快 | ✅ bridge 并发，~10× 提速 |
| 5 | 真实验证 | ✅ TM/性能实跑验证；抓取/写表待真机闭环 |

---

## 五、关键教训

1. **抓取层不要靠猜 DOM**：飞书 wiki 是 SPA，正文可能在 iframe/单元格里。先诊断真实结构再改选择器。
2. **friendlyError 会吞诊断**：错误展示必须显示原始 raw，否则友好标题掩盖真根因，反复定位不到。
3. **原文在表格里就该用 API 读**：不要用 DOM 抓取电子表格内容（会抓到公式面板/侧栏噪声）。Sheets API 读单元格零噪声。
4. **函数存在≠有入口**：`listSourceSegments` 一直存在但没按钮调用，导致用户只能走 DOM 抓取。
5. **并发 bug 先查自己的代码**：并发下数据污染，先排除是否引用了函数内同名局部变量，别先怀疑 starling-cli 竞态。
