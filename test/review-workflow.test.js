/** Focus 逐条最终确认状态机回归测试。 */
import assert from 'node:assert/strict';
import {
  beginConfirmation,
  buildFocusTmState,
  completeConfirmation,
  createReviewState,
  dedupeAiCandidates,
  editFinalText,
  explainFocusAiAbsence,
  failConfirmation,
  filterReviewItems,
  getReviewableAiCandidates,
  hasReviewableAiRewrite,
  hasPostTmImprovement,
  isAiCandidateSelected,
  prepareBulkConfirmations,
} from '../lib/review-workflow.js';

const draft = createReviewState({
  sourceText: 'Send {{count}} Gifts in 30s',
  initialText: 'Send {{count}} Gifts within 30s',
});
assert.equal(draft.status, 'draft');
assert.equal(draft.finalText, 'Send {{count}} Gifts within 30s');

const confirming = beginConfirmation(draft);
assert.equal(confirming.status, 'confirming');

const confirmed = completeConfirmation(confirming, {
  finalTm: { status: 'complete', score: 91 },
  sheetWriteSucceeded: true,
});
assert.equal(confirmed.status, 'confirmed');
assert.equal(confirmed.finalTm.score, 91);

const dirty = editFinalText(confirmed, 'Send {{count}} Gifts now in 30s');
assert.equal(dirty.status, 'dirty');
assert.equal(dirty.finalTm, null, '再次编辑必须清除过期 Final TM');

const failed = failConfirmation(confirming, new Error('sheet write failed'));
assert.equal(failed.status, 'error');
assert.match(failed.error, /sheet write failed/);
assert.equal(failed.finalTm, null);

assert.throws(
  () => beginConfirmation(editFinalText(draft, '')),
  /final_text_required/,
);
assert.throws(
  () => beginConfirmation(editFinalText(draft, 'Send Gifts now')),
  /protected_tokens_changed/,
);
assert.throws(
  () => completeConfirmation(confirming, {
    finalTm: { status: 'incomplete', reason: 'timeout' },
    sheetWriteSucceeded: true,
  }),
  /final_tm_incomplete/,
);
assert.throws(
  () => completeConfirmation(confirming, {
    finalTm: { status: 'complete', score: 91 },
    sheetWriteSucceeded: false,
  }),
  /sheet_write_failed/,
);

const legacyTmState = buildFocusTmState({
  similarity: 55,
  tm_source: 'Special LIVE Love Lock',
  tm_match: '目标语言 TM',
  tm_candidates: [],
});
assert.equal(legacyTmState.status, 'legacy_single');
assert.equal(legacyTmState.candidates.length, 1);
assert.equal(legacyTmState.candidates[0].score, 55);
assert.match(legacyTmState.message, /Native Host update required/);

const noTmState = buildFocusTmState({
  similarity: 0,
  tm_source: '',
  tm_match: '',
  tm_candidates: [],
});
assert.equal(noTmState.status, 'no_match');
assert.equal(noTmState.candidates.length, 0);
assert.equal(noTmState.message, 'No TM match');

assert.equal(
  explainFocusAiAbsence({
    rewrite_eligible: true,
    reasoning: 'AI disabled (enableAI=off in settings).',
  }),
  'AI disabled (enableAI=off in settings).',
);
assert.match(
  explainFocusAiAbsence({
    rewrite_eligible: true,
    ai_candidates: [{
      structure_valid: false,
      structure_error: 'candidate_json_missing',
    }],
  }),
  /candidate_json_missing/,
);
assert.match(
  explainFocusAiAbsence({
    rewrite_eligible: true,
    ai_quality: {
      validCandidates: [],
      candidates: [{ rejection_reason: 'meaning_changed' }],
    },
  }),
  /meaning changed/,
);
assert.equal(
  explainFocusAiAbsence({
    ai_quality: {
      validCandidates: [{
        ai_translation: 'Special LIVE Love Lock',
        post_rewrite_tm: { status: 'complete', score: 88 },
      }],
    },
  }),
  '',
);

