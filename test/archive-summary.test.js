import assert from 'node:assert/strict';
import { buildVendorRoutes, estimateTmRequests, formatVendorCoverage, summarizeArchive } from '../lib/archive-summary.js';

assert.deepEqual(
  estimateTmRequests({ rowCount: 100, languageCount: 56 }),
  { original: 168, final: 168, total: 336 },
  '100 rows × 56 languages uses 40-row batches for A and C only',
);
assert.deepEqual(
  estimateTmRequests({ rowCount: 100.9, languageCount: 56.8, batchSize: 40.7 }),
  { original: 168, final: 168, total: 336 },
  'counts are normalized to non-negative integers and the product is always A + C',
);
assert.deepEqual(estimateTmRequests({ rowCount: -2, languageCount: -1, batchSize: -4 }), { original: 0, final: 0, total: 0 });

const realVendorFixture = buildVendorRoutes({
  plannedScopes: [{ key: 'fr' }, { key: 'ja' }, { key: 'ar' }, { key: 'de' }],
  vendorResults: {
    RWS: {
      scopeRuns: [
        { scope: { key: 'fr' }, rate: { status: 'ready', amount: 0.12 } },
        { scope: { key: 'ar' }, rate: { status: 'incomplete', reason: 'word_rate_missing' } },
      ],
      unservedScopes: [{ key: 'ja' }],
    },
    Pactera: {
      scopeRuns: [{ scope: { key: 'ja' }, rate: { status: 'ready', amount: 0.09 } }],
      unservedScopes: [{ key: 'fr' }, { key: 'ar' }],
    },
  },
});
assert.deepEqual(realVendorFixture, [
  { vendor: 'RWS', scopeKey: 'fr', served: true, completeRate: true },
  { vendor: 'RWS', scopeKey: 'ar', served: true, completeRate: false },
  { vendor: 'RWS', scopeKey: 'ja', served: false, completeRate: false },
  { vendor: 'Pactera', scopeKey: 'ja', served: true, completeRate: true },
  { vendor: 'Pactera', scopeKey: 'fr', served: false, completeRate: false },
  { vendor: 'Pactera', scopeKey: 'ar', served: false, completeRate: false },
  { vendor: null, scopeKey: 'de', served: false, completeRate: false },
]);
const realRouteSummary = summarizeArchive({ sourceRowCount: 100, languageCount: 4, vendorRoutes: realVendorFixture });
assert.equal(realRouteSummary.incompleteLanguageCount, 1, 'only the served RWS rate gap is incomplete');
assert.deepEqual(realRouteSummary.vendorCoverage, { RWS: 2, Pactera: 1, unpriced: 1 });
assert.equal(realRouteSummary.unpricedLanguageCount, 1, 'a planned scope absent from every vendor is unpriced once');

const crossVendorRoutes = buildVendorRoutes({
  plannedScopes: [{ key: 'ja' }, { key: 'it' }],
  vendorResults: {
    RWS: { scopeRuns: [], unservedScopes: [{ key: 'ja' }, { key: 'it' }] },
    Pactera: { scopeRuns: [{ scope: { key: 'ja' }, rate: { status: 'ready' } }], unservedScopes: [{ key: 'it' }] },
  },
});
const crossVendorSummary = summarizeArchive({ languageCount: 2, vendorRoutes: crossVendorRoutes });
assert.equal(crossVendorSummary.unpricedLanguageCount, 1, 'ja is served elsewhere; it is not unpriced, while it is counted once');

const summary = summarizeArchive({
  sourceRows: Array.from({ length: 100 }),
  confirmedRows: Array.from({ length: 80 }),
  languages: Array.from({ length: 56 }),
  vendorRoutes: [
    { vendor: 'RWS', scopeKey: 'fr', served: true, completeRate: true },
    { vendor: 'RWS', scopeKey: 'ja', served: false, completeRate: false },
    { vendor: 'Pactera', scopeKey: 'ja', served: true, completeRate: true },
    { vendor: null, scopeKey: 'de', served: false, completeRate: false },
  ],
});
assert.equal(summary.sourceRowCount, 100);
assert.equal(summary.confirmedRowCount, 80);
assert.equal(summary.languageCount, 56);
assert.deepEqual(summary.vendorCoverage, { RWS: 1, Pactera: 1, unpriced: 1 });
assert.equal(summary.unpricedLanguageCount, 1);
assert.equal(summary.incompleteLanguageCount, 0, 'served:false is a normal route outcome');
assert.deepEqual(summary.estimatedTmRequests, { original: 168, final: 168, total: 336 });
assert.ok(summary.estimatedDuration.minSeconds <= summary.estimatedDuration.maxSeconds);

const incomplete = summarizeArchive({
  sourceRowCount: 0,
  confirmedRowCount: 0,
  languageCount: 2,
  vendorRoutes: [
    { vendor: 'RWS', served: true, completeRate: false },
    { vendor: 'Pactera', served: false, completeRate: false },
  ],
});
assert.equal(incomplete.incompleteLanguageCount, 1);
assert.deepEqual(incomplete.estimatedTmRequests, { original: 0, final: 0, total: 0 });

console.log('archive-summary tests passed');

const formattedCoverage = formatVendorCoverage({ routes: [
  { vendor: 'RWS', scopeKey: 'ja', served: false, completeRate: false },
  { vendor: 'Pactera', scopeKey: 'ja', served: true, completeRate: true, completeTm: true, completeFinal: true },
  { vendor: 'RWS', scopeKey: 'fr', served: true, completeRate: true, completeTm: false, completeFinal: true },
  { vendor: null, scopeKey: 'de', served: false },
] });
assert.deepEqual(formattedCoverage.counts, { RWS: 1, Pactera: 1, unpriced: 1 });
assert.equal(formattedCoverage.incomplete, true, 'only served missing rate/TM/final is incomplete');
assert.equal(formattedCoverage.incompleteCount, 1);
assert.match(formattedCoverage.explanations.join(' '), /routed/i);
