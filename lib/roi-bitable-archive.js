/**
 * ROI 多维表格归档适配器。
 *
 * 模块将多语言 ROI 的内存结果转为可审计的 Run/Scope 记录，并负责解析 Bitable
 * 目标、初始化固定 schema 与执行受确认触发的飞书写入。纯数据转换不访问网络，网络
 * 操作通过当前配置的 App ID / App Secret 换取 tenant access token 严格失败；
 * 不以默认费率、过期令牌或伪造金额降级。
 */

import { getTenantToken } from './feishu-bitable.js';

export const RUNS_TABLE_NAME = 'L10n ROI Runs';
export const SCOPES_TABLE_NAME = 'L10n ROI Scopes';

const FEISHU_BASE = 'https://open.feishu.cn/open-apis';
const TEXT = 1;
const NUMBER = 2;
const SINGLE_SELECT = 3;
const DATETIME = 5;

/** `L10n ROI Runs` 的固定字段定义。 */
export const RUNS_FIELD_SCHEMA = Object.freeze([
  { field_name: 'Run ID', type: TEXT },
  { field_name: 'Run at', type: DATETIME },
  { field_name: 'Write status', type: SINGLE_SELECT, property: { options: [
    { name: 'writing' }, { name: 'complete' }, { name: 'incomplete' }, { name: 'write_failed' },
  ] } },
  { field_name: 'Source segments', type: NUMBER },
  { field_name: 'Vendor', type: TEXT },
  { field_name: 'Projects', type: TEXT },
  { field_name: 'Selected scopes', type: NUMBER },
  { field_name: 'Complete scopes', type: NUMBER },
  { field_name: 'Coverage', type: TEXT },
  { field_name: 'Full translation USD', type: NUMBER },
  { field_name: 'TM estimated USD', type: NUMBER },
  { field_name: 'Saving USD', type: NUMBER },
  { field_name: 'Incomplete scopes', type: TEXT },
  { field_name: 'Pricing notes', type: TEXT },
]);

/** `L10n ROI Scopes` 的固定字段定义。 */
export const SCOPES_FIELD_SCHEMA = Object.freeze([
  { field_name: 'Scope', type: TEXT },
  { field_name: 'Run ID', type: TEXT },
  { field_name: 'Project', type: TEXT },
  { field_name: 'Source locale', type: TEXT },
  { field_name: 'Target locale', type: TEXT },
  { field_name: 'ROI status', type: SINGLE_SELECT, property: { options: [
    { name: 'complete' }, { name: 'incomplete' },
  ] } },
  { field_name: 'Source segments', type: NUMBER },
  { field_name: 'Failure reasons', type: TEXT },
  { field_name: 'Pricing notes', type: TEXT },
]);

/**
 * 生成整车 A-C 节省金额的可读文本。
 *
 * 严格覆盖语义保持不变：完整整车写 Final saving；存在缺失 scope 时只能写已覆盖语言
 * 小计，不能把小计伪装为整车金额。
 */
function formatRunSavingNote(summary) {
  if (!Number.isFinite(summary?.subtotalSaving)) return '';
  const label = summary.status === 'complete'
    ? 'Final A-C saving USD'
    : 'Covered subtotal A-C saving USD';
  return `${label}: ${summary.subtotalSaving.toFixed(4)}`;
}

/**
 * 解析 ROI 归档目标 URL。
 *
 * @param {string} input Wiki 或 /base/ Bitable URL。
 * @returns {{kind: 'wiki', nodeToken: string, tableId: string|null, viewId: string|null}|{kind: 'base', appToken: string, tableId: string|null, viewId: string|null}}
 */
