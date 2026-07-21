# Side Panel 运行配置与凭证管理

本文定义 L10n TM Companion 的 AK/SK、Starling 项目、快速 TM、按需 ROI、费率状态和 Side Panel 交互。它是这些功能的当前统一规格；README 与 Setup Guide 只保留入口和操作摘要。

## 业务目标

用户不需要打开 Terminal。首次使用时在 Settings 直接输入 Starling Access Key（AK）和 Secret Key（SK），保存后插件自动发现该账号有权限访问的项目；日常使用在 Side Panel 选择一至十个项目和一个共同 target locale。ROI 默认关闭，只有显式开启后才要求 vendor 和多语言覆盖范围。

Side Panel 替代固定 420×600 的 action Popup。点击扩展图标打开持久面板，失焦不会销毁界面；长文本在卡片内通过“展开详情”完整显示，Focus 视图继续用于逐条审阅。顶部语言选择器即时切换中文与英文并持久化到当前 Chrome profile。按钮反馈、折叠内容、Tab、前八张结果卡和 Focus 视图使用 160–240ms 的 `transform/opacity` 动效；系统开启 reduced motion 时自动关闭这些动效，动效不等待网络也不阻塞输入。

## 快速路径与 ROI mode

快速路径将相同 source locale、共同 target locale 的全部已选项目组成一个 Batch TM scope。它不加载 `local-rates.json`，不解析 vendor，不执行多语言计价，也不显示最终 C 与 archive 操作。该路径是普通 CD 的默认入口。

ROI mode 开启后，Side Panel 才显示 vendor 与 `Shared ROI target languages`。选择器先计算全部项目的 target locale 交集，再保留 vendor 有精确按字费率的语言；每个已选共享语言生成一个 scope，scope 携带全部已选 `projectIds` 并只发送一次 Batch TM 请求。两个项目与二十一个共享语言产生二十一个语言 scope，不产生四十二个项目语言笛卡尔积 scope。AI 候选 B 在同一车中只生成一次，默认参考快速目标语言对应的英文 `tm_source`；其他语言复用同一 B，并分别查询真实 Score B，避免把 LLM 调用数乘以语言数。

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

## Spreadsheet、Sheet 与动态布局

`Working spreadsheet` 是当前读写目标的唯一入口。默认自动采用当前打开的 Feishu Spreadsheet；用户可展开 `Use a different spreadsheet` 粘贴另一份 Spreadsheet 链接形成手动 override，也可一键恢复当前页面。插件列出该 Spreadsheet 内全部可见 Sheet，用户必须能通过下拉框显式切换，不能隐式固定为第一个 Sheet。

布局配置以 `spreadsheetToken + sheetId` 为键独立保存。切换 Spreadsheet 或 Sheet 后，插件恢复该 Sheet 最近确认的来源列、数据起始行与输出起始列；首次进入则读取 A-Z 的前二十行重新检测。检测只接受标准化后完全等于 `Original Source Segment`、`English Source` 或 `Source` 的唯一表头；唯一命中时采用该列并将下一行设为数据起始行，多处命中或无表头时展示候选值并要求用户确认。无表头时使用首个非空单元格作为候选数据起始行；候选位于第一行时必须要求用户调整，因为输出区仍需要单独的表头行。

Side Panel 显示来源列、可编辑的数据起始行、输出起始列、实际读取范围、实际写入范围与前五条非空 source 预览。输出从用户选择的起始列连续占六列，依次为 `Best TM Match`、`Orig Match %`、`Rewritten Segment`、`New Match %`、`Reached 85%?`、`CD review valid?`。来源列与输出区域重叠、输出表头不符合契约或空表头下已有输出数据时，插件正确停止并要求用户调整，禁止覆盖未知内容。

运行前摘要必须同时显示 Spreadsheet、Sheet、读取范围和写入范围。空白 source 行被跳过，但每个结果保留真实原始行号，写回时不得压缩到其他行。

## 界面语言契约

