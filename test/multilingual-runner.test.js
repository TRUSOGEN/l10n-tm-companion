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

// ---------------------------------------------------------------------------
// 共享并发闸门与 A/C 流水线（归档补算的墙钟时间优化）
// ---------------------------------------------------------------------------

/** 创建可外部控制 resolve/reject 时机的 promise。 */
function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

assert.equal(
  typeof runnerModule.createRequestLimiter,
  'function',
  'A/C 并发化需要一个共享的纯函数并发闸门',
);

const { createRequestLimiter } = runnerModule;

// 并发上限：注入可控 deferred，断言峰值在飞数从不超过 limit，且 FIFO 有序。
{
  const limiter = createRequestLimiter(2);
  const gates = Array.from({ length: 5 }, () => createDeferred());
  const started = [];
  let inFlight = 0;
  let peak = 0;
  const tasks = gates.map((gate, index) => limiter(async () => {
    started.push(index);
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await gate.promise;
    inFlight -= 1;
    return index;
  }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(started, [0, 1], 'limiter 只允许 limit 个任务同时启动');
  gates[0].resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(started, [0, 1, 2], 'limiter 释放额度后必须按 FIFO 顺序放行');
  gates.forEach((gate) => gate.resolve());
  assert.deepEqual(await Promise.all(tasks), [0, 1, 2, 3, 4], 'limiter 必须原样返回任务结果');
  assert.equal(peak, 2, 'limiter 峰值在飞数不得超过 limit');
}

// 非法 limit 回退到 1（固定行为，避免 NaN/0 导致无限并发或死锁）。
for (const invalid of [0, -3, Number.NaN, undefined, 'x']) {
  const limiter = createRequestLimiter(invalid);
  const gates = [createDeferred(), createDeferred()];
  let inFlight = 0;
  let peak = 0;
  const tasks = gates.map((gate) => limiter(async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await gate.promise;
    inFlight -= 1;
  }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  gates.forEach((gate) => gate.resolve());
  await Promise.all(tasks);
  assert.equal(peak, 1, `非法 limit(${String(invalid)}) 必须安全回退到 1`);
}

// 异常不泄漏额度：抛错后后续任务仍能拿到额度。
{
  const limiter = createRequestLimiter(1);
  await assert.rejects(() => limiter(async () => { throw new Error('boom'); }), /boom/);
  assert.equal(await limiter(async () => 'ok'), 'ok', 'limiter 抛错后额度必须归还');
  const results = await Promise.all([
    limiter(async () => 1).catch(() => 'caught'),
    limiter(async () => { throw new Error('boom2'); }).catch(() => 'caught'),
    limiter(async () => 3),
  ]);
  assert.deepEqual(results, [1, 'caught', 3], '队列中的异常不能卡死后续任务');
}

/** 构造延后补算的公共入参，便于各场景只覆盖需要的依赖。 */
function deferredInput(overrides) {
  const scopeCount = overrides.scopeCount ?? 3;
  const allScopes = Array.from({ length: scopeCount }, (_, index) => ({
    key: index === 0 ? 'display' : `deferred-${index}`,
    projectId: 1,
    sourceLocale: 'en',
    targetLocale: `locale-${index}`,
  }));
  const base = {
    allScopes,
    existingScopeRuns: [{
      scope: allScopes[0],
      rate: { status: 'ready' },
      items: [{
        id: 'a',
        row: 2,
        source_text: 'Save',
        similarity: 70,
        reached_threshold: false,
        ai_translation: 'Save today',
        ai_candidates: [{ ai_translation: 'Save today', structure_valid: true }],
        final_source_text: 'Save today',
        final_tm: { status: 'complete', score: 91 },
      }],
    }],
    sourceItems: [{ id: 'a', row: 2, source_text: 'Save' }],
    queryOriginalTm: async () => [{ tm_match: 'Save', tm_source: 'Save', similarity: 72 }],
    queryPostRewriteTm: (scopeItems) => scopeItems.map(() => ({ status: 'not_required' })),
    resolveRate: () => ({ status: 'ready' }),
    calculateRoi: (item) => (item.final_tm?.status === 'complete'
      ? { status: 'complete', finalScore: item.final_tm.score }
      : { status: 'incomplete', reason: 'final_tm_missing' }),
    decorateItem: () => {},
    finalSourceForItem: () => 'Save today',
    queryFinalTm: async (scopeItems) => scopeItems.map(() => ({ status: 'complete', score: 93 })),
  };
  const { scopeCount: _ignored, ...rest } = overrides;
  return { ...base, ...rest, allScopes: rest.allScopes || allScopes };
}

// 核心：同一 scope 的 A 与 C 必须并发发出（A 未 resolve 时 C 已经在飞）。
{
  const aGate = createDeferred();
  let finalCalledBeforeOriginalResolved = false;
  let originalResolved = false;
  const pending = runnerModule.completeDeferredLocaleScopes(deferredInput({
    scopeCount: 2,
    queryOriginalTm: async () => {
      await aGate.promise;
      originalResolved = true;
      return [{ tm_match: 'Save', tm_source: 'Save', similarity: 72 }];
    },
    queryFinalTm: async (scopeItems) => {
      if (!originalResolved) finalCalledBeforeOriginalResolved = true;
      return scopeItems.map(() => ({ status: 'complete', score: 93 }));
    },
  }));
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(finalCalledBeforeOriginalResolved, true, 'C 查询必须与 A 并发发出，不再等 A 全部完成');
  aGate.resolve();
  const pipelined = await pending;
  assert.equal(pipelined[1].items[0].final_tm.score, 93, '流水线化后仍要写入真实 C TM');
  assert.equal(pipelined[1].items[0].similarity, 72, '流水线化后 A 分数仍来自本语言独立查询');
  assert.equal(pipelined[1].items[0].post_rewrite_tm.status, 'not_required', '延后语言的 B 仍是 not_required');
  assert.equal(pipelined[1].items[0].ai_translation, 'Save today', '延后语言仍复用展示 scope 的改写决策');
  assert.equal(pipelined[1].items[0].roi.status, 'complete');
}

// 全局在飞上限：13 个 scope × (A+C) 时，默认峰值在飞请求数必须仍是 3。
{
  let inFlight = 0;
  let peak = 0;
  const track = async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 3));
    inFlight -= 1;
  };
  const runs = await runnerModule.completeDeferredLocaleScopes(deferredInput({
    scopeCount: 14,
    queryOriginalTm: async () => {
      await track();
      return [{ tm_match: 'Save', tm_source: 'Save', similarity: 72 }];
    },
    queryFinalTm: async (scopeItems) => {
      await track();
      return scopeItems.map(() => ({ status: 'complete', score: 93 }));
    },
  }));
  assert.equal(runs.length, 14, '13 个延后 scope 必须全部补算');
  assert.equal(peak, 12, '默认全局在飞 TM 请求上限应使用 2026-08-04 PPE 实测稳定值 12');
  inFlight = 0;
  peak = 0;
  const limited = await runnerModule.completeDeferredLocaleScopes(deferredInput({
    scopeCount: 6,
    requestConcurrency: 2,
    queryOriginalTm: async () => {
      await track();
      return [{ tm_match: 'Save', tm_source: 'Save', similarity: 72 }];
    },
    queryFinalTm: async (scopeItems) => {
      await track();
      return scopeItems.map(() => ({ status: 'complete', score: 93 }));
    },
  }));
  assert.equal(limited.length, 6);
  assert.ok(peak <= 2, 'requestConcurrency 显式变小后必须使用显式上限');
}

