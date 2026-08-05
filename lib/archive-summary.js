const nonNegativeInteger = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
};
const countOf = (value, fallback = 0) => (
  Array.isArray(value) ? value.length : nonNegativeInteger(value, fallback)
);

/** Preserve the actual routing/rate outcome produced by deriveVendorRoiResults. */
export function buildVendorRoutes({ plannedScopes = [], vendorResults = {} } = {}) {
  const routes = [];
  const servedScopeKeys = new Set();
  Object.entries(vendorResults || {}).forEach(([vendor, result = {}]) => {
    (result.scopeRuns || []).forEach((run = {}) => {
      const scopeKey = run.scope?.key || '';
      servedScopeKeys.add(scopeKey);
      routes.push({
        vendor,
        scopeKey,
        served: true,
        completeRate: run.rate?.status === 'ready',
      });
    });
    (result.unservedScopes || []).forEach((scope = {}) => {
      routes.push({ vendor, scopeKey: scope.key || '', served: false, completeRate: false });
    });
  });
  const emittedUnpriced = new Set();
  (Array.isArray(plannedScopes) ? plannedScopes : []).forEach((scope = {}) => {
    const scopeKey = scope.key || '';
    if (servedScopeKeys.has(scopeKey) || emittedUnpriced.has(scopeKey)) return;
    emittedUnpriced.add(scopeKey);
    routes.push({ vendor: null, scopeKey, served: false, completeRate: false });
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

/** Build the confirmation model without touching DOM, runtime state, or money calculations. */
export function summarizeArchive(input = {}) {
  const sourceRowCount = countOf(input.sourceRows, countOf(input.sourceRowCount));
  const confirmedRowCount = countOf(input.confirmedRows, countOf(input.confirmedRowCount));
  const languageCount = countOf(input.languages, countOf(input.languageCount));
  const routes = Array.isArray(input.vendorRoutes) ? input.vendorRoutes : [];
  const vendorCoverage = { RWS: 0, Pactera: 0, unpriced: 0 };
  let incompleteLanguageCount = 0;

  const servedScopeKeys = new Set();
  const unservedScopeKeys = new Set();
  routes.forEach((route = {}, index) => {
    const scopeKey = route.scopeKey || `__unkeyed_${index}`;
    if (route.served === true) {
      servedScopeKeys.add(scopeKey);
      if (route.completeRate === false) incompleteLanguageCount += 1;
      if (route.vendor === 'RWS' || route.vendor === 'Pactera') vendorCoverage[route.vendor] += 1;
      return;
    }
    unservedScopeKeys.add(scopeKey);
  });
  vendorCoverage.unpriced = [...unservedScopeKeys].filter((scopeKey) => !servedScopeKeys.has(scopeKey)).length;

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