首次安装默认使用英文，之后按 Chrome profile 记住用户最近一次选择。英文模式的全部插件自有可见文案、动态状态、校验错误、按钮 title、placeholder 与 aria-label 必须为英文，不能混入中文；中文模式从同一组 i18n key 渲染完整中文。动态文案使用参数插值，禁止在业务代码中拼接双语字符串。

## Popup 运行配置

Popup 顶部的 `Run configuration` 是主流程的可滚动区域，配置完整后仍保持当前展开状态；summary 格式为 `Pactera · en→zh-Hans · 2 projects`，任一必填项缺失时自动展开。

展开内容包括：

1. vendor 四选一下拉框。
2. 权限项目列表位于独立的 `Projects` 折叠区，项目卡展示名称、ID、source locale 和“当前 vendor 可计费语言数 / Starling target 总数”。
3. `Shared ROI target languages` 位于独立的折叠区；默认勾选全部项目共同支持且当前 vendor 有精确按字费率的语言。顶部可按 locale code 搜索，`Select all` 与 `Clear all` 作用于这一组共享语言；用户取消的语言不会进入本次 scope。范围摘要显示“已选语言 scope / 可用语言 scope”，其中 scope 数等于共享语言数，与项目数无关。
4. 切换 vendor 时，插件把当前选择重置为新 vendor 的全部可计费语言，避免保留已经隐藏且不能按字计算 ROI 的旧语言范围。若某个语言对只有 hourly rate 或没有精确费率，该语言不出现在本次 vendor 的选择器中。
5. `Refresh projects`，用于权限变更后重新拉取。
6. 当前 local rate 状态。

Popup 打开且凭证有效时自动调用 `list_projects`。成功结果写入 Chrome 仅供审计；每次打开和显式刷新都以接口结果完全替换运行时列表。接口失败时清空运行时项目与选择，禁止把缓存项目当作本次已验证权限。

选择第一个项目后，当前 source 自动采用其 `sourceLocale`，该项目当前 vendor 可计费的全部 target locale 默认勾选。继续多选时，只允许选择相同 source locale 的项目；每次项目变化都会重新计算共同 target locale，并删除不再被全部项目支持的语言，禁止悄悄换成另一种语言。项目最多十个，达到上限后其他卡片禁用；没有共同语言时普通项目选择仍可保留，但 ROI 运行会给出明确错误并停止。

vendor 与 `starlingProjectIds` 每次点击后立即写入 Chrome storage，不再需要额外 Save。旧版 Settings 中已保存的选择首次加载时迁移到 Popup，之后 Settings 不再编辑这些字段。

## 费率状态

费率 resolver 严格使用 `vendor + canonical source locale + canonical target locale`；canonical 字段由导出器显式写入 local rate 快照，未知工作簿标签会停止导出。Popup 对每个已选 scope 解析费率，并汇报完整 scope 数与缺失项。错误必须包含可操作上下文：

- 语言对存在按字费率：显示 `AIPE USD X/1000 words · T-only USD Y/1000 words`。
- 当前 vendor 无该语言对：显示项目、语言对和缺失原因；TM 仍可运行，ROI subtotal 排除该 scope。
- Alconost 或 Skrivanek 只有 hourly rate：显示 `该语言对只有 hourly rate，无法进行按字 ROI`。
- 所有 vendor 都无该语言对：显示当前 vendor 缺少精确费率、TM optimization 可以继续、ROI amount 不可计算。

费率缺失不阻断 TM 查询，也不伪造金额。任一 scope 缺失时整车状态为 `incomplete`，Popup 先按失败原因归并数量，再显示可滚动的完整 scope 列表；Starling 未分类的 `100%` TM 按 T-only 的 20% 保守估算，并在逐语言明细中保留该估算分类。

## 普通 Sheet 输出 schema

当前标准输出字段仍为六列：`Best TM Match`、`Orig Match %`、`Rewritten Segment`、`New Match %`、`Reached 85%?`、`CD review valid?`，但来源列、数据起始行与输出起始列由当前 Sheet 的布局配置决定。最后一列由 CD 人工填写，插件只负责创建 `Yes`、`No` 单选下拉并保留已有选择。

