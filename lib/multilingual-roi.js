/**
 * 多语言整车 ROI 汇总。
 *
 * 本模块接收按“项目 × 目标语言”拆分的运行结果，逐条汇总可计算的 A-C ROI。
 * 任一文案缺少费率、TM 快照或金额时，对应 scope 保留原因并使总状态为 incomplete；
 * 其余完整文案继续进入 subtotal，避免因为局部失败丢掉所有可审计金额。
 */

import { resolveWordRate } from './pricing-rules.js';
import { calculateRoiForItem } from './roi-calculation.js';

const ROI_AMOUNT_FIELDS = Object.freeze([
  'fullTranslationBaselineCost',
  'estimatedCostBefore',
  'estimatedCostAfter',
  'estimatedSaving',
]);

// `resolveWordRate()` 在该 vendor 的费率目录中完全找不到语言对时使用的原因码。
const VENDOR_UNSERVED_LOCALE_REASON = 'missing_language_pair';

function resolveIncompleteReason(roi) {
  if (roi?.status !== 'complete') return roi?.reason || 'roi_unavailable';
  return ROI_AMOUNT_FIELDS.every((field) => Number.isFinite(roi[field]))
    ? ''
    : 'roi_amount_invalid';
}

function collectIncompleteReasons(items) {
  return [...new Set(items
    .map((item) => resolveIncompleteReason(item?.roi))
    .filter(Boolean))];
}

function sumRoiField(items, field) {
  return items.reduce((total, item) => total + item.roi[field], 0);
}

/**
 * 按 source 条目计算 A、有效 AI 与已确认人工阶段的 85% 漏斗。
 *
 * AI 阶段只有通过全部安全门禁的候选才能替换 A；Review 指标只在同一批已确认
 * 样本中比较 A 与 C，未确认条目不进入人工阶段分母。
 */
export function buildRoiFunnelMetrics(items = []) {
  const metrics = {
    pretranslationAt85: 0,
    afterAiAt85: 0,
    aiUpliftTo85: 0,
    cdReviewedSegments: 0,
    afterReviewAt85: 0,
    reviewUpliftTo85: 0,
  };
  (Array.isArray(items) ? items : []).forEach((item) => {
    const scoreA = Number(item?.similarity);
    const aAt85 = Number.isFinite(scoreA) && scoreA >= 85;
    if (aAt85) metrics.pretranslationAt85 += 1;

    const validCandidate = item?.ai_quality?.validCandidates?.[0];
    const scoreB = validCandidate?.post_rewrite_tm?.status === 'complete'
      ? Number(validCandidate.post_rewrite_tm.score)
      : NaN;
    const afterAiScore = Number.isFinite(scoreB) && scoreB > scoreA ? scoreB : scoreA;
    if (Number.isFinite(afterAiScore) && afterAiScore >= 85) metrics.afterAiAt85 += 1;
    if (!aAt85 && Number.isFinite(scoreB) && scoreB >= 85 && scoreB > scoreA) {
      metrics.aiUpliftTo85 += 1;
    }

    const confirmed = item?.review_status === 'confirmed'
      || item?.review?.status === 'confirmed';
    if (!confirmed) return;
    metrics.cdReviewedSegments += 1;
    const finalTm = item?.final_tm || item?.review?.finalTm;
    const scoreC = finalTm?.status === 'complete' ? Number(finalTm.score) : NaN;
    if (Number.isFinite(scoreC) && scoreC >= 85) {
      metrics.afterReviewAt85 += 1;
      if (!aAt85) metrics.reviewUpliftTo85 += 1;
    }
  });
  return metrics;
}

