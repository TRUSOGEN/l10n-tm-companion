# L10n TM Companion

Chrome MV3 Side Panel 扩展：从输入源读英文原文 A → 查 Starling TM → AI 改写候选 B 并查询第二次真实 TM；按需开启 ROI 后，CD 在表格中编辑确认最终 C → 查询 C 的第三次真实 TM → 将 A−C ROI 原始输入归档到 ROI_Test。个人 Access Key 模式的 Inspire Writer 和其余流程均在用户本机执行；生产分发 Inspire 时需要租户签名代理。

当前 TM 达标门槛为 **85%**：`Orig Match % >= 85` 直接复用 TM，`< 85` 才进入 AI 改写。该边界已与主端及当前 vendor 计费口径对齐。

默认运行是快速 CD 路径：选择一个共同 target locale 后，对全部已选项目执行一次 Batch TM scope；ROI 默认关闭，不加载费率、不展开多语言 scope，也不显示最终 C 与归档操作。只有用户显式开启 ROI mode，插件才把同一组共享 target locales 应用于全部项目并运行多语言计价链路。

## 功能

- 📥 从飞书文档/电子表格抓取原文（全文 / 选中文字）
- 🔄 调用 Starling 批量 TM Match API 查询 TM 记忆（Orig Match%，默认 PPE）
- 🤖 AI 改写只参考英文 `tm_source`；Inspire Writer 使用异步 tasks/copies 接口，最多三条并发，默认选择最高分 revision 并保留全部候选
- 📌 对实际生成的 AI rewrite 再调用 Starling Batch TM，保存版本 B 的真实 Score B 与失败状态
- ✅ 读取 CD 在当前布局的 `Rewritten Segment` 列确认的版本 C（`CD review valid?` 为 Yes），第三次调用 Starling Batch TM 保存真实 Score C
- 🔀 对比生成 Comment（`no_tm` / `same` / `improved` / `different`）
- ⚠️ Starling 查询失败时明确展示错误并停止流程，避免把接口失败伪装成「无 TM 命中」
- 📤 写回飞书电子表格 Sheets（按真实行号定位，不错位）
- 💵 每个共享目标语言生成一个携带全部已选 `projectIds` 的 scope，并解析冻结的 `local rate` 快照；ROI_Test 的 Runs 直接记录本车金额，`Saving USD` 严格为正式 `TM cost(A) - TM cost(C)`，缺失费率或最终 C 时严格标记 incomplete
- ⚙️ Settings 直接保存并完整回填 Starling AK/SK；Side Panel 支持中英文切换、快速 TM target 与按需 ROI mode

## 架构

```
输入源（飞书 Sheets 已确认 source 范围 / 文档抓取）
   ↓
① 读原文（飞书 Sheets API，以配置的 App ID / Secret 换取 tenant_access_token 鉴权）
   ↓
② 查 TM：原文 → background.js（Service Worker）
        → Native Messaging → 本地 Python starling-bridge.py
        → 每 10 条组成批次 → starling-batch-client.js
        → Chrome AK/SK 注入单次子进程（或读取官方配置）
        → 官方 Starling Core 签名 → PPE 批量 TM 服务
        → 返回 {TM译文, TM库原文, Orig Match%}
        （失败时 → UI 展示真实错误并停止）
   ↓
③ AI 改写：对 Orig% < 85 的条目改写英文原文
   （Inspire Writer 直连 OpenAPI；Claude/OpenAI-compatible 继续经本机桥接）
   ↓
④ 二次查 TM：仅对实际生成 rewrite 的未达标条目再次调用 Starling Batch TM
   → 保存 post-rewrite 真实 score；查询失败标记 incomplete，不伪造 0 分
   ↓
⑤ 从用户选择的输出起始列连续写五列结果，第六列保留给 CD review
   ↓
⑥ CD 编辑 Rewritten Segment 形成最终 C，并在 CD review valid? 列选择 Yes
   ↓
⑦ 点击“确认最终 C，计算 Score C”：读取已确认的 Rewritten Segment，查询第三次 TM，保存 Score C，并生成正式 A-C ROI
⑧ 结果卡片按当前可用 TM Score 从低到高排列：优先 Score C，其次 Score B，最后 Score A；没有可用分数的条目排在最后
   ↓
⑧ 点击 Write ROI archive：Runs 直接显示本车正式 A−C 节省
```

纯客户端，无后端服务器。TM/LLM 调用经 Native Messaging Host 走本机 Python 桥接（绕浏览器 CORS）。

## 三个本机依赖（分发限制）

给别人用前，对方机器必须装齐，否则 TM/LLM 功能不可用：

1. `starling-cli` 运行时（AK/SK 在扩展 Settings 中配置）
2. Python 桥接脚本 `native-host/starling-bridge.py`
3. Native Messaging Host 注册到 Chrome（`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`，`allowed_origins` 绑扩展 ID）

## 安装

### 快速 CLI 参考

