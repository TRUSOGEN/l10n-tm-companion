# Side Panel 运行配置与凭证管理

本文定义 L10n TM Companion 的 AK/SK、Starling 项目、快速 TM、按需 ROI、费率状态和 Side Panel 交互。它是这些功能的当前统一规格；README 与 Setup Guide 只保留入口和操作摘要。

## 业务目标

用户不需要打开 Terminal。首次使用时在 Settings 直接输入 Starling Access Key（AK）和 Secret Key（SK），保存后插件自动发现该账号有权限访问的项目；日常使用在 Side Panel 选择一至十个项目和一个共同 target locale。ROI 默认关闭，只有显式开启后才要求 vendor 和多语言覆盖范围。

Side Panel 替代固定 420×600 的 action Popup。点击扩展图标打开持久面板，失焦不会销毁界面；结果卡只保留“Review & edit / 审阅与修改”入口，该视图默认折叠长 Top-3 TM 与多 AI 候选，最终文案输入框按内容自动伸缩。顶部语言选择器即时切换中文与英文并持久化到当前 Chrome profile。按钮反馈、折叠内容、Tab、前八张结果卡和审阅视图使用 160–240ms 的 `transform/opacity` 动效；系统开启 reduced motion 时自动关闭这些动效，动效不等待网络也不阻塞输入。

## 快速路径与 ROI mode

快速路径将相同 source locale、共同 target locale 的全部已选项目组成一个 Batch TM scope。它不加载 `local-rates.json`，不解析 vendor，不执行多语言计价，也不显示最终 C 与 archive 操作。该路径是普通 CD 的默认入口。

ROI mode 开启后，Side Panel 才显示 vendor 与 `Shared ROI target languages`。普通 CD 路径不显示 target locale，程序从所选项目共同支持的 locales 中确定性选择第一个内部参考 locale，并以该 scope 的英文 `tm_source` 生成一次 AI 候选 B。ROI 选择器先计算全部项目的 target locale 交集，再保留 vendor 有精确按字费率的语言；每个已选共享语言生成一个 scope，scope 携带全部已选 `projectIds` 并只发送一次 Batch TM 请求。两个项目与二十一个共享语言产生二十一个语言 scope，不产生四十二个项目语言笛卡尔积 scope；其他语言复用同一 B，并分别查询真实 Score B，避免把 LLM 调用数乘以语言数。

低频信息默认折叠。运行配置本身保持可见并允许在主面板滚动，项目选择和语言范围各自使用独立的折叠区；缺少必填项时主动展开对应区域并给出唯一的下一步操作。

## 已确认规则

1. Starling 项目至少选择一个，最多选择十个；零项目时禁止开始 TM 查询。
2. 项目支持单选和多选。Starling 项目实际返回一个 `sourceLocale` 和多个 `targetLocales`；一次运行的项目必须使用同一 source locale。ROI 只展示全部已选项目共同支持且当前 vendor 存在精确按字费率的 `targetLocales`，默认覆盖全部共同语言；运行 scope 一一对应 `selected shared target locales`，每个 scope 将全部已选项目 ID 一次性发送给 Batch TM。
3. vendor 必须从 RWS、Pactera、Alconost、Skrivanek 中选择一个，作为当前运行的统一 vendor。
4. AK/SK 同时保存在 Chrome `storage.local` 和 Starling 官方配置中。Chrome 副本用于 Settings 完整回填与 Native Host 配置被清理后的恢复；官方副本供 starling-cli 和 Starling Core 使用。
5. AK/SK 输入框都回填完整值，默认使用 password 样式遮挡，点击眼睛后显示完整内容。
6. `Other sources` 与 `Working spreadsheet` 默认折叠，工作表折叠标题显示当前可用状态。
7. AI rewrite 始终发生在 source 侧；当前业务 source 为英文，因此 rewrite 是 English-to-English。每个 ROI scope 的 target locale 决定对应 Starling TM target 和 vendor 费率，允许 `en→en` 查询。

## 凭证数据流

### 保存

Settings 的 `Save & Verify` 依次执行：

