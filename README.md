# L10n TM Companion

在飞书表格旁边查翻译记忆、改英文文案、审阅并写回结果的 Chrome 扩展。

本地化工作中，一段新英文可能已经有意思相近的历史译文，但措辞不同会影响翻译记忆（Translation Memory，TM）的匹配。L10n TM Companion 把 Starling 查询、AI 英文改写和人工审阅放到同一个 Side Panel：先看已有表达，再决定是否改写，确认后才写回表格。

[使用教程](docs/user-guide.md) · [安装手册](docs/offline-install-manual.md) · [TM 匹配说明](docs/TM-MATCHING.md) · [ROI 计算](docs/multilingual-roi.md)

当前扩展版本为 **1.6.0**，面向已有 Starling、Inspire 和飞书应用权限的使用者。完整流程依赖相应公司账号与办公网络；公开源码本身不提供这些服务的访问权限。

## 日常怎么用

1. **选来源**：在 Side Panel 选择 Starling 项目和飞书 Sheet，确认原文列、起始行与输出位置。
2. **查 TM**：获取每条原文最多三条历史匹配及 Starling 返回的真实分数。
3. **看改写**：启用 AI 后，只对 `50 ≤ 原始匹配分数 < 85` 的文案生成最多三个英文候选，再查一次真实 TM。
4. **审阅确认**：在 `Review & edit` 中选择候选或自己修改。可以逐条确认，也可以批量确认剩余默认结果。
5. **写回结果**：最终文案通过校验、Final TM 查询和表格写入后，才显示 `Saved`。需要成本分析时另行开启 ROI mode 并归档。

AI 执行 English-to-English 改写，目标是复用已有译文。目标语言翻译不由模型生成。

## 改写与确认

流程保留三个文案版本，便于比较和追溯：

| 版本 | 内容 | 查询结果 |
| --- | --- | --- |
| A | 输入的原始英文 | Orig Match % |
| B | AI 生成的候选英文 | Post-TM % |
| C | 人工确认的最终英文 | Final TM % |

候选需要通过占位符、URL、数字、品牌 token 和语义风险检查。安全且 TM 查询完整的候选都可以审阅；只有分数高于 A 的候选会自动成为默认 C，持平或下降的候选仍可手动选择。自动检查不能替代人工核对含义。

原始分数低于 50 或达到 85 时跳过 AI，仍可人工编辑。查询失败会显示具体错误，不会被当作“没有 TM 命中”。所有分数来自 Starling API，本地文本相似度不进入正式 TM 结果。

确认后按原始行号写入六列，空白 source 行不会导致结果错位：

```text
Best TM Match | Orig Match % | Rewritten Segment | Post-TM % | Reached 85%? | Final TM %
```

其中 `Best TM Match` 保存排名第一的 TM 英文原文，`Rewritten Segment` 保存最终确认的 C。表格中不显示 ROI 金额。

## 安装与配置

### 使用安装包

macOS 安装包由维护者通过 `scripts/build-offline-package.sh` 构建，内置 Python、Node.js 和固定版本 Starling CLI，无需接收者自行安装这些运行时。

1. 解压安装包，打开 `安装 L10n TM Companion.app`；首次被 macOS 拦截时，右键选择“打开”。
2. 安装器会准备运行目录、检查 bridge 并注册 Native Messaging Host。
3. 在 `chrome://extensions` 开启开发者模式，选择“加载已解压的扩展程序”，从桌面入口选择 `L10n TM Companion - Chrome 加载这个文件夹`。
4. 按 `Cmd+Q` 完全退出 Chrome 后重开，进入扩展 Settings 配置凭证。

安装 App 目前只有 ad-hoc 签名，尚未完成 Apple Developer ID 签名与公证。Chrome 加载扩展仍需要用户确认。逐步说明和排障见[安装手册](docs/offline-install-manual.md)。

### 首次配置

| 项目 | 操作 |
| --- | --- |
| Starling | 填写个人 AK/SK，点击 `Save & Verify`，确认能读到有权限的项目 |
| AI 改写 | 选择 Inspire Writer、Claude 或 OpenAI-compatible 服务，填写相应凭证与模型；AI 可以关闭 |
| 飞书 | 完成已批准应用的授权，确认当前账号与应用具备表格读写权限 |
| Sheet | 选择工作表，检查来源列、起始行和连续六列输出区 |

