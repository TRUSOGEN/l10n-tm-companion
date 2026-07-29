/** Side Panel 响应式授权卡与批量审阅界面契约测试。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'popup.css'), 'utf8');

assert(html.includes('id="btn-confirm-remaining"'), '结果页必须提供批量确认剩余项入口');
assert(source.includes("getElementById('btn-confirm-remaining').addEventListener"), '批量确认按钮必须绑定真实处理函数');
assert(source.includes('async function confirmRemainingReviewItems'), 'Popup 必须实现批量 Final TM 与写回事务');

assert(source.includes('class="focus-disclosure focus-tm-disclosure"'), 'Top-3 TM 必须可折叠');
assert(source.includes('class="focus-disclosure focus-ai-disclosure"'), 'AI 候选必须可折叠');
assert(source.includes('rows="6"'), 'Final copy 必须提供足够的初始可读高度');
assert(source.includes('autoSizeTextarea(manual)'), 'Final copy 必须根据内容自动伸缩');

assert(source.includes('class="score-rail"'), '结果卡必须显示 A/B/C 分阶段得分轨道');
assert(source.includes('score-arrow'), '结果卡必须显示阶段箭头');
assert(source.includes('scoreDelta(snapshot.score, baseline)'), 'Post-TM 和 Final TM 必须显示相对 Score A 的变化');
assert(source.includes('reviewStatusTag(reviewStatus)'), 'draft/dirty/confirmed 必须渲染为状态标签');
assert(html.includes('id="review-filter-all"')
  && html.includes('id="review-filter-improved"'), 'Review 顶部必须提供 All / Improved 双选筛选');
assert(source.includes("filterReviewItems(items, reviewFilter)"), '结果渲染必须使用统一的 Review 筛选函数');
assert(source.includes("getElementById('review-filter-improved').addEventListener"), 'Improved 筛选必须绑定真实交互');
assert(styles.includes('.review-filter-option[aria-pressed="true"]'), '当前筛选必须具有清晰的选中状态');

assert(styles.includes('@media (max-width: 420px)'), '授权卡必须定义窄屏响应式布局');
assert(styles.includes('.feishu-auth-card .btn')
  && styles.includes('grid-column: 1 / -1')
  && styles.includes('width: 100%'), '窄屏 Authorize 按钮必须独占整行并填满可用宽度');
assert(styles.includes('.focus-manual')
  && styles.includes('min-height: 132px')
  && styles.includes('resize: vertical'), 'Final copy 必须可读且允许人工调整高度');
assert(styles.includes('.score-stage.tm')
  && styles.includes('.score-stage.post')
  && styles.includes('.score-stage.final'), 'TM、Post-TM、Final TM 必须使用可区分的阶段样式');

console.log('popup responsive review UI tests: 20 passed, 0 failed');
