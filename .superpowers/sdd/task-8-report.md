# Task 8 报告：Full regression、文档与 handoff

## 结论

Task 8 已完成。全量回归除 backend pytest 因本机缺少 `pytest` 模块失败外全部通过；用户可见文档、E2E checklist、Broker 契约与中文 handoff 均已更新，未安装任何依赖，未削弱或跳过任何测试断言。

## 执行的命令与结果

| 命令 | 结果 |
| --- | --- |
| `./scripts/run-full-regression.sh` | 退出码 1；失败点仅为 `Backend pytest` |
| ├ 8 个前置指定 JS/Python 测试 | 全部 OK |
| ├ `test/*.test.js`（59 个文件） | `ALL_JS_TESTS_PASSED` |
| ├ 顶层 `test/*.py`（9 个文件） | `ALL_PYTHON_TESTS_PASSED` |
| ├ `node --check`（`*.js lib/*.js test/*.test.js`） | `JS_SYNTAX_OK` |
| ├ native-host + `test/*.py` py_compile | `PY_SYNTAX_OK` |
| └ `PYTHONPATH=backend/src python3 -m pytest tests -q` | `BACKEND_TESTS_FAIL`，原始错误：`/Library/Developer/CommandLineTools/usr/bin/python3: No module named pytest` |
| `cd backend && python3 -m compileall -q src tests migrations` | 通过（脚本已在 pytest 处退出，故人工补跑） |
| `node test/popup-error-actions.test.js` | 9 个行为场景通过 |
| `git diff --check` | 无错误 |
| `standard-lint` | `command not found` → 环境跳过，未安装依赖 |

完整日志：`temp/v1.5-regression/full-regression.txt`。

## 环境限制（如实记录，不记作通过）

1. backend pytest：本机 `python3`（Command Line Tools 自带）无 `pytest`。需在装有 pytest 的 Python 3.11+ 环境重跑 `./scripts/run-full-regression.sh` 才能得到 `BACKEND_TESTS_OK`。
2. `standard-lint` 命令不存在，按计划 Step 6 规则标记“环境跳过”。
3. 手动 E2E（计划 Step 7）无法在本环境执行：需用户在 Chrome 中重载 unpacked 扩展，完成 `docs/E2E-CHECKLIST.md` 新增 11 项，重点是 100 行 × 56 语言的真实归档验证。

## 文档更新

- `docs/user-guide.md`：归档摘要确认弹窗（六项口径、Esc/Tab/焦点归还、336 请求算法）、归档进度与 ETA、“出错时怎么办”错误→动作对照表、headerless Sheet 恢复步骤、A→B→C 与 vendor coverage 解读、无障碍/窄屏/动效。
- `docs/E2E-CHECKLIST.md`：新增“Side Panel UX 升级（1.5，需重载扩展手动验证）”11 项未勾选场景。
- `docs/oauth-broker-async-roi-contract.md`：新增“Side Panel UX 契约”小节（Broker 不降级、A−C 口径、stable Run ID、vendor coverage 语义、脱敏边界、progress 观测点）。
- `USAGE-GUIDE.md`：新增两条常见问题（友好错误与下一步动作、归档进度与 ETA）。
- `handoff/l10n-tm-companion-handoff-20260805-side-panel-ux.md`：中文 handoff，记录 8 个任务实现、关键 commit、口径与安全边界、测试结果、已知限制与后续待办。注意 `handoff/` 被 `.gitignore` 忽略，与既有 handoff 一致，只保留在本机，同时已同步到主工作目录 `l10n-tm-companion/handoff/`。

## 安全与口径复核

- 文档与 handoff 中无 Secret、AK/SK、token、真实凭据或运行快照内容。
- 明确写明正式 ROI 仅 `Cost(A) − Cost(C)`、B 不进金额与请求估算、Secret 不回显、Broker 不 fallback、stable Run ID 复用、vendor 不借价不填 0。
- 新增 Markdown 文件权限均为 100644。