```bash
starling-cli --version
./native-host/register-native-host.sh <扩展ID>
for f in test/*.test.js; do node "$f"; done
python3 -m unittest test/test_export_local_rates.py test/starling-credentials-test.py -v
```

### 1. 加载扩展

1. 打开 `chrome://extensions`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」，选择本目录 `l10n-tm-companion/`
4. 记录扩展 ID（地址栏中可见，形如 `bgnakecphongbinlnmgnhoefgjecdang`）

### 2. 注册 Native Messaging Host（macOS）

```bash
cd native-host
./register-native-host.sh <你的扩展ID>
```

脚本会：
- 把 `starling-bridge.py` 设为可执行
- 在 `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` 写入注册清单

> ⚠️ 注册清单中 `path` 必须是绝对路径，且 `allowed_origins` 绑扩展 ID。重装导致 ID 变化时需重新注册，否则 TM/LLM 失联。

### 3. 配置参数

点击扩展图标 → ⚙️ 设置，填写：

| 配置 | 说明 |
|------|------|
| Starling Access Key / Secret Key | 两项均完整填写，默认遮挡；点击眼睛显示完整内容 |
| Save & Verify | 同时写入 Chrome 副本与 Starling 官方配置，并真实验证项目权限 |
| Starling CLI 路径 | 通常留空自动检测，排障时填绝对路径 |
| TM 查询模式 | 默认「Batch TM API in PPE」；只有排障时才切回旧的单条 CLI 查询 |
| LLM Provider / Endpoint / Key / Model | Inspire Writer、Claude 或 OpenAI-compatible；Inspire 填个人 `wak_…` Access Key 与 teamId，模型从 OpenAPI 支持列表选择，再选择 thinking level |
| Feishu App ID / App Secret | 填写自建应用凭证；Spreadsheet 与 ROI archive 均以该应用的 tenant token 访问 |

应用 Owner 需要在飞书开放平台为自建应用开通并发布 `sheets:spreadsheet`；使用 Wiki ROI archive 时还需开通 `wiki:wiki:readonly` 和归档所需的 Bitable scope。每个安装扩展的 Chrome profile 都需要填写获准使用的 App ID 与 App Secret；该应用也必须作为目标 Spreadsheet 与 ROI archive Bitable 的可编辑协作者。

日常运行配置放在 Side Panel：项目从 AK/SK 当前有权访问的列表中选择一至十个，`Fast TM target language` 只显示全部已选项目共同支持的语言。ROI mode 关闭时，vendor、费率和 coverage languages 不参与运行。开启 ROI mode 后选择 vendor，语言选择器只显示全部已选项目共同支持且当前 vendor 存在精确按字费率的 `targetLocales`；用户只选择一次共享语言集合，每个语言生成一个携带全部已选 `projectIds` 的 scope。两个项目与二十一个共享语言显示并查询二十一个 scope。Projects 与 ROI coverage languages 使用独立折叠区，语言支持搜索和全局 All/None。AI 始终执行 English-to-English rewrite；同一车只生成一组 B 候选，再在各 ROI scope 查询真实 Score B，避免按语言重复调用 LLM。

ROI 费率只来自随插件发布的 `data/local-rates.json`。RWS 与 Pactera 按当前 source-target
语言对显示 AIPE 和 T-only 单价；Alconost 与 Skrivanek 当前原表只有 hourly rate，
按字 ROI 会明确显示 `missing_word_rate`。正式 ROI 是每个 scope 的 `TM cost(A) - TM cost(C)`，版本 B
只供 CD 审阅，不能进入金额。整车金额只在 ROI_Test 的 `L10n ROI Runs` 的金额列和 `Pricing notes` 中显示；Popup 与
Spreadsheet 均不显示 ROI 金额。最终 C 缺失、G 不为 Yes、第三次 TM 失败或费率不完整时，记录保持
`incomplete`，金额与 `Pricing notes` 显示所有可计算文案的小计；完全没有可计算的最终 C 时金额留空。完整翻译基线仍是本地英文词数乘 AIPE 单价的参考字段；TM 成本按真实 score
估算，0–75（含 75）走 AIPE，(75,85]、(85,95]、(95,99] 分别按 T-only 的 60%、40%、20%。Starling
未返回 100% 命中的计费分类时，插件按 T-only 的 20% 做保守估算，并标记
`exact_unclassified_conservative`。预估不能替代 Elasticsearch 结算结果。

### 4. 配置 Spreadsheet、Sheet 与列布局

Side Panel 默认采用当前 Spreadsheet，也可在 `Working spreadsheet` 粘贴另一份表格链接。同一 Spreadsheet 的全部可见 Sheet 会显示在下拉框中；来源列、数据起始行和输出起始列按 `spreadsheetToken + sheetId` 独立保存。