1. 校验 AK 和 SK 均非空，不接受只保存其中一个。
2. 通过 background 将完整凭证发送到 Native Host 的 `save_starling_credentials` action。
3. Native Host 从当前 starling-cli 安装中加载官方 Starling Core，调用 `saveConfig({ accessKey, secretKey })`；官方实现写入 `~/.starling-cli/.starlingrc.json` 并设置权限 `0600`。
4. Native Host 使用刚保存的凭证调用项目列表接口完成真实验证。验证失败时返回结构化错误，不返回凭证内容。
5. 正常保存路径中，官方配置保存且验证成功后，Settings 才把完整 AK/SK 与 `credentialsUpdatedAt` 写入 `chrome.storage.local`，并展示已配置状态和权限项目数量；Native Host 不可用时按下述“仅本地备份”例外处理。

若 Native Host 不可用，Settings 可以把凭证保存为 Chrome 备份，但状态必须显示 `saved_locally_not_activated`，TM 查询保持禁用；重新安装 Native Host 后，用户在 Settings 再次点击 `Save & Verify` 即可恢复官方配置并重新验证。该状态不能显示为配置成功。

### 读取与优先级

Settings 打开时先读取 Chrome 副本并完整回填两个 password 输入框。Chrome 没有副本时，调用 Native Host 的 `get_starling_credentials` 读取官方配置并导入 Chrome；用户已明确接受完整 AK/SK 从本机配置返回扩展页面。

运行时优先使用 Chrome 中最新保存的 AK/SK，并随 Native Messaging 请求在内存中传给 Native Host。Native Host 将它们作为 `STARLING_ACCESS_KEY`、`STARLING_SECRET_KEY` 注入当前 Starling 子进程；Chrome 没有凭证时才使用官方配置文件。官方配置被清理但 Chrome 副本仍在时，本次请求仍可运行；再次 `Save & Verify` 会恢复官方副本。

### 凭证保护边界

`chrome.storage.local` 和 `~/.starling-cli/.starlingrc.json` 都属于本机持久化存储，不提供硬件级加密。UI 必须明确提示该事实。任何 console、Native Host debug log、错误信息、测试 fixture 和飞书写回都不得记录真实 AK/SK；自动化测试只使用 `test-ak`、`test-sk`。

Native Host 当前只记录 action 与 message key，继续禁止记录 message value。凭证相关异常必须转换为固定错误码，例如 `credentials_invalid`、`native_host_unavailable`、`starling_cli_missing`，禁止把包含请求对象的异常 `repr` 返回页面。

## Settings 交互

Starling 区包含：

- Access Key password 输入框、Secret Key password 输入框，以及各自独立的显示/隐藏按钮。
- `Save & Verify`：保存两份凭证并真实加载项目列表。
- `Credential status`：显示未配置、仅本地备份、已验证或验证失败；已验证时显示项目数量，不回显到状态文本。
- AK/SK 申请链接、Native Host/CLI 检测结果和重新验证按钮。

Settings 不再承担日常项目和 vendor 选择。Advanced 仅保留 Starling CLI path 与 TM mode；source 来自项目 `sourceLocale`，快速 target 与 ROI target 均在 Side Panel 选择。

Settings 顶部使用固定四步清单说明首次配置：`Starling 个人中心取 AK/SK → Inspire 取个人 wak_ Access Key（可选）→ 从部门负责人获取 Feishu App Secret 并通过 Enter Feishu App Secret 写入本机 macOS Keychain → 回到 Workflow 授权并运行`。有飞书应用管理权限的用户也可从飞书开放平台的 `Credentials & Basic Info` 自行复制 Secret。页面不再展示 Guide 或 Prototype 文档入口；各配置区只保留字段、按钮和一行必要状态，避免把注册说明重复成大段帮助卡。

## Spreadsheet、Sheet 与动态布局

`Working spreadsheet` 是当前读写目标的唯一入口。默认自动采用当前打开的 Feishu Spreadsheet 或 Wiki 挂载电子表格；用户可展开 `Use a different spreadsheet` 粘贴任意已授权的 `/sheets/` 或 `/wiki/` 链接形成手动 override，也可一键恢复当前页面。Wiki node token 必须通过 `wiki/v2/spaces/get_node` 解析为真实 Spreadsheet `obj_token` 后保存，禁止直接当成 Spreadsheet token。插件列出该 Spreadsheet 内全部可见 Sheet，用户必须能通过下拉框显式切换，不能隐式固定为第一个 Sheet，也不能迁移到任何硬编码历史文档。

