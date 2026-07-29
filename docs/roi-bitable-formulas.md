# ROI_Test 归档金额

当前归档不使用 Bitable Formula，也不需要 Bitable Owner 手动新增字段。点击 `Write ROI archive` 后，插件直接创建或校验 `L10n ROI Runs`、`L10n ROI Scopes` 与 `L10n ROI Items`，随后写入当前运行。

## 查看本车节省

打开 `L10n ROI Runs`，查看当前 `Run ID` 的金额列：`Full translation USD` 是完整翻译参考成本，`TM estimated USD` 是原文 A 的 TM 预估成本，`Saving USD` 是本车最终送翻版本 C 相对原文 A 的正式节省。`Pricing notes` 会重复显示 Saving 的语义。存在费率、最终 C 或第三次 TM 缺失时，金额代表所有可计算文案的小计；完全没有可计算文案时金额保持空白。

`L10n ROI Scopes` 每行对应一个多项目 target locale，直接保存该语言的 `Full translation USD`、`TM Cost A USD`、`TM Cost C USD`、`Saving USD`、覆盖数量、确认数量、A/AI/Review 漏斗与失败原因，不需要任何 Formula 字段。

`L10n ROI Items` 每行对应当前 Run 的一条 source，保存 A/B/C 文案、三个真实 TM score、AI 是否被采用、Review 状态与 Operator。Items 不与 locale 相乘；18 条 source 在一个 Run 中固定写 18 条 Item，即使 ROI 覆盖 35 个语言。

插件幂等创建六个基础 grid view，并保留 Owner 在飞书中维护的分组、筛选、字段显隐与仪表盘。写入前检查每张表 20,000 条记录上限；达到上限时先停止，由 Owner 归档历史表后再继续。

## 历史表处理

旧版 Formula 字段无需删除。已有的 Runs、Scopes 或 Items 只要同名字段类型满足当前固定契约，归档即可直接继续；缺失字段会增量创建，同名字段类型不匹配时插件会停止并报告 schema mismatch，避免破坏用户已有结构。
