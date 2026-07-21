/** Vendor 和项目配置从 Settings 迁移到 Popup 的结构回归测试。 */

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const optionsHtml = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
const optionsJs = fs.readFileSync(path.join(root, 'options.js'), 'utf8');
const popupHtml = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const popupJs = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');

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

console.log('\n=== vendor/project: Settings → Popup ===');
assert('Settings 不再显示 ROI Billing', !optionsHtml.includes('<h2>ROI Billing</h2>'));
assert('Settings 不再显示项目 picker', !optionsHtml.includes('id="project-picker"'));
assert('General Save 不修改 vendor', !optionsJs.includes("'vendor',"));
assert('General Save 不修改项目 ID', !optionsJs.includes("'starlingProjectIds',"));
assert('Popup vendor 必填', popupHtml.includes('<select id="run-vendor" required>'));
for (const vendor of ['RWS', 'Pactera', 'Alconost', 'Skrivanek']) {
  assert(`Popup 包含 ${vendor}`, popupHtml.includes(`<option value="${vendor}">${vendor}</option>`));
}
assert('Popup 加载严格 resolver', popupJs.includes("from './lib/pricing-rules.js'"));
assert('Popup 加载费率快照', popupJs.includes("chrome.runtime.getURL('data/local-rates.json')"));
assert('Popup 按每个 scope 解析精确费率', popupJs.includes('scopeConfig.scopes.map') && popupJs.includes('resolveWordRate(rateCatalog'));
assert('Popup 显示多语言费率覆盖率', popupJs.includes('ROI scope(s) have exact word rates'));
assert('Popup 持久化 vendor', popupJs.includes('vendor: runVendor'));

console.log(`\noptions vendor 迁移测试: ${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
