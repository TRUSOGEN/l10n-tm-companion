/**
 * ROI 金额计算。
 *
 * 本模块以原文或 AI rewrite 的英文文本在浏览器端计词，再结合 Starling TM 返回的
 * score 计算 TM 加权字数和金额。完整翻译基线使用 AIPE 单价；Starling 未分类的 100%
 * 命中按已确认的保守 20% T-only 规则估算。
 */

export const AIPE_MAX_SCORE = 75;

const EXACT_MATCH_DISCOUNTS = Object.freeze({
  ice: 0,
  repetition: 0.2,
  exact_no_review: 0,
  exact_review: 0.1,
});

// Starling Batch TM 当前只返回 score，未返回 100% 命中的计费分类。
// 经业务确认，缺分类的 100% 命中统一按已知最高的 20% T-only 成本做保守预估。
const UNCLASSIFIED_EXACT_MATCH_DISCOUNT = 0.2;

function incomplete(reason, details = {}) {
  return {
    status: 'incomplete',
    reason,
    estimatedCostBefore: null,
    estimatedCostAfter: null,
    estimatedSaving: null,
    ...details,
  };
}

function normalizeMatchCategory(value) {
  const category = String(value ?? '').trim().toLowerCase();
  return Object.hasOwn(EXACT_MATCH_DISCOUNTS, category) ? category : '';
}

/**
 * 按浏览器的英文分词规则统计可计费词数。
 *
 * 源文案当前是 English-to-English rewrite，因此 `Intl.Segmenter('en')` 的
 * word-like segment 与本地可审计的英文词数定义一致；空文本或不含英文词时返回 null。
 */
export function countLocalEnglishWords(text) {
  const source = typeof text === 'string' ? text.trim() : '';
  if (!source) return null;
  const segments = new Intl.Segmenter('en', { granularity: 'word' }).segment(source);
  const count = Array.from(segments).filter((segment) => segment.isWordLike).length;
  return count > 0 ? count : null;
}

/**
 * 解析 score 对应的计费率与加权系数。
 *
 * 边界遵循已确认的表格：0–75（含 75）走 AIPE；(75, 85] 为 60%；
 * (85, 95] 为 40%；(95, 99] 为 20%。100% 只能由明确的命中分类判定。
 */
export function resolveTmPricing(score, matchCategory) {
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    return { reason: 'tm_score_invalid' };
  }
  if (score === 100) {
    const category = normalizeMatchCategory(matchCategory);
    if (!category) {
      return {
        rateType: 't_only',
        discount: UNCLASSIFIED_EXACT_MATCH_DISCOUNT,
        matchCategory: 'exact_unclassified_conservative',
      };
    }
    return {
      rateType: 't_only',
      discount: EXACT_MATCH_DISCOUNTS[category],
      matchCategory: category,
    };
  }
  if (score > 95) return { rateType: 't_only', discount: 0.2, matchCategory: '95_99' };
  if (score > 85) return { rateType: 't_only', discount: 0.4, matchCategory: '85_95' };
  if (score > AIPE_MAX_SCORE) return { rateType: 't_only', discount: 0.6, matchCategory: '75_85' };
  return { rateType: 'aipe', discount: 1, matchCategory: '0_75' };
}

function resolveCost(snapshot, rate, prefix) {
  const pricing = resolveTmPricing(snapshot.score, snapshot.matchCategory);
  if (pricing.reason) return { reason: `${prefix}_${pricing.reason}` };
  const actualWordCount = countLocalEnglishWords(snapshot.sourceText);
  if (actualWordCount == null) return { reason: `${prefix}_local_word_count_missing` };
  const weightedWordCount = actualWordCount * pricing.discount;
  const cost = pricing.rateType === 'aipe'
    ? actualWordCount * rate.aipeUsdPerWord
    : weightedWordCount * rate.tOnlyUsdPerWord;
  return {
    cost,
    actualWordCount,
    weightedWordCount,
    discountPercent: pricing.discount * 100,
    pricingMethod: pricing.rateType === 'aipe' ? 'aipe_actual_words' : 't_only_discounted_words',
    matchCategory: pricing.matchCategory,
  };
}

/**
 * 计算不使用 TM 时的整段翻译基线成本。
 *
 * 当前估算口径以完整英文词数乘 AIPE 单价，作为用户所说“这一车原本要花多少钱”的
 * 可审计基线；TM 成本再按 Starling 返回的实际 score 单独计算。
 */
