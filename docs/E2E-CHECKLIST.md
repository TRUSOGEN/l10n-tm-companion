# 手动 E2E 验收清单（T24）

> 代码层单测全过，但以下需在真实 Chrome + 真机环境手动验证。
> 单测无法覆盖：MV3 Service Worker、Native Messaging、飞书真实权限、Starling CLI 真机调用、DOM 渲染。

## 前置环境（每项打勾确认）

- [ ] Chrome 已加载未压缩扩展（chrome://extensions → L10n TM Companion，ID = `bgnakecphongbinlnmgnhoefgjecdang`）
- [ ] `native-host/register-native-host.sh` 已运行，Native Messaging Host 已注册到该扩展 ID
- [ ] starling-cli v1.1.16 已装，`~/.starling-cli/.starlingrc.json` 含 accessKey/secretKey（chmod 600）
- [ ] 飞书应用「L10n TM Companion」已发布，开通 `sheets:spreadsheet`、Wiki 节点读取，以及 ROI 归档所需的用户身份 `base:table:read`、`base:table:create`、`base:field:read`、`base:record:create`、`base:record:update`、`base:block:read`、`base:block:update`
- [ ] 飞书应用安全设置已登记 `http://localhost:39641/l10n-tm-companion/oauth/callback` 为重定向 URL，Native Host 已能返回同一地址
- [ ] 应用已加为测试电子表格的协作者（可编辑）
- [ ] Options 已填：飞书 App ID/Secret、电子表格 URL（自动解析 token）、ROI archive Bitable Wiki 或 `/base/` URL、Starling Project ID=385、LLM LLMBox 网关 + Key + Model=glm-5.2

## Setup Health Check（T07）

- [ ] 打开 popup，health 面板自动出现 4 行
- [ ] Native Messaging Host → 绿（可用）
- [ ] 飞书应用凭证 → 绿（已配置）
- [ ] 电子表格可访问 → 绿（可访问）
- [ ] 写入目标 → 绿（目标表格已就绪）
- [ ] 故意删 token → 电子表格行变红，提示「贴入飞书表格 URL」

## 主流程 E2E

- [ ] 在飞书 docx 文档页打开扩展，popup 仅显示两个按钮：抓取全文 / 抓取选中文字
- [ ] 点击「抓取全文」→ 抓到文案，步骤指示器进入「查询 TM」
- [ ] 选择一个项目后，Shared ROI target languages 默认勾选该项目全部可计费 target locales；取消其中一个语言后 scope 数量立刻减少并在重新打开 Side Panel 后保持
- [ ] 选择两个同为 source `en` 且共同支持 `ar` 的项目时，只选择一次 `ar`，scope 数等于项目数；界面不再出现项目级语言选择器
- [ ] 选择两个同为 source `en`、但没有共同 target locale 的项目时，项目仍可选，ROI 区显示没有共同可计费语言，启动 ROI 时明确停止
- [ ] source `en`、target `en` scope 可以运行；缺少精确费率时 TM 继续运行，结果页只显示“已覆盖语言小计”和缺失 scope
- [ ] 关闭 AI 后运行至少两个有完整费率的语言 scope，结果页每个 complete scope 均计入 Before/After，整车 Saving 为 0
- [ ] 进度条显示「查询 Starling TM」→「AI 改写原文」→「查询改写后的 Starling TM」→「计算 New Match %」→「对比」，期间没有 Source String Key 查询步骤
- [ ] 多语言运行时进度条显示当前项目、target locale 与 scope 序号；任一 scope 首轮 TM 失败后，其他 scope 仍继续，结果页将失败 scope 列入 incomplete 清单
- [ ] 步骤指示器进入「查看结果」，结果卡片渲染（无 emoji，TM x% / AI 改写 / Post-TM x% 标签）
- [ ] 卡片详情展开后显示「TM 匹配」与真实的「Post-rewrite Starling TM」分数和方法
- [ ] 改写后二次 TM 查询失败时，卡片显示 `Post-TM incomplete` 和真实错误原因；首轮 TM 结果仍保留，页面不显示伪造的 post-rewrite 0 分
- [ ] 写入前显示「将写入到：电子表格(Sheet) / <token> / <sheet> / rows 2-N」预览
- [ ] 点「写回表格」→ 步骤进入「写回」，成功后显示「已写入到（共 N 条）：...」
- [ ] 打开飞书表格，B-F 正确写入（B 为匹配到的英文 TM source / C Orig% / D Rewritten / E New% / F Reached85?），G 列保持空白
- [ ] G2:G5000 为 `Yes/No` 单选下拉，选择已有值后再次写回不会覆盖
- [ ] H-J 如有历史数据保持不变，插件没有产生 H-J 写入请求
- [ ] **row alignment 不错位**：A 列若有空行，B-F 仍对应真实行号

