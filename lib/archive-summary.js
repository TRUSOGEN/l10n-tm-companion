const nonNegativeInteger = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
};
const countOf = (value, fallback = 0) => (
  Array.isArray(value) ? value.length : nonNegativeInteger(value, fallback)
);

/**
 * Preserve the actual routing/rate outcome produced by deriveVendorRoiResults.
 *
 * TM and final completeness are derived from the real scope run items. A scope with no
 * observed snapshot stays `false`: unknown must never be reported as complete.
 */
export function buildVendorRoutes({ plannedScopes = [], vendorResults = {} } = {}) {
  const routes = [];
  const servedScopeKeys = new Set();
  Object.entries(vendorResults || {}).forEach(([vendor, result = {}]) => {
    (result.scopeRuns || []).forEach((run = {}) => {
      const scopeKey = run.scope?.key || '';
      servedScopeKeys.add(scopeKey);
      const items = Array.isArray(run.items) ? run.items : [];
      routes.push({
        vendor,
        scopeKey,
        served: true,
        completeRate: run.rate?.status === 'ready',
        completeTm: items.length > 0
          && items.every((item) => Number.isFinite(Number(item?.similarity))),
        completeFinal: items.length > 0
          && items.every((item) => item?.final_tm?.status === 'complete'
            && Number.isFinite(Number(item.final_tm.score))),
      });
    });
    (result.unservedScopes || []).forEach((scope = {}) => {
      routes.push({
        vendor,
        scopeKey: scope.key || '',
        served: false,
        completeRate: false,
        completeTm: false,
        completeFinal: false,
      });
    });
  });
  const emittedUnpriced = new Set();
  (Array.isArray(plannedScopes) ? plannedScopes : []).forEach((scope = {}) => {
    const scopeKey = scope.key || '';
    if (servedScopeKeys.has(scopeKey) || emittedUnpriced.has(scopeKey)) return;
    emittedUnpriced.add(scopeKey);
    routes.push({
      vendor: null,
      scopeKey,
      served: false,
      completeRate: false,
      completeTm: false,
      completeFinal: false,
    });
  });
  return routes;
}

/** Estimate the product's two official TM passes: A (original) and C (confirmed final). */
export function estimateTmRequests({ rowCount = 0, languageCount = 0, batchSize = 40 } = {}) {
  const rows = nonNegativeInteger(rowCount);
  const languages = nonNegativeInteger(languageCount);
  const size = Math.max(1, nonNegativeInteger(batchSize, 40));
  const requestsPerPass = rows === 0 || languages === 0 ? 0 : languages * Math.ceil(rows / size);
  return { original: requestsPerPass, final: requestsPerPass, total: requestsPerPass * 2 };
}

/** Distinguish normal vendor routing from incomplete work on a served scope. */
export function formatVendorCoverage(input = {}) {
  const routes = Array.isArray(input) ? input : (Array.isArray(input.routes) ? input.routes : []);
  const counts = { RWS: 0, Pactera: 0, unpriced: 0 };
  const served = new Set();
  const unserved = new Set();
  const incompleteScopes = new Set();
  routes.forEach((route = {}, index) => {
    const key = route.scopeKey || `__unkeyed_${index}`;
    if (route.served !== true) {
      unserved.add(key);
      return;
    }
    served.add(key);
    if (route.vendor === 'RWS' || route.vendor === 'Pactera') counts[route.vendor] += 1;
    const rateComplete = route.completeRate !== false && route.rateStatus !== 'missing';
    const tmComplete = route.completeTm !== false && route.tmStatus !== 'missing' && route.tmStatus !== 'incomplete';
    const finalComplete = route.completeFinal !== false && route.finalStatus !== 'missing' && route.finalStatus !== 'incomplete';
    if (!rateComplete || !tmComplete || !finalComplete) incompleteScopes.add(key);
  });
  counts.unpriced = [...unserved].filter((key) => !served.has(key)).length;
  const explanations = [
    `RWS serves ${counts.RWS} scope(s).`,
    `Pactera serves ${counts.Pactera} scope(s).`,
    `${counts.unpriced} scope(s) are unpriced and routed outside vendor pricing.`,
  ];
  return { counts, explanations, incomplete: incompleteScopes.size > 0, incompleteCount: incompleteScopes.size };
}

/** Build the confirmation model without touching DOM, runtime state, or money calculations. */
export function summarizeArchive(input = {}) {
  const sourceRowCount = countOf(input.sourceRows, countOf(input.sourceRowCount));
  const confirmedRowCount = countOf(input.confirmedRows, countOf(input.confirmedRowCount));
  const languageCount = countOf(input.languages, countOf(input.languageCount));
  const routes = Array.isArray(input.vendorRoutes) ? input.vendorRoutes : [];
  const coverage = formatVendorCoverage({ routes });
  const vendorCoverage = coverage.counts;
  const incompleteLanguageCount = coverage.incompleteCount;

  const estimatedTmRequests = estimateTmRequests({
    rowCount: sourceRowCount,
    languageCount,
    batchSize: input.batchSize ?? 40,
  });
  const secondsPerRequest = input.secondsPerRequest || {};
  const minPerRequest = Math.max(0, Number(secondsPerRequest.min) || 1);
  const maxPerRequest = Math.max(minPerRequest, Number(secondsPerRequest.max) || 3);

  return {
    sourceRowCount,
    confirmedRowCount,
    languageCount,
    vendorCoverage,
    unpricedLanguageCount: vendorCoverage.unpriced,
    incompleteLanguageCount,
    estimatedTmRequests,
    estimatedDuration: {
      minSeconds: Math.ceil(estimatedTmRequests.total * minPerRequest),
      maxSeconds: Math.ceil(estimatedTmRequests.total * maxPerRequest),
    },
  };
}
