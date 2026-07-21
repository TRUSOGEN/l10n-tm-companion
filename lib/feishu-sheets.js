/**
 * 飞书电子表格（Sheets）API 封装
 * =================================
 * 团队用电子表格（/sheets/<spreadsheet_token>），不是多维表格（Bitable）。
 * 按当前 Sheet 的已确认布局读写：source 列保存原文，连续六列保存插件结果与 CD review。
 * ROI 费率、成本与金额不写入 Spreadsheet，只在 ROI_Test 多维表格中保存和计算。
 *
 * 默认兼容布局为 A2 source 与 B-G 输出；Side Panel 的正式路径会按 Sheet 自动检测并
 * 确认 source column、data start row 和 output start column。输出字段始终连续六列，
 * 最后一列是 CD review valid?（Yes/No 单选，默认留空待人工）。
 *
 * 鉴权：以 App ID / App Secret 换取 tenant_access_token，应用需作为表格协作者。
 * 所需应用权限：sheets:spreadsheet（读写电子表格）。
 *
 * 接口（飞书 Sheets v2 批量，最稳）：
 *   读：GET  /sheets/v2/spreadsheets/{token}/values/{dynamicRange}
 *   写：POST /sheets/v2/spreadsheets/{token}/values_batch_update
 *   查 sheet：GET /sheets/v3/spreadsheets/{token}/sheets/query
 */

const FEISHU_BASE = 'https://open.feishu.cn/open-apis';
import { getTenantToken } from './feishu-bitable.js';
import {
  OUTPUT_HEADERS,
  columnToIndex,
  detectSheetLayout,
  getOutputColumns,
  indexToColumn,
  validateSheetLayout,
} from './sheet-layout.js';

/** 旧版固定 A2/B-G 布局，仅用于没有显式 Sheet 布局的兼容调用。 */
const DEFAULT_SHEET_LAYOUT = Object.freeze({
  sourceColumn: 'A',
  headerRow: 1,
  dataStartRow: 2,
  outputStartColumn: 'B',
  confirmed: true,
  detection: 'legacy_default',
});

/** 解析并校验当前调用应使用的布局。 */
function resolveSheetLayout(config = {}) {
  const candidate = config.sheetLayout || DEFAULT_SHEET_LAYOUT;
  const validation = validateSheetLayout(candidate);
  if (validation.status !== 'ready') {
    throw new Error(`Invalid Sheet layout: ${validation.reason}`);
  }
  if (config.sheetLayout && candidate.confirmed !== true) {
    throw new Error('Sheet layout must be confirmed before reading or writing.');
  }
  return validation.layout;
}

/**
 * 当前普通 Sheet 输出表头（顺序固定，不可改名）。
 * CD review valid? 留给人工 review，默认不写。
 */
export const REQUIRED_HEADERS = [
  'Original Source Segment',
  'Best TM Match',
  'Orig Match %',
  'Rewritten Segment',
  'New Match %',
  'Reached 85%?',
  'CD review valid?',
];

export const ROI_HEADERS = [
  // 保留导出兼容；普通 Spreadsheet 不再拥有 ROI 字段。
];

/** 取得应用身份 token；兼容已存在的旧用户 token，但 Settings 只保存 App 凭证。 */
async function resolveSheetsAccessToken(config) {
  const appId = typeof config?.feishuAppId === 'string' ? config.feishuAppId.trim() : '';
  const appSecret = typeof config?.feishuAppSecret === 'string' ? config.feishuAppSecret.trim() : '';
  if (appId || appSecret) {
    if (!appId || !appSecret) {
      throw new Error('Feishu App ID and App Secret must both be provided.');
    }
    return getTenantToken(appId, appSecret);
  }

  const legacyUserToken = typeof config?.feishuUserAccessToken === 'string'
    ? config.feishuUserAccessToken.trim()
    : '';
  if (legacyUserToken) return legacyUserToken;
  throw new Error('Configure Feishu App ID and App Secret in Settings first.');
}

