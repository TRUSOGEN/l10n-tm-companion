/**
 * ROI_Test 三层分析结构回归测试。
 *
 * 测试锁定 Runs、Scopes、Items 三种粒度、语言级金额与漏斗，以及增量视图定义。
 * Items 必须严格保持一条 source 一条记录，不能与 locale 形成笛卡尔积。
 */

import assert from 'node:assert/strict';

const archive = await import('../lib/roi-bitable-archive.js');

assert.equal(typeof archive.ITEMS_FIELD_SCHEMA, 'object', '必须定义 Items 固定 schema');
assert.equal(typeof archive.ROI_VIEW_DEFINITIONS, 'object', '必须定义 ROI 视图契约');

const scopeFields = new Map(
  archive.SCOPES_FIELD_SCHEMA.map((field) => [field.field_name, field.type]),
);
[
  'Run at',
  'Vendor',
  'Operator',
  'Project names',
  'Covered segments',
  'Confirmed segments',
  'Pretranslation ≥85',
  'After AI ≥85',
  'After Review ≥85',
  'Full translation USD',
  'TM Cost A USD',
  'TM Cost C USD',
  'Saving USD',
].forEach((field) => assert.equal(scopeFields.has(field), true, `Scopes 缺少 ${field}`));

const itemFields = new Map(
  archive.ITEMS_FIELD_SCHEMA.map((field) => [field.field_name, field.type]),
);
[
  'Item ID',
  'Run ID',
  'Source key',
  'Sheet row',
  'Source',
  'Display scope',
  'Best TM Match',
  'Score A',
  'AI rewrite',
  'Score B',
  'Final copy',
  'Score C',
  'AI selected',
  'Review status',
  'Needs attention',
  'Operator',
  'Operator User ID',
  'Operator Avatar URL',
].forEach((field) => assert.equal(itemFields.has(field), true, `Items 缺少 ${field}`));
const reviewStatusField = archive.ITEMS_FIELD_SCHEMA.find(
  (field) => field.field_name === 'Review status',
);
assert.deepEqual(
  reviewStatusField.property.options.map((option) => option.name),
  ['draft', 'confirming', 'confirmed', 'dirty', 'error'],
  'Items Review status 必须覆盖真实确认状态机',
);

const completeRoi = (overrides = {}) => ({
  status: 'complete',
  fullTranslationBaselineCost: 1,
  estimatedCostBefore: 0.6,
  estimatedCostAfter: 0.2,
  estimatedSaving: 0.4,
  ...overrides,
});
const reviewItems = [
  {
    id: 'source-a',
    row: 2,
    source_text: 'Save today',
    tm_source: 'Save now',
    similarity: 70,
    post_rewrite_tm: { status: 'complete', score: 88 },
    ai_translation: 'Save today',
    final_source_text: 'Save today',
    final_tm: { status: 'complete', score: 91 },
    review_status: 'confirmed',
    review: { status: 'confirmed', finalText: 'Save today' },
    ai_quality: {
      validCandidates: [{
        ai_translation: 'Save today',
        post_rewrite_tm: { status: 'complete', score: 88 },
      }],
    },
  },
  {
    id: 'source-b',
    row: 3,
    source_text: 'Open settings',
    tm_source: 'Settings',
    similarity: 90,
    post_rewrite_tm: { status: 'not_required' },
    ai_translation: '',
    final_source_text: 'Open settings',
    final_tm: { status: 'complete', score: 90 },
    review_status: 'confirmed',
    review: { status: 'confirmed', finalText: 'Open settings' },
  },
];
const scopeRuns = ['fr', 'de'].map((targetLocale) => ({
  scope: {
    key: `1,2:en:${targetLocale}`,
    projectIds: [1, 2],
    projectNames: ['Live_campaign', 'TikTok_LIVE_FE'],
    sourceLocale: 'en',
    targetLocale,
  },
  items: reviewItems.map((item, index) => ({
    ...item,
    roi: completeRoi(index === 0 ? {} : {
      fullTranslationBaselineCost: 0.8,
      estimatedCostBefore: 0.5,
      estimatedCostAfter: 0.3,
      estimatedSaving: 0.2,
    }),
  })),
}));

const payload = archive.buildRoiArchivePayload({
  runId: 'roi-analytics',
  startedAt: '2026-07-28T00:00:00.000Z',
  vendor: 'RWS',
  sourceSegmentCount: reviewItems.length,
  projects: ['1', '2'],
  summary: {
    status: 'complete',
    selectedScopeCount: 2,
    completeScopeCount: 2,
    coveredSegmentCount: 4,
    subtotalFullTranslation: 3.6,
    subtotalBefore: 2.2,
    subtotalAfter: 1,
    subtotalSaving: 1.2,
    incompleteScopes: [],
  },
  scopeRuns,
  reviewItems,
  operator: {
    name: 'ROI Owner',
    userId: 'u_owner',
    openId: 'ou_owner',
    avatarUrl: 'https://example.com/avatar.png',
  },
});

assert.equal(payload.scopes.length, 2, '每个 target locale 只生成一条 Scope');
assert.equal(payload.items.length, 2, 'Items 必须按 source 粒度生成，不能得到 2×2');
assert.equal(payload.scopes[0].fields['Covered segments'], 2);
assert.equal(payload.scopes[0].fields['Confirmed segments'], 2);
assert.equal(payload.scopes[0].fields['Full translation USD'], 1.8);
assert.equal(payload.scopes[0].fields['TM Cost A USD'], 1.1);
assert.equal(payload.scopes[0].fields['TM Cost C USD'], 0.5);
assert.equal(payload.scopes[0].fields['Saving USD'], 0.6);
assert.equal(payload.items[0].fields.Source, 'Save today');
assert.equal(payload.items[0].fields['Score A'], 70);
assert.equal(payload.items[0].fields['Score B'], 88);
assert.equal(payload.items[0].fields['Score C'], 91);
assert.equal(payload.items[0].fields['AI selected'], true);
assert.equal(payload.items[0].fields['Needs attention'], false);

assert.deepEqual(
  archive.ROI_VIEW_DEFINITIONS.map((view) => `${view.tableKey}:${view.viewName}`),
  [
    'runsTableId:Management overview',
    'runsTableId:Operator adoption',
    'runsTableId:Quality funnel',
    'scopesTableId:Locale performance',
    'scopesTableId:Exceptions',
    'itemsTableId:Source review audit',
  ],
);

console.log('ROI analytics archive tests: 45 passed, 0 failed');