插件读取 A-Z 前二十行，唯一命中 `Original Source Segment`、`English Source` 或 `Source` 时自动采用该列与下一行；无唯一表头时展示候选并要求确认。输出起始列连续占六列：`Best TM Match`、`Orig Match %`、`Rewritten Segment`、`New Match %`、`Reached 85%?`、`CD review valid?`。最后一列只创建 Yes/No 下拉，不自动写值。来源列与输出区域重叠、未知表头或空表头下已有数据时停止写回。

展开 Working spreadsheet 可以查看完整 Spreadsheet、Sheet、读取范围、写入范围与前五条非空 source 预览。空白 source 行会跳过，但结果保留真实行号，写回不会错位。

## 使用

1. 在 Settings 填写完整 AK/SK，点击 `Save & Verify`
2. 打开 Side Panel，选择一至十个权限项目和 `Fast TM target language`；普通运行保持 ROI mode 关闭
3. 在飞书电子表格中将本扩展所用飞书应用添加为协作者，授予可编辑权限
4. 从当前 Spreadsheet 打开 Side Panel，选择 Sheet，确认来源列、数据起始行和输出起始列；需要其他表格时展开 `Use a different spreadsheet`
5. 点击 `Read configured source range`；文档 DOM 抓取位于折叠的 `Other sources`
6. 自动触发 Starling TM，得到 Score A、候选 B 与真实 Score B
7. 点击「写回表格」，结果按真实行号写入当前六列输出区；CD 编辑 `Rewritten Segment` 为最终 C，并在 `CD review valid?` 选择 Yes
8. 需要整车 ROI 时，在运行前开启 ROI mode、选择 vendor 与 coverage languages；CD 确认后点击“确认最终 C，计算 Score C”
9. 点击 `Write ROI archive`；ROI_Test 的 `L10n ROI Runs` 直接显示本车 A−C ROI

> 💡 wiki/doc 页若「抓取全文」抓不到，可选中文字用「抓取选中文字」（走 `window.getSelection()`，不依赖 DOM 选择器，几乎一定能抓到）。

> ⚠️ Starling 已确认 `sourceContents` 与 `projectIds` 各最多 10 条。插件默认只调用 Batch TM Match，不会自动调用 `/project/search` 查询 Key 或项目归属。

## 文件结构

```
l10n-tm-companion/
├── manifest.json              # MV3 清单（权限：activeTab/nativeMessaging/storage/scripting）
├── background.js              # Service Worker，消息转发 + Native Messaging（含 content.js 兜底注入）
├── content.js                 # 飞书文档抓取（docx 块 + wiki 容器 + 全文段落兜底）
├── popup.html / .css / .js    # Side Panel UI（双 tab、运行时双语、卡片详情与聚焦视图）
├── options.html / .css / .js # 设置页
├── lib/
│   ├── starling-tm.js         # 首轮与改写后二次 TM 查询封装（经 background 中转）
│   ├── run-config.js          # 项目规范化、多语言 ROI scope 与运行门禁
│   ├── multilingual-roi.js    # 多语言 ROI 严格汇总与 subtotal 失败语义
│   ├── multilingual-runner.js # 共享语言多项目 scope 串行执行器
│   ├── tm-bm25.js             # 历史本地词法匹配工具，主流程不再自动调用
│   ├── ai-translate.js        # AI 改写原文 + LLM 调用
│   ├── inspire-writer.js      # Inspire 异步 task、轮询与 revisions 解析
│   ├── i18n.js                # Side Panel 运行时中英文文案
│   ├── sheet-layout.js        # Sheet 表头检测、列换算、范围映射与冲突校验
│   ├── new-match-scoring.js   # 确定性 New Match% 打分（固定权重，无 LLM）
│   ├── diff.js                # AI vs TM 对比（生成 Comment）
│   ├── feishu-sheets.js       # 飞书电子表格读写（按行号定位写回）
│   ├── feishu-bitable.js      # 飞书应用身份 token 与 Bitable 工具
│   ├── pricing-rules.js       # local rate 精确解析与 incomplete 失败语义
│   └── errors.js              # 友好错误信息
├── data/local-rates.json      # 从业务费率表确定性生成的静态快照
├── scripts/export_local_rates.py # 费率工作簿导出与来源审计
├── native-host/
│   ├── starling-bridge.py     # Python 桥接：TM/LLM + 飞书本机 OAuth
│   ├── feishu_oauth.py        # localhost OAuth 回调、state 校验与 user token 兑换
│   ├── starling-batch-client.js # 批量 TM 请求：复用官方 Core 完成 AK/SK 签名
│   ├── starling-credentials-client.js # 官方 Core AK/SK 保存与完整读取
│   ├── starling-key-batch-client.js # 保留的按需 Key 查询实现，默认流程不调用
│   ├── com.l10n.tm-companion.json  # Native Messaging 注册清单模板
│   └── register-native-host.sh     # 一键注册脚本（macOS）
├── test/                      # JavaScript/Python 回归与协议测试
├── docs/                      # E2E 手动验证清单等
├── icons/
└── README.md
```

## 测试