## ROI Bitable 归档

- [ ] Settings 填入有效的 Feishu App ID 与 App Secret 后点击 `Test Feishu connection`，确认能获取 tenant token；测试不显示 Secret 或 token 内容
- [ ] 完成一次多语言 ROI 后，结果页出现启用的 `Write ROI archive`；未配置 ROI archive Bitable、App 凭证不完整、应用权限未发布或应用未获文档编辑权限时按钮保持禁用或返回真实错误
- [ ] 点击按钮先看到目标链接、`L10n ROI Runs` / `L10n ROI Scopes` 和 `1 Run + N Scope` 的确认框；取消后飞书中没有新增表或记录
- [ ] 首次确认后，仅在配置的 Bitable App 中创建 `L10n ROI Runs` 与 `L10n ROI Scopes` 两张表，原 URL 指向的表和视图没有被改动
- [ ] Runs 表包含 Run ID、运行时间、写入状态、覆盖率、完整翻译/TM 预估/节省小计和缺失 scope 原因；Scopes 表包含 Run ID、project、source/target locale、ROI 状态和 scope 金额/失败原因
- [ ] 完整运行的 Run 状态由 `writing` 变为 `complete`；存在缺失费率或 TM 的运行最终为 `incomplete`，金额是已覆盖语言小计
- [ ] 不完整 Scope 没有 Full translation USD、TM estimated USD、Saving USD 三个金额字段值，但保留真实失败原因
- [ ] 将任一专用表的必需字段改名或改为错误类型后再次写入，Popup 显示 schema mismatch，且不创建新的 Run 记录
- [ ] 临时撤销 Scope 表写入权限后运行，已创建 Run 最终为 `write_failed` 并记录真实 API 失败原因

## 错误恢复（T23 可操作提示）

- [ ] 卸载 native host → 抓取时报「Native Messaging Host 不可用」+ 提示运行 register 脚本
- [ ] 飞书缺 sheets:spreadsheet 权限 → 报「飞书权限不足」+ 提示开通权限加协作者
- [ ] 贴非飞书链接 → 报「链接无法识别」+ 提示贴 /sheets/ 或 /base/ 链接

## 多输入源 / 目标（T08-T10）

- [ ] 贴 Sheet URL（/sheets/）→ 识别为「电子表格(Sheet)」
- [ ] 贴 Bitable URL（/base/）→ 识别为「多维表格(Bitable)」；普通 Spreadsheet 写回继续拒绝该目标，ROI archive 使用单独配置
- [ ] 写入前预览 + 写入后结果都明确显示目标位置

## 表头（T12-T14）

- [ ] 目标表表头为 7 列：Original Source Segment / Best TM Match / Orig Match % / Rewritten Segment / New Match % / Reached 85%? / CD review valid?
- [ ] 表头缺失时 `validateHeaders` 返回 missing 列表
- [ ] `repairHeaders` 能写入 A1:G1 表头且不清除 H-J 历史数据
- [ ] CD review valid? 列永不被自动填值，只设置 Yes/No 单选规则

## TM / Match 确定性（T16-T22）

- [ ] TM 查询带 method=starling、candidate_count（卡片详情可见）
- [ ] Starling 不可用时显示真实错误并停止本轮流程；不得以 BM25 或本地分数伪造 TM 结果
- [ ] New Match% 确定性：同输入两次结果相同
- [ ] LLM 仅用于改写，不参与 TM/New Match 打分

## 已知未完成（非阻塞 MVP）

- [ ] Bitable 与普通 Spreadsheet 的数据行写回仍只支持 Spreadsheet；ROI archive 仅追加 Run/Scope 审计记录
- [ ] BM25 fallback 未接入 popup/bridge（corpus 来源待定）
- [ ] doc 抓取的 items 无 row 字段 → 写回需 T08-T10 重建行号语义
- [ ] TM 查询串行慢（逐条起 starling-cli 子进程，未并发优化）
