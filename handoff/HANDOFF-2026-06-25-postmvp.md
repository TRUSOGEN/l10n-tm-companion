# L10n TM Companion — Post-MVP Bugfix Handoff（2026-06-25 下午）

> 本文档记录 2026-06-25 下午一轮「真实使用反馈驱动的修复」。之前 `HANDOFF-2026-06-25.md` 与 LOOP 文件里的 COMPLETE 只代表文件级任务完成，不代表真实 E2E 完成。真实使用推翻了该结论，本项目重新打开。
> 项目代码：`/Users/bytedance/my-project/l10n-tm-companion/`
> 配套进度文件：`LOOP_PROGRESS.md` / `LOOP_TASKS.md`（BX1-BX5）

---

## 〇、2026-06-26 本轮工作记录（最新，接手先看这节）

### 做了什么

| 项 | 改动 | 文件 | 状态 |
|----|------|------|------|
| wiki 抓取全文兜底 | 加 `extractFromBodyFallback()`：选择器全落空时用 `querySelectorAll('p,li,h1-6,blockquote,td')` 单次选择器 + 顺序遍历记 heading 上下文 + 文本去重，保证不返回空。**O(n)，不嵌套 querySelectorAll** | `content.js` | ✅ 25 用例 |
| docTitle 零宽清洗 | `getDocTitle()` 复用 `cleanText`，去飞书标题里的 U+200B 等零宽字符 | `content.js` | ✅ |
| BM25 fallback 接入 | `searchTM` 抛错时 `applyBM25Fallback` 用同批 items 互为 corpus 兜底，origin=`local fallback`、tm_method=`local_bm25_v1` | `popup.js` | ✅ |
| diff.js 死代码清理 | 删 `levenshteinSim`/`extractKeyDifferences`（`new-match-scoring.js` 有独立同名实现） | `lib/diff.js` | ✅ |
| background 诊断日志 | `[bg]` 前缀打每步状态（收消息/active tab/sendMessage 返回/兜底注入结果） | `background.js` | ✅ |
| content.js 诊断日志 | 顶部 `console.log('[content] content.js 已加载')` 确认注入 | `content.js` | ✅ |
| 抓取超时兜底 | `triggerExtract` 加 `Promise.race` 15s 超时，防 content 卡死时 popup 永久挂起 | `popup.js` | ✅ |
| README 重写 | 对齐当前代码（Sheets 写回/BM25/双 tab/全文兜底），更新文件结构与已知限制 | `README.md` | ✅ |
| 分享版教程 + 打包 | 写 `SETUP-GUIDE.md`（前置条件/安装5步/使用9步/常见问题/调试），打包 zip 放桌面 `L10n-TM-Companion-20260626.zip`（91K，排除 handoff/LOOP_/过时 TUTORIAL） | `SETUP-GUIDE.md` | ✅ |

**测试现状：** 7 套件 299/0（content 25 + e2e 68 + errors 14 + bitable 13 + sheets 105 + new-match 49 + bm25 25）。全 JS `node --check` + `py_compile` OK。

### 🔴 教训：分批 TM 查询把能用的功能改坏了（已回退）

中途为优化「614 条 TM 串行慢」，在 popup 加了**分批（每5条）+ 60s 超时**。结果真机实测把本来能跑的 TM 查询搞坏：
- 每批 spawn 一个新 bridge 进程（`/tmp/l10n-bridge-debug.log` 显示 6 次 `bridge start`）
- bridge 收到 `search_tm` 后还在串行查，没查完就被 60s 超时杀掉 → 每批都没结果 → TM 全空
- 用户报「不行」是对的，是回归

**已回退** popup.js 的 TM 查询到原始「一次性全发，无分批无超时」逻辑。**下次优化 TM 速度的正确方向**：在 `starling-bridge.py` 的 `search_tm` 内部用 `ThreadPoolExecutor` 并发查（同一进程内并发，不反复重启 bridge），**不要**在 popup 侧分批发消息。bridge 是「一次消息一个进程」模型，popup 分批 = 反复重启进程。

### 真机诊断已确认的事实（不用再查）