// 列字母（A=1, B=2, ...），用于表头映射。
const COL_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function colNumberToLetter(n) {
  // n 从 1 开始；仅支持 A-Z（>26 列不常见，够用）
  return COL_LETTERS[n - 1];
}

/**
 * 把目标表第一行（表头行）映射成「列名 → 列字母」。
 * 用于按具名列头定位写入列，而非硬编码 A-G。
 *
 * @param {string[]} headerRow  表头行的单元格文字数组（如 ['Row','Original Source Segment', ...]）
 * @returns {{ byName: Object<string,string>, missing: string[], extra: string[] }}
 *   byName: 列名 → 列字母；missing: REQUIRED_HEADERS 里缺失的列名；extra: 表里有但 spec 不要求的列名
 */
export function mapHeadersToColumns(headerRow) {
  const byName = {};
  const present = new Set();
  if (Array.isArray(headerRow)) {
    headerRow.forEach((cell, idx) => {
      const name = (typeof cell === 'string' ? cell : String(cell ?? '')).trim();
      if (!name) return;
      const letter = colNumberToLetter(idx + 1);
      if (!byName[name]) byName[name] = letter; // 取第一个匹配
      present.add(name);
    });
  }
  const missing = REQUIRED_HEADERS.filter((h) => !present.has(h));
  const extra = [...present].filter((h) => !REQUIRED_HEADERS.includes(h));
  return { byName, missing, extra };
}


/**
 * 解析 spreadsheet_token 与 sheet_id。
 * 支持：
 *   - 仅 spreadsheet_token（自动取第一个 sheet）
 *   - 完整 URL https://xxx.larkoffice.com/sheets/<token>
 *
 * 注：仅识别电子表格（/sheets/）。多维表格（/base/）请用 parseFeishuUrl。
 */
export function parseSheetsUrl(input) {
  if (!input) return null;
  // 直接是 token
  if (/^[A-Za-z0-9]+$/.test(input) && input.length > 10 && !input.includes('/')) {
    return { spreadsheetToken: input, sheetId: null };
  }
  // URL: /sheets/<token>，可能带 ?sheet=<sheetId> 或 ?sheetId=
  const m = input.match(/\/sheets\/([A-Za-z0-9]+)/);
  if (m) {
    const sheetMatch = input.match(/[?&]sheet=([A-Za-z0-9]+)/);
    return { spreadsheetToken: m[1], sheetId: sheetMatch?.[1] || null };
  }
  // wiki 节点挂载的电子表格：wiki token 即 spreadsheet token
  const w = input.match(/\/wiki\/([A-Za-z0-9]+)/);
  if (w) {
    const sheetMatch = input.match(/[?&]sheet=([A-Za-z0-9]+)/);
    return { spreadsheetToken: w[1], sheetId: sheetMatch?.[1] || null };
  }
  return null;
}

/**
 * 统一解析飞书链接，区分电子表格（Sheet）与多维表格（Bitable）。
 * 用于「粘贴 URL 自动识别目标类型」。
 *
 * 识别规则：
 *   - /sheets/<token>         → type='sheet',  spreadsheetToken, sheetId?
 *   - /wiki/<token>           → type='sheet',  spreadsheetToken=<wiki token>
 *     ⚠️ 飞书 wiki 中「挂载电子表格」的节点，wiki token 本身就是该
 *        spreadsheet 的 token（obj_token 即 spreadsheet_token），可直接用
 *        Sheets API 读写。实测：QmG4w6... wiki 节点 → 9a9d2d sheet → A 列 39 条原文。
 *        之前只认 /sheets/，贴 /wiki/ 链接解析不出 token → 报「未设置写入目标」，
 *        而用户实际用的是 wiki 表，这就是「读不到原文」的根因之一。
 *   - /base/<token>            → type='bitable', appToken, tableId?
 *     （多维表格 URL 常带 ?table=<tableId>，或 ?openId= 之类，仅取 table）
 *   - 裸 token（长度>10 纯字母数字）→ type='sheet'（沿用旧默认，电子表格）
 *
 * @returns {{type, spreadsheetToken?, sheetId?, appToken?, tableId?} | null}
 */
