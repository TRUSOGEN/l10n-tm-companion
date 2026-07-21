/** 多语言 scope 执行器回归：项目隔离、失败隔离与无 LLM 零节省。 */
import assert from 'node:assert/strict';
import { runLocaleScopes } from '../lib/multilingual-runner.js';

const runnerModule = await import('../lib/multilingual-runner.js');

const scopes = [
  { key: '1:en:ja-JP', projectId: 1, sourceLocale: 'en', targetLocale: 'ja-JP' },
  { key: '2:en:ko-KR', projectId: 2, sourceLocale: 'en', targetLocale: 'ko-KR' },
];
const items = [{ id: 'a', source_text: 'Save' }];
const calls = [];
const runs = await runLocaleScopes({
  scopes,
  items,
  queryOriginalTm: async (_texts, scope) => {
    calls.push(scope.projectId);
    if (scope.projectId === 1) throw new Error('TM 1204');
    return [{ tm_match: 'Save', tm_source: 'Save', similarity: 80 }];
  },
  rewriteItems: async (source) => source.map((item) => ({ ...item, ai_translation: '', reached_threshold: false })),
  queryPostRewriteTm: async (source) => source.map(() => ({ status: 'not_required' })),
  resolveRate: () => ({ status: 'ready' }),
  decorateItem: (item) => { item.new_match = 0; },
  calculateRoi: (item) => item.post_rewrite_tm.status === 'not_required'
    ? { status: 'complete', estimatedCostBefore: 2, estimatedCostAfter: 2, estimatedSaving: 0 }
    : { status: 'incomplete', reason: 'snapshot_missing' },
});

assert.deepEqual(calls, [1, 2], '首轮失败后仍执行下一个项目 scope');
assert.equal(runs[0].items[0].roi.reason, 'original_tm_query_failed');
assert.equal(runs[1].items[0].roi.status, 'complete');
assert.equal(runs[1].items[0].roi.estimatedSaving, 0, '无 LLM 仍产生零节省 ROI');
assert.equal(typeof runnerModule.runFinalLocaleScopes, 'function', '最终 C 文案需要独立的第三次 TM 执行器');

const finalRuns = await runnerModule.runFinalLocaleScopes({
  scopeRuns: [{
    scope: scopes[1],
    rate: { status: 'ready' },
    items: [{ id: 'a', row: 2, source_text: 'Save', ai_translation: 'Save now', similarity: 80 }],
  }],
  finalSourceForItem: (item) => item.row === 2 ? 'Save today' : '',
  queryFinalTm: async (scopeItems) => scopeItems.map(() => ({ status: 'complete', score: 97, tm_source: 'Save today' })),
  calculateRoi: (item) => item.final_tm?.status === 'complete'
    ? { status: 'complete', finalScore: item.final_tm.score }
    : { status: 'incomplete', reason: 'final_tm_missing' },
});
assert.equal(finalRuns[0].items[0].final_source_text, 'Save today', '最终 C 来自 CD 确认文本');
assert.equal(finalRuns[0].items[0].final_tm.score, 97, '最终 C 使用第三次真实 TM score');
assert.equal(finalRuns[0].items[0].roi.status, 'complete', '正式 ROI 只在 C TM 完成后产生');
console.log('multilingual-runner tests: 8 passed, 0 failed');
