// ROI 计算回归：本地按英文 source 计词，严格执行已确认的 TM 折扣表。
import { calculateRoiForItem } from '../lib/roi-calculation.js';

let passed = 0;
let failed = 0;

function assert(name, condition) {
  if (condition) {
    passed += 1;
    console.log(`  PASS ${name}`);
    return;
  }
  failed += 1;
  console.log(`  FAIL ${name}`);
}

const rate = {
  status: 'ready',
  currency: 'USD',
  aipeUsdPerWord: 0.04,
  tOnlyUsdPerWord: 0.02,
};

console.log('\n=== roi-calculation: 全量 AIPE 基线与 TM 匹配成本 ===');
{
  const result = calculateRoiForItem({
    source_text: 'One two three four five six seven eight nine ten',
    similarity: 97,
    post_rewrite_tm: { status: 'not_required' },
  }, rate);
  assert('97% 状态为 complete', result.status === 'complete');
  assert('97% 的全量基线字数为 10', result.originalActualWordCount === 10);
  assert('97% 的 TM 加权字数为 2', result.postRewriteWeightedWordCount === 2);
  assert('97% 按字数×20%×T-only 估算 TM 成本', Math.abs(result.estimatedCostAfter - 0.04) < 1e-12);
  assert('97% 的改写前成本为 A 自己的 TM 成本', Math.abs(result.estimatedCostBefore - 0.04) < 1e-12);
  assert('97% 未改写时不产生 AI 节省', Math.abs(result.estimatedSaving) < 1e-12);
  assert('97% 的完整 AIPE 基线单独保留为参考', Math.abs(result.fullTranslationBaselineCost - 0.4) < 1e-12);
}

console.log('\n=== roi-calculation: 85%、75% 与 100% 的边界 ===');
{
  const exact85 = calculateRoiForItem({
    source_text: 'One two three four five six seven eight nine ten',
    similarity: 85,
    post_rewrite_tm: { status: 'not_required' },
  }, rate);
  assert('85% 按 60% T-only 估算 TM 成本', Math.abs(exact85.estimatedCostAfter - 0.12) < 1e-12);
  assert('85% 的 TM 加权字数为 6', exact85.postRewriteWeightedWordCount === 6);

  const exact75 = calculateRoiForItem({
    source_text: 'One two three four five six seven eight nine ten',
    similarity: 75,
    post_rewrite_tm: { status: 'not_required' },
  }, rate);
  assert('75% 按实际字数与 AIPE 估算 TM 成本', Math.abs(exact75.estimatedCostAfter - 0.4) < 1e-12);
  assert('75% 不产生 TM 节省', Math.abs(exact75.estimatedSaving) < 1e-12);

  const unclassifiedExact = calculateRoiForItem({
    source_text: 'One two three four five six seven eight nine ten',
    similarity: 100,
    post_rewrite_tm: { status: 'not_required' },
  }, rate);
  assert('100% 缺分类按保守的 20% T-only 估算', unclassifiedExact.status === 'complete'
    && Math.abs(unclassifiedExact.estimatedCostAfter - 0.04) < 1e-12);
  assert('100% 缺分类的改写前成本同样按 A 的 TM 成本', Math.abs(unclassifiedExact.estimatedCostBefore - 0.04) < 1e-12
    && Math.abs(unclassifiedExact.fullTranslationBaselineCost - 0.4) < 1e-12
    && Math.abs(unclassifiedExact.estimatedSaving) < 1e-12);

  const checkedExact = calculateRoiForItem({
    source_text: 'One two three four five six seven eight nine ten',
    similarity: 100,
    match_category: 'exact_review',
    post_rewrite_tm: { status: 'not_required' },
  }, rate);
  assert('100% 需检查按 10% T-only 估算 TM 成本', Math.abs(checkedExact.estimatedCostAfter - 0.02) < 1e-12);
}

console.log('\n=== roi-calculation: 改写后快照与失败语义 ===');
{
  const rewritten = calculateRoiForItem({
    source_text: 'One two three four five six seven eight nine ten',
    similarity: 80,
    ai_translation: 'One two three four five six seven eight nine ten eleven twelve',
    post_rewrite_tm: { status: 'complete', score: 97 },
  }, rate);
  assert('改写前成本为 A 的 TM 成本', Math.abs(rewritten.estimatedCostBefore - 0.12) < 1e-12);
  assert('完整 AIPE 基线单独保留为参考', Math.abs(rewritten.fullTranslationBaselineCost - 0.4) < 1e-12);
  assert('改写后按改写文本重新计词', rewritten.postRewriteActualWordCount === 12);
  assert('改写后 97% 按 20% T-only', Math.abs(rewritten.estimatedCostAfter - 0.048) < 1e-12);
  assert('节省为 A 的 TM 成本减改写后 TM 成本', Math.abs(rewritten.estimatedSaving - 0.072) < 1e-12);

  const failedSnapshot = calculateRoiForItem({
    source_text: 'One two three four five six seven eight nine ten',
    similarity: 80,
    post_rewrite_tm: { status: 'incomplete', error: 'HTTP 1204' },
  }, rate);
  assert('改写后 TM 失败不伪造金额', failedSnapshot.status === 'incomplete'
    && failedSnapshot.reason === 'post_rewrite_tm_incomplete'
    && failedSnapshot.estimatedCostAfter === null);
}

