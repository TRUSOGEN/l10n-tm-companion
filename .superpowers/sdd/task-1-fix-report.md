# UX Task 1 修复报告

## 实施范围

- 强化 `lib/ui-errors.js` 的凭证脱敏，覆盖 Authorization/Bearer、引号及多词值，以及常见 camelCase、snake_case、kebab-case 凭证键。
- 对嵌套对象和数组递归清洗；真实 `Error` 保留 `name`、`message`、`code`、`requestId` 及安全扩展属性，并递归处理 `cause`。
- 循环引用输出 `[Circular]`，BigInt 转字符串，序列化异常安全降级，保证结果可被 JSON 序列化。
- 扩充 Task 1 测试，逐项验证六字段契约、action label、severity、rawDetails、凭证不泄漏和循环引用。
- 未修改 ROI 业务口径，未引入依赖。

## TDD 记录

1. 先扩充 `test/ui-errors.test.js`。
2. 初次执行失败：Authorization Bearer 真实凭证仍残留（断言 `redacts bearer-real-credential` 失败）。
3. 完成递归序列化及字符串/结构化凭证清洗后，任务测试通过。

## 测试结果

- `node test/ui-errors.test.js`：通过。
- `node test/errors.test.js`：21 通过，0 失败。
- `node --check lib/ui-errors.js`：通过。
- `node --check test/ui-errors.test.js`：通过。
- `node --test test/*.test.js`：完整 JS 回归通过（49 个测试文件全部通过）。

## 文件权限

以下新增/相关非脚本文件均设为 `100644`：

- `lib/ui-errors.js`
- `test/ui-errors.test.js`
- `.superpowers/sdd/task-1-fix-report.md`
