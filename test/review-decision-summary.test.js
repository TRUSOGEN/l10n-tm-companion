import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateReviewDecisions, classifyReviewDecision } from '../lib/review-decision-summary.js';

const cases = [
  [{ reasoning: 'Auto-revised based on review.' }, 'auto_revised', 'Auto-revised'],
  [{ reasoning: 'Orig Match % (37) is below 50; show Top-3 TM without AI rewrite.' }, 'below_50', 'Below 50'],
  [{ presentation: { explanation: 'TM score did not improve, so it was not auto-applied. Official saving compares A with confirmed C only.' } }, 'not_improved', 'Not improved'],
  [{ reasoning: 'Inspire returned the original source unchanged; no safe rewrite was available.' }, 'no_safe_rewrite', 'No safe rewrite'],
];

test('decision classifier converts repeated prose into short per-item labels', () => {
  for (const [item, key, label] of cases) {
    assert.deepEqual(classifyReviewDecision(item), { key, label });
  }
});

test('decision aggregation deduplicates types, counts current visible results, and hides zero types', () => {
  const items = [
    ...Array.from({ length: 23 }, () => cases[0][0]),
    ...Array.from({ length: 12 }, (_, index) => ({ reasoning: `Orig Match % (${index}) is below 50; show Top-3 TM without AI rewrite.` })),
    ...Array.from({ length: 5 }, () => cases[2][0]),
    ...Array.from({ length: 3 }, () => cases[3][0]),
  ];
  assert.deepEqual(aggregateReviewDecisions(items), [
    { key: 'auto_revised', count: 23, label: 'Auto-revised', note: 'based on review' },
    { key: 'below_50', count: 12, label: 'Below 50', note: 'Top-3 TM shown without AI rewrite' },
    { key: 'not_improved', count: 5, label: 'Not improved', note: 'candidate was not auto-applied' },
    { key: 'no_safe_rewrite', count: 3, label: 'No safe rewrite', note: 'original source kept' },
  ]);
  assert.deepEqual(aggregateReviewDecisions(items.slice(0, 23)), [
    { key: 'auto_revised', count: 23, label: 'Auto-revised', note: 'based on review' },
  ], 'filtering recomputes from only the currently visible items');
});
