# handoff 入口总览 — 接手者先看这个

> L10n TM Companion 项目交接文档目录。先看 `HANDOFF-2026-07-15-output-roi-ui.md` 了解当前 UI 与 Sheet schema，再看 `HANDOFF-2026-07-13-roi-measurement.md` 了解完整 ROI 金额边界。
> 代码位置：`/Users/bytedance/my-project/l10n-tm-companion/`

> 2026-07-16 已完成改写后二次真实 Starling TM 的运行内快照，最新实现与后续持久化边界见 `HANDOFF-2026-07-16-post-rewrite-tm-snapshot.md`；读完该文件后，再回看 2026-07-15 与 2026-07-13 的 UI 和金额契约。

---

## 📌 当前状态（2026-07-15，一句话）

**ROI 计费门槛已更新为 85%；插件必须按每个目标语言保存改写前后两次真实 Starling TM 分数，飞书报表按 Yuting / vendor 的 AIPE 与 T only 规则计算预估成本，Starling 不负责金额计算或 ROI 前端。**

详见 `HANDOFF-2026-07-13-roi-measurement.md` 的“2026-07-15 更新：85% 计费口径与待确认参数”。当前前置条件是取得可执行费率表、对账样本、85% 边界规则和 Starling 第二次 Batch 查询的正式运行条件。

当前普通 Sheet 已收敛为 A-G：插件读 A、写 B-F，G 为默认空白的 Yes/No CD review 下拉。`en→en` 可以执行 TM 优化；缺精确费率只让 ROI amount 不可用，不阻止 TM。

---

## 文件优先级（接手顺序）

| 顺序 | 文件 | 内容 | 必读？ |
|------|------|------|--------|
| 1 | **`HANDOFF-2026-07-15-output-roi-ui.md`** | 最新。`en→en` 语义、A-G 输出、CD review Yes/No、验证结果与金额剩余边界 | ✅ 必读 |
| 2 | **`HANDOFF-2026-07-13-roi-measurement.md`** | 85% ROI 计费口径、Starling / 插件 / vendor 职责、实施范围和待确认费率参数 | ✅ 必读 |
| 3 | **`HANDOFF-2026-06-29-config-key-i18n.md`** | 设置页简化 + DeepSeek 火山方舟 + TM key 回退说明 + UI 英化 + 打包 | ✅ 必读 |
| 4 | `HANDOFF-2026-06-29-simplification.md` | 本轮流程简化对比（before→after，7 项，快速理解改了什么流程） | 参考 |
| 5 | `HANDOFF-2026-06-29-install-flow.md` | 安装流程改进 + 配置体验 + native host forbidden 闭环 | ✅ 必读 |
| 6 | `HANDOFF-2026-06-26-rootcause.md` | 「读不到原文」根因闭环 + 代码修复 + 打包 | ✅ 必读 |
| 7 | `HANDOFF-2026-06-26-loop.md` | Loop Engineering 23 轮修复记录 | 参考 |
| 8 | `HANDOFF-2026-06-25-postmvp.md` | 2026-06-25 下午真实使用反馈修复（BX1-BX5） | 参考 |
| 9 | `HANDOFF-2026-06-25.md` | 2026-06-25 技术路线总览 | 参考 |
| 10 | `SESSION-HANDOFF.md` | 完整操作历史（从启动到 2026-06-24，偏流水账） | 参考 |
| 11 | `IMPLEMENTATION_PLAN.md` | 实施计划 + 进度总览 | 参考 |

---

## 关键事实速查

- **真正的原文表**：wiki 链接 `https://bytedance.larkoffice.com/wiki/QmG4w6EVIitUAlkT259clYFCndf`，sheet_id `9a9d2d`，A 列 39 条原文
- **飞书应用**：`L10n TM Companion`，App ID `cli_aab1ca4137badbc4`，纯凭证型（sheets 权限，**无机器人能力，不能上架应用市场**）
- **飞书凭证已预填进扩展**（App ID/Secret 写进 `options.js`/`popup.js` 的 `SHARED_FEISHU_CREDENTIALS`）
- **Starling**：starling-cli v1.1.16，项目 385（TikTok_Client），AK/SK 各自配（`starling-cli login`），源/目标语言默认 en
- **TM 项目**：starling-cli `/projects` 返回 3 个（513 live_client、385 TikTok_Client、278 TikTok_main），全部在设置页卡片可选
- **LLM**：Provider 下拉（Claude / DeepSeek 火山方舟 / 自定义）。DeepSeek preset = `ark.cn-beijing.volces.com/api/v3/chat/completions` + `deepseek-v4-flash-260425`。AI 默认关。
- **TM key**：⚠️ starling 的 TM match 不返回 keyText，已回退。用 TM 优化原文靠 TM 译文喂 AI，不依赖 key
- **本机 Chrome 扩展 ID**：`bgbodpcofifiloekhfjiffmchcaiiicm`（未打包扩展随机 ID，机器相关；install.sh 自动探测）
- **native host 注册清单**：`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.l10n.tm_companion.json`
- **私钥**：`/Users/bytedance/my-project/keys/extension.pem`（不入包，不进 git）
- **回档1**：`/Users/bytedance/my-project/回档/回档1-20260626.zip`
- **一键安装**：`双击安装.command`（根目录）或 `native-host/install.sh`
- **分发包**：`~/Desktop/L10n-TM-Companion-20260626.zip`（已覆盖，含全部最新改动）

---

## 最大教训（最新在前）

1. **`ark-` key 是火山方舟，不是 DeepSeek 官方**。DeepSeek 官方 key 是 `sk-`；火山方舟 `ark-` 要打 `ark.cn-beijing.volces.com`。都是 OpenAI 兼容，但 endpoint+key 必须配套，混用 401。火山方舟用模型 id（如 `deepseek-v4-flash-260425`），不是接入点 ep-。
2. **新增表格列要同步更新所有断言**。加 I 列后 feishu-sheets 测试的列数/表头数/missing 数全是硬编码，漏改会挂。
3. **英化只动可见文案，注释别动**。console.log 也不算用户可见，留中文方便诊断。
4. **Chrome 未打包扩展 ID 不可控**：manifest 的 key 字段对「加载已解压扩展程序」不生效，Chrome 给随机 ID。自动探测要从 `Secure Preferences`（非 Preferences）读。forbidden 90% 是没重启 Chrome。
5. **纯凭证型飞书应用不能上架应用市场**（无机器人/网页能力）。预填凭证进扩展是内部工具最优解。
6. **「抓不到」先飞书 API 直连 dump 表内容**，别先怀疑 DOM。
