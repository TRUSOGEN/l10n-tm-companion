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

const reviewView = fs.readFileSync(path.join(root, 'lib/review-presentation-view.js'), 'utf8');
assert(reviewView.includes("rail.className = 'score-rail'"), '共用 renderer 必须渲染 A/B/C 分阶段得分轨道');
assert(reviewView.includes('score-arrow'), '共用 renderer 必须显示阶段箭头');
assert(reviewView.includes('Math.round(score - baseline)'), 'B/C 必须显示相对 Score A 的变化');
assert(source.includes('buildReviewPresentation') && source.includes('createReviewPresentationElement'), 'Popup 必须真实导入并调用共用 A→B→C model 与 renderer');
assert(source.includes('function reviewPresentationForItem'), '卡片与 Focus 必须共用同一个 presentation model 构造函数');
assert((source.match(/reviewPresentationForItem\(item\)/g) || []).length >= 2, '结果卡与 Focus 必须都使用共用 model');
assert(!source.includes('function postRewriteTmBadge') && !source.includes('function finalTmBadge'), 'Popup 不得重复计算 A/B/C 展示口径');
assert(source.includes('formatVendorCoverage({ routes })'), 'vendor 覆盖必须来自真实双 vendor routes');
assert(!source.includes('renderMultilingualRoiSummary'), '禁止使用单个 vendor summary 渲染覆盖');
assert(source.includes('reviewStatusTag(reviewStatus)'), 'draft/dirty/confirmed 必须渲染为状态标签');
assert(source.includes("t(`reviewStatus${statusKey}`, uiLanguage)"), '审阅状态必须映射为用户动作，禁止直接显示内部枚举');
assert(!source.includes("const label = normalized.charAt(0).toUpperCase() + normalized.slice(1)"), '界面不得直接显示 Dirty 等内部状态名');
assert(html.includes('id="review-filter-all"')
  && html.includes('id="review-filter-improved"'), 'Review 顶部必须提供 All / AI rewritten 双选筛选');
assert(source.includes("filterReviewItems(items, reviewFilter)"), '结果渲染必须使用统一的 Review 筛选函数');
assert(source.includes("getElementById('review-filter-improved').addEventListener"), 'AI rewritten 筛选必须绑定真实交互');
assert(source.includes('getReviewableAiCandidates(item)'), 'Focus 必须展示安全且 Post-TM 完整的 AI 改写，不按分数是否提升隐藏候选');
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

console.log('popup responsive review UI tests: passed');