export function parseFeishuUrl(input) {
  if (!input) return null;

  // 电子表格
  const sheetMatch = input.match(/\/sheets\/([A-Za-z0-9]+)/);
  if (sheetMatch) {
    const sheetId = input.match(/[?&]sheet=([A-Za-z0-9]+)/)?.[1] || null;
    return { type: 'sheet', spreadsheetToken: sheetMatch[1], sheetId };
  }

  // wiki 节点（挂载电子表格的 wiki，wiki token 即 spreadsheet token）
  const wikiMatch = input.match(/\/wiki\/([A-Za-z0-9]+)/);
  if (wikiMatch) {
    const sheetId = input.match(/[?&]sheet=([A-Za-z0-9]+)/)?.[1] || null;
    return { type: 'sheet', spreadsheetToken: wikiMatch[1], sheetId, fromWiki: true };
  }

  // 多维表格
  const baseMatch = input.match(/\/base\/([A-Za-z0-9]+)/);
  if (baseMatch) {
    const tableId = input.match(/[?&]table=([A-Za-z0-9]+)/)?.[1] || null;
    return { type: 'bitable', appToken: baseMatch[1], tableId };
  }

  // 裸 token：按电子表格处理（与旧 parseSheetsUrl 行为一致）
  if (/^[A-Za-z0-9]+$/.test(input) && input.length > 10 && !input.includes('/')) {
    return { type: 'sheet', spreadsheetToken: input, sheetId: null };
  }

  return null;
}

/**
 * 获取 spreadsheet 的第一个 sheet_id（若用户没指定）。
 */
export async function getDefaultSheetId(token, accessToken) {
  const url = `${FEISHU_BASE}/sheets/v3/spreadsheets/${token}/sheets/query`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await resp.json();
  if (data.code !== 0) {
    throw new Error(`Sheets query error: ${data.msg || data.code}`);
  }
  const sheets = data.data?.sheets || [];
  if (sheets.length === 0) throw new Error('This spreadsheet has no sheets.');
  return sheets[0].sheet_id;
}

/** 列出一份 Spreadsheet 内所有可见 Sheet，供 Side Panel 显式选择。 */
export async function listSpreadsheetSheets(config) {
  const spreadsheetToken = String(config?.spreadsheetToken || '').trim();
  if (!spreadsheetToken) throw new Error('Spreadsheet token is not configured.');
  const accessToken = await resolveSheetsAccessToken(config);
  const sheets = await _listSheets(spreadsheetToken, accessToken);
  return sheets
    .map((sheet, index) => ({
      sheetId: sheet.sheet_id,
      title: sheet.title || sheet.sheet_id,
      index: Number.isInteger(sheet.index) ? sheet.index : index,
    }))
    .filter((sheet) => sheet.sheetId)
    .sort((left, right) => left.index - right.index);
}

/** 读取 A-Z 前二十行并运行纯函数布局检测。 */
export async function inspectSheetLayout(config) {
  const spreadsheetToken = String(config?.spreadsheetToken || '').trim();
  if (!spreadsheetToken) throw new Error('Spreadsheet token is not configured.');
  const accessToken = await resolveSheetsAccessToken(config);
  const sheetId = config.sheetId || await getDefaultSheetId(spreadsheetToken, accessToken);
  const rows = await _readRange(spreadsheetToken, sheetId, accessToken, `${sheetId}!A1:Z20`);
  return { ...detectSheetLayout(rows), spreadsheetToken, sheetId, rows };
}