function resolveFullTranslationBaseline(sourceText, rate) {
  const actualWordCount = countLocalEnglishWords(sourceText);
  if (actualWordCount == null) return { reason: 'baseline_local_word_count_missing' };
  return {
    cost: actualWordCount * rate.aipeUsdPerWord,
    actualWordCount,
    weightedWordCount: actualWordCount,
    discountPercent: 100,
    pricingMethod: 'aipe_full_translation_baseline',
    matchCategory: 'full_translation_baseline',
  };
}

function resolvePostRewriteSnapshot(item, original) {
  const snapshot = item?.post_rewrite_tm;
  if (snapshot?.status === 'complete') {
    return Number.isFinite(snapshot.score)
      ? {
        score: snapshot.score,
        matchCategory: snapshot.match_category,
        sourceText: item?.ai_translation,
        source: 'post_rewrite_starling_tm',
      }
      : { reason: 'post_rewrite_tm_score_invalid' };
  }
  if (snapshot?.status === 'incomplete') return { reason: 'post_rewrite_tm_incomplete' };
  if (snapshot?.status === 'not_required') {
    return { ...original, source: 'original_snapshot_no_rewrite' };
  }
  return { reason: 'post_rewrite_tm_missing' };
}

/**
 * 解析 CD 最终确认文案的第三次真实 TM 快照。
 *
 * `final_source_text` 是 Spreadsheet 中由 CD 确认或编辑后的 C 版本；它是唯一可用于
 * 正式 ROI 的送翻文本。B（AI rewrite）只用于帮助 CD 生成 C，不能代替 C 结算。
 */
function resolveFinalSnapshot(item) {
  const sourceText = typeof item?.final_source_text === 'string'
    ? item.final_source_text.trim()
    : '';
  const snapshot = item?.final_tm;
  if (!sourceText) return { reason: 'final_source_text_missing' };
  if (snapshot?.status === 'complete') {
    return Number.isFinite(snapshot.score)
      ? {
        score: snapshot.score,
        matchCategory: snapshot.match_category,
        sourceText,
        source: 'final_starling_tm',
      }
      : { reason: 'final_tm_score_invalid' };
  }
  if (snapshot?.status === 'incomplete') return { reason: 'final_tm_incomplete' };
  return { reason: 'final_tm_missing' };
}

function hasFinalDecision(item) {
  return Object.hasOwn(item || {}, 'final_source_text') || Object.hasOwn(item || {}, 'final_tm');
}

/**
 * 计算单条文案的完整翻译基线、TM 预估成本和节省金额。
 *
 * 本地词数与折扣规则用于预估，不等同于尚未开放的 Elasticsearch 结算字段；逐行金额
 * 保留完整精度，只有汇总层可以执行最终向上取整。开启 AI 时，TM 成本使用 rewrite 的
 * 二次 Starling 快照；关闭 AI 时使用首轮快照。
 *
 * @param {object} item 包含首轮与改写后 Starling TM 快照的运行条目。
 * @param {object} rate `resolveWordRate()` 返回的 ready 费率。
 * @returns {object} complete 金额或可审计的 incomplete 原因。
 */
