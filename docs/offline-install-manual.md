# L10n TM Companion 安装与使用手册

这份手册面向会使用 Mac、Chrome 和飞书，但不懂代码的同学。凭证和权限已经审批完成时，第一次安装大约需要 10–20 分钟；申请权限所需时间不包含在内。完成后，日常使用只需要打开飞书表格和插件。

## 先看这里

L10n TM Companion 会读取飞书表格中的英文原文，查询 Starling Top-3 TM，并按需调用 Inspire Writer 生成英文改写候选。CD 只需在 `Review & edit` 中修改例外项，其余默认结果可通过 `Confirm & save remaining` 批量确认；Final TM 和当前 Sheet 行全部写入成功后，该条才显示 `Saved`。

安装和使用需要：

- 一台公司 macOS 电脑。
- Google Chrome 114 或更高版本。
- 公司网络或 VPN。
- 你自己的 Starling AK 和 SK。
- 使用 AI 改写时，需要 Inspire 的个人 Access Key；默认使用托管 TM Agent 的最新已发布版本，高级项才需要填写 Custom Agent ID 或固定版本，teamId 不需要填写。
- 需要读写飞书表格时，需要共享飞书应用已被添加为目标表格的可编辑协作者。

安装包已经内置 Python、Node.js 和固定版本 Starling CLI。电脑已经安装过这些工具也没有关系：插件只使用自己目录内的私有副本，不覆盖、不升级、不卸载用户已有版本。

个人 AK、SK 与 Inspire Access Key 只粘贴到插件 Settings。本机直连飞书授权还要求获准用户先在 Settings 顶部写入 App Secret；Secret 只能经团队批准的渠道获取，绝不进入聊天、截图、Chrome storage 或安装包。

### 常用词说明

| 名称 | 简单解释 |
| --- | --- |
| TM / Starling | Translation Memory（翻译记忆库）及公司内部查询平台 |
| Source / Target | 待处理的英文原文 / 目标语言 |
| AK、SK、Access Key | 证明当前用户有权调用服务的个人凭证 |
| Native Host | 连接 Chrome 插件与本机 Starling 工具的组件，由安装器自动配置 |
| Service Worker | Chrome 按需启动的插件后台组件，空闲时休眠属于正常现象 |
| Inspire / Provider | AI 改写服务 / Settings 中选择的 AI 服务类型 |
| CD / A、B、C | Content Designer；原文 A、AI 候选 B、人工确认的最终原文 C |
| ROI | 正式节省计算，首次安装和普通 TM 查询不需要开启 |

## 第一步：准备 Chrome

### 安装 Chrome