/**
 * 从电子表格读取原文（A 列，第 2 行起）。
 * ⚠️ 跳过空行但保留真实行号：返回的 row 字段是表格里的真实行号（A2→row=2），
 * writeToSheet 必须按 row 定位单元格写，否则 A 列有空行时 B-F 会全部错位。
 *
 * @param {object} config { feishuAppId, feishuAppSecret, spreadsheetToken, sheetId }
 * @returns {Promise<Array>} [{ source_text, row }] row 是行号（从 2 开始）
 */
export async function listSourceSegments(config) {
  const { spreadsheetToken, sheetId } = config;
  if (!spreadsheetToken) throw new Error('Spreadsheet token is not configured.');

  const token = await resolveSheetsAccessToken(config);
  const sheet = sheetId || await getDefaultSheetId(spreadsheetToken, token);
  const layout = resolveSheetLayout(config);

  // 优先尝试指定/默认 sheet
  let results = await _readSourceColumn(
    spreadsheetToken, sheet, token, layout.sourceColumn, layout.dataStartRow,
  );

  // 默认 sheet 读空时，遍历所有工作表找有 A 列数据的那个
  // （真机根因：表格有多个 sheet，默认首个是空表，原文在别的 sheet）
  if (results.length === 0 && !sheetId && !config.sheetLayout) {
    const allSheets = await _listSheets(spreadsheetToken, token);
    for (const s of allSheets) {
      if (s.sheet_id === sheet) continue;
      try {
        const r = await _readSourceColumn(
          spreadsheetToken, s.sheet_id, token, layout.sourceColumn, layout.dataStartRow,
        );
        if (r.length > 0) {
          results = r;
          break;
        }
      } catch (e) { /* 单个 sheet 读失败不影响其它 */ }
    }
  }

  if (results.length === 0) {
    const allSheets = await _listSheets(spreadsheetToken, token).catch(() => []);
    // dump 前 5 行所有列，定位原文到底在哪个列/行
    let dump = null;
    try {
      dump = await _readRange(spreadsheetToken, sheet, token, 'A1:Z5');
    } catch (e) { dump = { error: e.message }; }
    const diag = JSON.stringify({
      triedSheet: sheet,
      allSheets: allSheets.map((s) => ({ id: s.sheet_id, title: s.title, index: s.index })),
      firstRowsDump: dump,
      sourceRange: `${layout.sourceColumn}${layout.dataStartRow}:${layout.sourceColumn}`,
      hint: 'Configured source range is empty. Inspect firstRowsDump and confirm the source column and data start row.',
    });
    throw new Error(`No source text found in the configured range. Diagnostic: ${diag}`);
  }
  return results;
}

/**
 * 读取 CD 在 Spreadsheet D 列确认或编辑后的最终英文文案 C。
 *
 * A 列继续提供稳定的原文行身份，D 列在首次写回后预填 AI 候选 B；CD 编辑 D 列并将
 * G 列设为 Yes 后才形成最终 C。未确认或空 C 不会被静默忽略，调用方必须将对应条目
 * 保留为“待最终 TM 验证”。
 *
 * @param {object} config 飞书 Spreadsheet 配置。
 * @returns {Promise<Array<{source_text:string, final_source_text:string, row:number}>>} 按真实行号返回。
 */