1. **抓取链路 OK**：`background.js` 的 `forwardToActiveTab` 兜底注入生效——首次 sendMessage 报「Receiving end does not exist」时，`chrome.scripting.executeScript` 注入 content.js 后重试成功。content.js 在 wiki 页**不会自动注入**（即使 manifest 匹配了 `larkoffice.com/wiki/*`），靠兜底注入救回。日志证据：`[bg] 兜底注入结果: true` + 重试拿到 614 条 items。
2. **wiki 页顶层 DOM 几乎无文本**：探针实测 `document.querySelectorAll('p,li,h1-6,blockquote,td')` = 634 节点，`body.innerText.length` = 403。飞书 wiki 内容在 **3 个 iframe** 里（文本长度都是 0，延迟加载或跨域）。但兜底注入的 content.js 在顶层能抓到 614 条——说明 content.js 注入到的是能看到内容的 frame，或飞书把内容渲染到了顶层 DOM 的其它结构里。**这块真机 DOM 真相仍未完全摸清**，但抓取已能工作。
3. **TM 查询本身没坏**：bridge 日志显示 `which starling-cli` 正常、`recv action=search_tm` 正常，PATH 已 augment。卡的是 popup 侧分批逻辑（已回退），不是 bridge。

### 仍待真机验证

- **回退后 TM 查询能否跑完 614 条**：回退了分批，恢复一次性全发，理论能跑完（只是慢，614×1.5s≈15min）。**用户尚未确认回退后是否恢复可用**。
- **docTitle 清洗效果**：抓取返回的 docTitle 之前是零宽字符乱码，已加 cleanText，待真机确认显示正常。
- **BM25 fallback 实际触发表现**：仅 TM 整体抛错时触发，未真机验证。

### 给接手者的下一步

1. 让用户用回退后的版本测一次「抓取全文」→ 确认 TM 查询恢复正常（能出结果，不再全空）。
2. 若 614 条太慢要优化速度：改 `native-host/starling-bridge.py` 的 `search_tm` 用 `ThreadPoolExecutor`（并发 4-8），**不要动 popup 侧**。
3. LLM token 问题未解决：用户找不到 `ANTHROPIC_AUTH_TOKEN`，`ttadk claude` 运行时动态注入不落盘。LLM 仅用于 Orig<75 条目的 AI 改写，不影响 TM 查询验证。若要用 AI 改写，需用户自行提供可用的 LLM endpoint+key 填进设置页。

---

## 一、本轮做了什么（BX1-BX5）

| ID | 问题 | 根因 | 修复 | 文件 | 测试 |
|----|------|------|------|------|------|
| BX1 | wiki/doc 页面抓不到文案，弹窗「未抓取到文案」 | `content.js` 仅用 `div[data-block-id]`；飞书 wiki 页（`/wiki/*`）DOM 无此属性 | 多选择器（`[data-record-id]`/`.wiki-block`/`p`/`h2`）+ 容器兜底（`.wiki-content`/`[role="main"]`）+ 文本清洗 | `content.js` | `test/content-extract.test.js` 19 用例 |
| BX2 | 写回失败 `Sheets write error: valueRanges is nil, wrong request body` | doc-capture 来源 item 无 `row`，`writeToSheet` 跳过全部 → `valueRanges:[]` 发给 API 报错 | doc-capture 追加路径（`getLastDataRow` 读 A 列末行，起点=max(末行,有row最大行)+1）+ 空 valueRanges 防护 | `lib/feishu-sheets.js` | sheets +16 用例 |
| BX3 | 用户不知道填哪个表格、是否推荐空表格 | 目标只在 options 页，弹窗看不到 | popup 新增 Step 2「输出目标（必填）」面板：输入框 + 摘要 + 推荐空表格提示 + 支持类型说明 + 未填禁写 + 写回前后展示目标摘要 | `popup.html` / `popup.js` / `popup.css` | sheets +7 用例 |
| BX3b | Bitable 目标会被允许写回但实际不支持 | `writeToSheet` Sheets-only，但 confirmDestination 放行 Bitable | `destWritable()` 判定：Bitable 不可写；摘要标注「暂不支持写回」+ 禁写 + 提示改用 /sheets/ | `popup.js` | sheets +5 用例 |
| BX4 | 卡片信息太挤太小（TM%、AI 改写、对比、采纳按钮） | 全塞在窄卡片里 | 「放大」按钮 + 点原文 → 聚焦覆盖层大图视图（原文 16px/TM 15px+重复率/对比/选择），支持翻页 + ESC/左右键 | `popup.html` / `popup.js` / `popup.css` | 逻辑经现有测试覆盖 |
| BX5 | 结果列表塞满弹窗，挡住目标和写回按钮 | 单页布局，结果与主流程混在一起 | 主流程/结果双 tab 分离；结果 tab 自带写回按钮（两处同步）；处理完自动切结果 tab，写回自动切回主流程看摘要 | `popup.html` / `popup.js` / `popup.css` | 逻辑经现有测试覆盖 |

