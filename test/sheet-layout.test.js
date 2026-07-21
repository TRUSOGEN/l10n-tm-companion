/** 动态 Sheet 布局检测与列运算回归测试。 */

import assert from 'node:assert/strict';
import {
  columnToIndex,
  detectSheetLayout,
  getOutputColumns,
  indexToColumn,
  offsetColumn,
  sheetLayoutStorageKey,
  validateSheetLayout,
} from '../lib/sheet-layout.js';

let passed = 0;
function check(name, callback) {
  callback();
  passed += 1;
  console.log(`  PASS ${name}`);
}

check('A、Z、AA 列可双向转换', () => {
  assert.equal(columnToIndex('A'), 1);
  assert.equal(columnToIndex('Z'), 26);
  assert.equal(columnToIndex('AA'), 27);
  assert.equal(indexToColumn(52), 'AZ');
  assert.equal(offsetColumn('Z', 1), 'AA');
});

check('第二行 D 列唯一标准表头自动识别，数据从第三行开始', () => {
  const result = detectSheetLayout([
    ['', '', '', '说明'],
    ['', '', '', 'Original Source Segment'],
    ['', '', '', 'First source'],
    ['', '', '', ''],
    ['', '', '', 'Second source'],
  ]);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.layout, {
    sourceColumn: 'D', headerRow: 2, dataStartRow: 3,
    outputStartColumn: 'E', confirmed: true, detection: 'exact_header',
  });
  assert.deepEqual(result.preview, [
    { row: 3, text: 'First source' },
    { row: 5, text: 'Second source' },
  ]);
});

check('Source 与 English Source 使用精确标准化匹配', () => {
  assert.equal(detectSheetLayout([['  source  '], ['Hello']]).layout.sourceColumn, 'A');
  assert.equal(detectSheetLayout([['English   Source'], ['Hello']]).layout.dataStartRow, 2);
  assert.equal(detectSheetLayout([['Source note'], ['Hello']]).status, 'confirmation_required');
});

check('多个合法表头不会擅自选择', () => {
  const result = detectSheetLayout([['Source', '', 'English Source'], ['A', '', 'B']]);
  assert.equal(result.status, 'confirmation_required');
  assert.equal(result.reason, 'multiple_source_headers');
  assert.deepEqual(result.candidates.map((candidate) => candidate.sourceColumn), ['A', 'C']);
});

check('无表头以首个非空单元格作为候选并要求确认', () => {
  const result = detectSheetLayout([[], ['', 'First source'], ['', 'Second source']]);
  assert.equal(result.status, 'confirmation_required');
  assert.equal(result.reason, 'source_header_not_found');
  assert.equal(result.layout.sourceColumn, 'B');
  assert.equal(result.layout.dataStartRow, 2);
  assert.equal(result.layout.confirmed, false);
});

check('无表头候选位于第一行时要求调整数据起始行', () => {
  const result = detectSheetLayout([['First source'], ['Second source']]);
  assert.equal(result.status, 'confirmation_required');
  assert.equal(result.reason, 'header_row_required');
  assert.equal(validateSheetLayout(result.layout).reason, 'data_start_row_requires_header');
});

check('输出连续六列且来源列不可与输出重叠', () => {
  assert.deepEqual(getOutputColumns('H'), {
    tmSource: 'H', originalScore: 'I', rewritten: 'J', rewrittenScore: 'K',
    reachedThreshold: 'L', cdReview: 'M',
  });
  assert.equal(validateSheetLayout({ sourceColumn: 'D', dataStartRow: 3, outputStartColumn: 'H' }).status, 'ready');
  assert.equal(validateSheetLayout({ sourceColumn: 'J', dataStartRow: 3, outputStartColumn: 'H' }).reason, 'source_output_overlap');
});

check('布局存储键隔离 Spreadsheet 与 Sheet', () => {
  assert.equal(sheetLayoutStorageKey('spreadsheet-A', 'sheet-2'), 'spreadsheet-A:sheet-2');
  assert.notEqual(sheetLayoutStorageKey('spreadsheet-A', 'sheet-1'), sheetLayoutStorageKey('spreadsheet-B', 'sheet-1'));
});

console.log(`\nsheet-layout tests: ${passed} passed, 0 failed`);
