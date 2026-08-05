import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReviewPresentation } from '../lib/review-workflow.js';

test('official saving is strictly A minus C and B is explanatory only', () => {
  const model = buildReviewPresentation({
    original: { score: 55, cost: 12 },
    ai: { score: 99, cost: -1000 },
    final: { score: 80, cost: 7 },
  });
  assert.deepEqual(model.rail.map(({ key, score }) => ({ key, score })), [
    { key: 'A', score: 55 }, { key: 'B', score: 99 }, { key: 'C', score: 80 },
  ]);
  assert.equal(model.officialSaving, 5);
  assert.match(model.explanation, /A.*C/i);
  assert.doesNotMatch(model.explanation, /B.*amount/i);
});

test('negative A-C saving is an amber warning', () => {
  const model = buildReviewPresentation({ original: { cost: 4 }, final: { cost: 9 } });
  assert.equal(model.officialSaving, -5);
  assert.equal(model.savingTone, 'warning');
  assert.match(model.headline, /increased/i);
});

test('safe rewrite without TM improvement uses fixed audit wording', () => {
  const model = buildReviewPresentation({
    original: { score: 70, cost: 8 }, ai: { score: 70 }, final: { score: 70, cost: 8 },
    candidateSafety: { safe: true },
  });
  assert.equal(model.headline, 'Safe rewrite available');
  assert.equal(model.explanation, 'TM score did not improve, so it was not auto-applied. Official saving compares A with confirmed C only.');
});
