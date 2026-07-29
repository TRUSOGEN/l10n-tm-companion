/** ROI Bitable 三层归档与基础视图回归测试。 */

import assert from 'node:assert/strict';
import {
  FIXED_ROI_ARCHIVE_URL,
  ITEMS_FIELD_SCHEMA,
  ROI_VIEW_DEFINITIONS,
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
    roiArchiveUrl: 'https://bytedance.larkoffice.com/wiki/OLDTARGET?table=tblOld&view=vewOld',
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

console.log('\n=== ROI Bitable archive: 三层 payload ===');
test('固定归档目标与产品约定完全一致', () => {
  assert.equal(
    FIXED_ROI_ARCHIVE_URL,
    'https://bytedance.larkoffice.com/wiki/J1RJwEf0FijMQQkceUkcZyqCnJc?table=tbls3B039S6J7zdT&view=vewSwbY6Ry',
  );
});

test('Runs schema 包含 Operator 与 A/AI/Review 漏斗字段', () => {
  const fields = new Map(RUNS_FIELD_SCHEMA.map((field) => [field.field_name, field.type]));
  assert.equal(fields.get('Operator'), 1);
  assert.equal(fields.get('Operator User ID'), 1);
  assert.equal(fields.get('Operator Open ID'), 1);
  assert.equal(fields.get('Operator Avatar URL'), 1);
  [
    'Pretranslation ≥85',
    'After AI ≥85',
    'AI uplift to ≥85',
    'CD reviewed segments',
    'After Review ≥85',
    'Review uplift to ≥85',
  ].forEach((name) => assert.equal(fields.get(name), 2, name));
});

test('Wiki URL 保留节点、表和视图标识', () => {
  assert.deepEqual(
    parseRoiArchiveUrl('https://bytedance.larkoffice.com/wiki/J1RJwEf0FijMQQkceUkcZyqCnJc?table=tblScope&view=vewScope'),
    { kind: 'wiki', nodeToken: 'J1RJwEf0FijMQQkceUkcZyqCnJc', tableId: 'tblScope', viewId: 'vewScope' },
  );
});

test('归档 Run、Scope 与 source-grain Item，整车 A-C 节省写入 Run', () => {
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
    reviewItems: [{
      similarity: 70,
      ai_quality: { validCandidates: [{ post_rewrite_tm: { status: 'complete', score: 88 } }] },
      review_status: 'confirmed',
      final_tm: { status: 'complete', score: 91 },
    }],
    operator: {
      name: '测试用户',
      enName: 'Test User',
      userId: 'u_test',
      openId: 'ou_test',
      avatarUrl: 'https://example.com/avatar.png',
    },
  });
  assert.equal(payload.items.length, 1);
  assert.equal(payload.scopes.length, 1);
  assert.equal(payload.run.fields['Full translation USD'], 0.62);
  assert.equal(payload.run.fields['TM estimated USD'], 0.42);
  assert.equal(payload.run.fields['Saving USD'], 0.38);
  assert.match(payload.run.fields['Pricing notes'], /Final A-C saving USD: 0\.3800/);
  assert.equal('TM Cost A USD' in payload.scopes[0].fields, false);
  assert.equal('TM Cost C USD' in payload.scopes[0].fields, false);
  assert.equal(payload.run.fields.Operator, '测试用户');
  assert.equal(payload.run.fields['Operator User ID'], 'u_test');
  assert.equal(payload.run.fields['Operator Open ID'], 'ou_test');
  assert.equal(payload.run.fields['Operator Avatar URL'], 'https://example.com/avatar.png');
  assert.equal(payload.run.fields['Pretranslation ≥85'], 0);
  assert.equal(payload.run.fields['After AI ≥85'], 1);
  assert.equal(payload.run.fields['CD reviewed segments'], 1);
});

