/**
 * Sheet 动态布局的纯函数核心。
 *
 * 模块负责列名换算、标准 source 表头检测、无表头候选生成、输出六列映射与
 * 冲突校验。它不访问 Chrome 或 Feishu API，因此 Popup 与 Sheets 适配器可以共享
 * 同一业务规则，测试也能覆盖所有不确定与正确失败路径。
 */

const SOURCE_HEADER_ALIASES = new Set([
  'original source segment',
  'english source',
  'source',
]);

/** 输出区域固定字段相对于起始列的顺序。 */
export const OUTPUT_HEADERS = Object.freeze([
  'Best TM Match',
  'Orig Match %',
  'Rewritten Segment',
  'New Match %',
  'Reached 85%?',
  'CD review valid?',
]);

/** 将 A1 列名转换为从 1 开始的列序号。 */
export function columnToIndex(column) {
  const normalized = String(column || '').trim().toUpperCase();
  if (!/^[A-Z]+$/.test(normalized)) throw new Error(`Invalid column: ${column}`);
  return [...normalized].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0);
}

/** 将从 1 开始的列序号转换为 A1 列名。 */
export function indexToColumn(index) {
  if (!Number.isInteger(index) || index < 1) throw new Error(`Invalid column index: ${index}`);
  let remaining = index;
  let column = '';
  while (remaining > 0) {
    const digit = (remaining - 1) % 26;
    column = String.fromCharCode(65 + digit) + column;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return column;
}

/** 从指定列向右偏移固定列数。 */
export function offsetColumn(column, offset) {
  if (!Number.isInteger(offset)) throw new Error(`Invalid column offset: ${offset}`);
  return indexToColumn(columnToIndex(column) + offset);
}

/** 返回连续六列输出字段的列映射。 */
export function getOutputColumns(outputStartColumn) {
  return {
    tmSource: offsetColumn(outputStartColumn, 0),
    originalScore: offsetColumn(outputStartColumn, 1),
    rewritten: offsetColumn(outputStartColumn, 2),
    rewrittenScore: offsetColumn(outputStartColumn, 3),
    reachedThreshold: offsetColumn(outputStartColumn, 4),
    cdReview: offsetColumn(outputStartColumn, 5),
  };
}

/** 生成按 Spreadsheet 与 Sheet 隔离的本地布局键。 */
export function sheetLayoutStorageKey(spreadsheetToken, sheetId) {
  return `${String(spreadsheetToken || '').trim()}:${String(sheetId || '').trim()}`;
}

/** 规范化单元格字符串，用于严格的表头别名匹配。 */
function normalizeHeader(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** 判断单元格是否包含实际内容。 */
function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

/** 根据布局提取最多五个非空 source 预览并保留真实行号。 */
export function buildSourcePreview(rows, layout, limit = 5) {
  if (!layout?.sourceColumn || !Number.isInteger(layout.dataStartRow)) return [];
  const columnIndex = columnToIndex(layout.sourceColumn) - 1;
  const preview = [];
  for (let rowIndex = layout.dataStartRow - 1; rowIndex < rows.length && preview.length < limit; rowIndex += 1) {
    const value = rows[rowIndex]?.[columnIndex];
    if (hasValue(value)) preview.push({ row: rowIndex + 1, text: String(value) });
  }
  return preview;
}

/**
 * 校验用户确认的 source、数据起始行和连续六列输出区域。
 *
 * @returns {{status:'ready',layout:object}|{status:'incomplete',reason:string}}
 */
export function validateSheetLayout(layout = {}) {
  let sourceIndex;
  let outputStartIndex;
  try {
    sourceIndex = columnToIndex(layout.sourceColumn);
    outputStartIndex = columnToIndex(layout.outputStartColumn);
  } catch {
    return { status: 'incomplete', reason: 'invalid_column' };
  }
  if (!Number.isInteger(Number(layout.dataStartRow)) || Number(layout.dataStartRow) < 2) {
    return { status: 'incomplete', reason: 'data_start_row_requires_header' };
  }
  const outputEndIndex = outputStartIndex + OUTPUT_HEADERS.length - 1;
  if (sourceIndex >= outputStartIndex && sourceIndex <= outputEndIndex) {
    return { status: 'incomplete', reason: 'source_output_overlap' };
  }
  const dataStartRow = Number(layout.dataStartRow);
  return {
    status: 'ready',
    layout: {
      ...layout,
      sourceColumn: indexToColumn(sourceIndex),
      headerRow: dataStartRow - 1,
      dataStartRow,
      outputStartColumn: indexToColumn(outputStartIndex),
    },
  };
}

/** 为自动识别的 source 列推荐紧邻右侧的输出起始列。 */
function recommendedOutputStart(sourceColumn) {
  return offsetColumn(sourceColumn, 1);
}

/**
 * 检测 A-Z 前若干行中的 source 布局。
 *
 * 唯一标准表头可直接使用；多个标准表头、无标准表头或第一行就是数据时返回
 * `confirmation_required`，让用户看到候选后明确确认或调整。
 */
export function detectSheetLayout(rows = []) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const headerCandidates = [];
  safeRows.forEach((row, rowIndex) => {
    (Array.isArray(row) ? row : []).forEach((value, columnIndex) => {
      if (SOURCE_HEADER_ALIASES.has(normalizeHeader(value))) {
        const sourceColumn = indexToColumn(columnIndex + 1);
        headerCandidates.push({
          sourceColumn,
          headerRow: rowIndex + 1,
          dataStartRow: rowIndex + 2,
          outputStartColumn: recommendedOutputStart(sourceColumn),
        });
      }
    });
  });

  if (headerCandidates.length === 1) {
    const layout = {
      ...headerCandidates[0],
      confirmed: true,
      detection: 'exact_header',
    };
    return { status: 'ready', layout, candidates: headerCandidates, preview: buildSourcePreview(safeRows, layout) };
  }

  if (headerCandidates.length > 1) {
    const layout = { ...headerCandidates[0], confirmed: false, detection: 'multiple_headers' };
    return {
      status: 'confirmation_required',
      reason: 'multiple_source_headers',
      layout,
      candidates: headerCandidates,
      preview: buildSourcePreview(safeRows, layout),
    };
  }

  let firstValue = null;
  for (let rowIndex = 0; rowIndex < safeRows.length && !firstValue; rowIndex += 1) {
    const row = Array.isArray(safeRows[rowIndex]) ? safeRows[rowIndex] : [];
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      if (hasValue(row[columnIndex])) {
        firstValue = { row: rowIndex + 1, column: columnIndex + 1 };
        break;
      }
    }
  }
  if (!firstValue) {
    return { status: 'incomplete', reason: 'sheet_empty', layout: null, candidates: [], preview: [] };
  }
  const sourceColumn = indexToColumn(firstValue.column);
  const layout = {
    sourceColumn,
    headerRow: Math.max(0, firstValue.row - 1),
    dataStartRow: firstValue.row,
    outputStartColumn: recommendedOutputStart(sourceColumn),
    confirmed: false,
    detection: 'first_non_empty',
  };
  return {
    status: 'confirmation_required',
    reason: firstValue.row === 1 ? 'header_row_required' : 'source_header_not_found',
    layout,
    candidates: [layout],
    preview: buildSourcePreview(safeRows, layout),
  };
}
