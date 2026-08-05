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