export async function listFinalSourceSegments(config) {
  const { spreadsheetToken, sheetId } = config;
  if (!spreadsheetToken) throw new Error('Spreadsheet token is not configured.');
  const token = await resolveSheetsAccessToken(config);
  const sheet = sheetId || await getDefaultSheetId(spreadsheetToken, token);
  const layout = resolveSheetLayout(config);
  const output = getOutputColumns(layout.outputStartColumn);
  const sourceIndex = columnToIndex(layout.sourceColumn);
  const rewrittenIndex = columnToIndex(output.rewritten);
  const reviewIndex = columnToIndex(output.cdReview);
  const rangeStartIndex = Math.min(sourceIndex, rewrittenIndex, reviewIndex);
  const rangeEndIndex = Math.max(sourceIndex, rewrittenIndex, reviewIndex);
  const rangeStart = indexToColumn(rangeStartIndex);
  const rangeEnd = indexToColumn(rangeEndIndex);
  const rows = await _readRange(
    spreadsheetToken, sheet, token,
    `${sheet}!${rangeStart}${layout.dataStartRow}:${rangeEnd}`,
  );
  const sourceOffset = sourceIndex - rangeStartIndex;
  const rewrittenOffset = rewrittenIndex - rangeStartIndex;
  const reviewOffset = reviewIndex - rangeStartIndex;
  return rows.map((row, index) => ({
    source_text: String(row?.[sourceOffset] ?? '').trim(),
    final_source_text: String(row?.[reviewOffset] ?? '').trim().toLowerCase() === 'yes'
      ? String(row?.[rewrittenOffset] ?? '').trim()
      : '',
    row: index + layout.dataStartRow,
  })).filter((item) => item.source_text);
}

/** 读取任意 range，返回原始二维数组（rows × cols）。 */
async function _readRange(spreadsheetToken, sheet, accessToken, range) {
  const url = `${FEISHU_BASE}/sheets/v2/spreadsheets/${spreadsheetToken}/values/${encodeURIComponent(range)}?valueRenderOption=ToString`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await resp.json();
  if (data.code !== 0) throw new Error(`Sheets read error: ${data.msg || data.code}`);
  return data.data?.valueRange?.values || [];
}

/** 列出电子表格所有工作表（含 id/title/index）。 */
async function _listSheets(spreadsheetToken, accessToken) {
  const url = `${FEISHU_BASE}/sheets/v3/spreadsheets/${spreadsheetToken}/sheets/query`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await resp.json();
  if (data.code !== 0) throw new Error(`Sheets query error: ${data.msg || data.code}`);
  return data.data?.sheets || [];
}

/** 读取指定工作表的已确认 source 列，返回原文与真实行号。 */
async function _readSourceColumn(spreadsheetToken, sheet, accessToken, sourceColumn, dataStartRow) {
  const range = `${sheet}!${sourceColumn}${dataStartRow}:${sourceColumn}`;
  const url = `${FEISHU_BASE}/sheets/v2/spreadsheets/${spreadsheetToken}/values/${encodeURIComponent(range)}?valueRenderOption=ToString`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await resp.json();
  if (data.code !== 0) throw new Error(`Sheets read error: ${data.msg || data.code}`);
  const rows = data.data?.valueRange?.values || [];
  const results = [];
  rows.forEach((row, idx) => {
    const cell = row?.[0];
    const text = typeof cell === 'string' ? cell : (cell?.toString?.() || '');
    if (text && text.trim()) {
      results.push({ source_text: text.trim(), row: idx + dataStartRow });
    }
  });
  return results;
}

/**
 * 读取目标表 A 列已有数据的最大行号（用于 doc-capture 追加写入）。
 * 返回最后一个非空行号；空表返回 1（表头行），追加从第 2 行开始。
 *
 * @param {string} spreadsheetToken
 * @param {string} sheet
 * @param {string} accessToken
 * @returns {Promise<number>} 最后一行行号（≥1）
 */
async function getLastDataRow(spreadsheetToken, sheet, accessToken, sourceColumn = 'A', headerRow = 1) {
  const range = `${sheet}!${sourceColumn}${headerRow}:${sourceColumn}`;
  const url = `${FEISHU_BASE}/sheets/v2/spreadsheets/${spreadsheetToken}/values/${encodeURIComponent(range)}?valueRenderOption=ToString`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await resp.json();
  if (data.code !== 0) {
    throw new Error(`Sheets read error: ${data.msg || data.code}`);
  }
  const rows = data.data?.valueRange?.values || [];
  // rows[0] 对应 A1；最后一行的行号 = rows.length（可能含空行，取数组长度为下界）
  return Math.max(headerRow, headerRow + rows.length - 1);
}