test('零条确认时禁止生成 ROI 归档 payload', () => {
  assert.throws(() => buildRoiArchivePayload({
    runId: 'roi-zero-confirmed',
    startedAt: Date.now(),
    sourceSegmentCount: 1,
    summary: {
      status: 'incomplete',
      selectedScopeCount: 1,
      completeScopeCount: 0,
      coveredSegmentCount: 0,
      subtotalFullTranslation: 0,
      subtotalBefore: 0,
      subtotalAfter: 0,
      subtotalSaving: 0,
      incompleteScopes: [],
    },
    scopeRuns: [{
      scope: { key: '513:en:fr' },
      items: [{ roi: { status: 'incomplete', reason: 'final_source_text_missing' } }],
    }],
    reviewItems: [{ similarity: 70, review_status: 'draft' }],
  }), /roi_archive_requires_confirmed_review/);
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

console.log('\n=== ROI Bitable archive: 三层写入边界 ===');
await testAsync('按 Run → Scopes → Items → Run status 顺序写入三层记录', async () => {
  const calls = mockFetch([
    { json: { code: 0, data: { node: { obj_type: 'bitable', obj_token: 'appROI' } } } },
    { json: { code: 0, data: { items: [
      { name: 'L10n ROI Runs', table_id: 'tblRuns' },
      { name: 'L10n ROI Scopes', table_id: 'tblScopes' },
      { name: 'L10n ROI Items', table_id: 'tblItems' },
    ] } } },
    { json: { code: 0, data: { items: fieldsFor(RUNS_FIELD_SCHEMA) } } },
    { json: { code: 0, data: { items: fieldsFor(SCOPES_FIELD_SCHEMA) } } },
    { json: { code: 0, data: { items: fieldsFor(ITEMS_FIELD_SCHEMA) } } },
    { json: { code: 0, data: { items: ROI_VIEW_DEFINITIONS
      .filter((view) => view.tableKey === 'runsTableId')
      .map((view) => ({ view_name: view.viewName })) } } },
    { json: { code: 0, data: { items: ROI_VIEW_DEFINITIONS
      .filter((view) => view.tableKey === 'scopesTableId')
      .map((view) => ({ view_name: view.viewName })) } } },
    { json: { code: 0, data: { items: ROI_VIEW_DEFINITIONS
      .filter((view) => view.tableKey === 'itemsTableId')
      .map((view) => ({ view_name: view.viewName })) } } },
    { json: { code: 0, data: { items: [], total: 5 } } },
    { json: { code: 0, data: { items: [], total: 100 } } },
    { json: { code: 0, data: { items: [], total: 1000 } } },
    { json: { code: 0, data: { record: { record_id: 'recRun' } } } },
    { json: { code: 0, data: { records: [{ record_id: 'recScope' }] } } },
    { json: { code: 0, data: { records: [{ record_id: 'recItem' }] } } },
    { json: { code: 0, data: { record: { record_id: 'recRun' } } } },
  ]);
  const result = await writeRoiArchive({
    config: archiveConfig(),
    payload: {
      run: { fields: { 'Run ID': 'roi-success', 'Write status': 'complete' } },
      scopes: [{ fields: { Scope: '513:en:fr', 'Run ID': 'roi-success', 'ROI status': 'complete' } }],
      items: [{ fields: { 'Item ID': 'roi-success:1', 'Run ID': 'roi-success' } }],
    },
  });
  assert.deepEqual(result, {
    runRecordId: 'recRun',
    scopeRecordCount: 1,
    itemRecordCount: 1,
    status: 'complete',
  });
  assert.match(calls[0].url, /token=J1RJwEf0FijMQQkceUkcZyqCnJc$/);
  assert.equal(calls[0].url.includes('OLDTARGET'), false);
  assert.equal(calls.some((call) => call.url.includes('/tables/tblScopes/records/batch_create')), true);
  assert.equal(calls.some((call) => call.url.includes('/tables/tblItems/records/batch_create')), true);
  const writes = calls.filter((call) => (
    call.url.includes('/records') && ['POST', 'PUT'].includes(call.options.method)
  ));
  assert.equal(writes[0].url.includes('/tables/tblRuns/records'), true);
  assert.equal(writes[1].url.includes('/tables/tblScopes/records/batch_create'), true);
  assert.equal(writes[2].url.includes('/tables/tblItems/records/batch_create'), true);
});

await testAsync('任一表达到 20,000 条容量上限时在写入前正确失败', async () => {
  const calls = mockFetch([
    { json: { code: 0, data: { node: { obj_type: 'bitable', obj_token: 'appROI' } } } },
    { json: { code: 0, data: { items: [
      { name: 'L10n ROI Runs', table_id: 'tblRuns' },
      { name: 'L10n ROI Scopes', table_id: 'tblScopes' },
      { name: 'L10n ROI Items', table_id: 'tblItems' },
    ] } } },
    { json: { code: 0, data: { items: fieldsFor(RUNS_FIELD_SCHEMA) } } },
    { json: { code: 0, data: { items: fieldsFor(SCOPES_FIELD_SCHEMA) } } },
    { json: { code: 0, data: { items: fieldsFor(ITEMS_FIELD_SCHEMA) } } },
    { json: { code: 0, data: { items: ROI_VIEW_DEFINITIONS
      .filter((view) => view.tableKey === 'runsTableId')
      .map((view) => ({ view_name: view.viewName })) } } },
    { json: { code: 0, data: { items: ROI_VIEW_DEFINITIONS
      .filter((view) => view.tableKey === 'scopesTableId')
      .map((view) => ({ view_name: view.viewName })) } } },
    { json: { code: 0, data: { items: ROI_VIEW_DEFINITIONS
      .filter((view) => view.tableKey === 'itemsTableId')
      .map((view) => ({ view_name: view.viewName })) } } },
    { json: { code: 0, data: { items: [], total: 20000 } } },
  ]);
  await assert.rejects(
    writeRoiArchive({
      config: archiveConfig(),
      payload: {
        run: { fields: { 'Run ID': 'roi-full', 'Write status': 'complete' } },
        scopes: [{ fields: { Scope: '513:en:fr', 'Run ID': 'roi-full' } }],
        items: [{ fields: { 'Item ID': 'roi-full:1', 'Run ID': 'roi-full' } }],
      },
    }),
    /L10n ROI Runs capacity exceeded: 20000 \+ 1 > 20000/,
  );
  assert.equal(calls.some((call) => call.options.method === 'POST' && call.url.includes('/records')), false);
});

await testAsync('99991679 必须废弃当前 token 并提示发布新版本后重新授权', async () => {
  const removedKeys = [];
  const storedValues = [];
  globalThis.chrome = {
    storage: {
      local: {
        async remove(keys) {
          removedKeys.push(...keys);
        },
        async set(values) {
          storedValues.push(values);
        },
      },
    },
  };
  mockFetch([{
    json: {
      code: 99991679,
      msg: 'Unauthorized. required one of these privileges under the user identity: [bitable:app:readonly, bitable:app, base:record:retrieve]',
    },
  }]);
  await assert.rejects(
    ensureRoiArchiveSchema(archiveConfig()),
    /base:record:retrieve.*publish a new app version.*Reconnect/i,
  );
  assert.equal(removedKeys.includes('feishuUserAccessToken'), true);
  assert.deepEqual(storedValues.at(-1), { feishuUserScope: '' });
  delete globalThis.chrome;
});

await testAsync('首次建表时创建三张表并幂等补齐基础视图', async () => {
  const calls = mockFetch([
    { json: { code: 0, data: { node: { obj_type: 'bitable', obj_token: 'appROI' } } } },
    { json: { code: 0, data: { items: [] } } },
    { json: { code: 0, data: { table_id: 'tblRuns' } } },
    { json: { code: 0, data: { table_id: 'tblScopes' } } },
    { json: { code: 0, data: { table_id: 'tblItems' } } },
    { json: { code: 0, data: { items: [] } } },
    { json: { code: 0, data: { view: { view_id: 'vewManagement' } } } },
    { json: { code: 0, data: { view: { view_id: 'vewOperator' } } } },
    { json: { code: 0, data: { view: { view_id: 'vewQuality' } } },
    },
    { json: { code: 0, data: { items: [] } } },
    { json: { code: 0, data: { view: { view_id: 'vewLocale' } } } },
    { json: { code: 0, data: { view: { view_id: 'vewExceptions' } } } },
    { json: { code: 0, data: { items: [] } } },
    { json: { code: 0, data: { view: { view_id: 'vewAudit' } } } },
  ]);
  const archive = await ensureRoiArchiveSchema(archiveConfig());
  assert.equal(archive.runsTableId, 'tblRuns');
  assert.equal(archive.scopesTableId, 'tblScopes');
  assert.equal(archive.itemsTableId, 'tblItems');
  assert.equal(calls.some((call) => call.body?.table?.name === 'L10n ROI Items'), true);
  const createdViews = calls
    .filter((call) => call.url.includes('/views') && call.options.method === 'POST')
    .map((call) => call.body.view_name);
  assert.deepEqual(createdViews, ROI_VIEW_DEFINITIONS.map((view) => view.viewName));
});

await testAsync('既有表只创建缺失字段且类型冲突正确失败', async () => {
  const missingField = RUNS_FIELD_SCHEMA.at(-1);
  const calls = mockFetch([
    { json: { code: 0, data: { node: { obj_type: 'bitable', obj_token: 'appROI' } } } },
    { json: { code: 0, data: { items: [
      { name: 'L10n ROI Runs', table_id: 'tblRuns' },
      { name: 'L10n ROI Scopes', table_id: 'tblScopes' },
      { name: 'L10n ROI Items', table_id: 'tblItems' },
    ] } } },
    { json: { code: 0, data: { items: fieldsFor(RUNS_FIELD_SCHEMA.slice(0, -1)) } } },
    { json: { code: 0, data: { field: { field_id: 'fldNew' } } } },
    { json: { code: 0, data: { items: fieldsFor(SCOPES_FIELD_SCHEMA) } } },
    { json: { code: 0, data: { items: fieldsFor(ITEMS_FIELD_SCHEMA) } } },
    { json: { code: 0, data: { items: ROI_VIEW_DEFINITIONS
      .filter((view) => view.tableKey === 'runsTableId')
      .map((view) => ({ view_name: view.viewName })) } } },
    { json: { code: 0, data: { items: ROI_VIEW_DEFINITIONS
      .filter((view) => view.tableKey === 'scopesTableId')
      .map((view) => ({ view_name: view.viewName })) } } },
    { json: { code: 0, data: { items: ROI_VIEW_DEFINITIONS
      .filter((view) => view.tableKey === 'itemsTableId')
      .map((view) => ({ view_name: view.viewName })) } } },
  ]);
  await ensureRoiArchiveSchema(archiveConfig());
  const fieldCreate = calls.find((call) => (
    call.url.includes('/tables/tblRuns/fields') && call.options.method === 'POST'
  ));
  assert.equal(fieldCreate.body.field_name, missingField.field_name);
  assert.equal(fieldCreate.body.type, missingField.type);

  mockFetch([
    { json: { code: 0, data: { node: { obj_type: 'bitable', obj_token: 'appROI' } } } },
    { json: { code: 0, data: { items: [
      { name: 'L10n ROI Runs', table_id: 'tblRuns' },
      { name: 'L10n ROI Scopes', table_id: 'tblScopes' },
      { name: 'L10n ROI Items', table_id: 'tblItems' },
    ] } } },
    { json: { code: 0, data: { items: [
      ...fieldsFor(RUNS_FIELD_SCHEMA.slice(1)),
      { field_id: 'bad', field_name: 'Run ID', type: 2 },
    ] } } },
  ]);
  await assert.rejects(
    ensureRoiArchiveSchema(archiveConfig()),
    /field Run ID type 2, expected 1/,
  );
});

console.log(`\nROI Bitable archive 测试: ${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
