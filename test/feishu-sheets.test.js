// 验证 feishu-sheets.js：URL 解析、读 A 列、按 row 写 B-F、CD review 下拉与失败语义。
import { parseSheetsUrl, parseFeishuUrl, listSpreadsheetSheets, inspectSheetLayout, listSourceSegments, listFinalSourceSegments, writeToSheet, testSheetsConnection, REQUIRED_HEADERS, mapHeadersToColumns, readHeaderRow, validateHeaders, repairHeaders } from '../lib/feishu-sheets.js';
import { _resetTokenCache } from '../lib/feishu-bitable.js';

const sheetsModule = await import('../lib/feishu-sheets.js');

let pass = 0, fail = 0;
const assert = (n, c, e = '') => c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${e}`));

// mock fetch：按 URL 匹配返回
function mockFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    const call = { url: String(url), method: opts?.method || 'GET', body: opts?.body, headers: opts?.headers || {} };
    calls.push(call);
    const r = handler(call);
    if (r.throw) throw new Error(r.throw);
    return {
      ok: true,
      json: async () => r.json,
      text: async () => JSON.stringify(r.json),
    };
  };
  return calls;
}

console.log('\n=== feishu-sheets: parseSheetsUrl ===');
{
  const a = parseSheetsUrl('Tjyfs3Tg5hYG6btMTiom3UA3yYd');
  assert('纯 token 识别', a?.spreadsheetToken === 'Tjyfs3Tg5hYG6btMTiom3UA3yYd');

  const b = parseSheetsUrl('https://bytedance.my.larkoffice.com/sheets/Tjyfs3Tg5hYG6btMTiom3UA3yYd');
  assert('URL 解析 token', b?.spreadsheetToken === 'Tjyfs3Tg5hYG6btMTiom3UA3yYd');

  const c = parseSheetsUrl('https://xxx.larkoffice.com/sheets/ABC123?sheet=sheetXYZ');
  assert('URL 带 sheet 参数解析', c?.spreadsheetToken === 'ABC123' && c?.sheetId === 'sheetXYZ');

  assert('空输入返回 null', parseSheetsUrl('') === null);
  assert('非 sheets URL 返回 null', parseSheetsUrl('https://example.com/foo') === null);
}

console.log('\n=== feishu-sheets: parseFeishuUrl 区分 Sheet / Bitable ===');
{
  const s = parseFeishuUrl('https://bytedance.my.larkoffice.com/sheets/Tjyfs3Tg5hYG6btMTiom3UA3yYd');
  assert('Sheet URL → type=sheet', s?.type === 'sheet', JSON.stringify(s));
  assert('Sheet URL → spreadsheetToken', s?.spreadsheetToken === 'Tjyfs3Tg5hYG6btMTiom3UA3yYd');

  const st = parseFeishuUrl('https://xxx.larkoffice.com/sheets/ABC?sheet=sheetXYZ');
  assert('Sheet URL 带 ?sheet= → sheetId', st?.type === 'sheet' && st?.sheetId === 'sheetXYZ');

  const b = parseFeishuUrl('https://bytedance.my.larkoffice.com/base/NNAubNCm9amBXXsS8BVmFKeTykg');
  assert('Bitable URL → type=bitable', b?.type === 'bitable', JSON.stringify(b));
  assert('Bitable URL → appToken', b?.appToken === 'NNAubNCm9amBXXsS8BVmFKeTykg');

  const bt = parseFeishuUrl('https://xxx.larkoffice.com/base/APP123?table=tbl456');
  assert('Bitable URL 带 ?table= → tableId', bt?.tableId === 'tbl456');

  const bare = parseFeishuUrl('Tjyfs3Tg5hYG6btMTiom3UA3yYd');
  assert('裸 token → 按 sheet 处理', bare?.type === 'sheet' && bare?.spreadsheetToken === 'Tjyfs3Tg5hYG6btMTiom3UA3yYd');

  assert('空输入返回 null', parseFeishuUrl('') === null);
  assert('非飞书 URL 返回 null', parseFeishuUrl('https://example.com/foo') === null);
}

console.log('\n=== feishu-sheets: 读 A 列跳空行但保留真实行号 ===');
{
  _resetTokenCache();
  const calls = mockFetch((c) => {
    if (c.url.includes('/auth/v3/tenant_access_token')) {
      return { json: { code: 0, tenant_access_token: 'TOK', expire: 7200 } };
    }
    if (c.url.includes('/sheets/query')) {
      return { json: { code: 0, data: { sheets: [{ sheet_id: 'SHT1' }] } } };
    }
    // 读 A2:A：模拟 A2 有原文、A3 空、A4 有原文。
    return { json: { code: 0, data: { valueRange: { values: [['Hello'], [''], ['World']] } } } };
  });
  const segments = await listSourceSegments({
    feishuUserAccessToken: 'u-user-token',
    spreadsheetToken: 'SP', sheetId: null,
  });
  assert('跳过空行只返回 2 条', segments.length === 2, `actual ${segments.length}`);
  assert('第 1 条行号=2（A2）', segments[0].row === 2, `actual ${segments[0].row}`);
  assert('第 1 条原文 Hello', segments[0].source_text === 'Hello');
  assert('第 2 条行号=4（A4，跳过空行 A3）', segments[1].row === 4, `actual ${segments[1].row}`);
  assert('第 2 条原文 World', segments[1].source_text === 'World');
  assert('读 A 列用 values/{range} 接口', calls.some((c) => c.url.includes('/values/')));
}

console.log('\n=== feishu-sheets: 以 App ID / Secret 读写，先请求 tenant token ===');
{
  const calls = mockFetch((c) => {
    if (c.url.includes('/auth/v3/tenant_access_token')) {
      return { json: { code: 0, tenant_access_token: 'tenant-token', expire: 7200 } };
    }
    if (c.url.includes('/sheets/query')) {
      return { json: { code: 0, data: { sheets: [{ sheet_id: 'SHT1' }] } } };
    }
    return { json: { code: 0, data: { valueRange: { values: [['OAuth source']] } } } };
  });
  const segments = await listSourceSegments({
    feishuAppId: 'cli-test', feishuAppSecret: 'secret-test', spreadsheetToken: 'SP', sheetId: null,
  });
  assert('tenant token 可读取 Sheet', segments[0]?.source_text === 'OAuth source');
  assert('请求了 tenant token', calls.some((call) => call.url.includes('/tenant_access_token')));
  assert('所有 Sheet 请求携带 tenant token', calls.filter((call) => call.url.includes('/sheets/')).every((call) => call.headers.Authorization === 'Bearer tenant-token'));
}

console.log('\n=== feishu-sheets: 读取 CD 在 D 列确认的最终 C 文案 ===');
assert('导出最终 C 文案读取函数', typeof sheetsModule.listFinalSourceSegments === 'function');
{
  _resetTokenCache();
  const calls = mockFetch((c) => {
    if (c.url.includes('/auth/v3/tenant_access_token')) {
      return { json: { code: 0, tenant_access_token: 'TOK', expire: 7200 } };
    }
    return { json: { code: 0, data: { valueRange: { values: [
      ['Original A', 'TM', 80, 'CD final C', 90, 'TRUE', 'Yes'],
      ['Pending A', 'TM', 70, 'AI candidate B', 88, 'TRUE', ''],
    ] } } } };
  });
  const finals = await listFinalSourceSegments({
    feishuUserAccessToken: 'u-user-token', spreadsheetToken: 'SP', sheetId: 'SHT1',
  });
  assert('最终 C 读取 A:D:G', calls.some((c) => decodeURIComponent(c.url).includes('SHT1!A2:G')));
  assert('CD 选 Yes 才将 D 作为最终 C', finals[0]?.final_source_text === 'CD final C');
  assert('未选 Yes 的 AI 候选不作为最终 C', finals[1]?.final_source_text === '');
  assert('最终 C 仍保留真实 Sheet 行号', finals[1]?.row === 3);
}

console.log('\n=== feishu-sheets: 写入按 row 定位（不错位） ===');
{
  _resetTokenCache();
  const calls = mockFetch((c) => {
    if (c.url.includes('/auth/v3/tenant_access_token')) {
      return { json: { code: 0, tenant_access_token: 'TOK', expire: 7200 } };
    }
    if (c.url.includes('/sheets/query')) {
      return { json: { code: 0, data: { sheets: [{ sheet_id: 'SHT1' }] } } };
    }
    // 写入
    return { json: { code: 0, data: {} } };
  });
  // 模拟 2 条 item，行号 2 和 4（中间 A3 是空行）
  const items = [
    { row: 2, tm_match: '完成', similarity: 100, ai_translation: 'Done', new_match: 95, reached_threshold: true, ai_vs_tm: { status: 'same', changes: 'x' }, roi: { status: 'complete', calculationBasis: 'local_english_word_count', originalActualWordCount: 10, originalWeightedWordCount: 2, postRewriteActualWordCount: 10, postRewriteWeightedWordCount: 2, estimatedCostBefore: 0.04, estimatedCostAfter: 0.04, estimatedSaving: 0 } },
    { row: 4, tm_match: '確認', similarity: 100, ai_translation: 'Confirm', new_match: 90, reached_threshold: true, ai_vs_tm: { status: 'same', changes: 'y' } },
  ];
  await writeToSheet(items, {
    feishuUserAccessToken: 'u-user-token',
    spreadsheetToken: 'SP', sheetId: 'SHT1',
  });
  const writeCall = calls.find((c) => c.url.includes('values_batch_update'));
  assert('有一次批量写', !!writeCall);
  const vr = JSON.parse(writeCall.body).valueRanges;
  // 2 items × B-F 五列 = 10 个数据 valueRange + 1 个补表头(B1:G1) = 11
  assert('生成 11 个 valueRange（2行×5列 + 补表头）', vr.length === 11, `actual ${vr.length}`);
  // 关键：写入 range 必须按真实行号定位，不能是 B2/B3 顺延
  const ranges = vr.map((v) => v.range);
  assert('第 1 行写到 B2（行号 2）', ranges.includes('SHT1!B2:B2'));
  assert('第 2 行写到 B4（行号 4，不是 B3！）', ranges.includes('SHT1!B4:B4'), `ranges: ${ranges.filter(r=>r.includes('B')).join(',')}`);
  assert('没有写到 B3（错位行）', !ranges.includes('SHT1!B3:B3'));
  const headerRange = vr.find((valueRange) => valueRange.range === 'SHT1!B1:G1');
  assert('Sheet 只保留 TM/CD 表头', headerRange?.values?.[0]?.length === 6);
  assert('Sheet 不写 ROI 列', !ranges.some((range) => /![H-O]\d+:[H-O]\d+$/.test(range)));

  const validationCall = calls.find((c) => c.url.includes('/dataValidation'));
  assert('写数据前以 POST 设置 CD review 下拉', !!validationCall && validationCall.method === 'POST');
  const validationBody = JSON.parse(validationCall.body);
  assert('下拉范围为本次最大行 range=G2:G4', validationBody.range === 'SHT1!G2:G4', JSON.stringify(validationBody));
  assert('下拉类型为 list', validationBody.dataValidationType === 'list');
    assert('下拉选项严格为 Yes/No', JSON.stringify(validationBody.dataValidation.conditionValues) === JSON.stringify(['Yes', 'No']));
    assert('CD review 只能单选', validationBody.dataValidation.options.multipleValues === false);
    assert('未提供颜色时关闭下拉高亮', validationBody.dataValidation.options.highlightValidData === false);
}

console.log('\n=== feishu-sheets: CD review 下拉失败时停止数据写入 ===');
{
  _resetTokenCache();
  const calls = mockFetch((c) => {
    if (c.url.includes('/auth/v3/tenant_access_token')) {
      return { json: { code: 0, tenant_access_token: 'TOK', expire: 7200 } };
    }
    if (c.url.includes('/dataValidation')) {
      return { json: { code: 90201, msg: 'invalid data validation range' } };
    }
    return { json: { code: 0, data: {} } };
  });
  try {
    await writeToSheet([
      { row: 2, tm_match: '完成', similarity: 100, ai_translation: '', new_match: 100, reached_threshold: true },
    ], {
      feishuUserAccessToken: 'u-user-token', spreadsheetToken: 'SP', sheetId: 'SHT1',
    });
    assert('下拉失败必须抛错', false);
  } catch (error) {
    assert('下拉错误包含可操作上下文', /CD review dropdown error/.test(error.message), error.message);
  }
  assert('下拉失败后不调用 values 写入', !calls.some((c) => c.url.includes('values_batch_update')));
}

console.log('\n=== feishu-sheets: CD review 下拉不超过本次真实最大行 ===');
{
  _resetTokenCache();
  let writeCalled = false;
  mockFetch((c) => {
    if (c.url.includes('/auth/v3/tenant_access_token')) {
      return { json: { code: 0, tenant_access_token: 'TOK', expire: 7200 } };
    }
    if (c.url.includes('/dataValidation')) {
      const range = JSON.parse(c.body).range;
      // 模拟只有第 4 行的 grid：旧版 G2:G5000 必须得到用户看到的原始错误。
      return range === 'SHT1!G2:G4'
        ? { json: { code: 0, data: {} } }
        : { json: { code: 90201, msg: 'range exceeds grid limits, row range is invalid' } };
    }
    if (c.url.includes('values_batch_update')) writeCalled = true;
    return { json: { code: 0, data: {} } };
  });
  try {
    await writeToSheet([
      { row: 2, tm_match: 'a', similarity: 80, ai_translation: 'b', new_match: 86, reached_threshold: true },
      { row: 4, tm_match: 'c', similarity: 90, ai_translation: 'd', new_match: 92, reached_threshold: true },
    ], { feishuUserAccessToken: 'u-user-token', spreadsheetToken: 'SP', sheetId: 'SHT1' });
    assert('下拉范围只到本次最大输出行', true);
  } catch (error) {
    assert('下拉范围只到本次最大输出行', false, error.message);
  }
  assert('动态下拉创建成功后继续写数据', writeCalled);
}

console.log('\n=== feishu-sheets: 无 row 的 item 走追加路径（BX2，不丢数据） ===');
{
  _resetTokenCache();
  const calls = mockFetch((c) => {
    if (c.url.includes('/auth/v3/tenant_access_token')) {
      return { json: { code: 0, tenant_access_token: 'TOK', expire: 7200 } };
    }
    if (c.url.includes('/sheets/query')) {
      return { json: { code: 0, data: { sheets: [{ sheet_id: 'SHT1' }] } } };
    }
    // 读 A 列已有数据：表头 1 行 + 1 条数据 → 追加从行 3 开始
    if (c.url.includes('/values/') && c.method === 'GET') {
      return { json: { code: 0, data: { valueRange: { values: [['Original Source Segment'], ['old']] } } } };
    }
    return { json: { code: 0, data: {} } };
  });
  // 一条有 row（行 2），一条无 row（追加）
  const items = [
    { row: 2, tm_match: 'a', similarity: 50, ai_translation: 'b', new_match: 60, reached_threshold: false, ai_vs_tm: { status: 'different', changes: 'c' } },
    { tm_match: 'x', similarity: 50, ai_translation: 'y', new_match: 60, reached_threshold: false, ai_vs_tm: { status: 'different', changes: 'z' } },
  ];
  await writeToSheet(items, { feishuUserAccessToken: 'u-user-token', spreadsheetToken: 'SP', sheetId: 'SHT1' });
  const writeCall = calls.find((c) => c.url.includes('values_batch_update'));
  const vr = JSON.parse(writeCall.body).valueRanges;
  // 两条都写：2 × 13 = 26；无 row 那条追加到 max(lastData=2, maxItemRow=2)+1 = 行 3
  // + 1 个无条件补表头(B1:G1) = 11
  assert('有 row + 无 row 混用都写入（2×5=10 + 补表头=11）', vr.length === 11, `actual ${vr.length}`);
  assert('有 row 那条写 B2', vr.some((v) => v.range === 'SHT1!B2:B2'));
  assert('无 row 那条追加到 B3（不丢、不错位）', vr.some((v) => v.range === 'SHT1!B3:B3'), vr.map((v) => v.range).filter((r) => r.includes('B')).join(','));
}

console.log('\n=== feishu-sheets: row alignment 回归边界（首行 A2 即空） ===');
{
  _resetTokenCache();
  mockFetch((c) => {
    if (c.url.includes('/auth/v3/tenant_access_token')) {
      return { json: { code: 0, tenant_access_token: 'TOK', expire: 7200 } };
    }
    if (c.url.includes('/sheets/query')) {
      return { json: { code: 0, data: { sheets: [{ sheet_id: 'SHT1' }] } } };
    }
    // A2 空、A3 有、A4 空、A5 有 —— 验证跳空后行号仍是真实行号
    return { json: { code: 0, data: { valueRange: { values: [[''], ['Hi'], [''], ['Hey']] } } } };
  });
  const segments = await listSourceSegments({
    feishuUserAccessToken: 'u-user-token',
    spreadsheetToken: 'SP', sheetId: null,
  });
  assert('首行空也跳过，只返回 2 条', segments.length === 2, `actual ${segments.length}`);
  assert('第 1 条行号=3（A3，不是 2）', segments[0].row === 3, `actual ${segments[0].row}`);
  assert('第 2 条行号=5（A5，不是 4）', segments[1].row === 5, `actual ${segments[1].row}`);
  assert('第 1 条原文 Hi', segments[0].source_text === 'Hi');
}

console.log('\n=== feishu-sheets: 单 item B-F 按真实行号落点 + reached_threshold 落 F 列 ===');
{
  _resetTokenCache();
  const calls = mockFetch((c) => {
    if (c.url.includes('/auth/v3/tenant_access_token')) {
      return { json: { code: 0, tenant_access_token: 'TOK', expire: 7200 } };
    }
    if (c.url.includes('/sheets/query')) {
      return { json: { code: 0, data: { sheets: [{ sheet_id: 'SHT1' }] } } };
    }
    return { json: { code: 0, data: {} } };
  });
  // 单条 item 落在行 7（非首行，验证不被强制回到行 2）
  const items = [
    { row: 7, tm_match: 'تم', tm_source: 'apples', similarity: 80, ai_translation: 'apple', new_match: 88, reached_threshold: false, key: 'btn_done', ai_vs_tm: { status: 'same', changes: 'x' } },
  ];
  await writeToSheet(items, { feishuUserAccessToken: 'u-user-token', spreadsheetToken: 'SP', sheetId: 'SHT1' });
  const writeCall = calls.find((c) => c.url.includes('values_batch_update'));
  const vr = JSON.parse(writeCall.body).valueRanges;
  const cell = (col) => vr.find((v) => v.range === `SHT1!${col}7:${col}7`);
  assert('B7 写匹配到的英文 TM source，不写 Arabic target', !!cell('B') && cell('B').values[0][0] === 'apples');
  assert('C7 写 Orig Match % = 80', !!cell('C') && cell('C').values[0][0] === 80);
  assert('D7 写 Rewritten Segment', !!cell('D') && cell('D').values[0][0] === 'apple');
  assert('E7 写 New Match % = 88', !!cell('E') && cell('E').values[0][0] === 88);
  assert('F7 写 reached_threshold = FALSE', !!cell('F') && cell('F').values[0][0] === 'FALSE');
  assert('G7（CD review）不写', !cell('G'), 'G 列必须留空给人工 review');
  assert('H-O 不写 ROI 快照或金额', !['H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'].some((column) => cell(column)));
  // reached_threshold=false 应落 FALSE
  const vr2 = (() => {
    const it = [{ row: 7, tm_match: '', similarity: 40, ai_translation: 'Rew', new_match: 60, reached_threshold: false, ai_vs_tm: { status: 'different', changes: 'y' } }];
    return it;
  })();
  // 单独再跑一次 false 情况
  _resetTokenCache();
  const calls2 = mockFetch((c) => {
    if (c.url.includes('/auth/v3/tenant_access_token')) return { json: { code: 0, tenant_access_token: 'TOK', expire: 7200 } };
    if (c.url.includes('/sheets/query')) return { json: { code: 0, data: { sheets: [{ sheet_id: 'SHT1' }] } } };
    return { json: { code: 0, data: {} } };
  });
  await writeToSheet(vr2, { feishuUserAccessToken: 'u-user-token', spreadsheetToken: 'SP', sheetId: 'SHT1' });
  const writeCall2 = calls2.find((c) => c.url.includes('values_batch_update'));
  const f7 = JSON.parse(writeCall2.body).valueRanges.find((v) => v.range === 'SHT1!F7:F7');
  assert('reached_threshold=false 时 F7 = FALSE', !!f7 && f7.values[0][0] === 'FALSE');
}

console.log('\n=== feishu-sheets: 缺配置报错 ===');
{
  _resetTokenCache();
  try {
    await listSourceSegments({ feishuUserAccessToken: '', spreadsheetToken: 'SP' });
    assert('未连接飞书抛错', false);
  } catch (e) { assert('未连接飞书抛错', /App ID.*App Secret/.test(e.message)); }
  try {
    await writeToSheet([], { feishuUserAccessToken: 'u-user-token', spreadsheetToken: '' });
    assert('缺 spreadsheetToken 抛错', false);
  } catch (e) { assert('缺 spreadsheetToken 抛错', /token/.test(e.message)); }
}

console.log('\n=== feishu-sheets: API code 非 0 报错 ===');
{
  _resetTokenCache();
  mockFetch((c) => {
    if (c.url.includes('/auth/v3/tenant_access_token')) {
      return { json: { code: 0, tenant_access_token: 'TOK', expire: 7200 } };
    }
    if (c.url.includes('/sheets/query')) {
      return { json: { code: 0, data: { sheets: [{ sheet_id: 'SHT1' }] } } };
    }
    return { json: { code: 99991663, msg: 'permission denied' } };
  });
  try {
    await listSourceSegments({ feishuUserAccessToken: 'u-user-token', spreadsheetToken: 'SP', sheetId: 'SHT1' });
    assert('读 A 列 API 错抛出', false);
  } catch (e) { assert('读 A 列 API 错抛出', /Sheets read error/.test(e.message)); }
}

console.log('\n=== feishu-sheets: testSheetsConnection 缺权限/错误场景 ===');
{
  // 缺权限：sheets/query 返回 permission denied
  _resetTokenCache();
  mockFetch((c) => {
    if (c.url.includes('/sheets/query')) {
      return { json: { code: 99991663, msg: 'permission denied: scopes required [sheets:spreadsheet]' } };
    }
    return { json: { code: 0, data: {} } };
  });
  const res = await testSheetsConnection({ feishuAppId: 'cli-test', feishuAppSecret: 'secret-test' }, 'SP');
  assert('缺权限返回 ok=false', res.ok === false, JSON.stringify(res));
  assert('错误信息含权限提示', /permission|sheets:spreadsheet/.test(res.error || ''), res.error);

  // 未连接飞书时不能伪造 tenant token 或继续访问。
  _resetTokenCache();
  const res2 = await testSheetsConnection({}, 'SP');
  assert('未连接飞书返回 ok=false', res2.ok === false, JSON.stringify(res2));
  assert('未连接提示填写凭证', /App ID.*App Secret/.test(res2.error || ''), res2.error);

  // 未选择 Spreadsheet 时只验证用户令牌，不调 query。
  _resetTokenCache();
  mockFetch((c) => {
    return { json: { code: 0, data: { sheets: [{ sheet_id: 'S1' }] } } };
  });
  const res3 = await testSheetsConnection({ feishuAppId: 'cli-test', feishuAppSecret: 'secret-test' }, '');
  assert('未选表格但已连接 → ok=true（不验证表格）', res3.ok === true, JSON.stringify(res3));
}

console.log('\n=== feishu-sheets: parseFeishuUrl 边界 ===');
{
  assert('带查询参数的 Sheet URL', parseFeishuUrl('https://a.larkoffice.com/sheets/TOK1?openId=x')?.spreadsheetToken === 'TOK1');
  assert('Bitable 带 openId 参数', parseFeishuUrl('https://a.larkoffice.com/base/APP1?openId=x')?.appToken === 'APP1');
  assert('Bitable 带 ?table= 解析 tableId', parseFeishuUrl('https://a.larkoffice.com/base/APP2?table=tbl9')?.tableId === 'tbl9');
  const wikiParsed = parseFeishuUrl('https://a.larkoffice.com/wiki/QmG4w6EVIitUAlkT259clYFCndf');
  assert('wiki 链接 → 当作 sheet（wiki token 即 spreadsheet token）', wikiParsed?.type === 'sheet' && wikiParsed?.spreadsheetToken === 'QmG4w6EVIitUAlkT259clYFCndf');
  assert('短 token 不识别为裸 token（长度<=10）', parseFeishuUrl('abc123') === null);
}

console.log('\n=== feishu-sheets: CD review valid? 永不被自动填（留空给人审） ===');
{
  _resetTokenCache();
  const calls = mockFetch((c) => {
    if (c.url.includes('/auth/v3/tenant_access_token')) return { json: { code: 0, tenant_access_token: 'TOK', expire: 7200 } };
    if (c.url.includes('/sheets/query')) return { json: { code: 0, data: { sheets: [{ sheet_id: 'SHT1' }] } } };
    return { json: { code: 0, data: {} } };
  });
  // 即使 item 带了 cdReview 字段，也不应写入 G 列
  const items = [
    { row: 2, tm_match: 'a', similarity: 80, ai_translation: 'b', new_match: 85, reached_threshold: true, cdReview: 'SHOULD NOT WRITE', ai_vs_tm: { status: 'same', changes: 'x' } },
    { row: 3, tm_match: '', similarity: 40, ai_translation: 'c', new_match: 50, reached_threshold: false, cdReview: true, ai_vs_tm: { status: 'different', changes: 'y' } },
  ];
  await writeToSheet(items, { feishuUserAccessToken: 'u-user-token', spreadsheetToken: 'SP', sheetId: 'SHT1' });
  const writeCall = calls.find((c) => c.url.includes('values_batch_update'));
  const vr = JSON.parse(writeCall.body).valueRanges;
  const gRanges = vr.filter((v) => /^SHT1!G\d+:G\d+$/.test(v.range));
  assert('没有任何 G 列（CD review）写入', gRanges.length === 0, `G ranges: ${gRanges.map(r=>r.range).join(',')}`);
  assert('CD review 字段被忽略，不进 valueRanges', !vr.some((v) => v.values?.[0]?.[0] === 'SHOULD NOT WRITE'));
  // 写入的列字母集合
  const cols = new Set(vr.map((v) => v.range.match(/SHT1!([A-Z])\d/)?.[1]));
  assert('只写 B-F，不写 G 或 ROI 列', [...cols].sort().join('') === 'BCDEF', `cols: ${[...cols].sort().join('')}`);
}

console.log('\n=== feishu-sheets: REQUIRED_HEADERS + mapHeadersToColumns ===');
{
  assert('7 个表头', REQUIRED_HEADERS.length === 7, `actual ${REQUIRED_HEADERS.length}`);
  assert('表头顺序：第1个=Original Source Segment', REQUIRED_HEADERS[0] === 'Original Source Segment');
  assert('表头顺序：最后=CD review valid?', REQUIRED_HEADERS[6] === 'CD review valid?');
  assert('标准表头不含已移除字段', !REQUIRED_HEADERS.some((header) => ['Comment', 'Source String Key', 'Project'].includes(header)));

  // 完整表头行 → 全映射，无 missing/extra
  const full = mapHeadersToColumns(REQUIRED_HEADERS);
  assert('完整表头无 missing', full.missing.length === 0, JSON.stringify(full.missing));
  assert('完整表头无 extra', full.extra.length === 0);
  assert('Original Source Segment → A', full.byName['Original Source Segment'] === 'A');
  assert('Best TM Match → B', full.byName['Best TM Match'] === 'B');
  assert('Reached 85%? → F', full.byName['Reached 85%?'] === 'F');
  assert('CD review valid? → G', full.byName['CD review valid?'] === 'G');

  // 缺列
  const partial = mapHeadersToColumns(['Original Source Segment', 'Best TM Match']);
  assert('缺 5 列被检出', partial.missing.length === 5, JSON.stringify(partial.missing));
  assert('缺 Rewritten Segment', partial.missing.includes('Rewritten Segment'));

  // 多余列
  const extra = mapHeadersToColumns([...REQUIRED_HEADERS, 'Notes', 'Owner']);
  assert('多余列被检出', extra.extra.length === 2, JSON.stringify(extra.extra));

  // 空表头
  const empty = mapHeadersToColumns([]);
  assert('空表头 → 7 列全 missing', empty.missing.length === 7);
  assert('空表头 → 无 extra', empty.extra.length === 0);

  // 单元格非字符串（数字/对象）也能处理
  const mixed = mapHeadersToColumns([123, 'Original Source Segment']);
  assert('非字符串表头转 String', mixed.byName['123'] === 'A');
}

console.log('\n=== feishu-sheets: 表头校验 + 修复流 ===');
{
  // 完整表头 → ok
  _resetTokenCache();
  mockFetch((c) => {
    if (c.url.includes('/auth/v3/tenant_access_token')) return { json: { code: 0, tenant_access_token: 'TOK', expire: 7200 } };
    if (c.url.includes('/sheets/query')) return { json: { code: 0, data: { sheets: [{ sheet_id: 'SHT1' }] } } };
    if (c.url.includes('/values/') && c.url.includes('A1')) {
      return { json: { code: 0, data: { valueRange: { values: [REQUIRED_HEADERS.slice()] } } } };
    }
    return { json: { code: 0, data: {} } };
  });
  const v = await validateHeaders({ feishuUserAccessToken: 'u-user-token', spreadsheetToken: 'SP', sheetId: null });
  assert('完整表头 → ok=true', v.ok === true, JSON.stringify(v.missing));
  assert('完整表头 → 无 missing', v.missing.length === 0);
  assert('sheet 解析为 SHT1', v.sheet === 'SHT1');

  // 缺列 → ok=false + missing
  _resetTokenCache();
  mockFetch((c) => {
    if (c.url.includes('/auth/v3/tenant_access_token')) return { json: { code: 0, tenant_access_token: 'TOK', expire: 7200 } };
    if (c.url.includes('/sheets/query')) return { json: { code: 0, data: { sheets: [{ sheet_id: 'SHT1' }] } } };
    if (c.url.includes('/values/') && c.url.includes('A1')) {
      return { json: { code: 0, data: { valueRange: { values: [['Original Source Segment', 'CD review valid?']] } } } };
    }
    return { json: { code: 0, data: {} } };
  });
  const v2 = await validateHeaders({ feishuUserAccessToken: 'u-user-token', spreadsheetToken: 'SP', sheetId: 'SHT1' });
  assert('缺列 → ok=false', v2.ok === false);
  assert('检出 5 个缺失列', v2.missing.length === 5, JSON.stringify(v2.missing));
  assert('缺 Best TM Match', v2.missing.includes('Best TM Match'));

  // 空表头（表第一行空）→ 全 missing
  _resetTokenCache();
  mockFetch((c) => {
    if (c.url.includes('/auth/v3/tenant_access_token')) return { json: { code: 0, tenant_access_token: 'TOK', expire: 7200 } };
    if (c.url.includes('/sheets/query')) return { json: { code: 0, data: { sheets: [{ sheet_id: 'SHT1' }] } } };
    if (c.url.includes('/values/') && c.url.includes('A1')) {
      return { json: { code: 0, data: { valueRange: { values: [] } } } };
    }
    return { json: { code: 0, data: {} } };
  });
  const v3 = await validateHeaders({ feishuUserAccessToken: 'u-user-token', spreadsheetToken: 'SP', sheetId: 'SHT1' });
  assert('空表头 → ok=false', v3.ok === false);
  assert('空表头 → 7 列全 missing', v3.missing.length === 7);

  // 修复：写入 A1:G1 表头
  _resetTokenCache();
  const calls = mockFetch((c) => {
    if (c.url.includes('/auth/v3/tenant_access_token')) return { json: { code: 0, tenant_access_token: 'TOK', expire: 7200 } };
    if (c.url.includes('/sheets/query')) return { json: { code: 0, data: { sheets: [{ sheet_id: 'SHT1' }] } } };
    return { json: { code: 0, data: {} } };
  });
  const r = await repairHeaders({ feishuUserAccessToken: 'u-user-token', spreadsheetToken: 'SP', sheetId: 'SHT1' });
  assert('修复返回 7 列', r.repaired === 7);
  const writeCall = calls.find((c) => c.url.includes('values_batch_update'));
  const vr = JSON.parse(writeCall.body).valueRanges[0];
  assert('修复写入 range=A1:G1', vr.range === 'SHT1!A1:G1', vr.range);
  assert('修复写入 7 个表头', vr.values[0].length === 7 && vr.values[0][0] === 'Original Source Segment' && vr.values[0][6] === 'CD review valid?');
}

console.log('\n=== BX2: 空 items 抛明确错误（不发空 valueRanges 给 API） ===');
{
  _resetTokenCache();
  let writeCalled = false;
  mockFetch((c) => {
    if (c.url.includes('/auth/v3/tenant_access_token')) return { json: { code: 0, tenant_access_token: 'TOK', expire: 7200 } };
    if (c.url.includes('/sheets/query')) return { json: { code: 0, data: { sheets: [{ sheet_id: 'SHT1' }] } } };
    if (c.url.includes('values_batch_update')) writeCalled = true;
    return { json: { code: 0, data: {} } };
  });
  try {
    await writeToSheet([], { feishuUserAccessToken: 'u-user-token', spreadsheetToken: 'SP', sheetId: 'SHT1' });
    assert('空 items 抛错', false);
  } catch (e) {
    assert('空 items 抛可操作错误', /No items to write|valueRanges.*empty/i.test(e.message), e.message);
  }
  assert('空 items 不调用写 API', !writeCalled, '不应发空 valueRanges');
}

console.log('\n=== BX2: 纯 doc-capture（全部无 row）走追加路径 ===');
{
  _resetTokenCache();
  const calls = mockFetch((c) => {
    if (c.url.includes('/auth/v3/tenant_access_token')) return { json: { code: 0, tenant_access_token: 'TOK', expire: 7200 } };
    if (c.url.includes('/sheets/query')) return { json: { code: 0, data: { sheets: [{ sheet_id: 'SHT1' }] } } };
    // 读 A 列：表头 + 2 条已有数据 → lastData=3 → 追加从行 4 开始
    if (c.url.includes('/values/') && c.method === 'GET') {
      return { json: { code: 0, data: { valueRange: { values: [['Original Source Segment'], ['a'], ['b']] } } } };
    }
    return { json: { code: 0, data: {} } };
  });
  // 3 条 doc-capture item，全无 row
  const items = [
    { tm_match: 't1', similarity: 80, ai_translation: 'r1', new_match: 70, reached_threshold: false, ai_vs_tm: { status: 'improved', changes: 'x' } },
    { tm_match: 't2', similarity: 60, ai_translation: 'r2', new_match: 85, reached_threshold: true, ai_vs_tm: { status: 'same', changes: 'y' } },
    { tm_match: 't3', similarity: 90, ai_translation: 'r3', new_match: 85, reached_threshold: true, ai_vs_tm: { status: 'same', changes: 'z' } },
  ];
  const n = await writeToSheet(items, { feishuUserAccessToken: 'u-user-token', spreadsheetToken: 'SP', sheetId: 'SHT1' });
  const writeCall = calls.find((c) => c.url.includes('values_batch_update'));
  const vr = JSON.parse(writeCall.body).valueRanges;
  assert('返回写入条数', n === 3);
  assert('3 条全写入（3×5=15 + 补表头=16）', vr.length === 16, `actual ${vr.length}`);
  // 追加起点行 4，连续 4/5/6
  assert('第 1 条追加到 B4', vr.some((v) => v.range === 'SHT1!B4:B4'));
  assert('第 2 条追加到 B5', vr.some((v) => v.range === 'SHT1!B5:B5'));
  assert('第 3 条追加到 B6', vr.some((v) => v.range === 'SHT1!B6:B6'));
  assert('未写到已有行 B2/B3', !vr.some((v) => v.range === 'SHT1!B2:B2') && !vr.some((v) => v.range === 'SHT1!B3:B3'));
}

console.log('\n=== BX2: 写 API code 非 0 抛 Sheets write error ===');
{
  _resetTokenCache();
  mockFetch((c) => {
    if (c.url.includes('/auth/v3/tenant_access_token')) return { json: { code: 0, tenant_access_token: 'TOK', expire: 7200 } };
    if (c.url.includes('/sheets/query')) return { json: { code: 0, data: { sheets: [{ sheet_id: 'SHT1' }] } } };
    if (c.url.includes('/values/') && c.method === 'GET') return { json: { code: 0, data: { valueRange: { values: [['h']] } } } };
    if (c.url.includes('/dataValidation')) return { json: { code: 0, data: {} } };
    // 写回失败：模拟 valueRanges is nil 错误
    return { json: { code: 99991672, msg: 'valueRanges is nil, wrong request body' } };
  });
  try {
    await writeToSheet([{ tm_match: 't', similarity: 80, ai_translation: 'r', new_match: 70, reached_threshold: false, ai_vs_tm: { status: 'improved', changes: 'x' } }],
      { feishuUserAccessToken: 'u-user-token', spreadsheetToken: 'SP', sheetId: 'SHT1' });
    assert('写 API 错抛出', false);
  } catch (e) {
    assert('写 API 错抛 Sheets write error', /Sheets write error/.test(e.message), e.message);
    assert('错误信息含原始 msg', /valueRanges is nil/.test(e.message), e.message);
  }
}

console.log('\n=== BX3: 输出目标校验（未填禁止写回） ===');
{
  // 复用 parseFeishuUrl 作为「目标是否有效」判定（与 popup.js confirmDestination 一致）
  const destOk = (raw) => !!parseFeishuUrl(raw || '');
  assert('空目标 → 禁止写回', !destOk(''));
  assert('null/undefined 目标 → 禁止写回', !destOk(null) && !destOk(undefined));
  assert('纯空格 → 禁止写回', !destOk('   '));
  assert('非飞书链接 → 禁止写回', !destOk('https://example.com/foo'));
  assert('Sheet 链接 → 允许写回', destOk('https://bytedance.larkoffice.com/sheets/ABC123def456'));
  assert('Bitable 链接 → 允许（识别类型）', parseFeishuUrl('https://xxx.larkoffice.com/base/Tok123')?.type === 'bitable');
  assert('裸 token → 允许写回', destOk('ABC123def456token'));
}
console.log('\n=== BX3b: Bitable 目标暂不支持写回（防护） ===');
{
  // 复刻 popup.js destWritable 判定：parsed 存在且 type !== 'bitable'
  const destWritable = (raw) => { const p = parseFeishuUrl(raw || ''); return !!p && p.type !== 'bitable'; };
  assert('Sheet 链接 → 可写', destWritable('https://xxx.larkoffice.com/sheets/Tok123'));
  assert('裸 token → 可写', destWritable('Tok123abcdef'));
  assert('Bitable 链接 → 不可写', !destWritable('https://xxx.larkoffice.com/base/Tok123'));
  assert('空目标 → 不可写', !destWritable(''));
  assert('非飞书链接 → 不可写', !destWritable('https://example.com/foo'));
}

console.log('\n=== ROI: Sheet 不追加 H-O 列或写入金额 ===');
{
  _resetTokenCache();
  const calls = mockFetch((c) => {
    if (c.url.includes('/auth/v3/tenant_access_token')) return { json: { code: 0, tenant_access_token: 'TOK', expire: 7200 } };
    if (c.url.includes('/sheets/query')) return { json: { code: 0, data: { sheets: [{ sheet_id: 'SHT1' }] } } };
    return { json: { code: 0, data: {} } };
  });
  await writeToSheet([{
    row: 2, tm_match: '完成', similarity: 80, ai_translation: 'Done', new_match: 90, reached_threshold: false,
    roi: {
      status: 'complete',
      originalActualWordCount: 100, originalWeightedWordCount: 60,
      postRewriteActualWordCount: 120, postRewriteWeightedWordCount: 70,
      estimatedCostBefore: 4, estimatedCostAfter: 1.4, estimatedSaving: 2.6,
    },
  }], { feishuUserAccessToken: 'u-user-token', spreadsheetToken: 'SP', sheetId: 'SHT1' });
  const ranges = JSON.parse(calls.find((c) => c.url.includes('values_batch_update')).body).valueRanges;
  const cell = (column) => ranges.find((valueRange) => valueRange.range === `SHT1!${column}2:${column}2`);
  assert('只新增 B-G TM/CD 表头', ranges.some((valueRange) => valueRange.range === 'SHT1!B1:G1'));
  assert('H-O 不写字数、成本、节省或 ROI 状态', !['H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'].some((column) => cell(column)));
}

console.log('\n=== 动态布局: 多 Sheet 列表、D3 来源与 H:M 输出 ===');
{
  _resetTokenCache();
  const calls = mockFetch((c) => {
    if (c.url.includes('/sheets/query')) {
      return { json: { code: 0, data: { sheets: [
        { sheet_id: 'SHT1', title: 'Overview', index: 0 },
        { sheet_id: 'SHT2', title: 'Arabic', index: 1 },
      ] } } };
    }
    return { json: { code: 0, data: {} } };
  });
  const sheets = await listSpreadsheetSheets({ feishuUserAccessToken: 'u-user-token', spreadsheetToken: 'SP' });
  assert('列出同一 Spreadsheet 的两个 Sheet', sheets.length === 2);
  assert('保留 Sheet 名称、ID 与顺序', sheets[1].title === 'Arabic' && sheets[1].sheetId === 'SHT2' && sheets[1].index === 1);
  assert('Sheet 列表使用 query API', calls.some((call) => call.url.includes('/sheets/query')));
}

{
  _resetTokenCache();
  const calls = mockFetch((c) => {
    const decoded = decodeURIComponent(c.url);
    if (decoded.includes('SHT2!A1:Z20')) {
      return { json: { code: 0, data: { valueRange: { values: [
        ['', '', '', 'Notes'],
        ['', '', '', 'Original Source Segment'],
        ['', '', '', 'First source'],
        ['', '', '', 'Second source'],
      ] } } } };
    }
    if (decoded.includes('SHT2!D3:D')) {
      return { json: { code: 0, data: { valueRange: { values: [['First source'], ['Second source']] } } } };
    }
    return { json: { code: 0, data: {} } };
  });
  const inspected = await inspectSheetLayout({ feishuUserAccessToken: 'u-user-token', spreadsheetToken: 'SP', sheetId: 'SHT2' });
  assert('检测 D2 表头并从 D3 开始', inspected.layout.sourceColumn === 'D' && inspected.layout.dataStartRow === 3);
  const segments = await listSourceSegments({
    feishuUserAccessToken: 'u-user-token', spreadsheetToken: 'SP', sheetId: 'SHT2',
    sheetLayout: { sourceColumn: 'D', dataStartRow: 3, outputStartColumn: 'H', confirmed: true },
  });
  assert('动态来源读取 D3:D', calls.some((call) => decodeURIComponent(call.url).includes('SHT2!D3:D')));
  assert('动态来源保留第三、四行真实行号', segments[0].row === 3 && segments[1].row === 4);
}

{
  _resetTokenCache();
  const calls = mockFetch((c) => {
    const decoded = decodeURIComponent(c.url);
    if (decoded.includes('SHT2!D3:M')) {
      return { json: { code: 0, data: { valueRange: { values: [
        ['Original A', '', '', '', '', '', 'CD final C', '', '', 'Yes'],
        ['Pending A', '', '', '', '', '', 'AI candidate B', '', '', ''],
      ] } } } };
    }
    return { json: { code: 0, data: {} } };
  });
  const finals = await listFinalSourceSegments({
    feishuUserAccessToken: 'u-user-token', spreadsheetToken: 'SP', sheetId: 'SHT2',
    sheetLayout: { sourceColumn: 'D', dataStartRow: 3, outputStartColumn: 'H', confirmed: true },
  });
  assert('最终 C 动态读取 D3:M', calls.some((call) => decodeURIComponent(call.url).includes('SHT2!D3:M')));
  assert('动态 J/M 列只接受 Yes 的最终 C', finals[0].final_source_text === 'CD final C' && finals[1].final_source_text === '');
  assert('动态最终 C 保留第三、四行', finals[0].row === 3 && finals[1].row === 4);
}

{
  _resetTokenCache();
  const calls = mockFetch((c) => {
    const decoded = decodeURIComponent(c.url);
    if (decoded.includes('SHT2!H2:M3') && c.method === 'GET') {
      return { json: { code: 0, data: { valueRange: { values: [[
        'Best TM Match', 'Orig Match %', 'Rewritten Segment',
        'New Match %', 'Reached 85%?', 'CD review valid?',
      ]] } } } };
    }
    return { json: { code: 0, data: {} } };
  });
  await writeToSheet([{
    row: 3, tm_source: 'TM source', similarity: 80, ai_translation: 'Rewrite', new_match: 90, reached_threshold: true,
  }], {
    feishuUserAccessToken: 'u-user-token', spreadsheetToken: 'SP', sheetId: 'SHT2',
    sheetLayout: { sourceColumn: 'D', dataStartRow: 3, outputStartColumn: 'H', confirmed: true },
  });
  const validation = JSON.parse(calls.find((call) => call.url.includes('/dataValidation')).body);
  assert('CD 下拉使用动态 M3:M3', validation.range === 'SHT2!M3:M3', validation.range);
  const ranges = JSON.parse(calls.find((call) => call.url.includes('values_batch_update')).body).valueRanges;
  assert('动态输出表头写 H2:M2', ranges.some((range) => range.range === 'SHT2!H2:M2'));
  assert('动态结果写 H3:L3 并保留 M', ['H', 'I', 'J', 'K', 'L'].every((column) => ranges.some((range) => range.range === `SHT2!${column}3:${column}3`)) && !ranges.some((range) => range.range === 'SHT2!M3:M3'));
}

{
  _resetTokenCache();
  const calls = mockFetch((c) => {
    const decoded = decodeURIComponent(c.url);
    if (decoded.includes('SHT2!H2:M3') && c.method === 'GET') {
      return { json: { code: 0, data: { valueRange: { values: [['Owner notes']] } } } };
    }
    return { json: { code: 0, data: {} } };
  });
  try {
    await writeToSheet([{ row: 3, tm_source: 'TM', similarity: 80 }], {
      feishuUserAccessToken: 'u-user-token', spreadsheetToken: 'SP', sheetId: 'SHT2',
      sheetLayout: { sourceColumn: 'D', dataStartRow: 3, outputStartColumn: 'H', confirmed: true },
    });
    assert('未知输出表头必须停止', false);
  } catch (error) {
    assert('未知输出表头必须正确失败', /output area|输出区域/i.test(error.message), error.message);
  }
  assert('输出冲突后不写值也不建下拉', !calls.some((call) => call.url.includes('values_batch_update') || call.url.includes('/dataValidation')));
}
console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`);
if (fail > 0) process.exit(1);