/**
 * 为 CD review 列设置 Yes/No 单选下拉。
 *
 * 该操作在结果写入前执行。设置失败时必须停止写回，避免页面声称 review schema
 * 已准备完成，实际却允许任意值。
 *
 * @param {string} spreadsheetToken 电子表格 token。
 * @param {string} sheet 工作表 ID。
 * @param {string} accessToken 飞书访问凭证。
 * @param {number} lastRow 本次输出的最大行号。
 * @returns {Promise<void>}
 */
export async function ensureCdReviewDropdown(
  spreadsheetToken, sheet, accessToken, lastRow, reviewColumn = 'G', dataStartRow = 2,
) {
  if (!Number.isInteger(lastRow) || lastRow < dataStartRow) {
    throw new Error(`Invalid CD review dropdown row range: ${lastRow}`);
  }
  const url = `${FEISHU_BASE}/sheets/v2/spreadsheets/${spreadsheetToken}/dataValidation`;
  const resp = await fetch(url, {
    // 飞书集合路径使用 POST 创建下拉规则；PUT 仅用于带 sheetId/dataValidationId 的更新路径。
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // 范围不能超过工作表现有 grid。每次写回覆盖本次实际输出行，后续写回自动延长。
      range: `${sheet}!${reviewColumn}${dataStartRow}:${reviewColumn}${lastRow}`,
      dataValidationType: 'list',
      dataValidation: {
        conditionValues: ['Yes', 'No'],
        // 未传颜色时不能开启高亮，否则飞书要求每个选项都有对应颜色。
        options: { multipleValues: false, highlightValidData: false },
      },
    }),
  });
  const data = await resp.json();
  if (data.code !== 0) {
    throw new Error(`Sheets CD review dropdown error: ${data.msg || data.code}`);
  }
}

/**
 * 在显式动态布局下保护用户已有内容。
 *
 * 空输出区域可以初始化；完整标准表头表示插件自己的可重写区域；任何其他表头，或
 * 空表头下已有数据，均停止写回，避免覆盖未知列。
 */
async function assertOutputAreaSafe(spreadsheetToken, sheet, accessToken, layout, lastOutputRow) {
  const output = getOutputColumns(layout.outputStartColumn);
  const range = `${sheet}!${layout.outputStartColumn}${layout.headerRow}:${output.cdReview}${lastOutputRow}`;
  const rows = await _readRange(spreadsheetToken, sheet, accessToken, range);
  const header = OUTPUT_HEADERS.map((_, index) => String(rows[0]?.[index] ?? '').trim());
  const headerIsEmpty = header.every((value) => !value);
  const headerMatches = OUTPUT_HEADERS.every((value, index) => header[index] === value);
  if (headerMatches) return;
  const dataHasValue = rows.slice(1).some((row) => (
    OUTPUT_HEADERS.some((_, index) => String(row?.[index] ?? '').trim() !== '')
  ));
  if (headerIsEmpty && !dataHasValue) return;
  throw new Error(
    `Sheet output area ${range} contains unknown headers or data. Choose another output start column.`,
  );
}

/**
 * 把处理结果批量写入电子表格（按 row 定位每行，只写 B-F）。
 * ⚠️ 必须用 item.row 真实行号定位，不能按下标整列写——
 * 否则 A 列有空行时（listSourceSegments 跳过空行），B-F 会全部错位。
 *
 * 每个 item 生成 5 个单行 valueRange（B/C/D/E/F，G 不写），
 * 用 values_batch_update 一次性提交。
 *
 * BX2 修复：
 *   - item 无 row（doc/wiki 抓取来源）时走追加路径：按目标表已有数据行数
 *     连续追加，row = lastDataRow + 1, +2, ...
 *   - valueRanges 为空时抛明确可操作错误，不再把空数组发给 API（避免
 *     `valueRanges is nil, wrong request body`）。
 *
 * @param {Array}  items  处理后的文案项（有 row 按行定位；无 row 追加）
 * @param {object} config { feishuAppId, feishuAppSecret, spreadsheetToken, sheetId }
 */
