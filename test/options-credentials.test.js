/**
 * Settings Starling AK/SK 双存储与显隐结构回归测试。
 *
 * 该测试检查浏览器可见契约和保存顺序，不执行真实 Native Host，也不输出凭证。
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

console.log('\n=== options: Starling credentials ===');
assert('AK 默认遮挡', html.includes('id="starlingAccessKey" type="password"'));
assert('SK 默认遮挡', html.includes('id="starlingSecretKey" type="password"'));
assert('两个独立显示按钮', (html.match(/data-reveal-target=/g) || []).length === 2);
assert('存在 Save & Verify', html.includes('id="save-starling-credentials"'));
assert('存在双存储安全说明', html.includes('Chrome local storage'));
assert('凭证状态独立展示', html.includes('id="starling-credentials-result"'));

const saveStart = source.indexOf('async function saveCredentials');
const saveEnd = source.indexOf('\n}', saveStart);
const saveBlock = source.slice(saveStart, saveEnd);
assert('先写 Native Host', saveBlock.indexOf('saveStarlingCredentials') >= 0);
assert(
  'Host 调用先于 Chrome 副本',
  saveBlock.indexOf('saveStarlingCredentials') < saveBlock.indexOf('chrome.storage.local.set'),
);
assert('Host 验证项目权限', saveBlock.includes('listProjects'));
assert('完整回填函数存在', source.includes('export function credentialsFromStorage'));
assert('General Save 不要求 vendor', !source.includes('Select a vendor before saving settings.'));

console.log(`\noptions credentials 测试: ${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