```bash
# 跑全部单测
for f in test/*.test.js; do node "$f"; done

# 刷新并验证 local rate 快照
python3 scripts/export_local_rates.py \
  --input '/Users/bytedance/Downloads/local rate 费用表.xlsx' \
  --output data/local-rates.json
python3 -m unittest test/test_export_local_rates.py -v
node test/pricing-rules.test.js

# Native Host 凭证与项目门禁
node test/starling-credentials-client.test.js
python3 -m unittest test/starling-credentials-test.py -v
```

测试覆盖内容抓取、流程逻辑、错误展示、飞书读写、New Match、改写后二次 TM 快照的成功与失败语义、历史 BM25 工具、批量请求参数转发、批量客户端入口，以及 Python 的批量协议解析。

## 调试

```bash
# 手动测试 bridge（Native Messaging 协议）
echo '{"action":"ping"}' | python3 -c \
  "import sys,json,struct; m=sys.stdin.read().encode(); sys.stdout.buffer.write(struct.pack('=I',len(m))+m)" \
  | python3 native-host/starling-bridge.py

# native host 排查日志（bridge 内置诊断）
rm -f /tmp/l10n-bridge-debug.log   # 清日志
# 刷新扩展 → 触发流程 →
cat /tmp/l10n-bridge-debug.log     # 看 PATH/which starling-cli/收到的 action/崩溃堆栈
```

- Service Worker 日志：`chrome://extensions` → 该扩展 → 「Service Worker」
- Content Script 日志：飞书页面的 DevTools Console
- Popup 日志：右键扩展图标 → 「检查弹出内容」

> ⚠️ Chrome 调 native host 子进程时 PATH 极简（只有 `/usr/bin:/bin:/usr/sbin:/sbin`）。bridge 会主动补 node 目录并探测 Starling CLI；批量请求失败会直接在插件中显示，不会被当成「No TM match」。

## 已知限制

- **批量上限**：`projectIds` 与 `sourceContents` 均按已确认的最多 10 条执行；更长文案列表由 bridge 按 10 条分批。
- **PPE 依赖**：默认批量模式发送 `x-use-ppe: 1` 与 `x-tt-env: ppe_openapi_integ`；上线生产环境前需由 Starling 确认路由与鉴权要求。
- **ROI Bitable 归档**：只追加 `L10n ROI Runs` / `L10n ROI Scopes` 两张审计表，不替代普通 Sheet 动态布局写回；Runs 直接写入 `Full translation USD`、`TM estimated USD` 与 `Saving USD`，其中 Saving 严格为 A−C 节省，Scopes 只保存一个多项目语言 scope 的覆盖与失败原因，无需配置 Formula。
- **抓取需真机验证**：飞书 wiki/doc 真实 DOM 结构未实测，`content.js` 选择器基于推断；已加全文段落兜底保证不返回空，但段落质量需真机确认。

## 安全

- Starling AK/SK 同时保存在 `chrome.storage.local` 与 `~/.starling-cli/.starlingrc.json`；两处均为本机持久化，不承诺硬件级加密
- AK/SK 默认遮挡但可完整回填；console、Native Host 日志、错误与飞书写回禁止记录凭证明文
- 飞书 App ID 与 App Secret 保存在 `chrome.storage.local`，用于换取短期 `tenant_access_token`；Options 默认遮挡 Secret，日志与错误信息不回显凭证明文
- A/B/C 运行快照仅保存在 `chrome.storage.local`，用于 Popup 关闭后恢复结果、确认最终 C 和 ROI archive；快照不含任何凭证，启动新运行时清除，最长保留七天
- 该模式要求每个 Chrome profile 填写获准凭证，并将应用添加为目标 Spreadsheet 与 ROI archive Bitable 的可编辑协作者
- TM 数据留在用户本地机器
- 高风险内容（金钱/法律/未成年人相关）请人工确认后再写入表格

## 相关文档

- `handoff/HANDOFF-2026-06-25.md` — 项目全貌与技术路线
- `handoff/HANDOFF-2026-06-25-postmvp.md` — 真实使用反馈驱动的修复（BX1-BX5）+ 已知阻塞
- `handoff/SESSION-HANDOFF.md` — 操作历史流水账（从启动至今，阶段 A–I）
- `docs/E2E-CHECKLIST.md` — 真机 E2E 验证清单
- `docs/user-guide.md` — 面向日常使用者的 A/B/C、表格 CD 审阅与整车 ROI 教程
- `docs/popup-configuration.md` — AK/SK、权限项目、vendor、target locale 与折叠交互的统一当前规格

---

## 迭代历程（Changelog）

> 本项目从 2026-06-24 启动到 2026-07-03，经历了 10 个阶段（A–J）。每个阶段解决一类真实问题，踩过的坑也记录在内。按时间从新到旧排列。

### 阶段 M — 共享 ROI 语言、Inspire 模型选择与轻量动效（2026-07-21）

