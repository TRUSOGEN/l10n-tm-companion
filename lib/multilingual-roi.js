/**
 * 多语言整车 ROI 汇总。
 *
 * 本模块接收按“项目 × 目标语言”拆分的运行结果，逐条汇总可计算的 A-C ROI。
 * 任一文案缺少费率、TM 快照或金额时，对应 scope 保留原因并使总状态为 incomplete；
 * 其余完整文案继续进入 subtotal，避免因为局部失败丢掉所有可审计金额。
 */

const ROI_AMOUNT_FIELDS = Object.freeze([
  'fullTranslationBaselineCost',
  'estimatedCostBefore',
  'estimatedCostAfter',
  'estimatedSaving',
]);

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
