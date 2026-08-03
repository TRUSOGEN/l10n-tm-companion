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

/** 安装可跨两次 writeRoiArchive 调用保留远端状态的 Feishu API fake。 */
function installStatefulArchiveFetch({ failOnceAt = '' } = {}) {
  const tables = {
    tblRuns: { name: 'L10n ROI Runs', schema: RUNS_FIELD_SCHEMA, records: [] },
    tblScopes: { name: 'L10n ROI Scopes', schema: SCOPES_FIELD_SCHEMA, records: [] },
    tblItems: { name: 'L10n ROI Items', schema: ITEMS_FIELD_SCHEMA, records: [] },
  };
  const calls = [];
  let failed = false;
  let sequence = 0;
  globalThis.fetch = async (rawUrl, options = {}) => {
    const url = new URL(String(rawUrl));
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: url.toString(), options, body });
    const ok = (data) => ({ ok: true, json: async () => ({ code: 0, data }) });
    if (url.pathname.endsWith('/wiki/v2/spaces/get_node')) {
      return ok({ node: { obj_type: 'bitable', obj_token: 'appROI' } });
    }
    if (url.pathname.endsWith('/tables')) {
      return ok({ items: Object.entries(tables).map(([table_id, table]) => ({ table_id, name: table.name })) });
    }
    const tableId = url.pathname.match(/\/tables\/(tbl[^/]+)/)?.[1];
    const table = tables[tableId];
    if (!table) throw new Error(`Unexpected stateful fake URL: ${url}`);
    if (url.pathname.endsWith('/fields')) return ok({ items: fieldsFor(table.schema) });
    if (url.pathname.endsWith('/views')) {
      const key = tableId === 'tblRuns' ? 'runsTableId' : (tableId === 'tblScopes' ? 'scopesTableId' : 'itemsTableId');
      return ok({ items: ROI_VIEW_DEFINITIONS.filter((view) => view.tableKey === key).map((view) => ({ view_name: view.viewName })) });
    }
    if (url.pathname.endsWith('/records/search')) {
      const condition = body?.filter?.conditions?.[0];
      const matches = table.records.filter((record) => (
        String(record.fields?.[condition?.field_name] || '') === String(condition?.value?.[0] || '')
      ));
      return ok({ items: matches, total: matches.length, has_more: false });
    }
    if (options.method === 'GET' && url.pathname.endsWith('/records')) {
      return ok({ items: [], total: table.records.length });
    }
    if (options.method === 'POST' && url.pathname.endsWith('/records')) {
      const record = { record_id: `rec${++sequence}`, fields: body.fields };
      table.records.push(record);
      return ok({ record });
    }
    if (options.method === 'POST' && url.pathname.endsWith('/records/batch_create')) {
      const created = body.records.map((record) => ({ record_id: `rec${++sequence}`, fields: record.fields }));
      table.records.push(...created);
      const stage = tableId === 'tblScopes' ? 'scopes' : 'items';
      if (!failed && failOnceAt === stage) {
        failed = true;
        throw new Error(`simulated ${stage} response loss after remote commit`);
      }
      return ok({ records: created });
    }
    const recordId = url.pathname.match(/\/records\/(rec[^/]+)$/)?.[1];
    if (options.method === 'PUT' && recordId) {
      const record = table.records.find((entry) => entry.record_id === recordId);
      if (!record) throw new Error(`Unknown record ${recordId}`);
      record.fields = body.fields;
      return ok({ record });
    }
    throw new Error(`Unexpected stateful fake operation: ${options.method || 'GET'} ${url}`);
  };
  return { calls, tables };
}

function resumableWritePayload(runId) {
  return {
    run: { fields: { 'Run ID': runId, 'Write status': 'complete' } },
    scopes: [{ fields: { Scope: '513:en:fr', 'Run ID': runId, 'ROI status': 'complete' } }],
    items: [{ fields: { 'Item ID': `${runId}:1`, 'Run ID': runId } }],
  };
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

test('第二个 vendor Run 不重复写 source-grain 审阅记录', () => {
  const payload = buildRoiArchivePayload({
    runId: 'roi-pactera-scope-only',
    startedAt: '2026-07-31T00:00:00.000Z',
    vendor: 'Pactera',
    sourceSegmentCount: 1,
    summary: {
      status: 'complete', selectedScopeCount: 1, completeScopeCount: 1,
      coveredSegmentCount: 1, subtotalFullTranslation: 0.3, subtotalBefore: 0.2,
      subtotalAfter: 0.1, subtotalSaving: 0.1, incompleteScopes: [],
    },
    scopeRuns: [{
      scope: { key: '513:en:fr', projectId: 513, sourceLocale: 'en', targetLocale: 'fr' },
      items: [finalItem()],
    }],
    reviewItems: [{ review_status: 'confirmed' }],
    includeReviewItems: false,
  });
  assert.equal(payload.items.length, 0);
  assert.equal(payload.scopes.length, 1);
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
    { json: { code: 0, data: { items: [], total: 0, has_more: false } } },
    { json: { code: 0, data: { items: [], total: 5 } } },
    { json: { code: 0, data: { items: [], total: 100 } } },
    { json: { code: 0, data: { items: [], total: 1000 } } },
    { json: { code: 0, data: { record: { record_id: 'recRun' } } } },
    { json: { code: 0, data: { items: [{ record_id: 'recRun', fields: { 'Run ID': 'roi-success', 'Write status': 'writing' } }], total: 1, has_more: false } } },
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
    call.url.includes('/records')
      && !call.url.includes('/records/search')
      && ['POST', 'PUT'].includes(call.options.method)
  ));
  assert.equal(writes[0].url.includes('/tables/tblRuns/records'), true);
  assert.equal(writes[1].url.includes('/tables/tblScopes/records/batch_create'), true);
  assert.equal(writes[2].url.includes('/tables/tblItems/records/batch_create'), true);
});

