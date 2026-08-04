# 手动 E2E 验收清单（T24）

> 代码层单测全过，但以下需在真实 Chrome + 真机环境手动验证。
> 单测无法覆盖：MV3 Service Worker、Native Messaging、飞书真实权限、Starling CLI 真机调用、DOM 渲染。

## 前置环境（每项打勾确认）

- [ ] Chrome 已加载未压缩扩展（chrome://extensions → L10n TM Companion，ID = `bgbodpcofifiloekhfjiffmchcaiiicm`）
- [ ] `native-host/install.sh --no-open` 已运行，Native Messaging Host 已注册到该扩展 ID
- [ ] 安装包内置 Starling CLI v1.1.41；Settings 中完整填写 AK/SK 并通过 `Save & Verify`
- [ ] 飞书应用「L10n TM Companion」已发布，开通用户身份的 `sheets:spreadsheet.meta:read`、`sheets:spreadsheet:read`、`sheets:spreadsheet:write_only`、Wiki 节点读取、ROI 归档所需的 Bitable 权限、`contact:user.base:readonly` 与获取 user ID 的权限
- [ ] 飞书应用安全设置已登记 `http://localhost:39641/l10n-tm-companion/oauth/callback` 为重定向 URL，Native Host 已能返回同一地址
- [ ] 应用已加为测试电子表格的协作者（可编辑）
- [ ] Options 已完成 Feishu 用户 OAuth、Starling AK/SK、Inspire Access Key 与 Model；普通用户界面没有 App Secret 输入框，ROI archive 固定为指定 ROI_Test

## Setup Health Check（T07）

- [ ] 打开 popup，health 面板自动出现 4 行
- [ ] Native Messaging Host → 绿（可用）
- [ ] 飞书用户授权 → 绿（显示当前用户已授权）
- [ ] 电子表格可访问 → 绿（可访问）
- [ ] 写入目标 → 绿（目标表格已就绪）
- [ ] 故意删 token → 电子表格行变红，提示「贴入飞书表格 URL」

## 主流程 E2E

- [ ] 在飞书 docx 文档页打开扩展，popup 仅显示两个按钮：抓取全文 / 抓取选中文字
- [ ] 点击「抓取全文」→ 抓到文案，步骤指示器进入「查询 TM」
- [ ] 选择一个项目并开启 ROI 后，界面不出现 vendor 或语言选择器，自动 scope 数等于该项目全部非英语 target locale 数
- [ ] 选择两个同为 source `en` 且共同支持 `ar` 的项目时，只生成一个携带两个 project ID 的 `ar` scope，不生成项目语言笛卡尔积
- [ ] 选择两个同为 source `en`、但没有共同非英语 target locale 的项目时，项目仍可选，启动 ROI 时明确停止
- [ ] `en` 及其变体不进入 ROI scope；某 vendor 缺少精确费率时 TM 继续运行，该 vendor 只显示“已覆盖语言小计”和缺失 scope
- [ ] 关闭 AI 后运行至少两个有完整费率的语言 scope，结果页每个 complete scope 均计入 Before/After，整车 Saving 为 0
- [ ] 进度条显示「查询 Starling Top-3 TM」→「AI 改写原文」→「查询候选 Post-TM」→「查看结果」，期间没有 Source String Key 查询步骤
- [ ] 多语言补算时进度条显示 target locale 与 scope 序号；任一 scope TM 失败后，其他 scope 仍继续，结果页将失败 scope 列入 incomplete 清单
- [ ] 步骤指示器进入「查看结果」，结果卡片只显示 source、TM/Post-TM/Final TM 摘要、用户状态和 `Review & edit`
- [ ] 结果卡片顺序与 Sheet 原始行号一致；`Review & edit` 展示 Top-3 TM、有效 AI 候选、分数差、最终 C 编辑框与 `Confirm & save`
- [x] 无敏感真实请求确认 `TM_inspire` Agent ID `6a7036d4ef9ca901ee5c7a65`、Version 7、`agentType=chat`、`mode=write`，并确认 term/rules/style 三个附加 review 阶段均 skipped
- [ ] 49.99 不创建 Inspire task，50 创建，84.99 创建，85 不创建；进入链路的每条 source 只创建一个 Custom Agent task，最多保留三个去重的 `status=pass` copy
- [ ] Inspire prompt 使用随包分发的 Skill、Principles 和唯一一份适用 Legal Guidelines；删去任一必需规则文件后改写真实失败
- [ ] 审阅视图只展示通过 token、URL、数字、全大写、单字符或 CamelCase 品牌 token、语义、风险和真实 Post-TM 门禁的 AI 候选；重复文案只显示一次，无有效候选时显示 None
- [ ] 点击候选后该卡片显示 Selected、蓝色边框和选中圆点，其他候选恢复 Select，Final copy 与选中文案一致；键盘 focus 清晰可见
- [ ] 改写后二次 TM 查询失败时，卡片显示 `Post-TM incomplete` 和真实错误原因；首轮 TM 结果仍保留，页面不显示伪造的 post-rewrite 0 分
- [ ] 点击单条 `Confirm & save` 后，依次完成 protected-token 校验、Final TM 与当前 Sheet 行六列写入，全部成功后界面状态才为 `Saved`
- [ ] Final TM 或 Sheet 写入故意失败时，该条保持未确认并展示真实错误；重试成功后才 confirmed
- [ ] 已保存文案再次编辑后显示 `Edited · confirm again`，旧 Final TM 清空，必须点击 `Confirm changes & save`
- [ ] 打开飞书表格，B-G 正确写入（B Best TM / C Orig% / D Final C / E Post-TM% / F Reached85? / G Final TM%）
- [ ] H-J 如有历史数据保持不变，插件没有产生 H-J 写入请求
- [ ] **row alignment 不错位**：A 列若有空行，B-F 仍对应真实行号

