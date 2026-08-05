import assert from 'node:assert/strict';
import { estimateTmRequests, summarizeArchive } from '../lib/archive-summary.js';

assert.deepEqual(
  estimateTmRequests({ rowCount: 100, languageCount: 56 }),
  { original: 168, final: 168, total: 336 },
  '100 rows × 56 languages uses 40-row batches for A and C only',
);
assert.deepEqual(
  estimateTmRequests({ rowCount: 100, languageCount: 56, passes: 3 }),
  { original: 168, final: 168, total: 504 },
  'extra passes can affect total without reclassifying B as an official A/C request',
);

const summary = summarizeArchive({
  sourceRows: Array.from({ length: 100 }),
  confirmedRows: Array.from({ length: 80 }),
  languages: Array.from({ length: 56 }),
  vendorRoutes: [
    { vendor: 'RWS', served: true, completeRate: true },
    { vendor: 'RWS', served: false, completeRate: false },
    { vendor: 'Pactera', served: true, completeRate: true },
    { vendor: null, served: false, completeRate: false },
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
