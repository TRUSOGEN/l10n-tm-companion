# L10n TM Companion Handoff — 2026-07-27

## 本轮目标与结果

本轮完成 Top-3 TM、50–85 英语改写梯度、简化审阅 UI、逐条确认与 ROI 漏斗指标的业务设计，没有修改功能代码。用户已口头确认方案；正式设计文档已经写入并提交，下一会话应先请用户复核书面规格，再进入 implementation plan。

## 权威材料

- 最新设计：`/Users/bytedance/my-project/l10n-tm-companion/docs/superpowers/specs/2026-07-23-tm-candidates-roi-review-workflow-design.md`
- 设计 commit：`e158c15 docs: design simplified TM review workflow`
- 设计 SHA-256：`d5e728cc6c0540d1bceb9cf44c9a6fb6d796d6fb34ae95d4e3e7f790ba04217e`
- 会议记录：`/Users/bytedance/Downloads/TM工具.md`
- 上一份运行态 handoff：`/private/tmp/l10n-tm-companion-handoff-20260723.md`

新设计的业务规则、数据结构、状态机、迁移规则、失败语义和验收标准以设计文档为准，本 handoff 不重复完整规格。

## 已确认的关键决策

- 自动 AI 改写区间为 `50 ≤ Score A < 85`；低于 50 只看 TM，达到 85 直接保留原文。
- Batch TM 已使用 `limit=3`，实现只需保留服务端候选数组，不应对同一 source 查询三次。
- AI 文案只在语义安全、受保护 token 完整且真实 Post-TM 高于原始 TM 时展示；其他情况显示 `AI 改写：None`。
- 被过滤候选仍可保留代表性 Post-TM 分数与相对原始 TM 的升降，用于解释 `None`，不展示无价值文本。
- Post-TM 与 Final TM 的箭头、delta 统一相对原始 Score A。
- 删除“展开详情”和 AI rewrite 徽标，只保留 Focus 审阅入口。
- 用户逐条点击“确认修改并查 TM”；Final TM 查询和 Sheet 写入都成功后才确认，再次编辑会使旧分数过期并允许重查。
- 删除两个全局“写回表格”按钮、`CD review valid?` 下拉和全局“确认最终 C”按钮。
- Sheet 第六列改为 `Final TM %`；旧 `CD review valid?` 列非空时必须停止迁移，禁止覆盖人工数据。
- ROI_Test Runs 增加 Operator、A/AI/Review 达到 85 的数量与 uplift；Operator 当前留空。
- 正式金额 ROI 始终为 `TM Cost(A) - TM Cost(C)`，B 只用于 AI 效果分析。
- 部分确认允许归档为 `incomplete` 小计，零条确认禁止归档。

## Git 与工作区边界

- Repo：`/Users/bytedance/my-project/l10n-tm-companion`
- Branch：`main`
- HEAD：`e158c15`
- `origin/main`：`a678f53`
- 当前分支领先远端 1 个 commit，设计 commit 尚未 push。
- `e158c15` 只包含一份 265 行的设计文档。
- 工作区仍有大量此前存在的 modified/untracked 文件，包括功能代码、测试、Installer、规则资产和文档；本轮没有 broad stage，也没有把这些文件纳入设计 commit。
- 下一会话不得 broad-stage、覆盖或清理这些改动；提交前必须按明确文件清单检查 secret 风险和 diff。

## 验证与外部边界

- 设计文档已检查：265 行、代码块闭合、无 TODO/TBD/未决口径、无空白错误。
- 本轮没有改功能代码，因此没有重跑 JavaScript、Python、Installer 或真实 E2E。
- 2026-07-23 的 v1.1.5 本地测试、安装包、活动目录和签名验证结果只属于上一份 handoff 的验证边界。
- 本轮没有调用真实 Inspire、没有写真实 Feishu Sheet、没有向固定 ROI_Test 写记录，也没有验证新增 Bitable 字段权限。
- 当前实现仍是旧 UI、旧 Sheet schema 和旧 ROI schema；不能把已批准设计描述成已经上线。

## 下一步

1. 请用户复核最新设计文档；用户确认书面规格后再进入实现。
2. 调用 `writing-plans` 生成分阶段 implementation plan，不在根目录创建计划文件。
3. 建议按 Top-3 数据契约、50–85 候选生成与门禁、Focus/逐条确认、Sheet 迁移、ROI Runs 字段五个可测试切片实现。
4. 每个切片先写失败测试，再改代码；重点检查 Batch 返回顺序、候选过滤、升降基线、确认状态机、写回失败和 schema 冲突。
5. 完成后运行全量 JavaScript、Python、syntax、`git diff --check`、Installer contract、离线包与隔离安装验证，并仔细检查输出内容。
6. 真实 Inspire、Feishu Sheet 和 ROI_Test E2E 需要用户授权与可用环境；未执行时必须继续明确标记未验证。
7. 测试通过后增量同步 README、用户手册、TM Matching、ROI 规则、Popup 配置、E2E checklist 和安装包说明。
8. 只有用户明确要求时才提交、push 或构建正式交付包。

## 建议技能

- `writing-plans`：把已确认设计拆成可执行、可验证的实现计划。
- `test-driven-development`：按数据契约和状态机先写失败测试。
- `verification-before-completion`：完成后核查测试输出、安装包和真实边界。
- `git-guardrails-claude-code`：在当前脏工作区中保持精确 staging 和 secret 边界。
- `handoff`：实现结束后更新临时目录交接记录。
