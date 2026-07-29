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
    return [{
      tm_match: 'Save',
      tm_source: 'Save',
      similarity: 80,
      tm_candidates: [{ source: 'Save', target: '保存', score: 80 }],
    }];
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
assert.equal(runs[1].items[0].tm_candidates.length, 1, 'Top-3 TM 候选必须进入后续改写与 Focus 数据');
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
assert.equal(finalRuns[0].items[0].review_status, 'confirmed', '有最终 C 的 scope 必须保留 CD 确认状态');
assert.equal(finalRuns[0].items[0].final_tm.score, 97, '最终 C 使用第三次真实 TM score');
assert.equal(finalRuns[0].items[0].roi.status, 'complete', '正式 ROI 只在 C TM 完成后产生');

assert.equal(
  typeof runnerModule.partitionPriorityScope,
  'function',
  'Review 必须有独立的优先展示 scope 分区函数',
);
const partition = runnerModule.partitionPriorityScope(scopes, scopes[1].key);
assert.deepEqual(
  partition.priority.map((scope) => scope.key),
  [scopes[1].key],
  '显式展示 scope 必须优先执行',
);
assert.deepEqual(
  partition.deferred.map((scope) => scope.key),
  [scopes[0].key],
  '其余 scope 必须延后到 ROI 归档阶段',
);

let activeQueries = 0;
let maxActiveQueries = 0;
const concurrentScopes = Array.from({ length: 4 }, (_, index) => ({
  key: `scope-${index}`,
  projectId: index + 1,
  sourceLocale: 'en',
  targetLocale: `locale-${index}`,
}));
const concurrentRuns = await runLocaleScopes({
  scopes: concurrentScopes,
  items,
  concurrency: 2,
  queryOriginalTm: async (_texts, scope) => {
    activeQueries += 1;
    maxActiveQueries = Math.max(maxActiveQueries, activeQueries);
    await new Promise((resolve) => setTimeout(resolve, 15));
    activeQueries -= 1;
    return [{
      tm_match: scope.key,
      tm_source: scope.key,
      similarity: 80,
    }];
  },
  rewriteItems: async (source) => source.map((item) => ({
    ...item,
    ai_translation: '',
    reached_threshold: false,
  })),
  queryPostRewriteTm: async (source) => source.map(() => ({ status: 'not_required' })),
  resolveRate: () => ({ status: 'ready' }),
  calculateRoi: () => ({ status: 'complete' }),
});
assert.equal(maxActiveQueries, 2, 'ROI scope 查询必须使用调用方指定的受控并发');
assert.deepEqual(
  concurrentRuns.map((run) => run.scope.key),
  concurrentScopes.map((scope) => scope.key),
  '并发完成顺序不能改变 scope 输出顺序',
);

activeQueries = 0;
maxActiveQueries = 0;
const concurrentFinalRuns = await runnerModule.runFinalLocaleScopes({
  scopeRuns: concurrentScopes.map((scope) => ({
    scope,
    rate: { status: 'ready' },
    items: [{ id: 'a', source_text: 'Save' }],
  })),
  concurrency: 2,
  finalSourceForItem: () => 'Save today',
  queryFinalTm: async (scopeItems) => {
    activeQueries += 1;
    maxActiveQueries = Math.max(maxActiveQueries, activeQueries);
    await new Promise((resolve) => setTimeout(resolve, 15));
    activeQueries -= 1;
    return scopeItems.map(() => ({ status: 'complete', score: 95 }));
  },
  calculateRoi: () => ({ status: 'complete' }),
});
assert.equal(maxActiveQueries, 2, 'Final TM 的跨 scope 补算必须使用受控并发');
assert.deepEqual(
  concurrentFinalRuns.map((run) => run.scope.key),
  concurrentScopes.map((scope) => scope.key),
  'Final TM 并发补算必须保持 scope 顺序',
);

assert.equal(
  typeof runnerModule.completeDeferredLocaleScopes,
  'function',
  'ROI 归档需要可测试的延后 scope 补算执行器',
);
const deferredScopes = [
  { key: 'display', projectId: 1, sourceLocale: 'en', targetLocale: 'fr' },
  { key: 'deferred-1', projectId: 1, sourceLocale: 'en', targetLocale: 'de' },
  { key: 'deferred-2', projectId: 1, sourceLocale: 'en', targetLocale: 'es' },
];
const completedDeferred = await runnerModule.completeDeferredLocaleScopes({
  allScopes: deferredScopes,
  existingScopeRuns: [{
    scope: deferredScopes[0],
    rate: { status: 'ready' },
    items: [{
      id: 'a',
      row: 2,
      source_text: 'Save',
      similarity: 70,
      reached_threshold: false,
      ai_translation: 'Save today',
      ai_candidates: [{
        ai_translation: 'Save today',
        structure_valid: true,
      }],
      final_source_text: 'Save today',
      final_tm: { status: 'complete', score: 91 },
    }],
  }],
  sourceItems: [{ id: 'a', row: 2, source_text: 'Save' }],
  concurrency: 2,
  queryOriginalTm: async (_texts, scope) => [{
    tm_match: scope.key,
    tm_source: scope.key,
    similarity: 72,
  }],
  queryPostRewriteTm: async (scopeItems) => scopeItems.map(() => ({
    status: 'complete',
    score: 86,
  })),
  resolveRate: () => ({ status: 'ready' }),
  calculateRoi: (item) => ({
    status: item.final_tm?.status === 'complete' ? 'complete' : 'incomplete',
  }),
  decorateItem: (item) => { item.new_match = item.post_rewrite_tm?.score || 0; },
  finalSourceForItem: () => 'Save today',
  queryFinalTm: async (scopeItems) => scopeItems.map(() => ({
    status: 'complete',
    score: 93,
  })),
});
assert.deepEqual(
  completedDeferred.map((run) => run.scope.key),
  deferredScopes.map((scope) => scope.key),
  '补算后必须恢复全部 scope 的产品顺序',
);
assert.equal(
  completedDeferred[1].items[0].ai_translation,
  'Save today',
  '延后 scope 必须复用一次 Inspire 决策',
);
assert.equal(
  completedDeferred[2].items[0].final_tm.score,
  93,
  '延后 scope 必须补齐真实 Final TM',
);
assert.equal(
  completedDeferred[2].items[0].review_status,
  'confirmed',
  '延后 scope 的漏斗必须计入同一条已确认 source',
);

console.log('multilingual-runner tests: 24 passed, 0 failed');