Inspire Writer 的模型改为 OpenAPI 枚举下拉，保留 `gemini_3f` 速度优先默认值，并提供 Gemini 3.1 Pro、GPT 5.4 mini 和 GPT 5.4。多项目 ROI 从项目级语言并集调整为共享语言集合：选择器只显示全部项目共同支持且 vendor 有精确费率的语言，每个共享语言只生成一个携带全部项目 ID 的 scope。Side Panel 为状态切换增加 160–240ms 的 transform/opacity 动效，并在系统 reduced motion 模式下关闭。同日增加 Spreadsheet override、Sheet 下拉与按 Sheet 独立保存的动态列布局；首次安装默认英文，语言选择持久化，英文模式不含插件自有中文文案。

### 阶段 L — 整车多语言 ROI（2026-07-17）

Popup 的 ROI 范围改为项目级语言勾选：每个项目默认全选其 `targetLocales`，多项目按 `project × target locale` 并集执行，不要求共同 target locale。每个 scope 分别保存首轮 TM、改写后二次 TM、费率和逐项金额；结果页展示整车完整翻译成本、TM 预估成本、节省金额或严格的已覆盖语言小计、scope 覆盖率、失败原因以及每条文案的逐语言审计明细。AI 关闭时直接使用首轮 TM 分数计算节省；A-G Sheet 仅允许写入一个完整 display scope。

### 阶段 K — Settings 凭证、Popup 运行配置与 local rate locale（2026-07-15）

Settings 直接接收完整 AK/SK，并通过官方 Starling Core 双存储到 Chrome 与 `.starlingrc.json`；两个字段默认遮挡且可用独立眼睛按钮显示。Popup 自动发现当前账号权限项目，把 vendor、项目与共同 target locale 统一为单次运行配置；零项目、不同 source locale、无共同 target 或超过十项目均正确停止。local rate 快照增加 canonical `source_locale/target_locale`，费率缺失会给出具体 vendor、语言对和可用 vendor 建议。`Other sources`、健康检查和可用 Working spreadsheet 默认折叠。

### 阶段 J — 多项目支持 + 搜索词容错 + 表格 J 列项目来源（2026-07-03）

**背景**：用户提出四个需求：①设置页可多选项目库，没有的可自定义新增（填名称或 ID）；②搜索词做大小写/拼写/符号容错（找不到可能因这个）；③表格展示每条 key 来自哪个项目库；④从 starling-cli 找 key，遵循 CLI 规则。

**接口能力探查**：读 starling-shared skill + 查 `/project/search` schema → 接口支持 `caseSensitive`（默认 false，大小写不敏感已由接口处理），但**不支持 fuzzy/拼写容错参数** → 拼写/符号容错必须在客户端实现。实测大写 `OFFICIAL VIDEOS` 模糊搜能命中 `Official Videos`。

**改动**：
- **bridge（`native-host/starling-bridge.py`）**：
  - 新增 `_normalize_loose(s)`：lowercase + 去掉所有非字母数字，用于「拼写/符号容错」——如 `gold-medal!` 与 `Gold Medal` 归一化后都成 `goldmedal`，相等即视为命中
  - `_parse_search_output` 三层匹配：①严格精确（`_normalize_ws` 空白归一化后相等）→ ②宽松精确（`_normalize_loose` 去标点+大小写不敏感后相等）→ ③取 score 最高（模糊命中）。exact 判断覆盖符号/大小写/空白差异
  - `search_key` 改成接收 `project_ids` 数组：解析去重 → 反查每个项目名（`_resolve_project_name` 调 `/projects`）→ 每条原文在所有项目并发查 → `_pick_best` 取最优一个（exact 优先 → score 优先 → 跳过空 key）。返回结果带 `project_id`/`project_name`
- **sheets（`lib/feishu-sheets.js`）**：COLUMN_MAP 加 `project: 'J'`；REQUIRED_HEADERS 加 `'Project'`（11 列）；`writeToSheet` 表头 B1:J1、每行写 `it.project`；`repairHeaders` range `A1:K1`（11 列）
- **`lib/starling-tm.js`**：`searchKeys` 透传 `projectIds` 数组（兼容旧 `projectId` 单值）
- **`popup.js`**：`tmOpts` 加 `projectIds`（优先数组兼容旧单值）；Step 1.5 把 `k.project_id`/`k.project_name` 组合成 `item.project = 'name (id)'`；`keyRow` 函数加项目来源显示（`From: name (id)`）；`renderFocus` Key 区块加 `From project:`；`loadConfig` KEYS 加 `starlingProjectIds`
- **options（`options.html/css/js`）**：卡片单选→多选 toggle；加自定义新增输入框（填名称→从缓存反查 ID、纯数字→当 ID、找不到→提示先 Load）；`selectedIds` 数组运行期；save 持久化 `starlingProjectIds` 数组 + 兼容字段 `starlingProjectId`（第一个）；load 时旧 `starlingProjectId` 单值迁移进数组