布局配置以 `spreadsheetToken + sheetId` 为键独立保存。切换 Spreadsheet 或 Sheet 后，插件恢复该 Sheet 最近确认的来源列、数据起始行与输出起始列；首次进入则读取 A-Z 的前二十行重新检测。检测只接受标准化后完全等于 `Original Source Segment`、`English Source` 或 `Source` 的唯一表头；唯一命中时采用该列并将下一行设为数据起始行，多处命中或无表头时展示候选值并要求用户确认。无表头时使用首个非空单元格作为候选数据起始行；候选位于第一行时必须要求用户调整，因为输出区仍需要单独的表头行。

Side Panel 显示来源列、可编辑的数据起始行、输出起始列、实际读取范围、实际写入范围与前五条非空 source 预览。输出从用户选择的起始列连续占六列，依次为 `Best TM Match`、`Orig Match %`、`Rewritten Segment`、`Post-TM %`、`Reached 85%?`、`Final TM %`。来源列与输出区域重叠、输出表头不符合契约或旧审阅区已有数据时，插件正确停止并要求用户调整，禁止覆盖未知内容。

运行前摘要必须同时显示 Spreadsheet、Sheet、读取范围和写入范围。空白 source 行被跳过，但每个结果保留真实原始行号，写回时不得压缩到其他行。

## 界面语言契约

首次安装默认使用英文，之后按 Chrome profile 记住用户最近一次选择。英文模式的全部插件自有可见文案、动态状态、校验错误、按钮 title、placeholder 与 aria-label 必须为英文，不能混入中文；中文模式从同一组 i18n key 渲染完整中文。动态文案使用参数插值，禁止在业务代码中拼接双语字符串。

## Popup 运行配置

Popup 工作台按真实操作顺序固定为四步：`1 Projects → 2 Spreadsheet → 3 Run → 4 Review`。步骤轨道持续显示当前位置与已完成步骤；项目配置或工作表未就绪时，用户在对应步骤内修复，运行完成或恢复有效历史运行后自动进入第 4 步 Review。环境检查与飞书授权属于四步之前的前置状态，不与业务步骤混排；飞书授权有效时认证卡只显示头像与姓名，未授权、权限过期或缺 scope 时才展开说明与授权按钮。

`1. Projects` 与 `2. Spreadsheet` 使用单开 accordion，展开一个会自动关闭另一个，折叠 summary 始终保持完整可见。两个展开区都限制为 Side Panel 可视高度的 46%、最高 380px，并在内容超出时提供独立纵向滚动；项目 summary 展示 source locale、所选项目数以及 ROI 模式下的 vendor 与 scope 数。运行写入目标、恢复提示和确认数量只出现在 Review，不在 Workflow 重复占位。

Review 结果顶部提供 `All / Improved` 双选筛选并显示各自数量，默认展示全部。`Improved` 只保留真实 Post-TM 查询完整且 `Post-TM > 原 TM` 的条目；持平、下降、未查询和查询失败均不计为提升。筛选只改变当前列表和 Focus 前后导航范围，不改变批量确认、Sheet 写回、ROI 归档或原始运行快照。

审阅卡不直接展示内部 `draft / confirming / confirmed / dirty / error` 枚举。英文界面映射为 `Ready to review / Saving… / Saved / Edited · confirm again / Save failed`，中文界面映射为 `待审阅 / 正在保存… / 已保存 / 已修改，需重新确认 / 保存失败`。单条主按钮使用 `Confirm & save / 确认并保存`，已保存文案再次编辑后使用 `Confirm changes & save / 确认修改并保存`，批量入口使用 `Confirm & save remaining / 确认并保存其余项目`。

展开内容包括：