export function calculateRoiForItem(item, rate) {
  if (rate?.status !== 'ready'
      || !Number.isFinite(rate.aipeUsdPerWord)
      || !Number.isFinite(rate.tOnlyUsdPerWord)) {
    return incomplete(`rate_${rate?.reason || 'unavailable'}`);
  }

  const original = {
    score: Number(item?.similarity),
    matchCategory: item?.match_category,
    sourceText: item?.source_text,
  };
  const before = resolveFullTranslationBaseline(item?.source_text, rate);
  if (before.reason) return incomplete(before.reason, { originalScore: original.score });

  // C 是 CD 最终确认、实际送翻的文案。只要调用方已经进入最终确认阶段，正式 ROI
  // 就严格要求真实的 final TM；不得回退到 B 或完整翻译基线伪造最终节省。
  if (hasFinalDecision(item)) {
    const tmBefore = resolveCost(original, rate, 'original_tm');
    if (tmBefore.reason) return incomplete(tmBefore.reason, {
      originalScore: original.score,
      fullTranslationBaselineCost: before.cost,
      tmCostBeforeOptimization: null,
      tmCostAfterOptimization: null,
      aiOptimizationSaving: null,
    });
    const final = resolveFinalSnapshot(item);
    if (final.reason) return incomplete(final.reason, {
      originalScore: original.score,
      fullTranslationBaselineCost: before.cost,
      tmCostBeforeOptimization: tmBefore.cost,
      tmCostAfterOptimization: null,
      aiOptimizationSaving: null,
    });
    const tmAfter = resolveCost(final, rate, 'final_tm');
    if (tmAfter.reason) return incomplete(tmAfter.reason, {
      originalScore: original.score,
      finalScore: final.score,
      fullTranslationBaselineCost: before.cost,
      tmCostBeforeOptimization: tmBefore.cost,
      tmCostAfterOptimization: null,
      aiOptimizationSaving: null,
    });
    const aiOptimizationSaving = tmBefore.cost - tmAfter.cost;
    return {
      status: 'complete',
      reason: '',
      currency: rate.currency || 'USD',
      calculationBasis: 'local_english_word_count',
      originalScore: original.score,
      finalScore: final.score,
      finalScoreSource: final.source,
      fullTranslationBaselineCost: before.cost,
      tmCostBeforeOptimization: tmBefore.cost,
      tmCostAfterOptimization: tmAfter.cost,
      aiOptimizationSaving,
      originalPricingMethod: tmBefore.pricingMethod,
      finalPricingMethod: tmAfter.pricingMethod,
      originalActualWordCount: tmBefore.actualWordCount,
      originalWeightedWordCount: tmBefore.weightedWordCount,
      originalDiscountPercent: tmBefore.discountPercent,
      originalMatchCategory: tmBefore.matchCategory,
      finalActualWordCount: tmAfter.actualWordCount,
      finalWeightedWordCount: tmAfter.weightedWordCount,
      finalDiscountPercent: tmAfter.discountPercent,
      finalMatchCategory: tmAfter.matchCategory,
      // 兼容旧汇总/归档调用方；后续 UI 与 Bitable 将只使用上面的具名正式字段。
      estimatedCostBefore: tmBefore.cost,
      estimatedCostAfter: tmAfter.cost,
      estimatedSaving: aiOptimizationSaving,
    };
  }

  const post = resolvePostRewriteSnapshot(item, original);
  if (post.reason) return incomplete(post.reason, {
    originalScore: original.score,
    originalActualWordCount: before.actualWordCount,
    originalWeightedWordCount: before.weightedWordCount,
    estimatedCostBefore: before.cost,
  });

  const after = resolveCost(post, rate, 'tm');
  if (after.reason) return incomplete(after.reason, {
    originalScore: original.score,
    originalActualWordCount: before.actualWordCount,
    originalWeightedWordCount: before.weightedWordCount,
    postRewriteScore: post.score,
    estimatedCostBefore: before.cost,
  });

  // 预览口径必须与正式 A-C 口径同源：改写前成本是 A 自己的 TM 成本，而不是完整翻译
  // 基线。用基线当改写前成本会把记忆库既有折扣算成 AI 的功劳，导致 A=B 也报正节省。
  const previewTmBefore = resolveCost(original, rate, 'original_tm');
  if (previewTmBefore.reason) return incomplete(previewTmBefore.reason, {
    originalScore: original.score,
    originalActualWordCount: before.actualWordCount,
    originalWeightedWordCount: before.weightedWordCount,
    postRewriteScore: post.score,
    fullTranslationBaselineCost: before.cost,
  });
  const previewSaving = previewTmBefore.cost - after.cost;

  return {
    status: 'complete',
    reason: '',
    currency: rate.currency || 'USD',
    calculationBasis: 'local_english_word_count',
    originalActualWordCount: before.actualWordCount,
    originalWeightedWordCount: previewTmBefore.weightedWordCount,
    originalDiscountPercent: previewTmBefore.discountPercent,
    originalMatchCategory: previewTmBefore.matchCategory,
    postRewriteActualWordCount: after.actualWordCount,
    postRewriteWeightedWordCount: after.weightedWordCount,
    postRewriteDiscountPercent: after.discountPercent,
    postRewriteMatchCategory: after.matchCategory,
    originalScore: original.score,
    postRewriteScore: post.score,
    postRewriteScoreSource: post.source,
    beforePricingMethod: previewTmBefore.pricingMethod,
    afterPricingMethod: after.pricingMethod,
    // 完整翻译基线只作为参考展示，绝不参与节省口径。
    fullTranslationBaselineCost: before.cost,
    fullTranslationPricingMethod: before.pricingMethod,
    tmCostBeforeOptimization: previewTmBefore.cost,
    tmCostAfterOptimization: after.cost,
    aiOptimizationSaving: previewSaving,
    // 兼容旧汇总/归档调用方；口径与上面的具名字段完全一致。
    estimatedCostBefore: previewTmBefore.cost,
    estimatedCostAfter: after.cost,
    estimatedSaving: previewSaving,
  };
}