console.log('\n=== roi-calculation: A 到最终 C 的正式 ROI ===');
{
  const result = calculateRoiForItem({
    source_text: 'One two three four five six seven eight nine ten',
    similarity: 97,
    ai_translation: 'One two three four five six seven eight nine ten eleven twelve',
    post_rewrite_tm: { status: 'complete', score: 100 },
    final_source_text: 'One two three four five six seven eight nine ten',
    final_tm: { status: 'complete', score: 97 },
  }, rate);
  assert('最终 ROI 使用 A 的 TM 成本，不使用全量翻译基线', Math.abs(result.tmCostBeforeOptimization - 0.04) < 1e-12);
  assert('最终 ROI 使用 C 的最终 TM 成本', Math.abs(result.tmCostAfterOptimization - 0.04) < 1e-12);
  assert('A 与 C 等价时最终 AI 节省为零', Math.abs(result.aiOptimizationSaving) < 1e-12);
  assert('全量翻译成本仅保留参考字段', Math.abs(result.fullTranslationBaselineCost - 0.4) < 1e-12);
  assert('A 与 C 均保留 Bitable 公式所需的计费方法', result.originalPricingMethod === 't_only_discounted_words'
    && result.finalPricingMethod === 't_only_discounted_words');
}

console.log('\n=== roi-calculation: 预览口径与正式口径一致（A-B，而非全量基线-B）===');
{
  const text = 'One two three four five six seven eight nine ten';

  const noUplift = calculateRoiForItem({
    source_text: text,
    similarity: 90,
    ai_translation: text,
    post_rewrite_tm: { status: 'complete', score: 90 },
  }, rate);
  assert('A=B 时预览状态为 complete', noUplift.status === 'complete');
  assert('A=B 时预览节省恰好为零', Math.abs(noUplift.estimatedSaving) < 1e-12);
  assert('A=B 时预览改写前成本为 A 的 TM 成本，不是全量基线',
    Math.abs(noUplift.estimatedCostBefore - noUplift.estimatedCostAfter) < 1e-12
    && Math.abs(noUplift.estimatedCostBefore - 0.08) < 1e-12);
  assert('预览仍单独保留全量翻译基线作为参考字段',
    Math.abs(noUplift.fullTranslationBaselineCost - 0.4) < 1e-12);
  assert('预览提供与正式口径同名的 A/B 成本字段',
    Math.abs(noUplift.tmCostBeforeOptimization - 0.08) < 1e-12
    && Math.abs(noUplift.tmCostAfterOptimization - 0.08) < 1e-12
    && Math.abs(noUplift.aiOptimizationSaving) < 1e-12);

  const regression = calculateRoiForItem({
    source_text: text,
    similarity: 97,
    ai_translation: text,
    post_rewrite_tm: { status: 'complete', score: 80 },
  }, rate);
  assert('AI 改低时预览状态为 complete', regression.status === 'complete');
  assert('AI 把命中率改低时预览节省为负数', regression.estimatedSaving < 0);
  assert('AI 改低时预览负值等于 A 的 TM 成本减 B 的 TM 成本',
    Math.abs(regression.estimatedSaving - (0.04 - 0.12)) < 1e-12);

  const uplift = calculateRoiForItem({
    source_text: text,
    similarity: 70,
    ai_translation: text,
    post_rewrite_tm: { status: 'complete', score: 97 },
  }, rate);
  assert('AI 提升时预览状态为 complete', uplift.status === 'complete');
  assert('AI 真实提升时预览节省为正数', uplift.estimatedSaving > 0);
  assert('AI 提升时预览正值等于 A 的 TM 成本减 B 的 TM 成本',
    Math.abs(uplift.estimatedSaving - (0.4 - 0.04)) < 1e-12);

  const aiOff = calculateRoiForItem({
    source_text: text,
    similarity: 97,
    post_rewrite_tm: { status: 'not_required' },
  }, rate);
  assert('未启用 AI 改写时预览状态为 complete', aiOff.status === 'complete');
  assert('未启用 AI 改写时预览节省为零（改写前后同一文案）',
    Math.abs(aiOff.estimatedSaving) < 1e-12);
  assert('未启用 AI 改写时全量基线仍可参考',
    Math.abs(aiOff.fullTranslationBaselineCost - 0.4) < 1e-12);
}

console.log(`\nroi-calculation 测试: ${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