1. vendor 四选一下拉框。
2. 权限项目列表位于独立的 `Projects` 折叠区，项目卡展示名称、ID、source locale 和“当前 vendor 可计费语言数 / Starling target 总数”。界面每页展示八个项目并始终显示上一页、当前页码和下一页；只有一页时仍显示 `Page 1/1`，两个翻页按钮保持禁用。例如三十个权限项目展示为四页 `8 + 8 + 8 + 6`。翻页不清空已选项目，最多十个的限制对全部页面合并生效；显式刷新后回到第一页，项目数量变化时页码自动收敛到有效范围。
3. `Shared ROI target languages` 位于独立的折叠区；默认勾选全部项目共同支持且当前 vendor 有精确按字费率的语言。顶部可按 locale code 搜索，`Select all` 与 `Clear all` 作用于这一组共享语言；用户取消的语言不会进入本次 scope。范围摘要显示“已选语言 scope / 可用语言 scope”，其中 scope 数等于共享语言数，与项目数无关。
4. 切换 vendor 时，插件把当前选择重置为新 vendor 的全部可计费语言，避免保留已经隐藏且不能按字计算 ROI 的旧语言范围。若某个语言对只有 hourly rate 或没有精确费率，该语言不出现在本次 vendor 的选择器中。
5. `Refresh projects`，用于权限变更后重新拉取。
6. 当前 local rate 状态。

Popup 打开且凭证有效时自动调用 `list_projects`。Native Host 通过当前 AK/SK 请求 Starling `/projects`，显式使用每页 25 条的 `limit` 与递增 `offset`，直到累计数量达到响应中的 `total`；任何中间页、响应结构或完整性校验失败都使本次项目发现整体失败，禁止把第一页或其他部分结果显示为完整权限列表。Native Host 的 25 条是接口拉取页大小，Popup 的八条是展示页大小，两者相互独立；Popup 只有在完整发现成功后才对结果做本地翻页。成功结果写入 Chrome 仅供审计；每次打开和显式刷新都以接口结果完全替换运行时列表。接口失败时清空运行时项目与选择，禁止把缓存项目当作本次已验证权限。

项目发现与 TM 查询是两个独立接口阶段：`/projects` 只返回当前 AK/SK 有权访问的项目元数据，用户选择一至十个项目后，实际 TM 查询仍调用 `/gateway/openapi/corpus/tm/match/batch`，请求中的 `projectIds` 与 `sourceContents` 各自遵守最多十条的平台上限。

选择第一个项目后，当前 source 自动采用其 `sourceLocale`，该项目当前 vendor 可计费的全部 target locale 默认勾选。继续多选时，只允许选择相同 source locale 的项目；每次项目变化都会重新计算共同 target locale，并删除不再被全部项目支持的语言，禁止悄悄换成另一种语言。项目最多十个，达到上限后其他卡片禁用；没有共同语言时普通项目选择仍可保留，但 ROI 运行会给出明确错误并停止。

vendor 与 `starlingProjectIds` 每次点击后立即写入 Chrome storage，不再需要额外 Save。旧版 Settings 中已保存的选择首次加载时迁移到 Popup，之后 Settings 不再编辑这些字段。

## Inspire Pilot 调用控制

Inspire Writer 只发送 OpenAPI 当前允许的 `gemini_3f`、`gemini-3.1-pro`、`gpt-5.4-mini` 与 `gpt-5.4`。历史版本曾保存的 `gemini-3.1-p-priority`、`gpt-5.4-mini-2026-03-17` 与 `gpt-5.4-2026-03-05` 会在 Settings 加载和请求发送前迁移到对应正式 ID；thinking level 仍独立使用 `low`、`medium` 或 `high`。

Inspire Writer 的 Pilot 默认同时保持最多五十个在途改写任务，以覆盖服务端异步生成等待。当前提速试验把客户端请求 gate 提高到 100 QPS，每个任务的创建、status polling 与 copies 读取复用该 gate，任何并发任务都不能绕过；Claude 和其他 OpenAI-compatible Provider 继续使用原有并发策略。100 QPS 只是客户端发送上限，不能证明服务端额度已经同步提高；服务端返回 429、400 或 5xx 时必须保留真实错误。运行中的状态区按批次显示 `finished / total`、当前活跃任务数和累计 status poll 数，避免把最后启动的 Row 误显示为串行卡点。单次 HTTP 请求默认最多等待 30 秒，单个 task 从创建到 copies 解析共用 120 秒截止时间；超时、失败与无可用 revision 都保留真实错误，禁止用空候选或原文伪装成功。每批结束后状态区与本机日志记录完成任务数、实际 HTTP 请求数和 status polling 次数，平台侧每天 5,000 次配额仍是最终日上限。