export async function writeToSheet(items, config) {
  const { spreadsheetToken, sheetId } = config;
  if (!spreadsheetToken) throw new Error('Spreadsheet token is not configured.');
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('No items to write; valueRanges would be empty. Process source text first.');
  }

  const token = await resolveSheetsAccessToken(config);
  const sheet = sheetId || await getDefaultSheetId(spreadsheetToken, token);
  const layout = resolveSheetLayout(config);
  const output = getOutputColumns(layout.outputStartColumn);

  // BX2：doc/wiki 抓取来源无 row → 追加路径。
  // 追加起点 = max(目标表已有数据末行, 有 row 的最大行号) + 1，
  // 保证混用时不与按行号写的条目重叠。
  const hasNoRow = items.some((it) => it.row == null);
  let appendFrom = 0;
  if (hasNoRow) {
    const lastData = await getLastDataRow(
      spreadsheetToken, sheet, token, layout.sourceColumn, layout.headerRow,
    );
    const maxItemRow = items.reduce((m, it) => (it.row != null ? Math.max(m, it.row) : m), 0);
    appendFrom = Math.max(lastData, maxItemRow) + 1;
  }

  // 先解析本次每条输出的真实行号，再设置下拉范围。静态写到 G5000 会超出
  // 小型工作表的 grid，飞书会拒绝整个写回操作。
  let appendIdx = 0;
  const resolvedItems = items.map((it) => {
    const row = it.row != null ? it.row : appendFrom + appendIdx;
    if (it.row == null) appendIdx++;
    if (!Number.isInteger(row) || row < layout.dataStartRow) {
      throw new Error(`Invalid Sheet output row: ${row}`);
    }
    return { it, row };
  });
  const lastOutputRow = Math.max(...resolvedItems.map(({ row }) => row));
  if (config.sheetLayout) {
    await assertOutputAreaSafe(spreadsheetToken, sheet, token, layout, lastOutputRow);
  }
  await ensureCdReviewDropdown(
    spreadsheetToken, sheet, token, lastOutputRow, output.cdReview, layout.dataStartRow,
  );

  const valueRanges = [];

  // 写数据前补 B1:G1 表头（无条件、幂等：每次写回都重置成标准列名）。
  // Spreadsheet 是 CD 的 TM 对比与文案编辑工作台，不写任何 ROI 字段或金额。
  // 独立成条、放在所有数据条之前，确保表头一定被写入，不被数据条覆盖。
  valueRanges.push({
    range: `${sheet}!${layout.outputStartColumn}${layout.headerRow}:${output.cdReview}${layout.headerRow}`,
    values: [OUTPUT_HEADERS.slice()],
  });

  for (const { it, row } of resolvedItems) {
    valueRanges.push(
      // 当前工作流优化 English source；B 列展示 TM 库中实际命中的英文 source，
      // 而 tm_match 保留目标语言译文，供用户选择复用译文时使用。
      { range: `${sheet}!${output.tmSource}${row}:${output.tmSource}${row}`, values: [[it.tm_source || it.tm_match || '']] },
      { range: `${sheet}!${output.originalScore}${row}:${output.originalScore}${row}`, values: [[it.similarity ? Math.round(it.similarity) : 0]] },
      { range: `${sheet}!${output.rewritten}${row}:${output.rewritten}${row}`, values: [[it.ai_translation || '']] },
      { range: `${sheet}!${output.rewrittenScore}${row}:${output.rewrittenScore}${row}`, values: [[it.new_match != null ? Math.round(it.new_match) : 0]] },
      { range: `${sheet}!${output.reachedThreshold}${row}:${output.reachedThreshold}${row}`, values: [[it.reached_threshold === true ? 'TRUE' : 'FALSE']] },
      // G 列 = CD review valid?，只允许人工从 Yes/No 下拉选择，代码绝不自动写入。
    );
  }

  // BX2：空 valueRanges 防护——绝不把空数组发给 API（避免 valueRanges is nil）。
  if (valueRanges.length === 0) {
    throw new Error('No cells to write because valueRanges is empty. Confirm that items were processed.');
  }

  const url = `${FEISHU_BASE}/sheets/v2/spreadsheets/${spreadsheetToken}/values_batch_update`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ valueRanges }),
  });
  const data = await resp.json();
  if (data.code !== 0) {
    throw new Error(`Sheets write error: ${data.msg || data.code}`);
  }
  return items.length;
}