**测试现状：** 7 套件 293/0（content 19 + e2e 68 + errors 14 + bitable 13 + sheets 105 + new-match 49 + bm25 25）。全 JS `node --check` + `py_compile` OK。

---

## 二、未解决的核心阻塞 ⚠️（最重要的部分）

### BX1 的 wiki 抓取——已加全文兜底，待真机验证

**2026-06-26 更新：** 已在 `content.js` 加 `extractFromBodyFallback()` 全文段落兜底——当 docx 块选择器和 wiki 选择器**全部落空**（真实 DOM 与推断不符）时，不再返回空数组报「未抓取到文案」，而是用 `TreeWalker` 从 `<body>` 按块级元素（P/LI/H1-6/DIV/SECTION/ARTICLE 等）抓取叶子段落，标题作为上下文，UI 噪声过滤，嵌套块级去重。**不依赖任何飞书专属选择器**，是真机 DOM 真相未知时的保底方案。新增 5 个测试用例（content-extract 24/0）。

**仍需真机验证：** 兜底逻辑已让「不再返回空」成为代码层保证，但抓到的段落质量（是否混入导航/侧栏噪声、是否按文档顺序）仍需在真实 wiki 页面确认。`WIKI_ROOT_SELECTORS` / `WIKI_BLOCK_SELECTORS` / `TEXT_NODE_SELECTORS` 三个常量仍是猜的——若真机拿 DOM，可继续精确化让抓取更干净，但兜底已让功能不再完全失效。

**接手者仍建议做（让抓取更干净，非阻塞）：**

**症状：** 用户在 `https://bytedance.larkoffice.com/wiki/QmG4w6EVIitUAlkT259clYFCndf` 点「抓取全文」，仍报「未抓取到文案，请确认页面内容或选中文字。」（另一个 wiki `https://bytedance.larkoffice.com/wiki/RVhuwy2oAikswbkxaOdcePYunHg` 同样不行）。

**为什么没修好：** BX1 的 DOM 选择器（`.wiki-content`/`[role="main"]`/`[data-record-id]` 等）是**基于对飞书 wiki DOM 结构的推断**，没有在真实 wiki 页面验证过。真实页面的实际 class/属性很可能跟猜的不一样，导致 `querySelectorAll` 返回空 → 抓取 0 条。

**已确认排除的：**
- ❌ 不是 content script 没注入：`background.js` 已加程序化注入兜底（`chrome.scripting.executeScript` 注入 content.js 后重试），扩展有 `scripting` 权限 + larkoffice host 权限。如果注入也失败，会报「无法与页面通信」，但用户报的是「未抓取到文案」——说明 content.js 已执行、已响应，只是 `extractAllText()` 返回空数组。
- ❌ 不是 manifest 没覆盖 wiki：`content_scripts.matches` 已含 `*://*.larkoffice.com/wiki/*`。
- ❌ 不是应用安装/权限问题：用户已装 l10n 飞书应用，且抓取不涉及飞书 API（是 DOM 操作）。

**接手者下一步必须做（不要再靠猜）：**

1. **在真实 wiki 页面拿 DOM 真相。** 在 `https://bytedance.larkoffice.com/wiki/QmG4w6EVIitUAlkT259clYFCndf` 按 F12 → Console，跑这段（见下方「DOM 探针脚本」），把输出整段贴回来或据此改选择器。
2. **根据真实 DOM 改 `content.js` 的 `WIKI_ROOT_SELECTORS` / `WIKI_BLOCK_SELECTORS` / `TEXT_NODE_SELECTORS`。** 这三个常量在 `content.js` 顶部，是唯一要调的地方。
3. **临时绕过方案（已对用户说过）：** 选中文字 → 点「抓取选中文字」。选中模式走 `window.getSelection()`，不依赖 DOM 选择器，几乎一定能抓到。先让用户能用着。

### DOM 探针脚本（接手者在真实 wiki 页面跑）