export function parseRoiArchiveUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch (_error) {
    throw new Error('ROI archive URL must be a Feishu Wiki or Bitable link');
  }
  const tableId = url.searchParams.get('table') || null;
  const viewId = url.searchParams.get('view') || null;
  const wiki = url.pathname.match(/\/wiki\/([A-Za-z0-9]+)/);
  if (wiki) return { kind: 'wiki', nodeToken: wiki[1], tableId, viewId };
  const base = url.pathname.match(/\/base\/([A-Za-z0-9]+)/);
  if (base) return { kind: 'base', appToken: base[1], tableId, viewId };
  throw new Error('ROI archive URL must be a Feishu Wiki or Bitable link');
}

/**
 * 生成稳定、去重的可审计文本列表。
 *
 * @param {Array<string>} values 输入文字。
 * @returns {string} 换行分隔的唯一文本。
 */
function joinUniqueLines(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()))].join('\n');
}

/**
 * 解析单个 scope 的完成状态与失败原因。
 *
 * @param {Array<object>} items scope 内的处理条目。
 * @returns {{status: 'complete'|'incomplete', reasons: string[]}}
 */
function resolveScopeStatus(items) {
  const reasons = [...new Set(items
    .filter((item) => item?.roi?.status !== 'complete')
    .map((item) => item?.roi?.reason || 'roi_unavailable'))];
  return reasons.length > 0 ? { status: 'incomplete', reasons } : { status: 'complete', reasons: [] };
}

/**
 * 将每个 scope 转为 Bitable 记录字段。
 *
 * @param {string} runId 当前运行 ID。
 * @param {{scope: object, items: object[]}} scopeRun 单个 scope 执行结果。
 * @returns {{fields: object}} Bitable records/batch_create 记录。
 */
function buildScopeRecord(runId, scopeRun) {
  const { scope = {}, items = [] } = scopeRun;
  const resolved = resolveScopeStatus(items);
  const projectIds = Array.isArray(scope.projectIds)
    ? scope.projectIds.map(String)
    : (scope.projectId === undefined || scope.projectId === null ? [] : [String(scope.projectId)]);
  const fields = {
    Scope: scope.key || `${projectIds.join(',')}:${scope.sourceLocale || ''}:${scope.targetLocale || ''}`,
    'Run ID': runId,
    Project: projectIds.join(', '),
    'Source locale': scope.sourceLocale || '',
    'Target locale': scope.targetLocale || '',
    'ROI status': resolved.status,
    'Source segments': items.length,
    'Failure reasons': resolved.reasons.join(', '),
    'Pricing notes': joinUniqueLines(items.map((item) => item.match_category || item.roi?.pricingNote || '')),
  };
  return { fields };
}

/**
 * 将多语言 ROI 汇总转为 Run 与 Scope 两张表的追加记录。
 *
 * @param {object} input 运行元数据、汇总和 scope 结果。
 * @returns {{run: {fields: object}, scopes: Array<{fields: object}>}} 可直接写入的 payload。
 */
export function buildRoiArchivePayload(input) {
  const {
    runId,
    startedAt,
    vendor,
    sourceSegmentCount,
    projects = [],
    summary,
    scopeRuns = [],
  } = input || {};
  if (!runId || !summary || !['complete', 'incomplete'].includes(summary.status)) {
    throw new Error('ROI archive payload requires a complete or incomplete ROI summary and Run ID');
  }
  const scopes = scopeRuns.map((scopeRun) => buildScopeRecord(runId, scopeRun));
  const hasCoveredAmount = summary.coveredSegmentCount > 0 || summary.completeScopeCount > 0;
  const pricingNotes = joinUniqueLines([
    formatRunSavingNote(summary),
    ...scopes.map((scope) => scope.fields['Pricing notes']),
  ]);
  const incompleteScopes = (summary.incompleteScopes || [])
    .map((scope) => `${scope.key}: ${(scope.reasons || []).join(', ')}`)
    .join('\n');
  return {
    run: {
      fields: {
        'Run ID': runId,
        'Run at': typeof startedAt === 'string' ? Date.parse(startedAt) : startedAt,
        'Write status': summary.status,
        'Source segments': sourceSegmentCount,
        Vendor: vendor || '',
        Projects: projects.map(String).join('\n'),
        'Selected scopes': summary.selectedScopeCount,
        'Complete scopes': summary.completeScopeCount,
        Coverage: `${summary.completeScopeCount} / ${summary.selectedScopeCount}`,
        // Full translation 为参考基线；TM estimated 为原始 A 的 TM 成本；Saving 严格为 A-C。
        ...(hasCoveredAmount ? {
          'Full translation USD': summary.subtotalFullTranslation,
          'TM estimated USD': summary.subtotalBefore,
          'Saving USD': summary.subtotalSaving,
        } : {}),
        'Incomplete scopes': incompleteScopes,
        'Pricing notes': pricingNotes,
      },
    },
    scopes,
  };
}

