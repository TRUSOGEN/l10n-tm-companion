/**
 * ROI Bitable 归档设置页回归测试。
 *
 * 此测试验证 ROI 归档目标固定，不提供用户配置入口，也不读取历史 storage 值。
 */

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'options.js'), 'utf8');
const generalKeys = source.slice(source.indexOf('const GENERAL_KEYS'), source.indexOf('const CREDENTIAL_KEYS'));

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
assert('不提供 ROI archive URL 输入框', !html.includes('id="roiArchiveUrl"'));
assert('展示固定归档目标入口', html.includes('ROI archive:') && html.includes('open ROI_Test'));
assert('常规设置不读取 ROI archive URL', !generalKeys.includes("'roiArchiveUrl'"));
assert('加载设置时清理历史 ROI archive URL', source.includes("chrome.storage.local.remove(['inspireTeamId', 'roiArchiveUrl'])"));

console.log(`\noptions ROI archive 测试: ${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
