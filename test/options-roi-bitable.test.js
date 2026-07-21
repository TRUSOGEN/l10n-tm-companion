/**
 * ROI Bitable 归档设置页回归测试。
 *
 * 此测试验证 ROI 归档目标与 Spreadsheet 输出目标保持独立，并由常规设置保存流程持久化。
 */

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'options.js'), 'utf8');

let passed = 0;
let failed = 0;

function assert(name, condition) {
  if (condition) {
    passed += 1;
    console.log(`  PASS ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}`);
  }
}

console.log('\n=== options: ROI Bitable archive ===');
assert('有 ROI archive URL 输入框', html.includes('id="roiArchiveUrl"'));
assert('有独立的归档用途说明', html.includes('This target stores ROI run history only.'));
assert('常规设置读取 ROI archive URL', source.includes("'roiArchiveUrl'"));
assert('ROI archive 不复用 Spreadsheet URL', !source.includes('roiArchiveUrl: data.sheetsUrl'));

console.log(`\noptions ROI archive 测试: ${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