// 顺序契约：完成顺序与 allScopes 顺序无关。
{
  const runs = await runnerModule.completeDeferredLocaleScopes(deferredInput({
    scopeCount: 4,
    queryOriginalTm: async (_texts, scope) => {
      if (scope.key === 'deferred-1') await new Promise((resolve) => setTimeout(resolve, 30));
      return [{ tm_match: scope.key, tm_source: scope.key, similarity: 72 }];
    },
  }));
  assert.deepEqual(
    runs.map((run) => run.scope.key),
    ['display', 'deferred-1', 'deferred-2', 'deferred-3'],
    '返回顺序必须严格等于 allScopes 顺序',
  );
}

// 失败隔离：A 失败与 C 失败各自只影响自己的 scope。
{
  const runs = await runnerModule.completeDeferredLocaleScopes(deferredInput({
    scopeCount: 4,
    queryOriginalTm: async (_texts, scope) => {
      if (scope.key === 'deferred-1') throw new Error('TM 1204');
      return [{ tm_match: scope.key, tm_source: scope.key, similarity: 72 }];
    },
    queryFinalTm: async (scopeItems, scope) => {
      if (scope.key === 'deferred-2') throw new Error('final TM 500');
      return scopeItems.map(() => ({ status: 'complete', score: 93 }));
    },
  }));
  assert.equal(runs[1].items[0].roi.status, 'incomplete', 'A 失败的 scope 必须保持 incomplete');
  assert.equal(runs[1].items[0].roi.reason, 'original_tm_query_failed', 'A 失败必须留下可审计 reason');
  assert.match(runs[1].error, /TM 1204/, 'A 失败必须保留原始错误');
  assert.equal(runs[2].items[0].final_tm.status, 'incomplete', 'C 失败的 scope 必须保持 incomplete');
  assert.equal(runs[2].items[0].final_tm.reason, 'final_tm_query_failed', 'C 失败必须留下可审计 reason');
  assert.equal(runs[2].items[0].roi.status, 'incomplete');
  assert.equal(runs[3].items[0].roi.status, 'complete', '其他 scope 不受失败 scope 影响');
  assert.equal(runs[3].items[0].final_tm.score, 93);
}