```js
(() => {
  const out = { url: location.href, title: document.title, bodyTextLen: document.body.innerText.length };
  out.bodyTextHead = document.body.innerText.slice(0, 300);
  out.probes = {
    'div[data-block-id]': document.querySelectorAll('div[data-block-id]').length,
    '[data-record-id]': document.querySelectorAll('[data-record-id]').length,
    '.wiki-content': document.querySelectorAll('.wiki-content').length,
    '.wiki-block': document.querySelectorAll('.wiki-block').length,
    '[role="main"]': document.querySelectorAll('[role="main"]').length,
    '.suite-markdown': document.querySelectorAll('.suite-markdown').length,
    'article': document.querySelectorAll('article').length,
    'p': document.querySelectorAll('p').length,
    'main': document.querySelectorAll('main').length,
  };
  // body 直接子元素结构
  out.bodyChildren = [...document.body.children].slice(0,8).map(c => `${c.tagName}.${c.className}`);
  console.log(JSON.stringify(out, null, 2));
})();
```

根据 `probes` 里非 0 的选择器，更新 `content.js` 顶部三个常量数组即可。

---

## 三、其他遗留（非阻塞，但要知道）

- **Bitable 写回未实现**（BX3b 仅禁写 + 提示）。`writeToSheet` 仍 Sheets-only。用户填 Bitable 链接会被明确拦截提示改用 Sheet。若要支持，需新增 `writeToBitable`（飞书 Bitable records API，与 Sheets 接口完全不同）。
- **wiki 抓取的 DOM 选择器**见上方第二节，已加全文兜底，选择器精确化为非阻塞优化项。
- **doc-capture 追加写回起点**：`getLastDataRow` 读 A 列末行，若目标表 A 列有大量空行可能低估起点——真实 E2E 验证。
- **BM25 fallback 已接入**（2026-06-26）：`searchTM` 抛错时，`popup.js` 的 `applyBM25Fallback` 用同批 items 互为 corpus 做 BM25 兜底，origin 标 `local fallback`、tm_method 标 `local_bm25_v1`，与真实 Starling 命中区隔。语义限制：corpus 只有同批原文无译文，命中「译文」回填为被命中条目原文（占位）；孤立句仍 No TM match 不编造。
- **TM 查询串行慢**（bridge 每个 text spawn 一次 starling-cli，1-2s/条，无并发/批量）。
- **diff.js 死代码已清理**（2026-06-26）：`levenshteinSim`/`extractKeyDifferences` 已删（`new-match-scoring.js` 有独立同名实现）。
- **popup.js 是浏览器 ESM，无 DOM 单测**：BX3/BX4/BX5 的 UI 交互逻辑只经 `parseFeishuUrl` 单测覆盖决策语义，DOM 渲染/事件/tab 切换/聚焦视图未单测——必须真实浏览器 E2E。BM25 接入逻辑 `applyBM25Fallback` 同理依赖 chrome API，未单测，但其核心 `bm25Match` 已被 tm-bm25.test.js 25 用例覆盖。

---

## 四、本轮关键代码改动清单

- `content.js` — wiki 抓取重构（多选择器+容器兜底+清洗），纯函数挂 `self.__l10n_extract`
- `lib/feishu-sheets.js` — `writeToSheet` 追加路径 + 空防护；新增 `getLastDataRow`
- `background.js` — `forwardToActiveTab` 加 `chrome.scripting` 程序化注入兜底
- `popup.html` — 双 tab 布局（主流程/结果）+ 目标输入面板 + 聚焦覆盖层 + 结果 tab 写回按钮
- `popup.js` — `confirmDestination`/`renderDestSummary`/`destWritable`/`openFocusView`/`switchTab`/`updateWriteButtonsEnabled`/`updateResultsBadge`
- `popup.css` — 卡片字号放大、聚焦层样式、tab 样式、目标输入样式
- 新增测试：`test/content-extract.test.js`（BX1，含极简 DOM shim）

---

## 五、给接手者的建议顺序

1. **先解决 wiki 抓取（第二节）**——这是用户最痛、最反复的问题。拿真实 DOM，改三个选择器常量，重测 `content-extract.test.js` + 真机验证那个 wiki 链接。
2. 真机 E2E 验证 BX2 写回（doc-capture 追加落点）、BX3-BX5 UI 交互（`docs/E2E-CHECKLIST.md`）。
3. 之后再考虑 Bitable 写回、BM25 接入等非阻塞项。

**核心教训：** 不要在没看过真实页面 DOM 的情况下猜选择器。所有「完成」结论必须以真实页面验证为准，否则会被使用反馈反复推翻（本项目已被推翻一次）。
