# Task 2 实施报告

## 范围

完成 Feishu Secret 授权前置检查与 Settings 深链。保留 OAuth callback、`authorizeFeishuUser({ returnUrl })`、Broker 权威模式及既有关键 DOM ID；未修改 ROI、TM、vendor 或 Run ID 逻辑。

除计划列出的 Task 2 文件外，按明确交付要求新增本报告；未调整其他实现文件。

## TDD 记录

### RED

先新增 `test/feishu-secret-preflight.test.js`，覆盖三态 preflight、Popup 诊断/action DOM、导航意图先持久化后打开 Settings、Settings hash/intent 定位、滚动与 focus、安全提示及不承载明文 Secret。

确认失败命令：

```text
node test/feishu-secret-preflight.test.js && node test/popup-feishu-oauth.test.js && node test/options-roi-oauth.test.js
```

预期失败：`lib/feishu-auth.js` 尚未导出 `preflightFeishuAuthorization`，Node 报 `SyntaxError: ... does not provide an export named 'preflightFeishuAuthorization'`。

### GREEN

- `preflightFeishuAuthorization(status)` 返回 `connected`、`ready`、`secret-required` 三态；缺 Secret 的 action 为 `open-settings`。
- Popup 的 legacy 本地 Secret 路径在 OAuth 前检查 Keychain 状态；缺失时显示明确诊断和 Open Settings，立即停止，不调用任一 OAuth 路径。
- Broker 权威路径仍直接使用 Broker，不读取或回退本地 Secret。
- `openFeishuSettings()` 先保存 `optionsNavigationIntent: 'feishu-secret'`，再打开 Settings。
- Settings 消费 `#feishu-secret` 或持久化 intent，展示返回 Side Panel 的提示，滚动并聚焦安全配置按钮，随后清除 intent。
- Secret 仍通过 Native Host/macOS Keychain 配置；页面仅显示 `Configured`，不回显 Secret。

## 验证结果

以下均通过：

```text
node test/feishu-secret-preflight.test.js
node test/popup-feishu-oauth.test.js
node test/options-roi-oauth.test.js
node test/feishu-auth.test.js                 # 33 passed, 0 failed
node test/popup-broker-failure-policy.test.js # 33 passed, 0 failed
node --check popup.js
node --check options.js
node --check lib/feishu-auth.js
for test_file in test/*.test.js; do node "$test_file" || exit 1; done

git diff --check
```

完整 JavaScript test regression 可行并通过。未新增依赖。

## Concerns

无已知阻塞问题。Secret preflight 仅约束需要本机 Keychain Secret 的 legacy 路径；Broker 开启且权威时由 Broker 持有应用 Secret，这是刻意保留的安全边界。

## 审查修复（2026-08-05）

按审查意见补充第二轮 RED→GREEN：

- 将 Secret preflight 测试升级为可执行行为测试，通过依赖注入真实执行状态决策、Chrome storage/open 顺序、失败传播，以及 Settings intent/hash 的消费、清理、滚动和聚焦。
- Popup 在 `visibilitychange`、window focus 和相关 storage change 时安全刷新授权状态；配置完成返回后会隐藏诊断/Settings action、恢复 Connect，并且监听器仅在模块初始化时注册一次。
- Broker authoritative 刷新和连接均不会查询本机 Secret；legacy 缺 Secret 时在 OAuth 前停止。
- Settings 打开流程捕获 storage 与 openOptionsPage 拒绝，并在既有诊断区展示 safe friendly error，不产生 unhandled rejection。

验证通过：focused Secret/OAuth tests、`feishu-auth`（33/0）、Broker failure policy（33/0）、全部 `test/*.test.js`、三个 `node --check` 及 `git diff --check`。

## 复审测试修复（2026-08-05）

为避免 Popup 编排仅靠源码字符串断言，新增 `lib/feishu-popup-controller.js`，生产 Popup 与测试共同使用该 controller/binder。测试通过最小 fake DOM、fake window 和 mock Chrome API 实际触发 click、visibilitychange 与 focus，验证 legacy 缺 Secret、Broker authority、Settings 顺序/失败 UI、返回后恢复 Connect，以及 binder 幂等性。对应 Popup 生命周期源码字符串断言已删除。

新增 controller 文件是满足“生产接线与行为测试使用同一实现”所必需的计划外小幅文件调整，不涉及 ROI/TM/vendor/Run ID。

本轮 focused/auth、全部 JavaScript regression、`popup.js`/`options.js`/`lib/feishu-auth.js`/controller 语法检查和 `git diff --check` 全部通过。

## 最终复审修复（2026-08-05）

- Controller Connect 增加共享 in-flight Promise；授权全程禁用 Connect，所有完成/失败路径均在 `finally` 恢复按钮。
- Connect 的 preflight、return URL、legacy/Broker OAuth 和授权后 refresh 全部由事件处理内部捕获，并统一进入注入的 safe error renderer；生命周期 refresh 同样使用安全包装，不产生 unhandled rejection。
- 行为测试真实连续触发两次 Connect，确认仅一次 Broker OAuth；分别覆盖 legacy/Broker reject，确认错误可见、按钮恢复且另一授权路径调用为 0。
- 删除 Popup 中旧 `openFeishuSettings` 与 `connectFeishuUserFromPopup` 死路径；生产授权仅由 controller 负责，保留 return URL callback 和 Broker 无 fallback 边界。

全部 focused/auth tests、`test/*.test.js`、四个相关 JS 语法检查及 `git diff --check` 通过。