Popup 关闭后会销毁页面内存。插件会在本机 `chrome.storage.local` 保存最近一轮 A/B/C 的运行快照，使 CD 写回 Sheet 后重新打开 Popup 可以直接确认最终 C，或在 Score C 完成后直接写 ROI archive。快照不包含 Starling、飞书或 LLM 凭证；启动新的 TM 运行会清除旧快照，快照最长保留七天，并且仅在写回时的同一份 Spreadsheet 中恢复。

插件在每次结果写入前为布局确定的 CD review 列和真实数据行范围设置 `Yes`、`No` 单选下拉，新记录保持空白。下拉设置失败时停止结果写回并展示真实错误；后续写回不得覆盖已有 CD 选择。

`Comment`、`Source String Key` 和 `Project` 已退出标准 schema。旧表 H-J 的历史数据保留，插件不删除、不覆盖，也不再把这些列作为表头校验要求。

## ROI 归档 Bitable

Settings 中的 `ROI archive Bitable` 独立于 Working spreadsheet，只接受用户提供的 Feishu Wiki 或 `/base/` Bitable 链接。它只作为跨运行 ROI 审计目标，不能替代或改变普通 Sheet 的动态输出区写回。Spreadsheet 与 ROI archive 均使用 Settings 中填写的 Feishu App ID 与 App Secret 换取 tenant access token。

结果页在 CD 已于当前 Sheet 的 `CD review valid?` 列确认最终 C、第三次 TM 已完成、已配置归档目标且 App ID 与 App Secret 完整时启用 `Write ROI archive`。点击后必须显示目标链接、将使用的 `L10n ROI Runs` / `L10n ROI Scopes` 两张表和记录数量，并由用户确认；取消确认不调用飞书写入接口。首次确认写入时会创建两张表并直接写入；Runs 直接写入 `Full translation USD`、`TM estimated USD` 与 `Saving USD`，其中 Saving 是本次正式 A−C 节省，整车不完整时金额仅代表已覆盖语言小计。Scopes 仅保留覆盖与失败原因。无需配置任何 Formula；已有同名表仍必须通过字段名和类型的完整校验，否则停止并报告 schema mismatch。

Settings 保存 App ID 与 App Secret；飞书客户端以它们请求短期 `tenant_access_token`。应用 Owner 需开通并发布 `sheets:spreadsheet`、`wiki:wiki:readonly` 及 ROI archive 所需的 Bitable scope，并把应用添加为目标 Spreadsheet 与 Bitable 的可编辑协作者。App Secret 只存于每个 Chrome profile 的本地扩展存储，默认遮挡，Options、日志与 Popup 都不显示其内容。缺少凭证、应用权限未发布或文档协作权限不足时，读写与归档停止并展示飞书返回的真实错误。

## 缺失配置引导

Popup 启动时按以下顺序检查：Native Host、AK/SK、已验证项目权限、vendor、项目选择、工作表。

- Native Host、Starling CLI 或 AK/SK 缺失：顶部显示阻塞式 `Setup required`，唯一主按钮为 `Open Settings`，读取和抓取按钮禁用。
- 凭证有效但 vendor 缺失：自动展开 Run configuration，并聚焦 vendor。
- 凭证有效但项目或 target locale 未选择：自动展开 Run configuration，并分别提示至少选择一个项目和一个共同支持的 target locale。
- 工作表缺失：保留 Run configuration，展开 Working spreadsheet，引导打开或选择表格。

开始 TM 前再次执行轻量校验，避免 Popup 打开后配置被清理。校验失败必须正确停止，不得使用默认项目 385 或空 project list 继续查询。

## 页面收纳

`Other sources` 保持 `<details>` 且默认关闭，`No Feishu doc detected` 或文档标题移入其内部。主页面只保留 `Read configured source range` 作为高频入口。

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
9. `en→en` TM 查询可运行；缺少精确费率使整车 ROI incomplete，但仍展示已覆盖语言小计。AI 关闭时完整 scope 的 Saving 为 0。普通 Sheet 的六列输出区按确认布局定位，最后一列为默认空白的 Yes/No 单选下拉。