**验证**：JS 全部 `node --check` OK；bridge `py_compile` OK；7 套测试 319/0 全过（content-extract 38、e2e 68、errors 14、feishu-bitable 13、feishu-sheets 112、new-match-scoring 49、tm-bm25 25）；Python search-key 15/0。
**待真机**：刷新扩展后 Options 多选项目 + 自定义新增 → popup 跑流程看卡片 `Key: xxx [exact/fuzzy] From: name (id)` + Focus 同款 → 表格 I 列 key + J 列 project 来源。

---

### 阶段 I — popup 显示 Source String Key（2026-07-03）

**背景**：用户反馈「在插件里面看到对应 key，写入的表格里面也需要有 key」。排查发现 `item.key` 早在 Step 1.5 查到、表格 I 列也早写了，**但 `renderCard`（卡片视图）和 `renderFocus`（聚焦大图视图）两个 popup 视图都没把 key 显示出来**——key 只在表格里看得到，插件界面看不到。

**改动**：
- `popup.css` 加 `.key-row` / `.key-value`（等宽字体）/ `.key-badge.exact`（绿）/ `.key-badge.fuzzy`（黄）/ `.key-none`（灰斜体「未查到」）样式
- `popup.js` 新增 `keyRow(item)` 辅助函数（卡片+聚焦共用，三态渲染：有 key+exact=绿徽章 / 有 key+fuzzy=黄徽章 / 无 key=灰「未查到」）
- `renderCard` 顶部插入 `${keyRow(item)}`
- `renderFocus` Source 区下方插入独立 Key 区块（带徽章+「精确命中/模糊命中」文字）

**验证**：node --check OK；e2e 68/0、feishu-sheets 108/0、feishu-bitable 13/0。表格 I 列写 key 逻辑未动。
**待真机**：刷新扩展后看卡片顶部 `Key: xxx [exact/fuzzy]` + Focus Source 下方独立 Key 区块。

---

### 阶段 H — 真机跑通 + TM key 修复（2026-06-30）

**背景**：三大阻塞（sheets 权限/协作者/真机端到端）解除；但用户反馈「TM 找不到对应文案的 Key，不可能，starling 的人说 TM 是有 key 的」。

**根因排查**：实测 `/corpus/tm/match` 完整返回，确认 TM 条目结构只有 `id/tmId/score/source/target/updater/keywords` **没有 key 字段**——TM 库本身不存 key，key 是源文案层概念。之前 bridge 用错了接口。

**修复**：
- 发现 `GET /project/search`（searchScope=0 按源文案搜）返回 `keyText` + `sourceContent` + `score`，这才是 starling 平台搜 key 走的接口
- `starling-bridge.py` 加 `search_key` action + `build_search_key_cmd` + `_parse_search_output`（精确命中判断：sourceContent trim 后完全相等 → exact=True，否则取最高分 exact=False）
- `lib/starling-tm.js` 加 `searchKeys` 封装
- `lib/feishu-sheets.js` 列布局加 I 列 = Source String Key；`writeToSheet` 表头 B1:I1、每行写 `it.key`；`repairHeaders` A1:J1（10 列）
- `popup.js` Step 1.5 调 `searchKeys`（失败不阻塞主流程，I 列留空）

**两个二次修复**：
1. **空白归一化**：第一版 `exact` 用 `sourceContent.strip()==query.strip()`，但 KTP 实测发现 starling 返回 sourceContent 用 `\n\n` 分段、用户原文用单空格（`system. Selfie` vs `system.\n\nSelfie`），严格相等永远 False。改 `_normalize_ws`（所有连续空白折叠成单空格再 trim）比较 → 立即 exact=True
2. **接口重试**：`/project/search` 偶发返回 total:0（实测 5 次 1 次空，服务端不稳定/限流），`search_key_single` 加重试最多 3 次（共 4 次）仍空才降级

**实测命中**：`Official Videos`→`music_video_official`(exact)、`Done`→`tiktoktv_matchCode_halfsheet_cta`(exact)、KTP 完整原文（Project ID 278）→`ttlsMerchant_gneMerchantRejectMsgKTP_msg1`(exact)。

**⚠️ 项目范围关键**：`ttlsMerchant_` 前缀属 merchant 类项目，**不在默认 385(TikTok_Client)**（385 搜 KTP 全空）。用户确认 merchant 项目 = Project ID 278（TikTok_main / TTLS Merchant Rejection Messages KTP and POI，任务 335649280002）。当前 Options 只能填单个 Project ID，多项目支持待办。

**新增测试**：`test/search-key-test.py`（15 用例）覆盖精确命中/模糊匹配/无匹配/API 错误/trim 容错/空白归一化。

---

### 阶段 G — Sheets 重构 + New Match 算法纠正（2026-06-24 深夜）

**背景**：用户给的链接是 `/sheets/`（电子表格），不是 `/base/`（多维表格）。现有 `feishu-bitable.js` 调的是 Bitable API，对 Sheets 无效。同时用户纠正了之前对工作流的错误理解。

