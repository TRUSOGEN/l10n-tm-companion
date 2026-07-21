# L10n TM Companion 使用教程

本教程面向使用飞书表格、Starling TM 和 ROI_Test 的内容运营、CD 与本地化同学。默认快速运行得到原文 A、AI 候选 B 与真实 Score B；只有开启 ROI mode 后，流程才继续生成最终 C 与 A-C 整车节省。

```mermaid
flowchart LR
  A[表格原文 A] --> TM1[查询 Score A]
  TM1 --> B[AI 候选 B]
  B --> TM2[查询 Score B]
  TM2 --> CD[CD 在表格确认最终 C]
  CD --> TM3[查询 Score C]
  TM3 --> ROI[写入整车 A-C ROI]
```

## 先理解三个版本

| 版本 | 内容 | 用途 |
| --- | --- | --- |
| A | 原始英文文案 | 第一次 TM 查询，得到 Score A |
| B | AI 改写的英文候选 | 第二次真实 TM 查询，得到 Score B，供 CD 审阅 |
| C | CD 在飞书表格确认后的最终英文文案 | 第三次真实 TM 查询，得到 Score C，也是实际送翻文案 |

正式节省只按 `TM Cost(A) - TM Cost(C)` 计算。Score B 不进入 ROI 金额。

> A/B/C 是文案版本名，和 Spreadsheet 的列字母不是同一件事。候选版本 B 写在当前布局的 `Rewritten Segment` 列；`Best TM Match` 始终保存 TM 库中匹配到的英文 source。

## 首次配置

### 安装扩展与本机桥接

1. 在 Chrome 的 `chrome://extensions` 开启开发者模式，加载 `l10n-tm-companion` 文件夹。
2. 按项目 README 注册 Native Messaging Host；没有本机桥接时，TM 和 LLM 都无法调用。
3. 每次拿到新版代码后，在 `chrome://extensions` 点击扩展的刷新按钮，再点击扩展图标打开 Side Panel。

### 配置 Starling 与飞书

打开扩展 Settings，完成以下项目：

| 配置 | 操作 |
| --- | --- |
| Starling AK/SK | 填写后点击 `Save & Verify`，确认能读取权限项目 |
| 飞书 App ID / App Secret | 每个使用者在自己的 Chrome profile 填写获准使用的凭证 |
| ROI archive Bitable | 填入 ROI_Test 的 Wiki 或 `/base/` 链接 |
| LLM | 只有需要 AI 改写 B 时才配置；TM 查询本身不依赖 LLM |

Inspire Writer 用户在 LLM Provider 选择 `Inspire Writer`，填写个人 `wak_…` Access Key 与 LIVE CD teamId，再从下拉列表选择 OpenAPI 支持的模型。默认 `Gemini 3 Flash (gemini_3f) + low` 以响应速度优先；复杂语义可选择 Gemini 3.1 Pro 或 GPT 5.4 mini，上线前严格审查可选择 GPT 5.4。个人 Access Key 只适合本机 Demo，正式分发需要租户签名代理。

飞书自建应用需要发布相应的 Spreadsheet、Wiki 和 Bitable 权限，并作为目标 Spreadsheet 与 ROI_Test 的可编辑协作者。只开通应用权限不等于应用自动拥有文档访问权。

### 准备飞书电子表格

来源列和数据起始行可以不同。Working spreadsheet 会检查 A-Z 前二十行，识别 `Original Source Segment`、`English Source` 或 `Source`；也可以手动选择来源列和起始行。输出起始列连续使用以下六列：

| 顺序 | 字段 | 谁来填写 |
| --- | --- | --- |
| 1 | `Best TM Match` | 插件写入 |
| 2 | `Orig Match %` | 插件写入 Score A |
| 3 | `Rewritten Segment` | 插件先写候选 B，CD 最后编辑为 C |
| 4 | `New Match %` | 插件写入 Score B |
| 5 | `Reached 85%?` | 插件写入 |
| 6 | `CD review valid?` | CD 选择 `Yes` 或 `No` |

首次 A/B 流程读取已确认 source 范围，写入输出区的前五列，从不自动覆盖第六列；确认最终 C 时，插件读取 `Rewritten Segment` 与 `CD review valid?`。普通 Spreadsheet 不显示任何 ROI 金额。

## 日常操作

### 选择本次运行范围

1. 打开存放文案的飞书电子表格，再点击扩展图标打开 Side Panel。
2. 勾选一至十个当前账号有权限的 Starling 项目，并选择共同支持的 `Fast TM target language`。
3. 普通 CD 运行保持 ROI mode 关闭；此时 Vendor、费率和多语言 coverage 不参与查询。
4. 需要整车计价时开启 ROI mode，再选择 Vendor 与 `Shared ROI target languages`；这里选择一次，全部项目使用同一组语言。
5. 在 `Working spreadsheet` 选择 Spreadsheet 与 Sheet，确认来源列、数据起始行、输出起始列和前五条 source 预览。

快速路径把全部已选项目与一个共同 target locale 合成单个 Batch scope。ROI mode 开启后，选择器取全部项目 target locale 的交集，再过滤 Vendor 没有精确费率的语言；每个共享语言生成一个携带全部已选项目 ID 的 Batch scope。项目之间没有共同可计费语言时插件会明确停止 ROI 运行。

### 生成 A 与 B

1. 点击 `Read configured source range`。
2. 插件先查询 A 的真实 TM，得到 Score A。
3. Score A 低于 85% 时，插件调用 LLM 生成英文候选 B，并查询 B 的真实 TM，得到 Score B。
4. 点击写回表格，插件将结果按原始行号写入当前输出区。

