/** ROI Bitable 两表归档回归测试。 */

import assert from 'node:assert/strict';
import {
  RUNS_FIELD_SCHEMA,
  SCOPES_FIELD_SCHEMA,
  buildRoiArchivePayload,
  ensureRoiArchiveSchema,
  parseRoiArchiveUrl,
  writeRoiArchive,
} from '../lib/roi-bitable-archive.js';

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

async function testAsync(name, callback) {
  try {
    await callback();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL ${name}`);
    console.error(error);
  }
}

function mockFetch(responses) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options, body: options.body ? JSON.parse(options.body) : null });
    const response = responses.shift();
    if (!response) throw new Error(`Unexpected fetch: ${url}`);
    return { ok: response.ok !== false, json: async () => response.json };
  };
  return calls;
}

function fieldsFor(schema) {
  return schema.map((field, index) => ({ field_id: `fld${index}`, field_name: field.field_name, type: field.type }));
}

function archiveConfig() {
  return {
    feishuUserAccessToken: 'user-token',
    roiArchiveUrl: 'https://bytedance.larkoffice.com/wiki/J1R?table=tblCurrent&view=vewCurrent',
  };
}

function finalItem(overrides = {}) {
  return {
    roi: {
      status: 'complete',
      tmCostBeforeOptimization: 0.42,
      tmCostAfterOptimization: 0.24,
      aiOptimizationSaving: 0.18,
      ...overrides,
    },
  };
}

console.log('\n=== ROI Bitable archive: 两表 payload ===');
test('Wiki URL 保留节点、表和视图标识', () => {
  assert.deepEqual(
    parseRoiArchiveUrl('https://bytedance.larkoffice.com/wiki/J1RJwEf0FijMQQkceUkcZyqCnJc?table=tblScope&view=vewScope'),
    { kind: 'wiki', nodeToken: 'J1RJwEf0FijMQQkceUkcZyqCnJc', tableId: 'tblScope', viewId: 'vewScope' },
  );
});

test('只归档 Run 与 Scope，整车 A-C 节省写入 Run', () => {
  const payload = buildRoiArchivePayload({
    runId: 'roi-two-table',
    startedAt: '2026-07-20T00:00:00.000Z',
    vendor: 'Pactera',
    sourceSegmentCount: 2,
    projects: ['513'],
    summary: {
      status: 'complete', selectedScopeCount: 1, completeScopeCount: 1,
      subtotalFullTranslation: 0.62, subtotalBefore: 0.42, subtotalAfter: 0.04,
      subtotalSaving: 0.38, incompleteScopes: [],
    },
    scopeRuns: [{
      scope: { key: '513:en:fr', projectId: 513, sourceLocale: 'en', targetLocale: 'fr' },
      items: [finalItem(), finalItem({ tmCostBeforeOptimization: 0.3, tmCostAfterOptimization: 0.1, aiOptimizationSaving: 0.2 })],
    }],
  });
  assert.equal('items' in payload, false);
  assert.equal(payload.scopes.length, 1);
  assert.equal(payload.run.fields['Full translation USD'], 0.62);
  assert.equal(payload.run.fields['TM estimated USD'], 0.42);
  assert.equal(payload.run.fields['Saving USD'], 0.38);
  assert.match(payload.run.fields['Pricing notes'], /Final A-C saving USD: 0\.3800/);
  assert.equal('TM Cost A USD' in payload.scopes[0].fields, false);
  assert.equal('TM Cost C USD' in payload.scopes[0].fields, false);
});

test('多项目语言 scope 在一条记录中保留全部项目 ID', () => {
  const payload = buildRoiArchivePayload({
    runId: 'roi-shared-locale',
    startedAt: '2026-07-21T00:00:00.000Z',
    vendor: 'Pactera',
    sourceSegmentCount: 1,
    projects: ['513', '385'],
    summary: {
      status: 'complete', selectedScopeCount: 1, completeScopeCount: 1,
      subtotalFullTranslation: 0.3, subtotalBefore: 0.2, subtotalAfter: 0.1,
      subtotalSaving: 0.1, incompleteScopes: [],
    },
    scopeRuns: [{
      scope: {
        key: '513,385:en:fr', projectIds: [513, 385],
        projectNames: ['live_client', 'TikTok_Client'], sourceLocale: 'en', targetLocale: 'fr',
      },
      items: [finalItem()],
    }],
  });
  assert.equal(payload.scopes[0].fields.Project, '513, 385');
  assert.equal(payload.scopes[0].fields.Scope, '513,385:en:fr');
});

test('不完整整车仅写已覆盖语言小计，Scope 保留失败原因', () => {
  const payload = buildRoiArchivePayload({
    runId: 'roi-incomplete',
    startedAt: '2026-07-20T00:00:00.000Z',
    vendor: 'RWS',
    sourceSegmentCount: 1,
    projects: ['513'],
    summary: {
      status: 'incomplete', selectedScopeCount: 1, completeScopeCount: 0, coveredSegmentCount: 1,
      subtotalFullTranslation: 0.32, subtotalBefore: 0.24, subtotalAfter: 0.06,
      subtotalSaving: 0.18,
      incompleteScopes: [{ key: '513:en:ar', reasons: ['rate_missing_language_pair'] }],
    },
    scopeRuns: [{
      scope: { key: '513:en:ar', projectId: 513, sourceLocale: 'en', targetLocale: 'ar' },
      items: [{ roi: { status: 'incomplete', reason: 'rate_missing_language_pair' } }],
    }],
  });
  const fields = payload.scopes[0].fields;
  assert.equal(fields['ROI status'], 'incomplete');
  assert.match(fields['Failure reasons'], /rate_missing_language_pair/);
  assert.equal(payload.run.fields['Full translation USD'], 0.32);
  assert.equal(payload.run.fields['TM estimated USD'], 0.24);
  assert.equal(payload.run.fields['Saving USD'], 0.18);
  assert.match(payload.run.fields['Pricing notes'], /Covered subtotal A-C saving USD: 0\.1800/);
});

console.log('\n=== ROI Bitable archive: 两表写入边界 ===');
await testAsync('只访问 Runs 与 Scopes，不读取或写入 Items', async () => {
  const calls = mockFetch([
    { json: { code: 0, data: { node: { obj_type: 'bitable', obj_token: 'appROI' } } } },
    { json: { code: 0, data: { items: [
      { name: 'L10n ROI Runs', table_id: 'tblRuns' },
      { name: 'L10n ROI Scopes', table_id: 'tblScopes' },
      { name: 'L10n ROI Items', table_id: 'tblItemsLegacy' },
    ] } } },
    { json: { code: 0, data: { items: fieldsFor(RUNS_FIELD_SCHEMA) } } },
    { json: { code: 0, data: { items: fieldsFor(SCOPES_FIELD_SCHEMA) } } },
    { json: { code: 0, data: { record: { record_id: 'recRun' } } } },
    { json: { code: 0, data: { records: [{ record_id: 'recScope' }] } } },
    { json: { code: 0, data: { record: { record_id: 'recRun' } } } },
  ]);
  const result = await writeRoiArchive({
    config: archiveConfig(),
    payload: {
      run: { fields: { 'Run ID': 'roi-success', 'Write status': 'complete' } },
      scopes: [{ fields: { Scope: '513:en:fr', 'Run ID': 'roi-success', 'ROI status': 'complete' } }],
    },
  });
  assert.deepEqual(result, { runRecordId: 'recRun', scopeRecordCount: 1, status: 'complete' });
  assert.equal(calls.some((call) => call.url.includes('tblItemsLegacy')), false);
  assert.equal(calls.some((call) => call.url.includes('/tables/tblScopes/records/batch_create')), true);
});

await testAsync('首次建表后不要求配置任何公式字段', async () => {
  const calls = mockFetch([
    { json: { code: 0, data: { node: { obj_type: 'bitable', obj_token: 'appROI' } } } },
    { json: { code: 0, data: { items: [] } } },
    { json: { code: 0, data: { table_id: 'tblRuns' } } },
    { json: { code: 0, data: { table_id: 'tblScopes' } } },
  ]);
  const archive = await ensureRoiArchiveSchema(archiveConfig());
  assert.equal(archive.runsTableId, 'tblRuns');
  assert.equal(archive.scopesTableId, 'tblScopes');
  assert.equal(calls.some((call) => call.body?.table?.name === 'L10n ROI Items'), false);
});

console.log(`\nROI Bitable archive 测试: ${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