**重大转向**：
1. **表格产品**：Bitable → Sheets，重写表格层 `lib/feishu-sheets.js`（Sheets API v2：读 A2:A 原文、按列写 B-H、URL 解析、连接测试），Bitable 版本保留弃用
2. **New Match% 算法纠正**：之前错调了第二次 TM 查 New Match%，改为文本相似度算法（`textSimilarity`：Jaccard token 重叠 0.6 + Levenshtein 字符相似 0.4，兼容中英文，0-100），算 `Rewritten Segment`(改写后原文) vs `TM库原文`，**不调第二次 TM**
3. **AI 任务纠正**：之前实现成「AI 翻译」，实际是「AI 改写英文原文」让原文更贴近 TM 已有表达、提升命中率（prompt 完全不同，明确禁止翻译，保留占位符/变量）
4. **Reached 75%? 判断的是 Orig Match %**（不是 New Match%）

**bug 修复**：`starling-bridge.py` 原来 `source_text` 被 TM 原文覆盖导致写表错误 → TM 原文单独存 `tm_source` 字段返回，用户原文保持不变。

---

### 阶段 F — Starling 装通 + 工作流重构（2026-06-24 晚）

**背景**：本地探测无 starling，读存档文档发现真工具是 `starling-cli`（npm `@byted/starling-agent-cli`），不是早期 handoff 写的 `starling`。

**装通**：`npm install -g @byted/starling-agent-cli --registry https://bnpm.byted.org`（v1.1.16）→ `starling-cli login --begin --no-qr` 非阻塞 SSO 登录。
**⚠️ 坑**：login 在 Claude Code 非交互 TTY 下 SK 不落盘（只存 AK），导致 doctor 报 `secretKey is required`。解决：手动把 AK/SK 写进 `~/.starling-cli/.starlingrc.json`（chmod 600）。

**TM 接口实测**：发现项目 TikTok_Client (id=385) **源语言是英文**，`sourceLocale` 必须用 `en` 不是 `zh`，用 zh 全空 → en→zh 命中 Done→完成(100) 等。改 `starling-bridge.py` 用真实 `starling-cli api GET /corpus/tm/match`，Native Messaging 协议端到端实测 3 条文案全命中。

**工作流重构**（用户决策）：原「AI 翻译」流程改为「TM 优化」流程——查TM得Orig%→判断≥75→<75则AI改写原文(Rewritten Segment)→算New Match%→对比(Comment)。改 `ai-translate.js`（新增 `rewriteSourceWithAI`/`buildRewritePrompt`）、`feishu-bitable.js`（字段名英文化、similarity 不再 ×100）、`popup.js` 主流程、`diff.js`（compareAIvsTM 改成基于 Orig/New Match% 的语义对比）、`options.html/js`（加 Source Language select + Starling Project ID input）。

---

### 阶段 E — 文档与教程整合（2026-06-24）

写 `TUTORIAL.md`（7 步字节定制使用教程）、`SETUP-GUIDE.md`、`README.md`、`docs/`。整合三份环境搭建文档成单一 `TUTORIAL.md`，删冗余。实测用户机器：Python 已装、ttadk 已装、查到 LLMBox 网关环境变量。存记忆 `always-read-agent-md`：每次对话读 agent.md。

---

### 阶段 D — 飞书应用配置（2026-06-24，多轮排查）

**卡点**：用户卡在「搜 bitable 搜不到」→ 发现搜的是文档站不是应用后台；正确入口是「开发配置→权限管理→开通权限」。

**关键混淆点**：用户分不清「用户身份（user_access_token，免审）」vs「应用身份（tenant_access_token，需发布审核）」——反复澄清。最终应用发布审核通过，**采用 tenant_access_token 正式版方案，代码不用改**，user_access_token 方案作为备选保留。

用户进版本管理与发布页，填版本号 1.0.0、申请理由、可用范围加自己、对外共享不勾，提交发布申请 → 审批通过。

---

### 阶段 C — 端到端逻辑验证 + 真实 bug 修复（2026-06-24）

写 `test/e2e-logic.test.js`（29 用例）+ `test/feishu-bitable.test.js`（11 用例）。
**修复真实 bug**：`feishu-bitable.js` token 缓存原为模块级单变量，用户改 App ID 后会误用旧 token → 改为按 appId 索引的 Map，暴露 `_resetTokenCache()`。修复后两套测试全过。

---

### 阶段 B — 代码实现（2026-06-24，按 IMPLEMENTATION_PLAN 8 个 Phase）

从零开始建 `l10n-tm-companion/` 目录结构，按 8 个 Phase 实现：① manifest+background 骨架 → ② content.js 飞书抓取 → ③ native-host Python 桥 + 注册清单 + starling-tm.js → ④ ai-translate.js + diff.js → ⑤ feishu-bitable.js → ⑥ popup.html/css/js → ⑦ options.html/css/js → ⑧ Python 生成图标 + README + 语法检查 + bridge ping 实测通过。

---

### 阶段 A — 项目启动（2026-06-24）

