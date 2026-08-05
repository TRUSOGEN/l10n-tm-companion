# 整分支审查修复报告（2026-08-05，codex/side-panel-ux）

## 背景

Task 1–8 提交后进行整分支审查，发现 2 项 Critical、3 项 Important、3 项 Minor 阻塞项。全部按 TDD（先红灯、确认失败、最小实现、确认通过、独立 commit）修复，未使用 `--amend`，未 push。

## Critical

### 1. `lib/ui-errors.js` 脱敏重写 — `0f01a5a fix: redact credentials by sensitive key roots`

- 敏感键判定改为「归一化后包含敏感词根」（`secret/token/accesskey/apikey/authorization/password/credential/privatekey/signature/cookie` + `ak/sk/akid/pwd` 精确名），覆盖 `feishuAppSecret`、`starlingSecretKey`、`starlingAccessKey`、`appSecret`、`client_secret`、`accessToken`、`refreshToken`、`authToken`、`access_key_id`、`llmApiKey`、`userAccessToken` 等前后缀变体。
- 字符串脱敏覆盖 JSON 形态 `{"access_key":"…"}` / `"secret_key": "…"`，非敏感字段保留。
- 值形态兜底：`AKLT…` 前缀串、裸 `Bearer …`。
- 红灯先行：新增断言使用真实业务字段名与真实 JSON payload，未通过时报 `product field feishuAppSecret redacted`。

### 2. 日志不得输出原始 error — `7eed5f3 fix: log only sanitized error details`

- 新增 `logSanitizedError(scope, error, logger = console)`，只输出 `toUiError(error).rawDetails`。
- 全分支检查后替换了 5 个 `console.warn(..., error)` 出口：归档失败（原 `popup.js:3053`）、broker run 恢复、broker run 创建失败、单条与批量 broker final 提交失败。
- 新增 `test/popup-error-logging.test.js`：行为断言（脱敏字符串、保留 Request ID/错误码/非敏感诊断）+ 全文件守卫（任何 `console.*` 不得接收 error/err/exception/reason 变量）。

## Important

### 3./4./6. CSS semantic token 与动效迁移 — `05602f2 style: migrate stateful components to semantic tokens`

- 新增 tint/border/track 语义 token；`.score-stage.*`、`.review-status-tag.*`、`.status-*`、`.archive-progress-*`、`.multilingual-roi-summary`、`.dest-*` 的 color/background/border-color 全部改为 token，**直接改原规则**并删除文件末尾的重复覆盖行（Task 5/Task 6 的颜色覆盖块）。
- 动效只保留 opacity/transform：删除 `border-color`、`background-color`、`color`、`box-shadow`、`width` 的 transition；`.progress-fill` 改为 `transform: scaleX()`（`showProgress` 同步改为设置 `style.transform`），`.archive-progress-bar` 继续 `scaleX`。
- 删除死规则 `.result-card.is-entering` 与会覆盖 `animation: none` 的 `.result-card:nth-child(-n+8)`（同时删除随之失效的 `@keyframes card-enter`），reduced-motion 下不再有特异度陷阱。
- `test/side-panel-accessibility.test.js` 增加真正的 CSS 解析器：动效白名单现在扫描**全部**含 transition/animation 的选择器与 keyframes 块；raw hex 检查与「同一选择器同一颜色属性只能声明一次」的反覆盖检查；死 keyframes 与死状态 class 检查。

### 5. Task 6 断言行为化 — 同 `05602f2`

- 新增 `captureActiveResultCardId()` 纯函数（`lib/result-batch-renderer.js`），Task 6 原先对 `RESULT_RENDER_BATCH_SIZE`、`activeCardId`、`visibleItems.map(...)` 的源码正则断言改为：批量渲染行为断言（每帧 ≤25、顺序稳定、焦点恢复、`aria-busy` 翻转）+ `captureActiveResultCardId` 行为断言。
- 仅保留一条不依赖变量名的顺序守卫：popup 必须在清空容器前调用 `captureActiveResultCardId`。

## Minor

### 7. 合法 flow 容器与 aria-live — `4ab2062 fix: keep error cards in valid flow containers`

- `<details>` 包进 `div.ui-error-details`；`#sheet-layout-status` 由 `<p>` 改 `<div>`（保留 `run-status` class）；`#status` 增加 `aria-live="polite"`。
- 行为断言：`<p>` 内不得有块级子节点、容器子元素序列为 `strong/p/div/div`、HTML 契约检查。

### 8. 语言感知错误文案 — `8e7c9ed feat: localize friendly error copy for zh-CN UI`

- `toUiError(error, { locale })` 默认英文，`zh-CN` 返回中文标题/说明/按钮文案；10 条规则全部有中文映射；action ID、错误码、脱敏详情与语言无关；未知 locale 回退英文。
- `showUiError` 与 sheet/archive/recovery 渲染路径传入当前 `uiLanguage`。

## 测试结果（2026-08-05 15:0x 本机）

| 命令 | 结果 |
| --- | --- |
| 全量 `test/*.test.js`（60 个文件） | 全部通过 |
| `./scripts/run-full-regression.sh` | 前置 8 项 OK、`ALL_JS_TESTS_PASSED`、`ALL_PYTHON_TESTS_PASSED`、`JS_SYNTAX_OK`、`PY_SYNTAX_OK`；`BACKEND_TESTS_FAIL` |
| backend pytest 原始错误 | `/Library/Developer/CommandLineTools/usr/bin/python3: No module named pytest` → 已知环境限制，未安装依赖、未削弱测试 |
| `cd backend && python3 -m compileall -q src tests migrations` | 通过（脚本在 pytest 处退出，人工补跑） |
| `node --check`（popup/options/background + 全部 lib/test） | 通过 |
| `git diff --check` | 无错误 |
| `standard-lint` | 命令不存在 → 环境跳过 |

## 残留 concerns

1. backend pytest 仍未真实执行（本机无 pytest）。
2. `popup.css` 中非本次范围的旧组件（header、focus overlay、health、tm-badge 等）仍有 raw hex，属既有代码，未在本轮扩大改动面；测试只对状态组件家族强约束。
3. 语言感知目前只覆盖 `lib/ui-errors.js` 的错误文案；归档摘要弹窗、进度阶段名仍是英文（与既有字符串契约一致）。
4. 需用户重载扩展做手动 E2E（含 100 行 × 56 语言归档、中文 UI 下错误卡片、reduced-motion）。