本机 Owner 测试需要先将获准的飞书 App Secret 写入 macOS Keychain。多人分发需要服务端 OAuth broker 和相应部署门禁；仓库中的后端实现默认关闭，不能直接视为已部署服务。凭证、权限清单与授权步骤见[使用教程](docs/user-guide.md)和[后端部署规格](docs/oauth-broker-async-roi.md)。

Starling AK/SK 保存在 Chrome `storage.local` 和官方 CLI 本机配置中；飞书 App Secret 不应放入扩展源码或安装包。使用外部模型前，请确认该服务适合处理当前文案。

## 可选 ROI 归档

普通运行默认关闭 ROI，不加载费率或执行完整多语言查询。需要估算翻译成本变化时，在运行前开启 ROI mode：程序覆盖所选项目共同支持的非英语目标语言，确认文案后再补齐其余语言的查询。

节省金额按人工确认的最终版本计算：

```text
Saving USD = TM cost(A) − TM cost(C)
```

B 只用于审阅，不进入金额。计算使用本地英文词数、真实 TM 分数和 `data/local-rates.json` 中对应供应商、语言对的费率，因此属于成本预估，不能替代供应商最终账单。

归档目标是配置中固定的 ROI_Test：Runs 保存运行汇总，Scopes 保存语言覆盖与金额，Items 保存每条 source 的 A/B/C 审阅记录。费率、确认结果或 TM 快照缺失时标为 `incomplete`，只展示可计算部分的小计；RWS 与 Pactera 复用查询快照，分别套用各自费率。

具体分档、缺失值处理与归档结构见[多语言 ROI](docs/multilingual-roi.md)和[归档金额说明](docs/roi-bitable-formulas.md)。

## 开发

界面使用原生 JavaScript 和 Chrome Manifest V3，没有前端构建步骤。本机 Python Host 通过 Native Messaging 连接扩展与 Starling 官方客户端；Inspire Writer 使用 OpenAPI。

```text
popup.js / options.js       Side Panel 与设置页
background.js              Service Worker 与本机消息转发
content.js                 飞书文档抓取
lib/                       TM、改写、审阅、表格与 ROI 逻辑
native-host/               Python bridge、官方客户端调用与授权
backend/                   默认关闭的 OAuth broker 与异步 ROI 实现
scripts/                   打包、费率导出与回归脚本
test/                      客户端与 Native Host 测试
```

从源码安装前，需要准备本机 Python 3、Node.js 和 Starling CLI 1.1.41；CLI 的获取需要内部包源权限，详见安装手册。源码仓库不包含安装包中的完整私有运行时，安装器也不会自动补装缺失的 CLI。准备好依赖后，先检查安装条件，再注册 Host：

```bash
git clone https://github.com/TRUSOGEN/l10n-tm-companion.git
cd l10n-tm-companion
./native-host/install.sh --dry-run --no-open
./native-host/install.sh --no-open
```

随后在 Chrome 加载仓库根目录，并按安装手册重启浏览器和配置凭证。

以下测试检查改写门禁、人工确认与成本规则，均使用本地测试数据：

```bash
node test/e2e-logic.test.js
node test/review-workflow.test.js
node test/pricing-rules.test.js
```

完整回归入口为 `bash scripts/run-full-regression.sh`，包含客户端、Native Host 与后端测试，需要准备相应 Python 依赖。本地测试通过不代表 Starling、Inspire、飞书线上链路已验证；真实环境检查见 [E2E 清单](docs/E2E-CHECKLIST.md)。

## 继续阅读

- [使用教程](docs/user-guide.md)：权限申请、日常操作与配置。
- [TM 匹配说明](docs/TM-MATCHING.md)：API、批量查询、真实分数和失败处理。
- [多语言 ROI](docs/multilingual-roi.md)：语言范围、费率与预估边界。
- [后端部署规格](docs/oauth-broker-async-roi.md)：OAuth broker、异步 ROI 与启用条件。
- [v1.6.0 发布记录](docs/release-v1.6.0.md)：版本改动与当时的验证范围。
- [维护交接](handoff/HANDOFF.md)：后续维护入口与历史记录。