`completed` 只表示服务端任务进入终态，不能保证 revision 已在第一次 copies 读取时可见。版本 1.1.4 对同一 task 最多读取三次 copies，读取之间复用现有 poll interval 和请求 gate；该过程不创建新 task。最终仍无可用 revision 时，错误只记录 copies/revisions 数量、revision 字段名和 prompt 字符数，不记录生成内容或 Access Key。

## Content Review 规则与结果选择

当前 Inspire Prompt 使用 TM Alignment Prompt、`cd-content-review-version-2`、Content Review Principles、Game Legal Guidelines 与 Revenue Legal Guidelines 的版本化 Markdown 快照。Style Guide 与 Glossary 不再加载或注入 Prompt。每条 Inspire prompt 对保留的规则证据执行确定性检索和字符预算，完整 prompt 超过 12,000 字符时正确失败；Writer revision 协议固定在首尾，一个 task 最多读取三个普通 revision，客户端将其包装为结构化候选后再执行安全门禁与真实 Post-TM。任何必需规则文件缺失都使本条 AI 改写真实失败，禁止绕过规则继续生成。

结果卡片严格保持 Sheet 原始行号顺序。TM source 中可安全识别的模板语法只在 UI 中转换为可读预览，原始 TM 文本继续保留用于审计。最终选择固定为 `保持原文 A`、`使用 AI 候选 B` 与 `人工编辑`；只有 URL、placeholder、模板 token 和数字逐项保持一致且真实 Score B 高于 Score A 时，B 才默认选中，其余情况默认保持 A。

## 费率状态

费率 resolver 严格使用 `vendor + canonical source locale + canonical target locale`；canonical 字段由导出器显式写入 local rate 快照，未知工作簿标签会停止导出。Popup 对每个已选 scope 解析费率，并汇报完整 scope 数与缺失项。错误必须包含可操作上下文：

- 语言对存在按字费率：显示 `AIPE USD X/1000 words · T-only USD Y/1000 words`。
- 当前 vendor 无该语言对：显示项目、语言对和缺失原因；TM 仍可运行，ROI subtotal 排除该 scope。
- Alconost 或 Skrivanek 只有 hourly rate：显示 `该语言对只有 hourly rate，无法进行按字 ROI`。
- 所有 vendor 都无该语言对：显示当前 vendor 缺少精确费率、TM optimization 可以继续、ROI amount 不可计算。

费率缺失不阻断 TM 查询，也不伪造金额。任一 scope 缺失时整车状态为 `incomplete`，Popup 先按失败原因归并数量，再显示可滚动的完整 scope 列表；Starling 未分类的 `100%` TM 按 T-only 的 20% 保守估算，并在逐语言明细中保留该估算分类。

## 普通 Sheet 输出 schema

当前标准输出字段为六列：`Best TM Match`、`Orig Match %`、`Rewritten Segment`、`Post-TM %`、`Reached 85%?`、`Final TM %`，来源列、数据起始行与输出起始列由当前 Sheet 的布局配置决定。初次运行不写入候选；每条 `Confirm & save` 在 Final TM 完整后一次写入该行六列。结果页另提供 `Confirm & save remaining`：已确认项跳过，其余项逐项执行同一本地门禁与 Final TM 查询，相邻真实行号合并为连续 B-G 区间写入，行号空洞不会被覆盖。

Popup 关闭后会销毁页面内存。插件会在本机 `chrome.storage.local` 保存最近一轮 A/B/C、候选审计与逐条确认状态，使 CD 重新打开 Popup 后继续“Review & edit / 审阅与修改”，或在已有 confirmed 条目时写 ROI archive。快照不包含 Starling、飞书或 LLM 凭证；启动新的 TM 运行会清除旧快照，快照最长保留七天，并且仅在同一份 Spreadsheet 中恢复。

## 全语言 ROI 后台预计算的下一阶段边界

会议提出“普通用户不选择 vendor 与语言、默认覆盖约 56 个目标语言，并在每条确认时后台预计算，最终只聚合归档”。该方向尚未启用。正式 ROI 当前以单次运行选择的一个 vendor 和精确按字费率为金额依据；启用全语言前必须先定义每个 locale 的权威 vendor、重叠语言优先级与费率缺失处理，否则同一 source 会产生不唯一金额。