/**
 * 汇总多项目、多目标语言的 ROI 金额。
 *
 * subtotal 按条目汇总所有可计算金额；scope 是否 complete 仍要求其全部条目完整。
 * 因此调用方可以同时展示已覆盖条目小计、完整语言数量和失败原因。无 LLM 的条目仍由
 * 单条 ROI 层产出 complete 结果，改写前后相同的成本自然汇总为零节省。
 *
 * @param {Array<{scope: {key: string}, items: Array<{roi: object}>}>} scopeRuns 逐 scope 运行结果。
 * @returns {{status: string, selectedScopeCount: number, completeScopeCount: number, coveredSegmentCount: number, subtotalFullTranslation: number, subtotalBefore: number, subtotalAfter: number, subtotalSaving: number, incompleteScopes: Array<{key: string, reasons: string[]}>}} 可审计的整车 ROI 汇总。
 */
export function summarizeMultilingualRoi(scopeRuns = []) {
  const completeScopeRuns = [];
  const coveredItems = [];
  const incompleteScopes = [];

  for (const { scope, items = [] } of scopeRuns) {
    const reasons = collectIncompleteReasons(items);
    coveredItems.push(...items.filter((item) => !resolveIncompleteReason(item?.roi)));
    if (reasons.length > 0) {
      incompleteScopes.push({ key: scope.key, reasons });
      continue;
    }
    completeScopeRuns.push({ scope, items });
  }

  return {
    status: incompleteScopes.length > 0 ? 'incomplete' : 'complete',
    selectedScopeCount: scopeRuns.length,
    completeScopeCount: completeScopeRuns.length,
    coveredSegmentCount: coveredItems.length,
    subtotalFullTranslation: sumRoiField(coveredItems, 'fullTranslationBaselineCost'),
    subtotalBefore: sumRoiField(coveredItems, 'estimatedCostBefore'),
    subtotalAfter: sumRoiField(coveredItems, 'estimatedCostAfter'),
    subtotalSaving: sumRoiField(coveredItems, 'estimatedSaving'),
    incompleteScopes,
  };
}

/**
 * 从一份已完成的 Starling A/B/C TM 快照派生多个 vendor 的 ROI 结果。
 *
 * TM 查询结果只读且与供应商无关；每个 vendor 仅替换其费率与 item.roi，确保
 * 双 vendor 报表不会创建额外 Starling 请求。禁止借用其他 vendor 价格。
 *
 * 费率目录中各 vendor 的语言覆盖互斥（例如 RWS 只有欧语系、Pactera 只有亚洲与
 * 中东语言）。某 vendor 完全不服务某目标语言时，该语言记入 `unservedScopes` 并
 * 路由给其他 vendor，不再计入本 vendor 的 coverage，避免整车 Run 被必然缺失的
 * 语言判成 incomplete。服务该语言但缺少按字费率（例如只有 hourly rate）仍保留
 * incomplete，因为那是真实的费率缺口。
 */
export function deriveVendorRoiResults(scopeRuns = [], catalog, vendors = []) {
  const inputScopeRuns = Array.isArray(scopeRuns) ? scopeRuns : [];
  return Object.fromEntries((Array.isArray(vendors) ? vendors : []).map((vendor) => {
    const vendorScopeRuns = [];
    const unservedScopes = [];
    for (const scopeRun of inputScopeRuns) {
      const scope = scopeRun?.scope || {};
      const rate = resolveWordRate(catalog, {
        vendor,
        sourceLang: scope.sourceLocale,
        targetLang: scope.targetLocale,
      });
      if (rate.status !== 'ready' && rate.reason === VENDOR_UNSERVED_LOCALE_REASON) {
        unservedScopes.push({ key: scope.key, targetLocale: scope.targetLocale || '' });
        continue;
      }
      vendorScopeRuns.push({
        ...scopeRun,
        rate,
        items: (scopeRun?.items || []).map((item) => {
          const formalItem = item?.review_status === 'confirmed'
            ? item
            : { ...item, final_source_text: '' };
          return {
            ...item,
            roi: calculateRoiForItem(formalItem, rate),
          };
        }),
      });
    }
    return [vendor, {
      vendor,
      scopeRuns: vendorScopeRuns,
      unservedScopes,
      requestedScopeCount: inputScopeRuns.length,
      summary: summarizeMultilingualRoi(vendorScopeRuns),
    }];
  }));
}
