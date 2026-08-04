// 多语言 ROI 汇总回归：完整 scope 计入 subtotal，缺失 scope 保留可审计原因。
import assert from 'node:assert/strict';
import { buildRoiFunnelMetrics, deriveVendorRoiResults, summarizeMultilingualRoi } from '../lib/multilingual-roi.js';

let passed = 0;
let failed = 0;

function test(name, callback) {
  try {
    callback();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL ${name}`);
    console.error(error);
  }
}

function complete(estimatedCostBefore, estimatedCostAfter) {
  return {
    status: 'complete',
    fullTranslationBaselineCost: estimatedCostBefore * 1.5,
    estimatedCostBefore,
    estimatedCostAfter,
    estimatedSaving: estimatedCostBefore - estimatedCostAfter,
  };
}

function incomplete(reason) {
  return { status: 'incomplete', reason };
}

console.log('\n=== multilingual-roi: 完整 scope 汇总 ===');
test('汇总所有完整语言 scope 的改写前后成本与节省', () => {
  const summary = summarizeMultilingualRoi([
    { scope: { key: '513:en:ja-JP' }, items: [{ roi: complete(2, 1.5) }] },
    { scope: { key: '513:en:zh-Hans' }, items: [{ roi: complete(4, 3) }, { roi: complete(1, 1) }] },
  ]);

  assert.deepEqual(summary, {
    status: 'complete',
    selectedScopeCount: 2,
    completeScopeCount: 2,
    coveredSegmentCount: 3,
    subtotalFullTranslation: 10.5,
    subtotalBefore: 7,
    subtotalAfter: 5.5,
    subtotalSaving: 1.5,
    incompleteScopes: [],
  });
});

console.log('\n=== multilingual-roi: 缺失费率 scope 不伪造金额 ===');
test('缺失费率时仅汇总完整 scope 并保留语言与原因', () => {
  const summary = summarizeMultilingualRoi([
    { scope: { key: '513:en:ja-JP' }, items: [{ roi: complete(2, 1.5) }] },
    { scope: { key: '513:en:zh-Hans' }, items: [{ roi: incomplete('rate_missing_language_pair') }] },
  ]);

  assert.equal(summary.status, 'incomplete');
  assert.equal(summary.selectedScopeCount, 2);
  assert.equal(summary.completeScopeCount, 1);
  assert.equal(summary.coveredSegmentCount, 1);
  assert.equal(summary.subtotalFullTranslation, 3);
  assert.equal(summary.subtotalBefore, 2);
  assert.equal(summary.subtotalAfter, 1.5);
  assert.equal(summary.subtotalSaving, 0.5);
  assert.deepEqual(summary.incompleteScopes, [{
    key: '513:en:zh-Hans',
    reasons: ['rate_missing_language_pair'],
  }]);
});

console.log('\n=== multilingual-roi: scope 部分完整时仍汇总可计算条目 ===');
test('同一 scope 有不完整条目时保留 complete 条目的金额小计', () => {
  const summary = summarizeMultilingualRoi([{
    scope: { key: '513:en:fr' },
    items: [
      { roi: complete(2, 1.5) },
      { roi: incomplete('final_source_text_missing') },
    ],
  }]);

  assert.deepEqual(summary, {
    status: 'incomplete',
    selectedScopeCount: 1,
    completeScopeCount: 0,
    coveredSegmentCount: 1,
    subtotalFullTranslation: 3,
    subtotalBefore: 2,
    subtotalAfter: 1.5,
    subtotalSaving: 0.5,
    incompleteScopes: [{
      key: '513:en:fr',
      reasons: ['final_source_text_missing'],
    }],
  });
});

console.log('\n=== multilingual-roi: 未启用 LLM 的零节省 ===');
test('post_rewrite_tm not_required 已计算出的 ROI 仍计入且节省为零', () => {
  const summary = summarizeMultilingualRoi([
    {
      scope: { key: '513:en:fr' },
      items: [{
        roi: {
          ...complete(0.04, 0.04),
          postRewriteScoreSource: 'original_snapshot_no_rewrite',
        },
      }],
    },
  ]);

  assert.deepEqual(summary, {
    status: 'complete',
    selectedScopeCount: 1,
    completeScopeCount: 1,
    coveredSegmentCount: 1,
    subtotalFullTranslation: 0.06,
    subtotalBefore: 0.04,
    subtotalAfter: 0.04,
    subtotalSaving: 0,
    incompleteScopes: [],
  });
});

console.log('\n=== multilingual-roi: 完整状态仍必须携带有限金额 ===');
test('改写前金额为 undefined 时排除整个 scope', () => {
  const summary = summarizeMultilingualRoi([{
    scope: { key: '513:en:de' },
    items: [{ roi: { ...complete(2, 1), estimatedCostBefore: undefined } }],
  }]);

  assert.deepEqual(summary, {
    status: 'incomplete',
    selectedScopeCount: 1,
    completeScopeCount: 0,
    coveredSegmentCount: 0,
    subtotalFullTranslation: 0,
    subtotalBefore: 0,
    subtotalAfter: 0,
    subtotalSaving: 0,
    incompleteScopes: [{ key: '513:en:de', reasons: ['roi_amount_invalid'] }],
  });
});

test('改写后金额为 NaN 时排除整个 scope', () => {
  const summary = summarizeMultilingualRoi([{
    scope: { key: '513:en:es' },
    items: [{ roi: { ...complete(2, 1), estimatedCostAfter: Number.NaN } }],
  }]);

  assert.deepEqual(summary, {
    status: 'incomplete',
    selectedScopeCount: 1,
    completeScopeCount: 0,
    coveredSegmentCount: 0,
    subtotalFullTranslation: 0,
    subtotalBefore: 0,
    subtotalAfter: 0,
    subtotalSaving: 0,
    incompleteScopes: [{ key: '513:en:es', reasons: ['roi_amount_invalid'] }],
  });
});

test('节省金额为字符串时排除整个 scope', () => {
  const summary = summarizeMultilingualRoi([{
    scope: { key: '513:en:it' },
    items: [{ roi: { ...complete(2, 1), estimatedSaving: '1' } }],
  }]);

  assert.deepEqual(summary, {
    status: 'incomplete',
    selectedScopeCount: 1,
    completeScopeCount: 0,
    coveredSegmentCount: 0,
    subtotalFullTranslation: 0,
    subtotalBefore: 0,
    subtotalAfter: 0,
    subtotalSaving: 0,
    incompleteScopes: [{ key: '513:en:it', reasons: ['roi_amount_invalid'] }],
  });
});

console.log('\n=== multilingual-roi: A/AI/Review 85% 漏斗 ===');
test('漏斗使用全部 source 与相同已确认样本分母', () => {
  const metrics = buildRoiFunnelMetrics([
    {
      similarity: 90,
      ai_quality: { validCandidates: [] },
      review_status: 'confirmed',
      final_tm: { status: 'complete', score: 92 },
    },
    {
      similarity: 70,
      ai_quality: {
        validCandidates: [{
          post_rewrite_tm: { status: 'complete', score: 88 },
        }],
      },
      review_status: 'confirmed',
      final_tm: { status: 'complete', score: 91 },
    },
    {
      similarity: 60,
      ai_quality: { validCandidates: [] },
      review_status: 'draft',
      final_tm: null,
    },
  ]);
  assert.deepEqual(metrics, {
    pretranslationAt85: 1,
    afterAiAt85: 2,
    aiUpliftTo85: 1,
    cdReviewedSegments: 2,
    afterReviewAt85: 2,
    reviewUpliftTo85: 1,
  });
});

test('双 vendor 从同一份 TM 快照派生金额，不复制 Starling 查询数据', () => {
  const item = {
    source_text: 'One two',
    final_source_text: 'One two revised',
    similarity: 70,
    final_tm: { status: 'complete', score: 90 },
    review_status: 'confirmed',
  };
  const results = deriveVendorRoiResults([{
    scope: { key: '1:en:fr', sourceLocale: 'en', targetLocale: 'fr' },
    items: [item],
  }], {
    schema_version: 1,
    vendors: {
      RWS: [{ source_locale: 'en', target_locale: 'fr', aipe_usd_per_1000_words: 1000, t_only_usd_per_1000_words: 2000 }],
      Pactera: [{ source_locale: 'en', target_locale: 'fr', aipe_usd_per_1000_words: 3000, t_only_usd_per_1000_words: 4000 }],
    },
  }, ['RWS', 'Pactera']);
  assert.deepEqual(Object.keys(results), ['RWS', 'Pactera']);
  assert.notEqual(results.RWS.scopeRuns[0].items[0], item, '派生结果不得改写共享 TM 快照');
  assert.equal(results.RWS.summary.status, 'complete');
  assert.equal(results.Pactera.summary.status, 'complete');
  assert.notEqual(results.RWS.summary.subtotalSaving, results.Pactera.summary.subtotalSaving);
});

test('正式双 vendor ROI 只汇总已确认 A-C，未确认条目保留 incomplete', () => {
  const confirmed = {
    source_text: 'Confirmed source',
    final_source_text: 'Confirmed final',
    similarity: 70,
    final_tm: { status: 'complete', score: 90 },
    review_status: 'confirmed',
  };
  const draft = {
    source_text: 'Draft source',
    ai_translation: 'Draft AI candidate',
    similarity: 70,
    post_rewrite_tm: { status: 'complete', score: 92 },
    review_status: 'draft',
  };
  const results = deriveVendorRoiResults([{
    scope: { key: '1:en:fr', sourceLocale: 'en', targetLocale: 'fr' },
    items: [confirmed, draft],
  }], {
    schema_version: 1,
    vendors: {
      RWS: [{ source_locale: 'en', target_locale: 'fr', aipe_usd_per_1000_words: 1000, t_only_usd_per_1000_words: 2000 }],
      Pactera: [{ source_locale: 'en', target_locale: 'fr', aipe_usd_per_1000_words: 3000, t_only_usd_per_1000_words: 4000 }],
    },
  }, ['RWS', 'Pactera']);
  for (const vendor of ['RWS', 'Pactera']) {
    const vendorResult = results[vendor];
    assert.equal(vendorResult.summary.status, 'incomplete');
    assert.equal(vendorResult.summary.coveredSegmentCount, 1);
    assert.equal(vendorResult.scopeRuns[0].items[1].roi.status, 'incomplete');
    assert.equal(vendorResult.scopeRuns[0].items[1].roi.reason, 'final_source_text_missing');
  }
});

console.log('\n=== multilingual-roi: vendor 语言覆盖路由 ===');
const disjointCatalog = {
  schema_version: 1,
  vendors: {
    RWS: [
      { source_locale: 'en', target_locale: 'de-DE', aipe_usd_per_1000_words: 74, t_only_usd_per_1000_words: 92 },
      { source_locale: 'en', target_locale: 'fr', aipe_usd_per_1000_words: 74, t_only_usd_per_1000_words: 92 },
    ],
    Pactera: [
      { source_locale: 'en', target_locale: 'ja-JP', aipe_usd_per_1000_words: 56, t_only_usd_per_1000_words: 80 },
    ],
  },
};

function confirmedItem() {
  return {
    source_text: 'One two three',
    final_source_text: 'One two three revised',
    similarity: 70,
    final_tm: { status: 'complete', score: 90 },
    review_status: 'confirmed',
  };
}

test('vendor 不服务的语言 scope 不进入该 vendor 结果，也不再伪装成 incomplete', () => {
  const scopeRuns = [
    { scope: { key: 'p:en:de-DE', sourceLocale: 'en', targetLocale: 'de-DE' }, items: [confirmedItem()] },
    { scope: { key: 'p:en:fr', sourceLocale: 'en', targetLocale: 'fr' }, items: [confirmedItem()] },
    { scope: { key: 'p:en:ja-JP', sourceLocale: 'en', targetLocale: 'ja-JP' }, items: [confirmedItem()] },
  ];
  const results = deriveVendorRoiResults(scopeRuns, disjointCatalog, ['RWS', 'Pactera']);

  assert.deepEqual(results.RWS.scopeRuns.map((run) => run.scope.key), ['p:en:de-DE', 'p:en:fr']);
  assert.equal(results.RWS.summary.status, 'complete');
  assert.equal(results.RWS.summary.selectedScopeCount, 2);
  assert.equal(results.RWS.summary.completeScopeCount, 2);
  assert.deepEqual(results.RWS.summary.incompleteScopes, []);
  assert.deepEqual(results.RWS.unservedScopes, [{ key: 'p:en:ja-JP', targetLocale: 'ja-JP' }]);
  assert.equal(results.RWS.requestedScopeCount, 3);

  assert.deepEqual(results.Pactera.scopeRuns.map((run) => run.scope.key), ['p:en:ja-JP']);
  assert.equal(results.Pactera.summary.status, 'complete');
  assert.deepEqual(results.Pactera.summary.incompleteScopes, []);
  assert.deepEqual(
    results.Pactera.unservedScopes.map((scope) => scope.targetLocale),
    ['de-DE', 'fr'],
  );
});

test('全部语言都不被某 vendor 服务时该 vendor 没有可归档 scope', () => {
  const results = deriveVendorRoiResults([
    { scope: { key: 'p:en:de-DE', sourceLocale: 'en', targetLocale: 'de-DE' }, items: [confirmedItem()] },
    { scope: { key: 'p:en:fr', sourceLocale: 'en', targetLocale: 'fr' }, items: [confirmedItem()] },
  ], disjointCatalog, ['RWS', 'Pactera']);

  assert.equal(results.RWS.scopeRuns.length, 2);
  assert.equal(results.Pactera.scopeRuns.length, 0);
  assert.equal(results.Pactera.unservedScopes.length, 2);
  assert.equal(results.Pactera.summary.selectedScopeCount, 0);
});

test('服务该语言但缺按字费率时仍保留 incomplete，不得静默丢弃 scope', () => {
  const hourlyOnlyCatalog = {
    schema_version: 1,
    vendors: {
      RWS: [{ source_locale: 'en', target_locale: 'de-DE', hourly_rate_usd: 40 }],
    },
  };
  const results = deriveVendorRoiResults([
    { scope: { key: 'p:en:de-DE', sourceLocale: 'en', targetLocale: 'de-DE' }, items: [confirmedItem()] },
  ], hourlyOnlyCatalog, ['RWS']);

  assert.equal(results.RWS.scopeRuns.length, 1);
  assert.deepEqual(results.RWS.unservedScopes, []);
  assert.equal(results.RWS.summary.status, 'incomplete');
  assert.deepEqual(results.RWS.summary.incompleteScopes, [{
    key: 'p:en:de-DE',
    reasons: ['rate_missing_word_rate'],
  }]);
});

console.log(`\nmultilingual-roi 测试: ${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
