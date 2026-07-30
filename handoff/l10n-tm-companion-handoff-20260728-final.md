# L10n TM Companion Continuation Handoff

日期：2026-07-28

## 接续目标

下一次优先完成真实飞书 E2E 与生产风险收口，不继续扩 UI 或新增 ROI 字段。项目内完整状态、验证证据、复盘和使用注意事项见 `/Users/bytedance/my-project/l10n-tm-companion/handoff/l10n-tm-companion-handoff-20260728.md`。

## 当前可交付物

- 源码：`/Users/bytedance/my-project/l10n-tm-companion`
- 正式线下包：`/Users/bytedance/my-project/L10n-TM-Companion-线下安装包`
- Chrome 已加载目录：`/Users/bytedance/L10n TM Companion - Chrome 加载这个文件夹`
- 版本：`1.3.2`
- ZIP SHA-256：`94e2ba121d4b496fff27d70e283e7d9ad8f7dd99ac524b963f79102ecc194c4f`
- 上一版备份：`/Users/bytedance/my-project/L10n-TM-Companion-线下安装包.previous-v1.3.1`

## 最新事件

真实 ROI_Test 调用返回飞书 `99991679 Unauthorized`，当前 user token 缺少 `base:view:read`。代码的 OAuth 请求已经包含该 scope；根因是新增后台权限尚未进入当前用户 grant。`1.3.1` 已加入旧 token scope 完整性检查，缺 scope 时首页显示 `Reconnect` 和具体缺失项。

视图权限修复后，真实容量预检继续暴露缺少 `base:record:retrieve`。`1.3.2` 已修正 OAuth 映射：保留特定记录读取 `base:record:read`，并为“列出/查询记录”显式请求 `base:record:retrieve`。这是实现错误，不是用户漏开权限。

用户侧应确认已发布版本包含用户身份 `base:record:retrieve`，再刷新 1.3.2、完全重启 Chrome 并点击 `Reconnect`。不要用共享 Secret 绕过这个过程。

## 下一次执行顺序

1. 确认飞书应用的新权限版本已经发布，用户完成 Reconnect。
2. 用 2–3 条非生产 source 做 Sheet Confirm 与 ROI_Test 三表归档。
3. 核对 Runs/Scopes/Items 的记录数、字段类型、Operator、金额、基础视图与失败状态。
4. 若失败，保留原始错误与 Run ID；先定位权限、资源分享、schema 或部分写入阶段，不手工造数据。
5. 小样本通过后，用 18 条 source 测试真实时延；最后才运行全部 locale，并记录 phase duration、请求数、错误数和限流。
6. 由产品负责人确认 50–85 gate 是否继续以展示参考 locale 的 Score A 作为 source-level 资格。
7. 单独规划 OAuth broker、私有 ROI 写入、幂等 repair、容量 rollover 和最小应用权限。
8. 清理 Git 只允许逐文件审查和精确 stage，禁止 broad stage。

## 仍未验证

- 真实 ROI_Test 三表成功写入与 live schema migration
- 真实六个视图创建
- 真实 35-locale PPE wall-clock、请求数与 QPS
- 普通用户跨机器安装与授权
- “用户可写但不可查看 ROI_Test”的应用身份代理
- Apple Developer ID 签名与 notarization

## 建议使用的 skills

- `systematic-debugging`：处理真实飞书、Starling 或 Inspire 错误，先沿组件边界定位根因。
- `verification-before-completion`：任何“E2E 已完成”“包可分发”结论前重新运行验证并核对输出。
- `git-guardrails-Codex`：在当前脏工作区建立安全的精确提交边界。
- `handoff`：下一阶段结束时同步真实验证状态、阻塞和下一步。

## 禁止事项

- 不把 App Secret、token、AK/SK 或用户 PII 写进 handoff、日志、ZIP 或聊天。
- 不用展示 locale 的分数填补失败 locale。
- 不把 `incomplete` 隐藏为成功，也不为缺失费率填默认金额。
- 不把基础 grid view 声称为已配置好的透视看板。
- 不在未完成真实 E2E 前宣称生产可用。
