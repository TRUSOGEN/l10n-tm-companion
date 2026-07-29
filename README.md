# L10n TM Companion

当前线下交付版本为 **1.3.3**：Review 首屏只等待一个展示语言 scope，完整多语言 A/B/C ROI 在用户确认归档后以最多三个 scope 受控并发补齐；ROI_Test 增量升级为 Runs、Scopes、Items 三层审计，并自动补齐六个基础视图与写入前容量检查。OAuth 同时请求“特定记录读取”`base:record:read` 与“列出/查询记录”`base:record:retrieve`；插件只信任飞书 token 响应实际返回的 scope，1.3.2 及更早保存的 scope 状态会要求一次性重新授权。

Chrome MV3 Side Panel 扩展：从输入源读取英文原文 A → 查询 Starling Top-3 TM → 仅对 `50 ≤ Score A < 85` 的 source 创建一个 Inspire task → 最多生成三个结构化候选并逐个查询真实 Post-TM → 在 Focus 中人工编辑最终 C → 单条确认或批量确认其余默认结果 → 查询 Final TM 并同步当前 Sheet 行 → 按需将正式 A−C ROI 归档到 ROI_Test。个人 Access Key 模式的 Inspire Writer 和其余流程均在用户本机执行；生产分发 Inspire 时需要租户签名代理。

AI 候选链路使用半开区间 **`50 ≤ Score A < 85`**：`49.99` 不创建 Inspire task，`50` 与 `84.99` 创建，`85` 不创建。Score A 低于 50 时缺少足够可靠的 TM 证据，85 及以上已经达标；两类条目仍可进入 Focus 人工编辑。

默认运行是快速 CD 路径：程序确定一个内部共同 target locale，对全部已选项目执行一次 Batch TM scope；ROI 默认关闭，不加载费率、不展开多语言 scope，也不显示归档操作。用户显式开启 ROI mode 后，Review 仍只等待一个展示 scope；其余共享 target locales 在确认写入 ROI_Test 后补算，避免 18 条 source × 35 个语言让首屏和 Confirm 同步等待。

## 功能

- 📥 从飞书文档/电子表格抓取原文（全文 / 选中文字）
- 🔄 调用 Starling 批量 TM Match API 查询 TM 记忆（Orig Match%，默认 PPE）
- 🤖 每条满足 50–85 门禁的 source 只创建一个 Inspire task；prompt 在首尾固定 Writer revision 协议，Inspire 原生返回最多三个普通改写 revision，客户端再将其包装为结构化候选并执行安全门禁与真实 Post-TM
- 🛡️ 每个候选依次经过结构、placeholder/token、URL、数字、Glossary、Legal、语义状态与风险校验；随后用真实 Post-TM 验证 `Score B > Score A`，失败候选保留审计信息但不进入可选列表
- ✅ Focus 是唯一编辑入口：CD 可采用通过门禁的 AI 候选或手动编辑 C；例外项可单条 Confirm，其余默认结果可一键批量确认。两种入口都按 `本地校验 → Final TM → Sheet 写入 → confirmed` 完成，任一步失败都保持未确认
- 🔀 对比生成 Comment（`no_tm` / `same` / `improved` / `different`）
- ⚠️ Starling 查询失败时明确展示错误并停止流程，避免把接口失败伪装成「无 TM 命中」
- 📤 已确认条目按真实行号写入六列：`Best TM Match`、`Orig Match %`、`Rewritten Segment`、`Post-TM %`、`Reached 85%?`、`Final TM %`
- 💵 每个共享目标语言生成一个携带全部已选 `projectIds` 的 scope，并解析冻结的 `local rate` 快照；ROI_Test 的 Runs 记录整车金额，Scopes 记录语言金额与覆盖漏斗，Items 按 source 记录 A/B/C 审计且不与 locale 做笛卡尔积；`Saving USD` 严格为正式 `TM cost(A) - TM cost(C)`
- ⚙️ Settings 直接保存并完整回填 Starling AK/SK；Side Panel 支持中英文切换、快速 TM target 与按需 ROI mode

## 架构