/**
 * 调用飞书 JSON 接口并将 API 错误转换为可见异常。
 *
 * @param {string} url 请求地址。
 * @param {string} accessToken 当前请求对应的飞书 access token。
 * @param {string} [method='GET'] HTTP 方法。
 * @param {object|null} [body=null] JSON 请求体。
 * @returns {Promise<object>} 飞书响应的 data 字段。
 */
async function requestJson(url, accessToken, method = 'GET', body = null) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok || data.code !== 0) {
    throw new Error(`ROI Bitable API error: ${data.msg || data.code || response.status}`);
  }
  return data.data || {};
}

/**
 * 解析配置的归档 URL，并获得该次操作可用的 Bitable App Token。
 *
 * @param {{feishuAppId: string, feishuAppSecret: string, roiArchiveUrl: string}} config 飞书与归档配置。
 * @returns {Promise<{appToken: string, accessToken: string, tableId: string|null, viewId: string|null}>} 已验证目标。
 */
export async function resolveRoiArchiveTarget(config) {
  if (!config?.roiArchiveUrl) {
    throw new Error('ROI archive Bitable URL is not configured');
  }
  const accessToken = await resolveRoiArchiveAccessToken(config);
  const parsed = parseRoiArchiveUrl(config.roiArchiveUrl);
  if (parsed.kind === 'base') {
    return {
      appToken: parsed.appToken,
      accessToken,
      tableId: parsed.tableId,
      viewId: parsed.viewId,
    };
  }
  const data = await requestJson(
    `${FEISHU_BASE}/wiki/v2/spaces/get_node?token=${encodeURIComponent(parsed.nodeToken)}`,
    accessToken,
  );
  const node = data.node || {};
  if (node.obj_type !== 'bitable' || !node.obj_token) {
    throw new Error(`ROI archive Wiki node is not a Bitable: ${node.obj_type || 'unknown'}`);
  }
  return {
    appToken: node.obj_token,
    accessToken,
    tableId: parsed.tableId,
    viewId: parsed.viewId,
  };
}

/**
 * 获取本次 Bitable 写入所需的应用身份 token。
 *
 * @param {{feishuAppId?: string, feishuAppSecret?: string}} config 飞书配置。
 * @returns {Promise<string>} tenant access token。
 */
async function resolveRoiArchiveAccessToken(config) {
  const appId = typeof config?.feishuAppId === 'string' ? config.feishuAppId.trim() : '';
  const appSecret = typeof config?.feishuAppSecret === 'string' ? config.feishuAppSecret.trim() : '';
  if (appId || appSecret) {
    if (!appId || !appSecret) {
      throw new Error('Feishu App ID and App Secret must be configured together for ROI archive');
    }
    return getTenantToken(appId, appSecret);
  }

  const legacyUserToken = typeof config?.feishuUserAccessToken === 'string'
    ? config.feishuUserAccessToken.trim()
    : '';
  if (legacyUserToken) return legacyUserToken;
  throw new Error('Configure Feishu App ID and App Secret before writing ROI archive');
}

/**
 * 列出一个 Bitable App 的全部数据表。
 *
 * @param {{appToken: string, accessToken: string}} target 已验证 Bitable 目标。
 * @returns {Promise<Array<{name: string, table_id: string}>>} 数据表列表。
 */
