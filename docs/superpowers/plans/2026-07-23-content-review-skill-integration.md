# Content Review Skill Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 接入用户提供的 Content Review skill 与四份 Markdown，并完成审阅选择、顺序、TM 预览、AI 门禁和错误分类修复。

**Architecture:** 原始规则作为版本化静态资产进入扩展，纯函数模块负责检索和质量门禁，`ai-translate.js` 只组装单条 Inspire prompt。UI 始终保留 Sheet 行身份和 A/B/C 业务语义。

**Tech Stack:** Chrome MV3、原生 JavaScript ESM、Node assert tests、Python unittest、macOS Installer.app。

## Global Constraints

- 不修改正式 A−C ROI 公式、Feishu A-G schema、Starling API 或凭证存储。
- 不同时加载 Game 与 Revenue Legal Guidelines。
- 不修改任何现有 placeholder、数字、URL 或模板 token。
- 所有行为先写失败测试并确认 RED。

---

### Task 1: 规则资产与检索

**Files:**
- Create: `skills/cd-content-review-version-2/SKILL.md`
- Create: `skills/cd-content-review-version-2/references/*.md`
- Create: `lib/content-review-rules.js`
- Test: `test/content-review-rules.test.js`

**Interfaces:**
- Produces: `buildContentReviewContext({sourceText, tmSource, context, assets})`。

- [x] 写入资产存在、Glossary 精确命中、相关章节选择和 Legal 单选失败测试。
- [x] 运行测试并确认函数缺失导致失败。
- [x] 原样复制资产并实现纯函数检索。
- [x] 运行测试确认通过。

### Task 2: Inspire prompt 与质量门禁

**Files:**
- Modify: `lib/ai-translate.js`
- Create: `lib/source-rewrite-policy.js`
- Test: `test/content-review-prompt.test.js`
- Test: `test/source-rewrite-policy.test.js`

**Interfaces:**
- Produces: `buildRewritePrompt(item, reviewContext)`、`evaluateRewriteCandidate(item)`、`formatTmSourceForDisplay(raw)`。

- [x] 写入规则证据、JSON schema、placeholder/数字/URL 校验、Score B 门禁和 TM preview 失败测试。
- [x] 运行测试确认 RED。
- [x] 实现最小纯函数和异步规则加载。
- [x] 运行目标测试确认 GREEN。

### Task 3: 审阅 UI、顺序与错误分类

**Files:**
- Modify: `popup.js`
- Modify: `lib/i18n.js`
- Modify: `lib/errors.js`
- Test: `test/popup-fast-path.test.js`
- Test: `test/errors.test.js`

**Interfaces:**
- Consumes: `evaluateRewriteCandidate()` 与 `formatTmSourceForDisplay()`。

- [x] 写入保持 A、删除 Use TM 最终选择、行号顺序和 Working spreadsheet 分类失败测试。
- [x] 运行测试确认 RED。
- [x] 实现选择、写回、快照、Focus 与错误映射。
- [x] 运行目标测试确认 GREEN。

### Task 4: 文档、版本与离线交付

**Files:**
- Modify: `README.md`
- Modify: `docs/user-guide.md`
- Modify: `docs/offline-install-manual.md`
- Modify: `scripts/build-offline-package.sh`
- Modify: `manifest.json`
- Modify: `L10n TM Companion Installer.app/Contents/Info.plist`
- Test: `test/installer-contract.test.js`

**Interfaces:**
- Produces: `1.1.3` Installer.app、ZIP 与正式交付目录。

- [x] 写入规则资产必须进入 payload、版本一致和文档文案失败测试。
- [x] 运行测试确认 RED。
- [x] 更新构建清单、文档和版本。
- [x] 运行全量测试、构建、签名、安装与哈希一致性验证。

### Post-delivery fix: completed task 的 copies 可见延迟

- [x] 写入第一次 copies 为空、第二次出现 revision 的失败测试并确认 RED。
- [x] 对同一 task 最多读取三次 copies，不创建新 task。
- [x] 写入最终失败响应形状与 prompt 长度诊断测试并确认 RED。
- [x] 运行全量测试，构建并同步 `1.1.4` 安装包、ZIP 与活动加载目录。
