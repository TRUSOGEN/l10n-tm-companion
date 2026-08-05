const countOf = (value, fallback = 0) => (
  Array.isArray(value) ? value.length : Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : fallback
);

/** Estimate official TM traffic. A (original) and C (confirmed final) are the two named passes. */
export function estimateTmRequests({ rowCount = 0, languageCount = 0, batchSize = 40, passes = 2 } = {}) {
  const rows = Math.max(0, Number(rowCount) || 0);
  const languages = Math.max(0, Number(languageCount) || 0);
  const size = Math.max(1, Number(batchSize) || 40);
  const requestsPerPass = rows === 0 || languages === 0 ? 0 : languages * Math.ceil(rows / size);
  return {
    original: requestsPerPass,
    final: requestsPerPass,
    total: requestsPerPass * Math.max(0, Number(passes) || 0),
  };
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
    passes: 2,
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