async function listTables(target) {
  const tables = [];
  let pageToken = null;
  do {
    const url = new URL(`${FEISHU_BASE}/bitable/v1/apps/${target.appToken}/tables`);
    url.searchParams.set('page_size', '100');
    if (pageToken) url.searchParams.set('page_token', pageToken);
    const data = await requestJson(url.toString(), target.accessToken);
    tables.push(...(data.items || []));
    pageToken = data.has_more ? data.page_token : null;
  } while (pageToken);
  return tables;
}

/**
 * 读取某数据表的字段元数据。
 *
 * @param {{appToken: string, accessToken: string}} target 已验证 Bitable 目标。
 * @param {string} tableId 数据表 ID。
 * @returns {Promise<Array<{field_name: string, type: number}>>} 字段列表。
 */
async function listFields(target, tableId) {
  const data = await requestJson(
    `${FEISHU_BASE}/bitable/v1/apps/${target.appToken}/tables/${tableId}/fields?page_size=100`,
    target.accessToken,
  );
  return data.items || [];
}

/**
 * 校验既有数据表是否满足 ROI 归档字段契约。
 *
 * @param {{name: string, tableId: string, schema: Array<object>}} definition 表定义。
 * @param {Array<object>} fields 飞书字段元数据。
 * @returns {void}
 */
function validateSchema(definition, fields) {
  const byName = new Map(fields.map((field) => [field.field_name, field]));
  for (const expected of definition.schema) {
    const actual = byName.get(expected.field_name);
    if (!actual) {
      throw new Error(`ROI archive schema mismatch: ${definition.name} missing ${expected.field_name}`);
    }
    if (actual.type !== expected.type) {
      throw new Error(`ROI archive schema mismatch: ${definition.name} field ${expected.field_name} type ${actual.type}, expected ${expected.type}`);
    }
  }
}

/**
 * 创建带有全部固定字段的新 ROI 数据表。
 *
 * @param {{appToken: string, accessToken: string}} target 已验证 Bitable 目标。
 * @param {{name: string, schema: Array<object>}} definition 表定义。
 * @returns {Promise<string>} 新建表 ID。
 */
async function createArchiveTable(target, definition) {
  const data = await requestJson(
    `${FEISHU_BASE}/bitable/v1/apps/${target.appToken}/tables`,
    target.accessToken,
    'POST',
    { table: { name: definition.name, fields: definition.schema } },
  );
  // 飞书的新增数据表接口返回 data.table_id；保留嵌套形式兼容旧响应。
  const tableId = data.table_id || data.table?.table_id;
  if (!tableId) throw new Error(`ROI archive table creation returned no table ID: ${definition.name}`);
  return tableId;
}

/**
 * 定位或首次创建两张 ROI 归档表，并严格校验已有 schema。
 *
 * @param {{feishuAppId: string, feishuAppSecret: string, roiArchiveUrl: string}} config 飞书与归档配置。
 * @returns {Promise<{appToken: string, accessToken: string, runsTableId: string, scopesTableId: string}>} 可写归档目标。
 */
export async function ensureRoiArchiveSchema(config) {
  const target = await resolveRoiArchiveTarget(config);
  const definitions = [
    { name: RUNS_TABLE_NAME, schema: RUNS_FIELD_SCHEMA, key: 'runsTableId' },
    { name: SCOPES_TABLE_NAME, schema: SCOPES_FIELD_SCHEMA, key: 'scopesTableId' },
  ];
  const tables = await listTables(target);
  const result = { appToken: target.appToken, accessToken: target.accessToken };
  for (const definition of definitions) {
    const existing = tables.find((table) => table.name === definition.name);
    if (!existing) {
      result[definition.key] = await createArchiveTable(target, definition);
      continue;
    }
    const fields = await listFields(target, existing.table_id);
    validateSchema({ ...definition, tableId: existing.table_id }, fields);
    result[definition.key] = existing.table_id;
  }
  return result;
}

