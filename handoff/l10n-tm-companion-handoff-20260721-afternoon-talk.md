# L10n TM Companion Handoff — 2026-07-21 Afternoon Talk

## 本轮目标

下一会话继续完成 L10n TM Companion 的真实使用验证，并以 `docs/tm-semantic-reuse-standup.md` 作为下午 standup 的讲稿。本文只记录当前状态、风险与接手入口；产品规则以正式文档为准，不在此重复展开。

## 当前实现状态

- Inspire Writer 已接入个人 Access Key 模式，使用异步 task、status polling 与 copies/revisions；Settings 提供模型下拉和 thinking level。默认模型为 `Gemini 3 Flash + low`，用于优先响应速度。
- 用户提供的 Inspire Base URL、teamId 与 Access Key 已在本机插件设置中配置。本文不记录或复述任何凭证、teamId、Starling AK/SK、Feishu Secret 或内部文档 token。
- ROI 默认关闭，只在用户需要金额时运行。多个 Starling 项目必须共享 source locale；ROI 选择器只显示全部已选项目共同支持且当前 vendor 有精确费率的目标语言。
- 每个已选共享目标语言只生成一个 scope；该 scope 将全部已选 `projectIds` 放入同一次 Batch TM 查询。两个项目和 21 个共享语言应显示 21 个 scope，不能显示 42 个。
- A/B/C 业务口径保持：A 为原始英文及 Score A；B 为 Inspire 候选及 Score B；C 为 CD 最终确认英文及 Score C。正式节省为 `TM cost(A) - TM cost(C)`，B 只用于审阅与优化分析。
- Working spreadsheet 支持切换 Spreadsheet 和该 Spreadsheet 内任意 Sheet。来源列、数据起始行与六列输出起始列按 `spreadsheetToken + sheetId` 独立保存。
- 自动检测读取 A-Z 前二十行，并查找 `Original Source Segment`、`English Source` 或 `Source`。唯一表头自动采用；无表头或多个表头时要求人工确认。运行前显示真实读写范围和前五条非空 source 预览。
- 首次安装默认英文，Side Panel 可即时切换中英文；英文模式不显示插件自有中文文案。轻量 transform/opacity 动效遵守 reduced-motion，不阻塞 TM 请求。
- 结果详情可展开查看完整 source、英文 Best TM Match、目标 TM translation、Inspire 候选和各阶段分数。

## 正式文档入口

- `/Users/bytedance/my-project/l10n-tm-companion/README.md`：项目入口、快速 CLI 与阶段状态。
- `/Users/bytedance/my-project/l10n-tm-companion/docs/popup-configuration.md`：运行配置、共享 ROI 语言、Spreadsheet/Sheet 与动态布局。
- `/Users/bytedance/my-project/l10n-tm-companion/docs/multilingual-roi.md`：A−C ROI、共享语言 scope、精确费率与 incomplete 规则。
- `/Users/bytedance/my-project/l10n-tm-companion/docs/user-guide.md`：面向使用者的操作流程。
- `/Users/bytedance/my-project/l10n-tm-companion/docs/TM-MATCHING.md`：三次真实 TM 与 source/target 字段语义。
- `/Users/bytedance/my-project/l10n-tm-companion/docs/tm-semantic-reuse-standup.md`：下午演讲讲稿、45 秒版本与数字口径提醒。

## 交付与验证边界

- 2026-07-21 已重新运行全部 26 个 `test/*.test.js` 文件，全部通过；`python3 -m unittest discover -s test -p 'test_*.py' -v` 的 4 个费率导出测试也全部通过。
- 此前的浏览器 UI 验证覆盖 Inspire 模型选择、默认英文、中英文切换、多 Sheet、动态列/起始行、source 预览、共享 ROI scope 和展开详情；本轮没有重复运行浏览器脚本。截图位于 `/Users/bytedance/my-project/l10n-tm-companion/temp/test_side_panel/`。
- 本轮没有执行真实 Inspire 线上改写，也没有对用户提供的 pilot 与金额数字做数据源审计。演讲中的 38%、3,733、137、97、23、$400、$3,200 与 $38K 均来自用户提供的稿件，发言前应核对原始分析或 ROI Bitable。
- 当前父级 Git 将整个 `l10n-tm-companion/` 识别为未跟踪目录。本轮没有 stage、commit、push 或 PR。目录存在历史凭证风险；禁止 broad-stage，上传前必须先建立安全 tracking boundary 并检查敏感文件与打包内容。

## 下一会话建议顺序

1. 在 Chrome 重新加载未解压扩展，确认默认英文和当前版本号。
2. 用包含多个 Sheet、来源列不在 A、数据从第三行开始的真实 Spreadsheet 跑一次 A/B/C。
3. 用两个项目和 21 个共享目标语言验证 scope 数量为 21，并抽查每个请求携带两个项目 ID。
4. 用小批量 source 执行一次真实 Inspire 请求，记录首结果延迟、总完成时间、候选质量和错误原文；不要在日志中输出 Access Key。
5. 选一条 CD 确认的 C 执行第三次 TM，再写一条新的 ROI archive；核对 A−C 金额、subtotal、coverage 与 failure reasons。
6. 演讲前核对 pilot 分母：`23/137 = 16.8%` 是低匹配覆盖率，`23/97 = 23.7%` 是已生成建议的可用率。

## Suggested skills

- `verification-before-completion`：真实 Inspire、Spreadsheet 与 ROI archive 验证后再宣称生产可用。
- `webapp-testing`：检查 Side Panel 的多 Sheet、动态布局、语言切换、展开详情和 reduced-motion。
- `diagnosing-bugs`：真实 API 或第三次 TM 失败时建立可重复的输入、请求和响应闭环。
- `edit-article`：演讲数字更新后保持 Why → How → Status → Next 的依赖顺序并压缩表达。
- `handoff`：下一阶段结束后生成新的脱敏临时交接，不复制正式规格。