// 已跑过的 scope 不得重复查询；进度回调仍要可见。
{
  const queried = [];
  const progress = [];
  const runs = await runnerModule.completeDeferredLocaleScopes(deferredInput({
    scopeCount: 3,
    onProgress: (event) => progress.push(event),
    queryOriginalTm: async (_texts, scope) => {
      queried.push(scope.key);
      return [{ tm_match: scope.key, tm_source: scope.key, similarity: 72 }];
    },
  }));
  assert.deepEqual(queried.sort(), ['deferred-1', 'deferred-2'], '已完成的展示 scope 不能重复查询');
  assert.equal(runs[0].items[0].final_tm.score, 91, '已完成 scope 的结果必须原样保留');
  assert.ok(progress.length >= 4, '流水线化后仍必须有可见进度');
  assert.deepEqual(
    [...new Set(progress.map((event) => event.operation))].sort(),
    ['A', 'C'],
    '进度仍区分 A/C 两个可同时 active 的 operation',
  );
  assert.deepEqual(
    progress.map((event) => event.totalLanguages),
    progress.map(() => 2),
    '进度总数必须等于延后 scope 数量',
  );
  assert.deepEqual(
    progress.filter((event) => event.operation === 'A').map((event) => event.completedRequests),
    [1, 2],
    'A 请求完成数必须单调递增',
  );
  assert.deepEqual(
    progress.filter((event) => event.operation === 'C').map((event) => event.completedRequests),
    [1, 2],
    'C 请求完成数必须单调递增',
  );
  for (const event of progress) {
    assert.deepEqual(Object.keys(event).sort(), ['completedLanguages', 'completedRequests', 'operation', 'phase', 'sampleDurationMs', 'totalLanguages'].sort());
    assert.equal(JSON.stringify(event).match(/source|secret|access.?key|token/i), null, 'progress event must not expose source or credentials');
  }
}

console.log('multilingual-runner tests: 55 passed, 0 failed');