```
输入源（飞书 Sheets 已确认 source 范围 / 文档抓取）
   ↓
① 读原文（飞书 Sheets API，以当前用户 OAuth 的 user_access_token 鉴权）
   ↓
② 查 TM：原文 → background.js（Service Worker）
        → Native Messaging → 本地 Python starling-bridge.py
        → 每 10 条组成批次，最多 5 个批次并发 → starling-batch-client.js
        → Chrome AK/SK 注入单次子进程（或读取官方配置）
        → 官方 Starling Core 签名 → PPE 批量 TM 服务
        → 返回 {TM译文, TM库原文, Orig Match%}
        （失败时 → UI 展示真实错误并停止）
   ↓
③ AI 改写：只对 50 ≤ Orig% < 85 的条目创建一个 Inspire task
   → 最多三个结构化候选；49.99 / 85 等边界严格跳过
   （Inspire Writer 直连 OpenAPI；Claude/OpenAI-compatible 继续经本机桥接）
   ↓
④ 候选安全校验与二次 TM：逐个校验结构、token、URL、数字、Glossary、Legal 和语义
   → 对结构有效候选批量查询真实 Post-TM；只有安全且 Score B > Score A 的候选可选
   ↓
⑤ 结果卡片只提供 Focus 入口；展示 Top-3 TM、有效 AI 候选、Post-TM 分数与差值
   ↓
⑥ CD 在 Focus 中选择候选或编辑最终 C
   ↓
⑦ 单条 Confirm 或 `Confirm & write remaining`：校验最终 C → 查询 Final TM → 写入当前 Sheet 的六列 → 标记 confirmed
   ↓
⑧ 至少一条确认后可点击 Write ROI archive：用户先确认记录数，再补齐延后语言并顺序写入 Runs → Scopes → Items
```

当前版本是纯客户端，无后端服务器。TM/LLM 调用经 Native Messaging Host 走本机 Python 桥接（绕浏览器 CORS）。本机 Owner 测试可通过 macOS 系统隐藏输入框把 App Secret 保存到 Keychain，再由 Native Host 调用飞书官方 `authen/v2/oauth/token`；不得把 Secret 打进扩展或安装包。多人分发必须增加服务端 OAuth broker，由 broker 保存 Secret 并完成授权码兑换。用户身份直写 ROI_Test 时，飞书还要求该用户本人拥有 ROI_Test 编辑权限；“可以写入但不能打开 ROI_Test”的私有分发目标必须增加由应用身份写入的受信任代理。

## 本机依赖与分发限制

给别人用时，对方机器只需要 macOS、Chrome、公司网络或 VPN。离线 Installer.app 内置 universal Python、Node.js LTS 与固定版本 Starling CLI，不读取、覆盖、升级或卸载用户已经安装的开发环境；Chrome 仍要求用户本人确认加载未打包扩展。

安装器负责以下项目：

1. 检查或安装 `starling-cli` 1.1.24；AK/SK 仍由用户在 Settings 配置
2. 自检 `native-host/starling-bridge.py`
3. 根据 manifest 公钥计算固定扩展 ID，并原子注册 Native Messaging Host

## 安装

### 快速 CLI 参考

```bash
starling-cli --version
./native-host/install.sh --dry-run --no-open
./native-host/install.sh --no-open
./scripts/build-offline-package.sh
for f in test/*.test.js; do node "$f"; done
python3 -m unittest test/test_export_local_rates.py test/starling-credentials-test.py -v
```

### 推荐安装

1. 对普通用户分发 `L10n-TM-Companion-线下安装包/L10n-TM-Companion-macOS.zip`；解压后双击 `安装 L10n TM Companion.app`，首次被 macOS 拦截时右键选择“打开”
2. 自包含安装器把内置插件复制到 `~/L10n TM Companion - Chrome 加载这个文件夹`，自检 bridge、注册 Native Host，并在桌面创建同名可点击入口
3. 开启“开发者模式”，点击“加载已解压的扩展程序”；在文件窗口左侧点击“桌面”，选择 `L10n TM Companion - Chrome 加载这个文件夹`
4. `Cmd+Q` 完全退出 Chrome 并重开，然后进入扩展 Settings 完成凭证配置

维护者运行 `./scripts/build-offline-package.sh` 可重复生成仅含 Installer.app、简明手册和分享 ZIP 的交付目录；浏览器运行文件与 Native Host 封装在 App 的 `Contents/Resources/extension` 中，测试、handoff、临时文件和历史教程不会进入交付包。源码目录中的开发版 Installer.app 仍支持原地安装。

