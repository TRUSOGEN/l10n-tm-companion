/** Vendor 和项目配置从 Settings 迁移到 Popup 的结构回归测试。 */

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const optionsHtml = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
const optionsJs = fs.readFileSync(path.join(root, 'options.js'), 'utf8');
const popupHtml = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const popupJs = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const runConfigJs = fs.readFileSync(path.join(root, 'lib', 'run-config.js'), 'utf8');

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
assert('Popup 不展示 vendor 选择器', popupHtml.includes('id="roi-config" class="roi-config hidden" aria-hidden="true"'));
assert('ROI 固定包含 RWS 与 Pactera', popupJs.includes('ROI_VENDORS') && runConfigJs.includes("['RWS', 'Pactera']"));
assert('ROI 不提供 Alconost 或 Skrivanek 选择', !popupHtml.includes('<option value="Alconost">') && !popupHtml.includes('<option value="Skrivanek">'));
assert('Popup 加载严格 resolver', popupJs.includes("from './lib/pricing-rules.js'"));
assert('Popup 加载费率快照', popupJs.includes("chrome.runtime.getURL('data/local-rates.json')"));
assert('Popup 按每个 scope 解析精确费率', popupJs.includes('scopeConfig.scopes.map') && popupJs.includes('resolveWordRate(rateCatalog'));
assert('Popup 对每个 vendor 保留独立费率完整性', popupJs.includes('deriveVendorRoiResults('));
assert(
  'Popup 归档两套 vendor Run',
  popupJs.includes('vendors: ROI_VENDORS.map')
    && popupJs.includes('for (const plan of archivePlan.vendors)'),
);

console.log(`\noptions vendor 迁移测试: ${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