/**
 * 创建一条记录并返回其 record ID。
 *
 * @param {{appToken: string, accessToken: string}} archive 已初始化归档目标。
 * @param {string} tableId 写入数据表 ID。
 * @param {object} fields 记录字段。
 * @returns {Promise<string>} 记录 ID。
 */
async function createRecord(archive, tableId, fields) {
  const data = await requestJson(
    `${FEISHU_BASE}/bitable/v1/apps/${archive.appToken}/tables/${tableId}/records`,
    archive.accessToken,
    'POST',
    { fields },
  );
  const recordId = data.record?.record_id;
  if (!recordId) throw new Error('ROI archive record creation returned no record ID');
  return recordId;
}

/**
 * 更新一条已有 Run 记录。
 *
 * @param {{appToken: string, accessToken: string}} archive 已初始化归档目标。
 * @param {string} runRecordId Run 记录 ID。
 * @param {object} fields 更新字段。
 * @returns {Promise<void>}
 */
async function updateRunRecord(archive, runRecordId, fields) {
  await requestJson(
    `${FEISHU_BASE}/bitable/v1/apps/${archive.appToken}/tables/${archive.runsTableId}/records/${runRecordId}`,
    archive.accessToken,
    'PUT',
    { fields },
  );
}

/**
 * 以飞书的 500 条上限追加全部 Scope 明细。
 *
 * @param {{appToken: string, accessToken: string, scopesTableId: string}} archive 已初始化归档目标。
 * @param {Array<{fields: object}>} scopes Scope 记录。
 * @returns {Promise<number>} 成功写入的 Scope 条数。
 */
async function createScopeRecords(archive, scopes) {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new Error('ROI archive requires at least one scope record');
  }
  let count = 0;
  for (let index = 0; index < scopes.length; index += 500) {
    const batch = scopes.slice(index, index + 500);
    await requestJson(
      `${FEISHU_BASE}/bitable/v1/apps/${archive.appToken}/tables/${archive.scopesTableId}/records/batch_create`,
      archive.accessToken,
      'POST',
      { records: batch },
    );
    count += batch.length;
  }
  return count;
}

/**
 * 写入一条 Run 与全部 Scope，使用明确状态机公开任何归档失败。
 *
 * @param {{config: object, payload: {run: {fields: object}, scopes: Array<{fields: object}>}}} input 配置与已计算 payload。
 * @returns {Promise<{runRecordId: string, scopeRecordCount: number, status: 'complete'|'incomplete'}>} 写入结果。
 */
export async function writeRoiArchive(input) {
  const payload = input?.payload;
  if (!payload?.run?.fields || !Array.isArray(payload.scopes)) {
    throw new Error('ROI archive write requires Run and Scope payload');
  }
  const finalStatus = payload.run.fields['Write status'];
  if (!['complete', 'incomplete'].includes(finalStatus)) {
    throw new Error(`ROI archive payload has invalid final status: ${finalStatus}`);
  }
  const archive = await ensureRoiArchiveSchema(input.config);
  let runRecordId = '';
  try {
    runRecordId = await createRecord(archive, archive.runsTableId, {
      ...payload.run.fields,
      'Write status': 'writing',
    });
    const scopeRecordCount = await createScopeRecords(archive, payload.scopes);
    await updateRunRecord(archive, runRecordId, payload.run.fields);
    return { runRecordId, scopeRecordCount, status: finalStatus };
  } catch (error) {
    if (runRecordId) {
      const originalMessage = error instanceof Error ? error.message : String(error);
      try {
        await updateRunRecord(archive, runRecordId, {
          ...payload.run.fields,
          'Write status': 'write_failed',
          'Incomplete scopes': `${payload.run.fields['Incomplete scopes'] || ''}${payload.run.fields['Incomplete scopes'] ? '\n' : ''}archive_write_failed: ${originalMessage}`,
        });
      } catch (_statusError) {
        // 原始失败仍然必须返回给调用方，二次状态更新失败不能伪装写入成功。
      }
    }
    throw error;
  }
}