/**
 * 读取目标表第一行（表头行）的文字数组。
 * 用 A1:1（仅第 1 行）读取整行。
 */
export async function readHeaderRow(config) {
  const { spreadsheetToken, sheetId } = config;
  if (!spreadsheetToken) throw new Error('Spreadsheet token is not configured.');

  const token = await resolveSheetsAccessToken(config);
  const sheet = sheetId || await getDefaultSheetId(spreadsheetToken, token);

  const range = `${sheet}!A1:1`;
  const url = `${FEISHU_BASE}/sheets/v2/spreadsheets/${spreadsheetToken}/values/${encodeURIComponent(range)}?valueRenderOption=ToString`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await resp.json();
  if (data.code !== 0) {
    throw new Error(`Sheets read error: ${data.msg || data.code}`);
  }
  const rows = data.data?.valueRange?.values || [];
  return rows[0] || [];
}

/**
 * 校验目标表表头是否满足 REQUIRED_HEADERS。
 * @returns {{ok:boolean, byName:object, missing:string[], extra:string[], sheet:string}}
 *   ok=true 当且仅当 missing 为空。missing 列表供 UI 提示用户是否自动创建。
 */
export async function validateHeaders(config) {
  const { sheetId } = config;
  const { spreadsheetToken } = config;
  if (!spreadsheetToken) throw new Error('Spreadsheet token is not configured.');

  const token = await resolveSheetsAccessToken(config);
  const sheet = sheetId || await getDefaultSheetId(spreadsheetToken, token);
  const headerRow = await readHeaderRow({ ...config, spreadsheetToken, sheetId: sheet });
  const mapped = mapHeadersToColumns(headerRow);
  return { ok: mapped.missing.length === 0, byName: mapped.byName, missing: mapped.missing, extra: mapped.extra, sheet };
}

/**
 * 修复表头：把 A1:G1 重置为 REQUIRED_HEADERS。
 *
 * 这是显式覆盖标准表头的操作，只能在用户确认后调用；写入范围不会触及 H-J，
 * 因此旧 schema 的历史数据与表头均保持不动。
 */
export async function repairHeaders(config) {
  const { spreadsheetToken, sheetId } = config;
  if (!spreadsheetToken) throw new Error('Spreadsheet token is not configured.');

  const token = await resolveSheetsAccessToken(config);
  const sheet = sheetId || await getDefaultSheetId(spreadsheetToken, token);

  // 把 REQUIRED_HEADERS 写到第 1 行 A1:G1；H-J 历史数据保持不动。
  const range = `${sheet}!A1:G1`;
  const url = `${FEISHU_BASE}/sheets/v2/spreadsheets/${spreadsheetToken}/values_batch_update`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      valueRanges: [{ range, values: [REQUIRED_HEADERS.slice()] }],
    }),
  });
  const data = await resp.json();
  if (data.code !== 0) {
    throw new Error(`Sheets write error: ${data.msg || data.code}`);
  }
  return { repaired: REQUIRED_HEADERS.length, sheet };
}

/**
 * 连接测试：尝试获取 token + 列出 sheets（校验 token + spreadsheet 可访问）。
 */
export async function testSheetsConnection(config, spreadsheetToken) {
  try {
    const token = await resolveSheetsAccessToken(config);
    if (spreadsheetToken) {
      await getDefaultSheetId(spreadsheetToken, token);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