固定扩展 ID 为 `bgbodpcofifiloekhfjiffmchcaiiicm`。当前 App 只有 ad-hoc 完整性签名，尚未使用 Apple Developer ID 签名与 notarization；Chrome 的加载确认也不能由安装器代替。完整依赖下载链接、逐步配置、健康检查和排障见[面向非技术用户的安装与使用手册](docs/offline-install-manual.md)。

### 配置参数

点击扩展图标 → ⚙️ 设置，填写：

| 配置 | 说明 |
|------|------|
| Starling Access Key / Secret Key | 两项均完整填写，默认遮挡；点击眼睛显示完整内容 |
| Save & Verify | 同时写入 Chrome 副本与 Starling 官方配置，并真实验证项目权限 |
| Starling CLI 路径 | 通常留空自动检测，排障时填绝对路径 |
| TM 查询模式 | 默认「Batch TM API in PPE」；只有排障时才切回旧的单条 CLI 查询 |
| LLM Provider / Endpoint / Key / Model | Inspire Writer、Claude 或 OpenAI-compatible；Inspire 入口为 [inspire.bytedance.net](https://inspire.bytedance.net)，填写个人 `wak_…` Access Key；LIVE CD teamId 已固定，再选择 OpenAPI 支持的模型与 thinking level |
| Feishu account | App ID 固定；普通用户在 Side Panel 首页点击 `Authorize`；插件读取姓名、英文名、user ID、open ID 与头像用于 ROI Operator |
| ROI archive Bitable | 固定写入 [ROI_Test](https://bytedance.larkoffice.com/wiki/J1RJwEf0FijMQQkceUkcZyqCnJc?table=tbls3B039S6J7zdT&view=vewSwbY6Ry)，用户无需配置 URL |

应用 Owner 需要在飞书开放平台为用户身份开通并发布 `sheets:spreadsheet.meta:read`、`sheets:spreadsheet:read`、`sheets:spreadsheet:write_only`、`wiki:node:read`、`base:table:read`、`base:table:create`、`base:field:read`、`base:field:create`、`base:record:read`、`base:record:retrieve`、`base:record:create`、`base:record:update`、`base:view:read`、`base:view:write_only`、`contact:user.base:readonly` 与 `contact:user.employee_id:readonly`，并登记 `http://localhost:39641/l10n-tm-companion/oauth/callback`。新增 scope 发布后，旧用户必须在 Side Panel 首页重新授权一次。本机 Owner 测试需先在 Settings 的 `Application owner setup` 通过系统隐藏输入框配置 Keychain；正式多人分发需改用服务端 OAuth broker，普通用户只在首页点击授权。发布应用、上传插件或分享 ROI_Test 都不会自动产生用户，只有安装插件并实际授权的账号才会出现在 ROI Operator。Working spreadsheet 支持当前页面自动选择，也支持用户粘贴任意已授权的 `/sheets/` 或 `/wiki/` 链接；Wiki node 会先解析为真实 `obj_token`。

日常运行配置放在 Side Panel，并按 `1 Projects → 2 Spreadsheet → 3 Run → 4 Review` 展示真实操作顺序；Projects 与 Spreadsheet 同时只展开一个，长内容在最高 380px 的区域内滚动，运行完成或恢复有效历史运行后自动进入 Review。飞书授权有效时首页只保留头像与姓名，运行写入目标和确认数量也只在 Review 展示。插件先分页调用 Starling `/projects`，完整发现当前 AK/SK 有权访问的项目，再由 CD 选择一至十个项目；界面每页展示八个项目，只有一页时也显示 `Page 1/1`，翻页保留跨页选择，十个上限对全部页面合并生效。项目发现与 `/gateway/openapi/corpus/tm/match/batch` 的实际 TM 查询是两个独立阶段。ROI mode 关闭时，程序从全部所选项目的共同 target locales 中确定性选择第一个内部参考 locale，用于满足 Starling Batch TM 协议；该实现参数不在 CD 界面展示，vendor、费率和 coverage languages 也不参与普通运行。开启 ROI mode 后选择 vendor，语言选择器只显示全部已选项目共同支持且当前 vendor 存在精确按字费率的 `targetLocales`；用户只选择一次共享语言集合，每个语言生成一个携带全部已选 `projectIds` 的 scope。Review 首轮只查询第一个展示 scope，单条与批量 Confirm 也只查询该 scope；点击归档并确认后，其余 scope 以最多三个并发补齐真实 A/B/C TM。AI 始终执行 English-to-English rewrite；同一车只创建一组 Inspire task 决策，再在各 ROI scope 查询真实 Score B，避免按语言重复调用 LLM。

ROI 费率只来自随插件发布的 `data/local-rates.json`。RWS 与 Pactera 按当前 source-target
语言对显示 AIPE 和 T-only 单价；Alconost 与 Skrivanek 当前原表只有 hourly rate，
按字 ROI 会明确显示 `missing_word_rate`。正式 ROI 是每个 scope 的 `TM cost(A) - TM cost(C)`，版本 B
只供 CD 审阅，不能进入金额。整车金额只在 ROI_Test 的 `L10n ROI Runs` 的金额列和 `Pricing notes` 中显示；Side Panel 与
Spreadsheet 均不显示 ROI 金额。最终 C 缺失、G 不为 Yes、第三次 TM 失败或费率不完整时，记录保持
`incomplete`，金额与 `Pricing notes` 显示所有可计算文案的小计；完全没有可计算的最终 C 时金额留空。完整翻译基线仍是本地英文词数乘 AIPE 单价的参考字段；TM 成本按真实 score
估算，0–75（含 75）走 AIPE，(75,85]、(85,95]、(95,100) 分别按 T-only 的 60%、40%、20%；100% 按命中分类或保守规则处理。Starling
未返回 100% 命中的计费分类时，插件按 T-only 的 20% 做保守估算，并标记
`exact_unclassified_conservative`。预估不能替代 Elasticsearch 结算结果。

### 配置 Spreadsheet、Sheet 与列布局

Side Panel 默认采用当前 Spreadsheet，也可在 `Working spreadsheet` 粘贴另一份表格链接。同一 Spreadsheet 的全部可见 Sheet 会显示在下拉框中；来源列、数据起始行和输出起始列按 `spreadsheetToken + sheetId` 独立保存。

插件读取 A-Z 前二十行，唯一命中 `Original Source Segment`、`English Source` 或 `Source` 时自动采用该列与下一行；无唯一表头时展示候选并要求确认。输出起始列连续占六列：`Best TM Match`、`Orig Match %`、`Rewritten Segment`、`Post-TM %`、`Reached 85%?`、`Final TM %`。空白输出区会初始化；旧六列表头的 `CD review valid?` 数据区为空时可迁移，存在任意人工 review 值时正确失败，避免覆盖历史确认状态。

展开 Working spreadsheet 可以查看完整 Spreadsheet、Sheet、读取范围、写入范围与前五条非空 source 预览。空白 source 行会跳过，但结果保留真实行号，写回不会错位。

## 使用

1. 在 Settings 填写完整 AK/SK，点击 `Save & Verify`
2. 打开 Side Panel，选择一至十个权限项目；普通 CD 运行保持 ROI mode 关闭，内部参考 locale 由程序自动选择
3. 在飞书电子表格中将本扩展所用飞书应用添加为协作者，授予可编辑权限
4. 从当前 Spreadsheet 打开 Side Panel，选择 Sheet，确认来源列、数据起始行和输出起始列；需要其他表格时展开 `Use a different spreadsheet`
5. 点击 `Read source → Query TM → AI rewrite`；文档 DOM 抓取位于折叠的 `Other sources`
6. 自动触发 Top-3 TM；只有 `50 ≤ Score A < 85` 且 AI 已开启的 source 创建 Inspire task，并最多产生三个候选
7. 在结果卡片点击 `Focus`，查看 Top-3 TM、通过安全门禁的 AI 候选及真实 Post-TM；没有有效 AI 时显示 `None`
8. 只修改需要人工调整的最终 C；例外项可在 Focus 单条 Confirm，其余项点击 `Confirm & write remaining` 批量完成。Final TM 与对应六列全部写入成功后才显示 confirmed
9. 需要整车 ROI 时，在运行前开启 ROI mode、选择 vendor 与 coverage languages；至少确认一条后归档会保留未确认缺口和所有有效小计
10. 点击 `Write ROI archive`；ROI_Test 的 `L10n ROI Runs` 保存本车 A−C ROI 与 pre-AI / after-AI / after-review 漏斗指标

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
│   ├── inspire-models.js      # Inspire 正式模型枚举与历史 ID 迁移
│   ├── i18n.js                # Side Panel 运行时中英文文案
│   ├── sheet-layout.js        # Sheet 表头检测、列换算、范围映射与冲突校验
│   ├── source-rewrite-policy.js # AI 候选结构、安全与真实 Post-TM 门禁
│   ├── review-workflow.js     # Focus 编辑、确认状态机与失败恢复
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

测试覆盖内容抓取、49.99 / 50 / 84.99 / 85 边界、每条单 task、Top-3 TM、最多三个结构化候选、安全门禁、逐候选 Post-TM、Focus 确认状态机、单行与连续区间六列写入、ROI 漏斗、批量请求参数转发，以及 Python 的批量协议解析。

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
- **ROI Bitable 归档**：目标固定为 [ROI_Test](https://bytedance.larkoffice.com/wiki/J1RJwEf0FijMQQkceUkcZyqCnJc?table=tbls3B039S6J7zdT&view=vewSwbY6Ry)，用户不能用历史设置覆盖；顺序追加 `L10n ROI Runs` / `L10n ROI Scopes` / `L10n ROI Items`，不替代普通 Sheet 写回。Runs 保存整车金额，Scopes 保存 target locale 金额和漏斗，Items 每个 source 只保存一条 CD 审计。插件幂等创建基础视图，并在写入前检查飞书每表 20,000 条记录上限；复杂分组、筛选和仪表盘由 ROI_Test Owner 在飞书界面一次性维护。
- **抓取需真机验证**：飞书 wiki/doc 真实 DOM 结构未实测，`content.js` 选择器基于推断；已加全文段落兜底保证不返回空，但段落质量需真机确认。

## 安全

- Starling AK/SK 同时保存在 `chrome.storage.local` 与 `~/.starling-cli/.starlingrc.json`；两处均为本机持久化，不承诺硬件级加密
- AK/SK 默认遮挡但可完整回填；console、Native Host 日志、错误与飞书写回禁止记录凭证明文
- 飞书 App ID 固定在程序中；普通用户从 Side Panel 首页使用 OAuth + PKCE。新版 token 接口要求 App Secret，本机 Owner 测试由 Native Host 系统隐藏输入框写入 macOS Keychain，多人分发由服务端 OAuth broker 持有；短期 user token 与最小用户资料保存在扩展本地存储，日志与错误信息不回显 token
- A/B/C 运行快照仅保存在 `chrome.storage.local`，用于 Side Panel 关闭后恢复候选、逐条确认状态和 ROI archive；快照不含任何凭证，启动新运行时清除，最长保留七天
- 当前纯客户端模式要求每个 Chrome profile 单独授权，并要求当前用户对目标 Spreadsheet 与 ROI_Test 具有相应访问权限；严格的 ROI 私有可见性需要应用身份代理
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
9. **未打包扩展 ID 必须固定**：manifest 的 `key` 字段会让“加载已解压的扩展程序”生成稳定 ID。安装器从同一公钥计算并注册 `bgbodpcofifiloekhfjiffmchcaiiicm`；若手动覆盖 ID 或加载另一份目录，需重新运行安装器。
10. **搜索词容错要客户端做**：`/project/search` 接口大小写不敏感（默认 caseSensitive=false），但**不支持 fuzzy/拼写/符号容错**。用户原文带标点（`gold-medal!`）和库里存的（`Gold Medal`）精确匹配会漏。解决：`_normalize_loose`（lowercase + 去非字母数字后比较）做宽松精确判断，覆盖符号/大小写差异。
11. **多项目要并发 + 取最优**：同一原文在多项目都可能命中 key，逐项目串行查太慢。bridge 用 `ThreadPoolExecutor` 并发 + `_pick_best`（exact 优先 → score 优先 → 跳过空 key）取最优一个，结果带 project 来源写 J 列。

---

## 当前状态一句话总览

**当前状态：Settings 凭证双存储与 Popup 权限项目选择已实现；真实 `/projects` 只读检查返回 `live_client (513)`、`TikTok_Client (385)`、`TikTok_main (278)`。** 文档 DOM 抓取仍是折叠的次要入口，后续继续按真机页面变化微调。