1. 打开 [Google Chrome 下载页](https://www.google.com/chrome/)。
2. 点击下载并完成安装。
3. 打开 Chrome，在地址栏输入 `chrome://version`。
4. 确认第一行版本号不低于 114。

不需要另外安装 Python、Node.js、npm 或 Starling CLI。离线包同时支持 Apple Silicon 和 Intel Mac。

## 第二步：运行安装器

1. 从团队维护者批准的渠道取得 `L10n-TM-Companion-macOS.zip`，不要使用来源不明的安装包。
2. 双击 ZIP 解压。文件夹中应有 `安装 L10n TM Companion.app` 和 `使用手册.md`；名称明显不同或文件缺失时停止安装并联系维护者。
3. 双击 `安装 L10n TM Companion.app`。
4. 如果 macOS 提示无法验证开发者，先点击“取消”，再右键安装器，选择“打开”，然后再次点击“打开”。
5. 安装器会显示进度窗口，并依次检查内置 Python、Node.js、Starling CLI 和 Native Host；安装过程不会联网安装开发工具。
6. 安装成功后会出现提示框，同时自动打开 Chrome 扩展页和桌面上的加载入口。
7. 桌面会出现 `L10n TM Companion - Chrome 加载这个文件夹`。这是指向稳定安装目录的入口，请不要删除；下载的 ZIP 和交付文件夹可以保留或删除。

安装失败时，系统会自动打开错误日志。请把日志最后一段完整复制给维护者，不要只发送“安装失败”的截图。

## 第三步：在 Chrome 加载插件

Chrome 要求用户本人确认本地插件，安装器不能代替这一步。

1. 在 Chrome 扩展页右上角打开“开发者模式”。
2. 点击左上角“加载已解压的扩展程序”。
3. 在文件选择窗口左侧点击“桌面”。
4. 单击 `L10n TM Companion - Chrome 加载这个文件夹`。
5. 点击右下角“选择”。整个过程不需要输入路径或使用键盘快捷键。
6. 页面出现名称为 `L10n TM Companion` 的卡片即表示加载成功；版本号应与本次交付说明一致。
7. 插件 ID 应显示为 `bgbodpcofifiloekhfjiffmchcaiiicm`。
8. 按 `Command + Q` 完全退出 Chrome，然后重新打开 Chrome。

Chrome 会在没有任务时让 Service Worker 休眠。如果插件可以打开，且后续 `Test connection` 显示 `Native Host available`，卡片上灰色的 `Service Worker（无效）`、`inactive` 或“已停止”都可以忽略。出现红色“错误”、插件无法打开，或点击后仍提示 Native Host unavailable 时，请按常见问题处理。

### 把插件固定在工具栏

1. 点击 Chrome 地址栏右侧的拼图图标。
2. 找到 `L10n TM Companion`。
3. 点击旁边的图钉。

## 第四步：打开 Settings

可以使用任意一种方法：

1. 在 `chrome://extensions` 找到插件，点击“详情”，再点击“扩展程序选项”。
2. 打开插件 Side Panel，点击右上角“设置”。

建议按照 Starling、Inspire、飞书的顺序配置。每一部分成功后再继续下一部分。

## 第五步：配置 Starling TM

Starling 是 TM 查询的必需配置。

1. 打开 [Starling 个人中心](https://starling.bytedance.net/personal_center#aksk)。
2. 使用公司账号登录。
3. 申请或查看个人 Access Key（AK）和 Secret Key（SK）。
4. 回到插件 Settings，把完整 AK 粘贴到 `Access Key (AK)`。
5. 把完整 SK 粘贴到 `Secret Key (SK)`。
6. `Starling CLI path` 保持空白。
7. `TM query mode` 保持 `Batch TM API in PPE`。
8. 先点击 `Test connection`；它只检查本机组件，出现 `Native Host available` 才继续。
9. 点击 `Save & Verify`；它检查 AK/SK 和项目权限。
10. 出现 `Saved and verified`，并显示可访问项目数量，即表示成功。

如果个人中心没有可用 AK/SK，请在页面提交申请；如果可访问项目数量是 0，请联系日常负责该 Starling 项目的项目负责人或 Owner 为你的账号增加权限。维护者不能代为提供其他人的 AK/SK。

## 第六步：配置 Inspire AI 改写

AI 改写是可选功能。关闭 AI 时，Starling TM 查询仍能正常运行。

当前 AI 改写使用安装包内的 Content Review skill、Content Review Principles 和适用的 Game 或 Revenue Legal Guidelines；Style Guide 与 Glossary 不再加载或注入 Prompt。结果仍需 CD 审核；必需规则文件缺失、结构变量改变或真实 TM 分数未提升时，插件默认保持原文 A。

Inspire task 已完成但第一次 copies 暂时为空时，插件会只重读同一 task，不会重复创建和扣用新的生成任务。若三次读取仍无可用 pass copy，错误会附带安全的响应形状与 prompt 长度诊断；请把完整错误发给维护者。

版本 1.2.0 起，插件查询 Starling Top-3 TM，只对 `50 ≤ Score A < 85` 的 source 创建一个 Inspire task，并最多生成三个结构化候选。结果在 Focus 中逐条确认；Final TM 与当前 Sheet 行全部写入成功后才成为 confirmed。旧 `CD review valid?` 列存在人工值时不会自动迁移。

版本 1.2.1 起，首页 Authorize 支持窄屏整行布局；结果卡使用 `TM → Post → Final` 分阶段颜色、箭头与状态标签；长 Top-3 TM 和多个 AI 候选默认折叠，Final copy 自动伸缩。CD 修改例外项后，可以一次批量确认剩余结果；批量入口仍逐项执行本地门禁、真实 Final TM 与 Sheet 写入，失败项不会伪装成 confirmed。

版本 1.3.0 起，Review 首屏和 Confirm 只等待一个展示语言，用户确认 ROI 归档后才以最多三个语言 scope 并发补齐其余 A/B/C。ROI_Test 自动使用 `L10n ROI Runs`、`L10n ROI Scopes`、`L10n ROI Items` 三层记录：Items 每条 source 只写一次，不与语言相乘；插件创建六个基础视图，并在写入前检查每张表 20,000 条记录上限。

1. 打开 [Inspire Writer](https://inspire.bytedance.net)，使用公司账号登录。
2. 阅读 [Inspire Prototype 使用说明](https://bytedance.larkoffice.com/wiki/D8PswE6azi4d4uk4ep7cyxoPnfc)；这是当前 Inspire Writer Pilot 的说明文档。
3. 向 Inspire Pilot owner 申请个人 OpenAPI Access Key；默认 Agent 自动使用最新已发布版本，日常不需要填写 Agent ID、version 或 `teamId`。需要切换到已发布且兼容的 Agent 时，在 Settings 的 `Advanced: Agent and version` 输入 Custom Agent ID。当前 Pilot 对接人是逯鹏宇。
4. 不要使用其他人的 Access Key。
5. 回到 Settings，勾选 `Enable AI rewrite`。
6. `LLM Provider` 选择 `Inspire Writer`。
7. 在 `API Key` 粘贴个人 Access Key，通常以 `wak_` 开头。
8. `API endpoint` 保持自动填写的 `https://inspire.bytedance.net/writer/api`。
9. 日常批量处理推荐选择 `Gemini 3 Flash` 和 `low`。
10. 更重视质量时可以选择 `GPT 5.4 mini` 和 `medium`。
11. `GPT 5.4` 配合 `high` 较慢，只适合少量关键文案。
12. 点击页面底部 `Save Settings`，看到 `Saved` 即表示配置已保存。

模型必须从下拉框选择。不要手动输入 `gpt-5.4-high` 等组合名称；thinking level 要在单独的下拉框选择。

可以把下面的话一对一发给 Pilot owner：`我需要使用 L10n TM Companion 调用 Inspire Writer，请帮我开通个人 OpenAPI Access Key。预计测试期间每天不超过 5,000 次调用。`

## 第七步：配置飞书表格读写

插件已经固定使用团队共享的飞书应用，用户不需要创建应用或填写 App ID。当前本机直连授权在点击 `Authorize` 前需要 App Secret：在 Settings 顶部点击 `Enter Feishu App Secret`，系统会打开 macOS 隐藏输入框，写入当前 Mac 的 Keychain；状态显示已保存后再回到 Side Panel 授权。正式分发环境部署 OAuth broker 后，用户只需在 Side Panel 首页点击 `Authorize`。

当前线下包在没有 OAuth broker 时只适用于 Owner/受控 Pilot。App Secret 只存在每位获准用户本机 Keychain，不会进入 ZIP；不得通过截图、聊天或安装包转发 Secret。扩大到无需接触 Secret 的多人分发时必须启用 OAuth broker。

### 仅供应用管理员：权限准备

1. 打开[飞书开放平台](https://open.feishu.cn/app)。
2. 点击“创建企业自建应用”。
3. 填写应用名称和说明，然后创建。
4. 进入“权限管理”。
5. 为用户身份申请电子表格元信息查询 `sheets:spreadsheet.meta:read`、查看 `sheets:spreadsheet:read` 与编辑 `sheets:spreadsheet:write_only`。
6. 如果需要 ROI 归档，申请 `base:table:read`、`base:table:create`、`base:field:read`、`base:field:create`、`base:record:read`、`base:record:retrieve`、`base:record:create`、`base:record:update`、`base:view:read`、`base:view:write_only`，并开通 `contact:user.base:readonly` 与获取 user ID 的权限。
7. ROI 链接使用 Wiki 页面时，再为用户身份申请知识库节点读取权限 `wiki:node:read`；在安全设置中登记 `http://localhost:39641/l10n-tm-companion/oauth/callback`。
8. 进入“版本管理与发布”，创建版本并发布。
9. 等待管理员审批完成。只申请但没有发布的权限不会生效。
10. 保留 App Secret 仅供应用 Owner 的受信任服务使用，禁止放进扩展或分发给普通用户。

从 1.2.x 升级到 1.3.0 后，应用管理员发布新增权限，已有用户需要在 Side Panel 首页点击 `Reconnect` 重新授权一次。Starling AK/SK、Inspire Access Key 和工作表配置无需重填。

1.3.1 起，插件会校验本地 token 是否包含当前必需 scope；若缺少 `base:view:read` 等新增权限，首页会列出缺失项并显示 `Reconnect`。后台显示“已开通”仍不等于旧 token 自动拥有该权限，必须先发布包含权限的新应用版本，再由当前用户重新授权。

1.3.2 起，容量预检使用的“列出记录”接口显式请求用户身份权限 `base:record:retrieve`。该权限与 `base:record:read` 不同；后者只覆盖特定记录读取。应用已有该权限时仍需使用 1.3.2 重新授权，旧 token 不会自动补入新请求的 scope。

1.3.3 起，插件不再把“授权链接申请的 scope”回填为“飞书实际授予的 scope”。升级后 1.3.2 及更早 token 会失效一次；Owner 先在开放平台创建并发布包含新增用户身份权限的应用版本，用户再在 Side Panel 首页点击 `Reconnect`。若飞书仍返回 `99991679`，插件会废弃当前 token 并在写入前给出发布与重新授权提示。

### 在插件中授权飞书账号

1. 回到插件 Settings。
2. 在 Side Panel 首页点击 `Authorize`，在系统浏览器中确认授权。
3. 有效回调会优先关闭授权标签页并回到发起授权的原页面；若浏览器阻止自动关闭，则把当前标签页跳转回原页面。
4. 在 Side Panel 确认页面显示自己的姓名、user ID 和头像；若 token 交换失败，Side Panel 会保持未授权并展示具体错误。
5. 打开要读写的飞书 Spreadsheet。
6. 点击右上角“更多”，选择“添加文档应用”或“添加协作者”。
7. 搜索刚才的应用名称，添加应用并授予可编辑权限。
8. 在这份 Spreadsheet 或 Wiki 挂载的电子表格页面打开插件，让它识别当前工作表。
9. 授权过期时直接在 Side Panel 首页点击 `Reconnect`。
10. 出现 `Feishu connected, spreadsheet accessible` 即表示成功。

开放平台的 API 权限和某一份文档的访问权限是两件事，两处都必须完成。

### 选择任意工作表

插件不绑定某一个固定 Wiki 地址。满足下面任一方式即可选择工作表：

1. 打开任意已添加共享飞书应用的 Spreadsheet 或 Wiki 挂载电子表格，再打开插件；自动模式会把当前页面设为工作表。
2. 在 Side Panel 的 `Working spreadsheet` 展开 `Use a different spreadsheet`，粘贴另一份 `/sheets/` 或 `/wiki/` 链接并确认；手动模式会保留这份选择，直到点击 `Use current page`。

Wiki 地址中的 node token 不是 Spreadsheet token。插件会自动调用 Wiki API 取得真实 `obj_token`，用户不需要复制或转换 token。目标 Wiki 页面不是电子表格、用户无法访问、或应用缺少用户身份的 `wiki:node:read` / 细分 Sheet 权限时，插件会直接显示错误，不会悄悄切回历史表格。

## 第八步：第一次运行

第一次请在飞书表格底部右键一个 Sheet 标签并选择“复制”，新建测试 Sheet。清空测试数据后，把下面四行粘贴到 A1 开始的位置；输出列不需要提前创建，插件会在确认的输出区域写入表头。

| Source |
| --- |
| You look tired. |
| Please try again later. |
| Your account has been updated. |

1. 打开任意已授权的目标飞书 Spreadsheet 或 Wiki 挂载电子表格；也可以在 `Working spreadsheet` 中粘贴其他目标链接。
2. 确保英文原文列的表头是 `Original Source Segment`、`English Source` 或 `Source`。
3. 点击 Chrome 工具栏中的插件图标，打开 Side Panel。
4. 在“项目”区域勾选 1–10 个 Starling 项目。
5. 从插件给出的下拉框选择目标语言；下拉框只显示这些项目共同支持的语言。
6. 普通 TM 处理保持 `ROI 模式`关闭。
7. 确认来源列是 A、数据起始行是 2，并把输出起始列选择为 B；确认后插件会使用 B:G，依次生成 `Best TM Match`、`Orig Match %`、`Rewritten Segment`、`Post-TM %`、`Reached 85%?` 和 `Final TM %`，不会覆盖 A 列原文。
8. 点击“读取原文 → 查询 TM → AI 改写”。
9. 等待 TM 查询和 AI 改写完成。处理期间不要关闭 Side Panel、刷新扩展或切换到另一份表格。
10. 在“结果”页点击 `Review & edit`；Top-3 TM 和多个 AI 候选默认折叠，需要比较时再展开。
11. 第一次保持 AI 关闭，在审阅页保留或编辑一条最终 C，再点击 `Confirm & save`，先验证 Final TM 与飞书单行写入。
12. 核对读取结果恰好是 3 条、确认后 B:G 六列已写入测试 Sheet、A 列原文没有被覆盖。
13. 再到 Settings 开启 AI 并重新运行；检查只有 50–85 区间创建 AI 候选，只修改需要调整的条目，然后点击 `Confirm & save remaining` 批量确认其余结果。

### 一个简单例子

假设原文列有一条 `You look tired.`：

- 插件先在 Starling 中取得最多三个历史 TM 候选，并显示第一名 Orig Match %。
- 只有 `50 ≤ Orig Match % < 85` 且 AI 已开启时，Inspire 为该 source 创建一个 Custom Agent task，并最多返回三个 pass copy，客户端将其包装为内部结构化候选。
- 插件校验 token、URL、数字、品牌 token、语义与风险，并使用 Prompt 中适用的 Legal 证据，再显示有效候选的真实 Post-TM。
- 你在 `Review & edit` 中选择或编辑最终 C；点击 `Confirm & save` 后，Final TM 和当前 Sheet 行写入全部成功才完成。

AI 改写的是英文 source，不会自动生成目标语言译文。

## 第九步：正式批量使用

- Starling Batch API 默认每个请求处理 10 条 source，插件会自动拆批，并最多并发处理 5 个批次；40 条能力等待 RD 批准与 PPE 复验后再由维护者显式启用。
- 一次读取 100 条时，界面仍会逐条显示进度，这是正常现象；用户不需要手动分成 10 次。
- CD 只需打开并修改例外项；结果页的 `Confirm & save remaining` 会跳过已保存条目，批量查询其余 Final TM，并按真实 Sheet 行号合并连续 B-G 写入区间。
- Inspire 的客户端请求上限不等于账号真实额度。当前 Pilot 请按获批额度使用，不要主动做 100 QPS 压测。
- `GPT 5.4 + high` 会明显慢于 `Gemini 3 Flash + low`。日常批量任务优先选择后者。
- 运行中出现 `Inspire Writer rewriting Row 10…` 说明该行仍在服务端处理。先等待；超过插件显示的超时时间后，应看到明确错误。
- 同一批任务不要连续点击两次运行按钮，否则会制造重复请求。

## 第十步：ROI 模式

普通 TM 使用不需要开启 ROI 模式。只有需要计算并归档正式节省时才使用以下步骤。

1. 当前纯客户端模式要求当前用户对固定的 [ROI_Test](https://bytedance.larkoffice.com/wiki/J1RJwEf0FijMQQkceUkcZyqCnJc?table=tbls3B039S6J7zdT&view=vewSwbY6Ry) 具有编辑权限；Settings 无需配置归档 URL。
2. 回到 Side Panel，开启 `ROI 模式`。
3. 选择项目并开启 ROI；插件自动覆盖全部项目共同支持的非英语目标语言，并计算 RWS 与 Pactera 两套金额。
4. 完成展示语言的 Top-3 TM、候选生成与 Post-TM；其余 ROI 语言暂不阻塞 Review。
5. CD 在 Focus 中选择或编辑需要调整的最终英文 C，再点击 `Confirm & write remaining` 批量确认其余结果；例外项仍可单条 Confirm。
6. 确认至少一条状态为 confirmed；未确认条目会作为缺口保留。
7. 检查结果后点击“写入 ROI 归档”，确认窗口会显示固定目标；本地模式分别写入 RWS 与 Pactera Run/Scope，并只写一组 source Items。
8. 确认后等待插件补齐其余语言并写入三张表；取消时不会补算或写入。

正式 ROI 使用 `TM Cost(A) - TM Cost(C)`。AI 候选 B 只用于辅助人工决策，不直接进入正式节省金额。

ROI_Test 的查看权限由飞书分享设置控制。发布应用、上传插件或分享安装包不会自动产生用户；用户完成授权并实际归档后，Runs 与 Items 才会记录用户名、user ID、open ID 和头像 URL。基础视图由插件自动创建；具体分组、筛选、字段显隐和仪表盘由 ROI_Test Owner 在飞书界面一次性维护，普通用户不需要逐次配置。若产品要求普通用户可提交但不能查看 ROI_Test，需要由应用身份代理代写，不能把 App Secret 放进插件。

## 更新插件

1. 关闭正在运行的批次。
2. 双击新版 `安装 L10n TM Companion.app`。
3. 安装器会把旧版本保留为 `extension.previous`，并把新版本安装到同一固定位置。
4. 打开 `chrome://extensions`，找到插件并点击卡片上的刷新按钮。
5. 按 `Command + Q` 完全退出 Chrome，再重新打开。
6. Settings 中原有配置通常会保留；仍建议点击 `Test connection` 和 `Save & Verify` 检查一次。

## 卸载插件

1. 打开 `chrome://extensions`。
2. 找到 L10n TM Companion，点击“移除”。
3. 在 Finder 菜单选择“前往”→“前往文件夹”。
4. 粘贴 `~/Library/Application Support/L10n TM Companion`，点击“前往”，把整个文件夹移到废纸篓。
5. 再次“前往文件夹”，粘贴 `~/Library/Application Support/Google/Chrome/NativeMessagingHosts`。
6. 把 `com.l10n.tm_companion.json` 移到废纸篓。

## 常见问题

### Service Worker 显示无效或已停止

插件可以打开且 `Test connection` 显示 `Native Host available` 时，卡片上灰色的 `Service Worker（无效）`、`inactive` 或“已停止”是正常休眠，直接打开插件即可。出现红色“错误”、插件无法打开，或 Native Host unavailable 时属于真实故障：先完全退出 Chrome 并重开，仍失败再运行安装器并核对插件 ID。

### 提示 Native Host unavailable 或 forbidden

先按 `Command + Q` 完全退出 Chrome，并重新打开。如果仍然失败，重新运行安装器，再检查插件 ID 是否为 `bgbodpcofifiloekhfjiffmchcaiiicm`。

### AI Error 400：Invalid option

打开 Settings，从 Model 下拉框重新选择当前可用模型，点击 `Save Settings`，再到 `chrome://extensions` 刷新插件。不要手动拼写模型名称。

### 显示 No AI rewrite

先确认 `Enable AI rewrite` 已勾选，Provider、API Key 和 Model 已填写并保存。默认 Agent 自动使用最新已发布版本；只有需要切换 Agent 或排障回滚时，才在 `Advanced: Agent and version` 填写 Custom Agent ID 或固定版本，teamId 永远不需要填写。Orig Match 已达到 85% 时，插件也可能不需要调用 AI。

### 飞书连接成功但无法写入

确认飞书应用已经发布三项细分 Sheet 用户权限，当前用户已经重新授权，并且本人拥有当前 Spreadsheet 的编辑权限。

### 安装器提示缺少 Python、Node.js 或 Starling CLI

正式离线包已经内置这三个组件，出现该提示说明安装包不完整或误用了源码开发版。请重新取得完整 ZIP，不要自行修改电脑上的 Python、Node.js 或 npm。

### 插件升级后看起来还是旧版本

在 `chrome://extensions` 点击刷新按钮，再按 `Command + Q` 完全退出 Chrome，并重新打开。不要只刷新飞书网页。

## 寻求帮助时请提供

请提供以下信息，但必须遮住所有 AK、SK、Access Key 和 App Secret：

1. macOS 版本、Chrome 版本、插件版本和插件 ID。
2. 出错时间、出错前点击的按钮，以及处于安装、Starling、Inspire、飞书或 ROI 哪个阶段。
3. 页面完整错误文字、HTTP 状态码和 Request ID；没有显示的项目可以省略。
4. 所选 Provider、Model、Starling 项目和目标语言。
5. 出错的是哪一行、这批共有多少行，以及脱敏后的相关原文。
6. 安装失败时，提供 `/tmp/l10n-tm-companion-installer.log` 最后一段；日志窗口关闭后，可在 Finder 使用“前往文件夹”打开这个路径。

不要只发送“不能用”或“卡住了”。完整错误文字能显著缩短排查时间。