## ROI Bitable 归档

- [ ] Side Panel 首页点击 `Authorize` 后完成 OAuth，立即显示当前用户姓名、user ID 与头像并刷新环境检查；界面和日志不显示 token
- [ ] 有效回调页只说明收到 authorization response，优先自动关闭授权标签页并回到发起授权的原页面；Chrome 阻止关闭时把当前标签页跳转回原页面
- [ ] token 交换失败时首页保持未授权并展示原始可操作错误；回调页不提前宣称授权完成
- [ ] 本机 Owner 测试由 Settings 系统隐藏输入框写入 Keychain；多人分发使用服务端 OAuth broker，安装包不包含 App Secret
- [ ] 至少一条 source confirmed 后结果页启用 `Write ROI archive`；零确认整车正确拒绝归档
- [ ] 点击按钮先看到目标链接、三张表和 `1 Run + N Scopes + M source Items` 的确认框；取消后不补算延后语言，飞书中没有新增表或记录
- [ ] 确认框始终显示固定 ROI_Test 链接；历史 storage 中的 `roiArchiveUrl` 不能改变写入目标
- [ ] 首次确认后，仅在固定 Bitable App 中增量创建 `L10n ROI Runs`、`L10n ROI Scopes`、`L10n ROI Items` 与六个基础视图；既有表、视图和记录不被删除或替换
- [ ] Runs 包含整车金额、Operator 与漏斗；Scopes 包含 target locale 金额、覆盖、漏斗与失败原因；Items 每条 source 每个 Run 恰好一行
- [ ] 18 条 source × 35 个语言只创建 18 条 Item 和 35 条 Scope，不创建 630 条 Item
- [ ] Review 首屏与 Confirm 只查询展示 scope；确认归档后其余语言最多三个 scope 并发，最终 scope 顺序与选择顺序一致
- [ ] 完整运行的 Run 状态由 `writing` 变为 `complete`；存在缺失费率或 TM 的运行最终为 `incomplete`，金额是已覆盖语言小计
- [ ] 不完整 Scope 只汇总自身可计算条目的金额并保留真实失败原因；完全没有可计算条目时金额字段留空
- [ ] 删除一个漏斗字段后再次写入，插件只创建缺失字段；把同名字段改为错误类型时显示 schema mismatch，且不创建新的 Run 记录
- [ ] 临时撤销 Scope 表写入权限后运行，已创建 Run 最终为 `write_failed` 并记录真实 API 失败原因
- [ ] 模拟 RWS 成功、Pactera 首次失败；再次点击归档只重试 Pactera，两个 vendor 均复用首次持久化的 Run ID，RWS 不产生重复记录
- [ ] 分别模拟 Scope 与 Item 已远端提交但响应丢失；重试按 Run ID、Scope、Item ID 只补缺失记录，同一 Run ID 出现两条 Run 时明确停止
- [ ] 任一归档表达到 20,000 条上限时，在创建 Run 记录前明确报 capacity exceeded

## 错误恢复（T23 可操作提示）

- [ ] 卸载 native host → 抓取时报「Native Messaging Host 不可用」+ 提示运行 register 脚本
- [ ] 飞书缺任一细分 Sheet 用户权限 → 报「飞书权限不足」+ 提示发布新版本并重新授权
- [ ] 贴非飞书链接 → 报「链接无法识别」+ 提示贴 /sheets/ 或 /base/ 链接

## 多输入源 / 目标（T08-T10）

- [ ] 贴 Sheet URL（/sheets/）→ 识别为「电子表格(Sheet)」
- [ ] 贴 Bitable URL（/base/）→ 识别为「多维表格(Bitable)」；普通 Spreadsheet 写回继续拒绝该目标，ROI archive 始终使用固定目标
- [ ] 写入前预览 + 写入后结果都明确显示目标位置

## 表头（T12-T14）

- [ ] 目标表表头为 7 列：Original Source Segment / Best TM Match / Orig Match % / Rewritten Segment / Post-TM % / Reached 85%? / Final TM %
- [ ] 表头缺失时 `validateHeaders` 返回 missing 列表
- [ ] `repairHeaders` 能写入 A1:G1 表头且不清除 H-J 历史数据
- [ ] 旧六列表头且 `CD review valid?` 数据区为空时可迁移；存在任意旧人工 review 值时以 `legacy_cd_review_data_conflict` 正确失败

## TM / Match 确定性（T16-T22）

- [ ] TM 查询带 method=starling、candidate_count（卡片详情可见）
- [ ] Starling 不可用时显示真实错误并停止本轮流程；不得以 BM25 或本地分数伪造 TM 结果
- [ ] Top-3 TM 按 source+target 去重并保留最高 score；非法 score 正确失败
- [ ] LLM 仅生成 Writer native copy，客户端包装为内部结构化候选；LLM 不参与 Orig/Post/Final TM 打分

## 已知未完成（非阻塞 MVP）

- [ ] Bitable 与普通 Spreadsheet 的数据行写回仍只支持 Spreadsheet；ROI archive 仅追加 Runs/Scopes/Items 审计记录
- [ ] BM25 fallback 未接入 popup/bridge（corpus 来源待定）
- [ ] doc 抓取的 items 无 row 字段 → 写回需 T08-T10 重建行号语义
- [ ] 真实生产 QPS 与 35-locale 总耗时仍需 Starling PPE 和 ROI_Test 真机压测确认