Score A 已达到 85% 时，插件不会调用 AI 改写，`Rewritten Segment` 会写入原文 A 作为可直接审阅的候选；CD 仍然可以编辑它，并在 `CD review valid?` 确认最终 C。

结果卡片按当前可用的 TM Score 从低到高排列，优先 Score C，其次 Score B，再次 Score A。点击“展开详情”可查看完整 source、英文 TM source、target translation、Inspire 全部候选和各 scope 分数；顶部可即时切换中文与英文。

### CD 确认最终 C

本节只适用于已开启 ROI mode 的运行；默认快速路径不会显示最终 C 与 ROI archive 按钮。

1. CD 在 `Rewritten Segment` 保留或修改候选 B，使其成为最终送翻的英文文案 C。
2. 在同一行的 `CD review valid?` 选择 `Yes`。
3. 重新打开 Popup 后，确认 `Working spreadsheet` 仍是刚才编辑的文档和页签。
4. 点击 `确认最终 C，计算 Score C`。

Popup 会显示“已由 CD 确认”的总行数；单行运行时该数字必须为 1，多行运行时它必须等于你选择 `Yes` 的行数。结果卡片出现 Score C 后，说明对应行已完成第三次查询。关闭 Popup 后，插件只会在同一份 Spreadsheet 和同一个 Sheet 中恢复最近运行快照；切换目标或启动新运行会使旧快照不可用。

### 写入整车 ROI

1. 在 Score C 查询完成后，点击 `Write ROI archive`。
2. 核对确认窗口中的目标链接和将要写入的 Runs / Scopes 数量。
3. 确认后，插件追加一条 `L10n ROI Runs` 记录和对应的 `L10n ROI Scopes` 记录。

不需要创建 Formula，也不需要 `L10n ROI Items` 表。旧的 Items 或 Formula 字段可以保留，插件不会读取或写入它们。

## 在 ROI_Test 查看结果

打开 `L10n ROI Runs`，按最新 `Run ID` 查看本次整车信息：

| 字段 | 含义 |
| --- | --- |
| `Write status` | `complete` 表示所有已选 scope 完整；`incomplete` 表示存在未覆盖语言或最终 C 缺失 |
| `Coverage` | 完整 scope 数 / 已选 scope 数 |
| `Full translation USD` | 完整翻译的参考成本 |
| `TM estimated USD` | 原文 A 的 TM 预估成本 |
| `Saving USD` | 正式 `A-C` 节省金额 |
| `Pricing notes` | 说明金额是完整整车金额还是已覆盖文案小计 |

`L10n ROI Scopes` 用于定位覆盖问题。每一行是一个携带全部项目 ID 的 target locale scope，重点查看 `ROI status` 与 `Failure reasons`。Scopes 不保存金额。

当 `Write status=incomplete` 时，插件仍会汇总所有成功得到 A/C TM 与费率的文案，金额代表“已覆盖文案小计”。只有一条文案都无法计算时金额才保持空白，避免把未知金额写成 0 或完整整车节省。

TM Cost 由每个 target locale scope 的固定 Vendor 费率、本地英文词数和真实 TM Score 计算，再汇总为整车金额。0–75 分按 AIPE 计价，(75,85]、(85,95]、(95,99] 分别按 T-only 的 60%、40%、20% 计价；完整规则见[多语言 ROI 规则](multilingual-roi.md)。

## 常见问题

### `final_source_text_missing`

插件在第三次查询时没有读到最终 C。检查同一行的 `Rewritten Segment` 是否有文本、`CD review valid?` 是否为 `Yes`，然后重新点击 `确认最终 C，计算 Score C`。Popup 必须显示已确认行数大于 0，再归档。

如果两列已正确填写但确认数量仍为 0，通常是 Side Panel 指向了别的 Spreadsheet、Sheet 或布局。先在 `Working spreadsheet` 核对实际范围，再重试。

### `incomplete`

这是覆盖状态，不是系统崩溃。打开 `L10n ROI Scopes`，查看 `Failure reasons`：常见原因包括 `final_source_text_missing`、`final_tm_missing`、`final_tm_query_failed` 和 `rate_missing_language_pair`。

新建运行的语言选择器会过滤掉当前 Vendor 缺少精确费率的语言，因此正常情况下不应出现 `rate_missing_language_pair`。它通常出现在旧快照、历史 Run、费率配置更新后，或运行范围由旧版本保留下来的场景。

### `ROI archive schema mismatch`

现有的 `L10n ROI Runs` 或 `L10n ROI Scopes` 字段名或类型不符合当前固定结构。不要自行添加 Scope 的 TM Cost 或 Formula 字段；把完整报错和两张表的字段截图发给插件维护者核对。

### AI 改写提示 URL 或 endpoint 错误

TM 查询可以正常工作，AI 改写需要独立的 LLM endpoint。像 `ep-xxxx` 的部署 ID 不是 URL，不能填入 Endpoint；需要向 AI 平台确认完整 API Base URL、模型/部署名称以及 OpenAI 兼容的请求格式。

## 使用边界

- AI 只改写英文 source，不翻译 target language。
- 每次运行最多选择十个 Starling 项目；TM 文案由桥接按十条一批处理。
- Vendor 费率只使用插件内置的 `local-rates.json` 快照，不会借用其他 Vendor 的价格。
- `Saving USD` 是 TM 计费规则下的预估，不替代供应商最终结算。

更详细的配置与业务规则见 [Popup 配置说明](popup-configuration.md)、[多语言 ROI 规则](multilingual-roi.md) 与 [ROI_Test 金额说明](roi-bitable-formulas.md)。
