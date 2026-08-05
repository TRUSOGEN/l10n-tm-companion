# L10n TM Companion v1.6.0 发布摘要

发布日期：2026-08-05；分支：`codex/publish-v1.5.0`；仅本机准备，不 push。

## 用户可见更新

- Review details 默认折叠；A→B→C 方法论只展示一次，结果卡不再重复。
- 相同决策原因聚合为 Decision notes，并显示影响条数。
- Feishu Secret 缺失时，错误卡引导到 Secret Settings；Secret 只写入 Keychain，Settings 不回显明文。
- ROI 归档前展示 source/confirmed 行、语言、vendor coverage、A+C 请求量和预计时长；归档中展示阶段、进度、Elapsed 和 ETA。
- 正式 ROI 仅计算 `Cost(A) − Cost(C)`，候选 B 不进入金额。

## 制品与校验

最终 ZIP：`/Users/bytedance/my-project/L10n-TM-Companion-线下安装包/L10n-TM-Companion-v1.6.0-macOS.zip`

- 大小：106911552 bytes
- SHA-256：`efc24f10b5ed679f6dcf9d9023e160bfe4d640ef20027fc00a88c5c75a79898d`
- manifest：1.6.0
- 固定扩展 ID：`bgbodpcofifiloekhfjiffmchcaiiicm`
- `unzip -t`、必需文件与敏感信息扫描通过。

## 测试边界

Installer contract（53/53）、全部 JS tests、JS syntax、仓库 Python 脚本测试、Native Host Python compile 和 `git diff --check` 通过。完整回归执行到 Backend pytest；系统 Python 缺少 pytest（`No module named pytest`），按发布要求未安装依赖，因此不宣称全量全绿，Backend compileall 未到达。

未执行实际安装器，也未完成真实 Starling/Feishu/Inspire/Broker 或 100 行×56 语言 E2E。接收者安装后需重载扩展、完全重启 Chrome，并完成上述受控 E2E。