await testAsync('第二个 vendor 只写 Run 与 Scopes，复用第一份共享 Items', async () => {
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
    { json: { code: 0, data: { items: [], total: 0, has_more: false } } },
    { json: { code: 0, data: { items: [], total: 6 } } },
    { json: { code: 0, data: { items: [], total: 101 } } },
    { json: { code: 0, data: { items: [], total: 1001 } } },
    { json: { code: 0, data: { record: { record_id: 'recPacteraRun' } } } },
    { json: { code: 0, data: { items: [{ record_id: 'recPacteraRun', fields: { 'Run ID': 'roi-pactera', 'Write status': 'writing' } }], total: 1, has_more: false } } },
    { json: { code: 0, data: { records: [{ record_id: 'recPacteraScope' }] } } },
    { json: { code: 0, data: { record: { record_id: 'recPacteraRun' } } } },
  ]);
  const result = await writeRoiArchive({
    config: archiveConfig(),
    payload: {
      run: { fields: { 'Run ID': 'roi-pactera', 'Write status': 'complete' } },
      scopes: [{ fields: { Scope: '513:en:fr', 'Run ID': 'roi-pactera', 'ROI status': 'complete' } }],
      items: [],
    },
  });
  assert.deepEqual(result, {
    runRecordId: 'recPacteraRun',
    scopeRecordCount: 1,
    itemRecordCount: 0,
    status: 'complete',
  });
  assert.equal(calls.some((call) => call.url.includes('/tables/tblItems/records/batch_create')), false);
});

await testAsync('Run 已创建且 Scope 响应丢失后按稳定键续写，不重复 Run 或 Scope', async () => {
  const fake = installStatefulArchiveFetch({ failOnceAt: 'scopes' });
  const payload = resumableWritePayload('roi-resume-scope');
  await assert.rejects(
    writeRoiArchive({ config: archiveConfig(), payload }),
    /simulated scopes response loss after remote commit/,
  );
  const result = await writeRoiArchive({ config: archiveConfig(), payload });
  assert.equal(result.status, 'complete');
  assert.equal(fake.tables.tblRuns.records.length, 1);
  assert.equal(fake.tables.tblScopes.records.length, 1);
  assert.equal(fake.tables.tblItems.records.length, 1);
});

await testAsync('Scopes 和 Items 已远端成功但 Item 响应丢失时只完成状态，不重复明细', async () => {
  const fake = installStatefulArchiveFetch({ failOnceAt: 'items' });
  const payload = resumableWritePayload('roi-resume-item');
  await assert.rejects(
    writeRoiArchive({ config: archiveConfig(), payload }),
    /simulated items response loss after remote commit/,
  );
  const result = await writeRoiArchive({ config: archiveConfig(), payload });
  assert.equal(result.status, 'complete');
  assert.equal(fake.tables.tblRuns.records.length, 1);
  assert.equal(fake.tables.tblScopes.records.length, 1);
  assert.equal(fake.tables.tblItems.records.length, 1);
});

await testAsync('同一 Run ID 已有多条 Run 时正确失败且不追加明细', async () => {
  const fake = installStatefulArchiveFetch();
  const payload = resumableWritePayload('roi-duplicate');
  fake.tables.tblRuns.records.push(
    { record_id: 'recDuplicate1', fields: { 'Run ID': 'roi-duplicate', 'Write status': 'writing' } },
    { record_id: 'recDuplicate2', fields: { 'Run ID': 'roi-duplicate', 'Write status': 'writing' } },
  );
  await assert.rejects(
    writeRoiArchive({ config: archiveConfig(), payload }),
    /duplicate Run ID: roi-duplicate \(2 records\)/,
  );
  assert.equal(fake.tables.tblScopes.records.length, 0);
  assert.equal(fake.tables.tblItems.records.length, 0);
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
    { json: { code: 0, data: { items: [], total: 0, has_more: false } } },
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
  assert.equal(calls.some((call) => (
    call.options.method === 'POST'
      && call.url.includes('/records')
      && !call.url.includes('/records/search')
  )), false);
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