const dedupedCandidates = dedupeAiCandidates([
  {
    ai_translation: 'No fans have reached lv.50',
    post_rewrite_tm: { status: 'complete', score: 58.2 },
  },
  {
    ai_translation: '  No   fans have reached lv.50  ',
    post_rewrite_tm: { status: 'complete', score: 59.4 },
  },
  {
    ai_translation: 'No fan has reached lv.50',
    post_rewrite_tm: { status: 'complete', score: 61 },
  },
]);
assert.equal(dedupedCandidates.length, 2, '语义展示完全相同的候选只保留一张卡片');
assert.equal(
  dedupedCandidates[0].post_rewrite_tm.score,
  59.4,
  '重复候选保留 Post-TM 分数更高的一条',
);
assert.equal(
  isAiCandidateSelected(
    { finalText: ' No fans have reached lv.50 ' },
    dedupedCandidates[0],
  ),
  true,
);
assert.equal(
  isAiCandidateSelected(
    { finalText: 'No fan has reached lv.50' },
    dedupedCandidates[0],
  ),
  false,
);

const bulk = prepareBulkConfirmations([
  {
    id: 'confirmed',
    review: {
      ...confirmed,
      sourceText: 'Send {{count}} Gifts in 30s',
      finalText: 'Send {{count}} Gifts within 30s',
    },
  },
  {
    id: 'valid',
    review: createReviewState({
      sourceText: 'Waiting for the party star',
      initialText: 'Waiting for the party host',
    }),
  },
  {
    id: 'invalid',
    review: createReviewState({
      sourceText: 'Use {{count}} coins',
      initialText: 'Use coins',
    }),
  },
]);
assert.deepEqual(bulk.skipped.map((entry) => entry.item.id), ['confirmed']);
assert.deepEqual(bulk.ready.map((entry) => entry.item.id), ['valid']);
assert.equal(bulk.ready[0].review.status, 'confirming');
assert.deepEqual(bulk.failed.map((entry) => entry.item.id), ['invalid']);
assert.equal(bulk.failed[0].review.status, 'error');
assert.match(bulk.failed[0].review.error, /protected_tokens_changed/);

const reviewItems = [
  {
    id: 'improved',
    similarity: 56,
    post_rewrite_tm: { status: 'complete', score: 100 },
  },
  {
    id: 'rewritten_lower',
    similarity: 71,
    post_rewrite_tm: { status: 'complete', score: 30 },
    ai_quality: {
      reviewableCandidates: [{
        ai_translation: 'Claim 5 Coins now',
        post_rewrite_tm: { status: 'complete', score: 30 },
      }],
    },
  },
  {
    id: 'equal',
    similarity: 46,
    post_rewrite_tm: { status: 'complete', score: 46 },
  },
  {
    id: 'incomplete',
    similarity: 50,
    post_rewrite_tm: { status: 'incomplete', reason: 'timeout' },
  },
  {
    id: 'missing',
    similarity: 40,
  },
];
assert.equal(hasPostTmImprovement(reviewItems[0]), true, 'Post-TM 高于原 TM 才算有提升');
assert.equal(hasPostTmImprovement(reviewItems[1]), false, '分数下降不算可自动采用');
assert.equal(hasPostTmImprovement(reviewItems[2]), false, 'Post-TM 持平不算有提升');
assert.equal(hasPostTmImprovement(reviewItems[3]), false, 'Post-TM 查询不完整不算有提升');
assert.equal(hasPostTmImprovement(reviewItems[4]), false, '没有 Post-TM 快照不算有提升');
assert.equal(hasReviewableAiRewrite(reviewItems[1]), true, '安全 AI 改写即使分数下降也必须可审阅');
assert.equal(hasReviewableAiRewrite(reviewItems[2]), false, '没有安全 AI 候选不能进入 AI 改写筛选');
assert.deepEqual(
  getReviewableAiCandidates({
    ai_quality: {
      candidates: [{
        ai_translation: 'Claim 5 Coins now',
        gate_status: 'rejected',
        rejection_reason: 'tm_score_not_improved',
      }],
    },
  }).map((candidate) => candidate.ai_translation),
  ['Claim 5 Coins now'],
  '旧运行快照中的安全下降候选也必须恢复到新审阅视图',
);
assert.deepEqual(
  filterReviewItems(reviewItems, 'improved').map((item) => item.id),
  ['rewritten_lower'],
  'AI 改写筛选必须保留安全的下降候选',
);
assert.deepEqual(
  filterReviewItems(reviewItems, 'all').map((item) => item.id),
  reviewItems.map((item) => item.id),
  'All 筛选保留原始顺序和全部条目',
);

console.log('review workflow tests: passed');
