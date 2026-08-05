# Task 6 报告：Visual tokens、motion 与 a11y

## 设计计划（编码前）

**产品与单一任务**：面向本地化运营/审核者的紧凑审计控制台；让用户快速读懂 A（原始）→ B（AI 辅助）→ C（确认最终）、归档运行状态与下一步动作。

### Token

核心 6 色：

- Canvas `#F6F7F9`
- Surface `#FFFFFF`
- Text primary `#172033`
- Text secondary `#667085`
- Primary `#3366FF`
- AI `#6558D9`

状态语义沿用已批准值：Confirmed `#14805E`、Warning `#A15C00`、Error `#C9362B`。组件只消费 semantic token/兼容 alias，不自行发明品牌色。

### 字体角色

- Display / section：系统 UI 字体 600–700，用于步骤与审计结论。
- Body：系统 UI 字体 400–500，用于说明与操作。
- Utility / data：系统等宽字体，用于 locale、key、数值；启用 tabular figures。
- 扩展保持离线，不加载 Google Font 或新依赖。

### Layout wireframe

```text
┌ Header · Workflow | Review ┐
├ A ─────→ B ─────→ C        ┤  审计轨道
├ 状态 / vendor / archive    ┤
├ 可筛选 Review cards        ┤
│ card 1                     │
│ card 2                     │
│ …（>50 时每帧 ≤25）        │
├ sticky next action         ┤
└ progress / dialog / Focus  ┘
```

### Signature

唯一 signature 是有文字标签和状态边框的 **A→B→C 审计轨道**，以及不回退的归档进度；不加入无关插画、渐变或环境动画。

## 自我批评与修正

初始 data-dense dashboard 建议容易滑向通用 KPI 卡片、过多 hover 动画和外部 dashboard 字体。该方向与 Side Panel 的单一审计任务不匹配。修正为：保留系统字体、减少装饰性动效；把视觉辨识度集中到 A/B/C 轨道；保留 Workflow/Review、四步 Stepper 和 sticky action；通过紧凑间距、文字状态与统一 focus 提升效率，而不是增加组件数量。375px 下把项目、Sheet 和 archive summary 降为单列，避免横向滚动。

## TDD 记录

### RED

先新增 `test/side-panel-accessibility.test.js`，验证批准 token、统一 focus、44px、motion 时长、reduced motion、375px、dialog/live/progress DOM 契约，以及 >50 项每帧最多 25 的调度契约。首次运行按预期失败：semantic token 均未定义；同期 compact/responsive 基线测试通过。

### GREEN / 实现

- 在 `popup.css` 建立 semantic color、4/8 spacing、radius、focus、44px 与 motion token；主要旧 alias 指向 semantic token。
- 容器与卡片补 `min-width: 0`，根容器禁止横向溢出；375px 关键 grid 单列。
- Step 150ms、card/progress 180ms、Focus 200ms；只使用 opacity/transform；confirmed 单次高亮，无 infinite/blink；reduced-motion 降至 `.01ms`。
- Focus View 补 dialog 语义、label、初始焦点、Tab trap、Escape 与关闭后焦点归还。
- Results 补 `aria-live` / `aria-busy`；现有 archive dialog/live/progressbar 保持。
- `renderResults` 继续复用 `filterReviewItems`；先按过滤顺序构建 card 数组，超过 50 项后通过 `requestAnimationFrame` 每批 25 项追加；generation 防止旧批次污染新 filter；结束后恢复原 card action 焦点。
- 归档进度从 layout width 更新改为 `scaleX()`，继续消费纯模型保证 percent 不回退。
- `options.css` 同步 canvas/surface/text/primary、focus、radius 和 44px 控件契约。
- 未修改 A-C 金额、B 辅助、Final TM、vendor、Broker、Run ID 或归档业务口径。

## 验证结果

- 计划四测试：通过
  - `node test/side-panel-accessibility.test.js`
  - `node test/popup-compact-workflow.test.js`
  - `node test/popup-responsive-review-ui.test.js`
  - `node test/side-panel-i18n.test.js`
- 全部 JS 测试：57/57 文件通过。
- 全部 tracked JS `node --check`：95/95 文件通过。
- `scripts/run-full-regression.sh`：JS、顶层 Python、JS syntax、Native Host compile 全部通过；Backend pytest 阶段因环境缺少 pytest 失败。
- Backend 原始环境错误：`/root/.venv_python3.11/bin/python3: No module named pytest`。按计划未安装依赖，不记为通过。
- `standard-lint` 已运行但失败；输出包含 `popup.js` 既有 unused import / magic-number 等存量问题，未为 Task 6 扩大范围清理业务代码。
- `git diff --check`：提交前执行。

## Concerns

- 当前环境无法完成 Backend pytest，仅为工具依赖缺失；本任务不修改 backend。
- standard-lint 仍有仓库存量错误；Task 6 的完整 Node 测试与语法检查均通过。
- 未在本次自动化环境执行真实 Chrome Side Panel 的视觉截图对比；375px、ARIA、键盘与 reduced-motion 由 CSS/DOM/行为契约覆盖。
