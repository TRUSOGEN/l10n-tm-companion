/** Source rewrite 结构、语义与真实 TM 安全门禁测试。 */
import assert from 'node:assert/strict';
import {
  evaluateRewriteCandidate,
  evaluateRewriteCandidates,
  extractProtectedTokens,
  formatTmSourceForDisplay,
} from '../lib/source-rewrite-policy.js';

assert.equal(formatTmSourceForDisplay('You have {{count}} message{{#plural}}s{{/plural}}'), 'You have {count} messages');
assert.deepEqual(
  extractProtectedTokens('A creator shares from iPhone on X.'),
  ['X', 'iPhone'],
  '单字符保护只覆盖明确品牌 X，不能把冠词 A 误判成品牌',
);
assert.deepEqual(
  extractProtectedTokens('Use C++, C+, or C# in LIVE.'),
  ['C#', 'C+', 'C++', 'LIVE'],
  '尾部带符号的专名必须完整保护',
);
const safe = evaluateRewriteCandidate({
  source_text: 'Send {{count}} Gifts in 30s',
  ai_translation: 'Send {{count}} Gifts within 30s',
  similarity: 70,
  post_rewrite_tm: { status: 'complete', score: 86 },
});
assert.equal(safe.structureValid, true);
assert.equal(safe.tmImproved, true);
assert.equal(safe.defaultChoice, 'ai');
const broken = evaluateRewriteCandidate({
  source_text: 'Send {{count}} Gifts in 30s',
  ai_translation: 'Send Gifts now',
  similarity: 70,
  post_rewrite_tm: { status: 'complete', score: 90 },
});
assert.equal(broken.structureValid, false);
assert.equal(broken.defaultChoice, 'source');
const lowerScore = evaluateRewriteCandidate({
  source_text: 'Send 1 Gift',
  ai_translation: 'Send one Gift',
  similarity: 80,
  post_rewrite_tm: { status: 'complete', score: 79 },
});
assert.equal(lowerScore.structureValid, false);
assert.equal(lowerScore.defaultChoice, 'source');

const item = {
  source_text: 'Visit https://live.example.com in 30s for {{count}} Gifts',
  similarity: 70,
  ai_candidates: [
    {
      ai_translation: 'Visit https://live.example.com within 30s for {{count}} Gifts',
      semantic_status: 'same_meaning',
      risks: [],
      structure_valid: true,
    },
    {
      ai_translation: 'Buy Gifts at https://live.example.com in 30s for {{count}} users',
      semantic_status: 'meaning_changed',
      risks: [],
      structure_valid: true,
    },
    {
      ai_translation: 'Visit https://live.example.com within 60s for Gifts',
      semantic_status: 'same_meaning',
      risks: [],
      structure_valid: true,
    },
  ],
};
const snapshots = [
  { status: 'complete', score: 88 },
  { status: 'complete', score: 95 },
  { status: 'complete', score: 92 },
];
const evaluated = evaluateRewriteCandidates(item, snapshots);
assert.equal(evaluated.validCandidates.length, 1, '只有全部门禁通过的候选可展示');
assert.equal(evaluated.validCandidates[0].ai_translation, item.ai_candidates[0].ai_translation);
assert.equal(evaluated.displayText, item.ai_candidates[0].ai_translation);
assert.equal(evaluated.representativePostTm.score, 88, '存在有效候选时代表分数取最高有效候选');
assert.equal(evaluated.candidates[1].rejection_reason, 'meaning_changed');
assert.equal(evaluated.candidates[2].rejection_reason, 'protected_tokens_changed');

const noValid = evaluateRewriteCandidates({
  ...item,
  ai_candidates: item.ai_candidates.slice(1),
}, snapshots.slice(1));
assert.equal(noValid.displayText, '', '候选全部无效时 UI 必须显示 None');
assert.equal(noValid.representativePostTm.score, 95, '无有效候选时保留最高已查询分数');
assert.equal(noValid.representativePostTm.rejectionReason, 'meaning_changed');

const risky = evaluateRewriteCandidates({
  source_text: 'Send a Gift',
  similarity: 60,
  ai_candidates: [{
    ai_translation: 'Send one Gift',
    semantic_status: 'same_meaning',
    risks: ['glossary_conflict'],
    structure_valid: true,
  }],
}, [{ status: 'complete', score: 90 }]);
assert.equal(risky.validCandidates.length, 0);
assert.equal(risky.candidates[0].rejection_reason, 'review_rule_risk');

const missingBrandToken = evaluateRewriteCandidates({
  source_text: 'Complete 3 LIVE missions to earn 100 points.',
  similarity: 78,
  ai_candidates: [{
    ai_translation: 'Complete 3 missions to earn 100 points.',
    semantic_status: 'same_meaning',
    risks: [],
    structure_valid: true,
  }],
}, [{ status: 'complete', score: 90 }]);
assert.equal(missingBrandToken.validCandidates.length, 0, '丢失全大写品牌 token 的候选必须被拦截');
assert.equal(missingBrandToken.candidates[0].rejection_reason, 'protected_tokens_changed');

const missingLowerCamelBrand = evaluateRewriteCandidates({
  source_text: 'Open iPhone settings before sharing on X.',
  similarity: 78,
  ai_candidates: [{
    ai_translation: 'Open phone settings before sharing.',
    semantic_status: 'same_meaning',
    risks: [],
    structure_valid: true,
  }],
}, [{ status: 'complete', score: 90 }]);
assert.equal(
  missingLowerCamelBrand.validCandidates.length,
  0,
  '丢失 lowerCamelCase 或单字符品牌 token 的候选必须被拦截',
);
assert.equal(missingLowerCamelBrand.candidates[0].rejection_reason, 'protected_tokens_changed');

const missingSymbolBrand = evaluateRewriteCandidates({
  source_text: 'Use C++ in LIVE.',
  similarity: 78,
  ai_candidates: [{
    ai_translation: 'Use C in LIVE.',
    semantic_status: 'same_meaning',
    risks: [],
    structure_valid: true,
  }],
}, [{ status: 'complete', score: 90 }]);
assert.equal(missingSymbolBrand.validCandidates.length, 0, '丢失 C++ 专名的候选必须被拦截');
assert.equal(missingSymbolBrand.candidates[0].rejection_reason, 'protected_tokens_changed');
console.log('source rewrite policy: passed');