读 `handoff/IMPLEMENTATION_PLAN.md` 确认从零开始。设计依据：`docs/superpowers/specs/2026-06-23-l10n-tm-companion-design.md` + `handoff/IMPLEMENTATION_PLAN.md`。用户：wuyegen@bytedance.com，字节 TikTok LIVE-CD&LOC 实习生。agent.md 身份：L10n Readiness Agent。

---

## 关键技术决策（为什么这么设计）

| 决策 | 选择 | 理由 |
|------|------|------|
| 无后端 | ✅ 纯客户端 | 内部工具，TM 留本地，不外传 |
| MV3 | ✅ | MV2 已停 |
| Native Messaging 调 CLI | ✅ | 唯一能从扩展调本地 starling-cli 的方式 |
| Popup 而非 Sidepanel | ✅ | 轻量 |
| Vanilla JS | ✅ | 避免构建链 |
| 飞书 REST API | ✅ | JS-SDK 仅飞书内嵌浏览器可用 |
| LLM 用内部网关 | ✅ LLMBox | 用户是字节员工有 SSO，无需外部 Key |
| 飞书鉴权 | ✅ tenant_access_token | 应用已发布，比 OAuth 流程简单 |
| 表格产品 | ✅ 电子表格 Sheets | 用户团队实际用 Sheets（`/sheets/`），非 Bitable |
| New Match% 算法 | ✅ 文本相似度 | 不调第二次 TM，用 textSimilarity(Rewritten 原文, TM原文) |
| AI 任务 | ✅ 改写英文原文 | 不是翻译！让原文更贴近 TM 已有表达，提升命中率 |
| 飞书域名匹配 | ✅ 加 larkoffice.com | 字节内部域名是 larkoffice.com，原只匹配 feishu.cn 无法通信 |
| 查 key 接口 | ✅ /project/search | TM match 不存 key，key 在源文案层，用 searchScope=0 按 source 搜 |

---

## 踩过的最大坑（教训）

1. **TM match 不存 key**：`/corpus/tm/match` 返回的 TM 条目只有 source/target/score/updater，**没有 key**。要查 key 必须用 `/project/search`（源文案搜索）。一度被用户质疑「能力不足」，根因是接口选错。
2. **空白归一化**：starling 返回 sourceContent 用 `\n\n` 分段、用户原文用单空格，严格字符串相等永远 False。精确命中判断必须先 `_normalize_ws`（折叠所有连续空白）再比较。
3. **LLMBox CORS**：扩展直连 LLMBox 被 Chrome CORS 拦截。改走 native host（bridge 加 `llm_call` action，urllib 直连网关无 CORS）。⚠️ 判断扩展环境用 `chrome.runtime?.sendMessage`（popup/content 都有），不是 `sendNativeMessage`（只有 SW 有）——popup 不能直接调 native host，必须经 SW 中转。
4. **D 列错位**：`writeToSheet` 原按下标整列写 `B2:B`，A 列有空行时（listSourceSegments 跳空行）B-H 全错位。改成按 `it.row` 真实行号定位每行写 `B{row}:B{row}`。
5. **卡片 TM% 双倍**：`renderCard` 里 `similarity * 100`——similarity 早是 0-100 百分制，又 ×100 变 8500。
6. **starling-cli login SK 不落盘**：非交互 TTY 下只存 AK 不存 SK。手动写 `~/.starling-cli/.starlingrc.json`。
7. **源语言**：项目 TikTok_Client (385) 源语言是英文，`sourceLocale` 必须用 `en` 不是 `zh`，否则全空。
8. **项目范围**：merchant 类 key（`ttlsMerchant_` 前缀）在 Project 278，不在默认 385。要查哪个项目的 key 就在 Options 切 Project ID。
9. **未打包扩展 ID 不可控**：manifest 的 key 字段对「加载已解压扩展程序」不生效，Chrome 给随机 ID。重装导致 ID 变化时需重新注册 native host。
10. **搜索词容错要客户端做**：`/project/search` 接口大小写不敏感（默认 caseSensitive=false），但**不支持 fuzzy/拼写/符号容错**。用户原文带标点（`gold-medal!`）和库里存的（`Gold Medal`）精确匹配会漏。解决：`_normalize_loose`（lowercase + 去非字母数字后比较）做宽松精确判断，覆盖符号/大小写差异。
11. **多项目要并发 + 取最优**：同一原文在多项目都可能命中 key，逐项目串行查太慢。bridge 用 `ThreadPoolExecutor` 并发 + `_pick_best`（exact 优先 → score 优先 → 跳过空 key）取最优一个，结果带 project 来源写 J 列。

---

## 当前状态一句话总览

**当前状态：Settings 凭证双存储与 Popup 权限项目选择已实现；真实 `/projects` 只读检查返回 `live_client (513)`、`TikTok_Client (385)`、`TikTok_main (278)`。** 文档 DOM 抓取仍是折叠的次要入口，后续继续按真机页面变化微调。