后台任务需要在 Side Panel 关闭后继续运行，因此不能依赖会被销毁的 Popup 内存或可能休眠的 MV3 Service Worker。推荐在 Native Host 增加持久任务队列与按 `run_id + source_id + locale + final_text_hash` 幂等的结果缓存，记录 queued、running、complete、incomplete 状态；Final TM 与 Sheet 单条保存仍保持当前同步事务，56-language ROI 作为独立任务异步执行。上线前必须用真实 18 条与 100 条样本测量 Starling 请求量、并发、P95 完成时间和失败恢复，并按已批准的客户端 QPS 配置容量。

空输出区会初始化新六列表头。发现旧六列表头且旧 `Rewritten Segment` 与 review 数据均为空时，插件可迁移为新 schema；只要旧审阅数据非空，就抛出 `legacy_cd_review_data_conflict` 并停止写入。

`Comment`、`Source String Key` 和 `Project` 已退出标准 schema。旧表 H-J 的历史数据保留，插件不删除、不覆盖，也不再把这些列作为表头校验要求。

## ROI 归档 Bitable

ROI archive 独立于 Working spreadsheet，固定指向 [ROI_Test](https://bytedance.larkoffice.com/wiki/J1RJwEf0FijMQQkceUkcZyqCnJc?table=tbls3B039S6J7zdT&view=vewSwbY6Ry)。Settings 不提供 URL 输入框，历史 storage 值会在升级后清理，底层归档也始终解析固定常量。该目标只承担跨运行 ROI 审计，不能替代或改变普通 Sheet 的动态输出区写回。普通用户从 Side Panel 首页通过固定 App ID 的 OAuth + PKCE 获取短期 `user_access_token`；飞书官方 v2 token 交换要求 App Secret，因此本机 Owner 测试使用 Keychain，多人分发使用服务端 OAuth broker。

结果页在至少一条 source 完成 `本地校验 → Final TM → Sheet 写入` 并成为 confirmed 后启用 `Write ROI archive`；单条与批量确认使用相同 confirmed 语义，零确认整车必须拒绝归档。Review 和 Confirm 只等待展示 scope；点击归档后先显示固定目标、确认/未确认数量与 `1 Run + N Scopes + M source Items`，用户取消时不补算延后语言也不调用飞书写入。用户确认后，插件以最多三个 scope 并发补齐其余语言 A/B/C，再顺序写入 Runs、Scopes、Items。Runs 保存整车金额、Operator 与漏斗；Scopes 保存语言金额、覆盖与漏斗；Items 每条 source 每个 Run 只写一条 A/B/C 审核记录。已有表缺字段时只创建缺失字段；同名字段类型冲突时停止并报告 schema mismatch。

Settings 不允许编辑固定 App ID，也不展示 App Secret 输入框；Chrome storage 中的历史 `feishuAppId` / `feishuAppSecret` 会在升级时清除。普通用户在 Side Panel 首页点击 `Authorize`，完成后首页立即显示姓名、user ID 和头像并重跑环境检查。回调页只确认收到 authorization response，只有 v2 token 交换、用户资料读取与本地保存全部成功后才显示已授权。应用 Owner 需为用户身份开通并发布细分 Sheet scope、`wiki:node:read`、Bitable table/field scope、`base:record:read`、`base:record:retrieve`、`base:record:create`、`base:record:update`、`base:view:read`、`base:view:write_only`、`contact:user.base:readonly` 与 `contact:user.employee_id:readonly`，并登记 localhost 回调地址。1.3.0 新增记录读取与视图权限，已有用户必须重新授权一次；1.3.1 起，插件会比较本地 token scope 与当前必需 scope，缺失时首页显示具体权限并切换为 `Reconnect`；1.3.2 修正容量预检的“列出记录”权限为 `base:record:retrieve`；1.3.3 只信任 v2 token 响应实际返回的 scope，并一次性废弃 1.3.2 及更早无法证明 scope 来源的本地 token。用户未授权、应用权限未发布、token broker/Keychain 未配置或文档权限不足时，读写与归档停止并展示真实错误。

当前部门内部分发允许获准用户展开 Settings 的 `Feishu App Secret`，点击 `Enter Feishu App Secret` 后由 Native Host 调起 macOS 隐藏输入框，先验证 App Secret，再保存到当前用户 Keychain；Secret 不进入 DOM、Chrome storage、Native Messaging 响应、日志或安装包。部门负责人通过批准的内部渠道把同一应用 Secret 提供给获准用户，每位用户只在自己的 Mac 上输入一次。正式扩大到无需接触 Secret 的多人发布仍需要服务端 OAuth broker 在受信任环境保存 Secret、兑换 authorization code，并向客户端返回受限的用户会话。

当前 `direct_user` 写入模式遵循飞书当前调用身份的数据权限：若普通用户使用 `user_access_token` 追加 ROI_Test，该用户必须具有 ROI_Test 编辑权限，也就能打开该表。产品目标“任何获准插件用户均可点击写入，但只有 Owner 分享链接的人能查看”需要独立的应用身份代理：客户端把经过验证的 Runs/Scopes/Items payload 和用户身份声明发给代理，代理持有 App Secret、校验调用方并用 `tenant_access_token` 写入；App Secret 不能进入扩展。ROI_Test 文档显示名可以改，固定 Wiki token 与三张内部表名不变即可。

## 缺失配置引导

Popup 启动时按以下顺序检查：Native Host、AK/SK、已验证项目权限、vendor、项目选择、工作表。

- Native Host、Starling CLI 或 AK/SK 缺失：顶部显示阻塞式 `Setup required`，唯一主按钮为 `Open Settings`，读取和抓取按钮禁用。
- 凭证有效但 vendor 缺失：自动展开 Run configuration，并聚焦 vendor。
- 凭证有效但项目或 target locale 未选择：自动展开 Run configuration，并分别提示至少选择一个项目和一个共同支持的 target locale。
- 工作表缺失：保留 Run configuration，展开 Working spreadsheet，引导打开或选择表格。

开始 TM 前再次执行轻量校验，避免 Popup 打开后配置被清理。校验失败必须正确停止，不得使用默认项目 385 或空 project list 继续查询。

## 页面收纳

`Other sources` 保持 `<details>` 且默认关闭，`No Feishu doc detected` 或文档标题移入其内部。主页面只保留 `Read source → Query TM → AI rewrite` 作为高频入口。

`Working spreadsheet` 整块使用 `<details>`。可用时 summary 显示 `✓ <Spreadsheet> / <Sheet> ready` 并默认关闭；不可用、无权限或布局未确认时 summary 显示错误并自动打开。展开后展示 Spreadsheet override、Sheet 下拉框、动态布局、读写范围和 source 预览。

健康检查继续默认折叠。配置错误优先通过 Setup required 或对应折叠 summary 表达，避免同一错误在多个常驻区域重复占位。

## 失败语义

凭证保存、凭证验证、项目加载和 TM 查询分别返回独立状态。任何阶段失败都不得沿用未验证项目、默认项目 385、空 AK/SK 或本地 New Match 结果伪装成功。

项目接口返回空数组时显示 `No accessible Starling projects`；它与 AK/SK 无效、接口错误和 Native Host 不可用是不同状态。凭证更新后清除项目权限验证时间并重新加载项目；验证完成前旧项目不可用于新查询。

## 验收标准

1. 新用户无需 Terminal 即可在 Settings 保存并验证 AK/SK，关闭再打开后两项完整回填且默认遮挡。
2. 删除官方 `.starlingrc.json` 后，Chrome 副本仍存在；Native Host 可用时插件能恢复官方配置并重新验证。
3. 删除 Chrome 副本但保留官方配置后，Settings 能从 Native Host 导入并回填。
4. Popup 自动列出当前账号权限项目，支持一至十个同 source locale 的项目；共享语言默认全选当前 vendor 可计费的共同 target locales，至少保留一个语言 scope 才能开始 ROI。
5. vendor 与项目在 Popup 选择并即时记住，折叠摘要准确反映当前运行配置。
6. generic local rate 错误被替换为包含 vendor、语言对和可用建议的消息。
7. Other sources、Working spreadsheet 和健康检查默认不占主要空间，缺失或错误时自动展开。
8. 自动化测试和 `/tmp/l10n-bridge-debug.log` 中不存在 AK/SK 明文或模拟凭证之外的敏感值。
9. `en→en` TM 查询可运行；缺少精确费率使整车 ROI incomplete，但仍展示已覆盖语言小计。AI 关闭时完整 scope 的 Saving 为 0。普通 Sheet 的六列输出区按确认布局定位，最后一列保存真实 Final TM。
