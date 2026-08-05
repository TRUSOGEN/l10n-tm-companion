const nonNegativeInteger = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
};
const countOf = (value, fallback = 0) => (
  Array.isArray(value) ? value.length : nonNegativeInteger(value, fallback)
);

/** Preserve the actual routing/rate outcome produced by deriveVendorRoiResults. */
export function buildVendorRoutes({ vendorResults = {} } = {}) {
  const routes = [];
  Object.entries(vendorResults || {}).forEach(([vendor, result = {}]) => {
    (result.scopeRuns || []).forEach((run = {}) => {
      routes.push({
        vendor,
        scopeKey: run.scope?.key || '',
        served: true,
        completeRate: run.rate?.status === 'ready',
      });
    });
    (result.unservedScopes || []).forEach((scope = {}) => {
      routes.push({ vendor, scopeKey: scope.key || '', served: false, completeRate: false });
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

/** Build the confirmation model without touching DOM, runtime state, or money calculations. */
export function summarizeArchive(input = {}) {
  const sourceRowCount = countOf(input.sourceRows, countOf(input.sourceRowCount));
  const confirmedRowCount = countOf(input.confirmedRows, countOf(input.confirmedRowCount));
  const languageCount = countOf(input.languages, countOf(input.languageCount));
  const routes = Array.isArray(input.vendorRoutes) ? input.vendorRoutes : [];
  const vendorCoverage = { RWS: 0, Pactera: 0, unpriced: 0 };
  let incompleteLanguageCount = 0;

  routes.forEach((route = {}) => {
    if (route.served === true && route.completeRate === false) incompleteLanguageCount += 1;
    if (route.served !== true) {
      if (!route.vendor) vendorCoverage.unpriced += 1;
      return;
    }
    if (route.vendor === 'RWS' || route.vendor === 'Pactera') vendorCoverage[route.vendor] += 1;
    else vendorCoverage.unpriced += 1;
  });

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
