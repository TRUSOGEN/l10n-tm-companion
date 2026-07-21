// local rate resolver 回归：精确查价、结构化失败和禁止跨 vendor 回退。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  VENDORS,
  availableWordRateVendors,
  resolveWordRate,
} from '../lib/pricing-rules.js';


let passed = 0;
let failed = 0;

function assert(name, condition) {
  if (condition) {
    passed += 1;
    console.log(`  PASS ${name}`);
    return;
  }
  failed += 1;
  console.log(`  FAIL ${name}`);
}

const testDir = path.dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(fs.readFileSync(
  path.join(testDir, '..', 'data', 'local-rates.json'),
  'utf8',
));

console.log('\n=== pricing-rules: vendor allowlist ===');
assert('恰好四个 vendor', VENDORS.length === 4);
assert(
  'vendor 顺序固定',
  JSON.stringify(VENDORS) === JSON.stringify(['RWS', 'Pactera', 'Alconost', 'Skrivanek']),
);
assert('vendor 列表冻结', Object.isFrozen(VENDORS));

console.log('\n=== pricing-rules: RWS/Pactera 精确按字费率 ===');
const rws = resolveWordRate(catalog, { vendor: 'RWS', sourceLang: 'en', targetLang: 'ro-RO' });
assert('RWS en→ro-RO ready', rws.status === 'ready');
assert('RWS AIPE 严格为 74/1000', rws.aipeUsdPerWord === 0.074);
assert('RWS T-only 严格为 92/1000', rws.tOnlyUsdPerWord === 0.092);
assert('RWS 来源行保留', rws.provenance?.sheet === 'RWS' && rws.provenance?.row === 2);

const pacteraZh = resolveWordRate(
  catalog,
  { vendor: 'Pactera', sourceLang: 'en', targetLang: 'zh-Hans' },
);
assert('Pactera en→zh-Hans ready', pacteraZh.status === 'ready');
assert('Pactera zh 精确映射 Chinese S', pacteraZh.targetLanguage === 'Chinese S');
assert('Pactera zh AIPE 严格为 34.72/1000', pacteraZh.aipeUsdPerWord === 0.03472);
assert('Pactera zh T-only 严格为 49.13/1000', pacteraZh.tOnlyUsdPerWord === 0.04913);

const pacteraZhJa = resolveWordRate(
  catalog,
  { vendor: 'Pactera', sourceLang: 'zh-Hans', targetLang: 'ja-JP' },
);
assert('Pactera zh→ja 使用原表 Chinese→Japanese 行', pacteraZhJa.provenance?.row === 24);

console.log('\n=== pricing-rules: 正确失败 ===');
const noVendor = resolveWordRate(catalog, { vendor: '', sourceLang: 'en', targetLang: 'zh-Hans' });
assert('vendor 未选明确失败', noVendor.status === 'incomplete' && noVendor.reason === 'vendor_required');

const invalidVendor = resolveWordRate(
  catalog,
  { vendor: 'Unknown', sourceLang: 'en', targetLang: 'zh-Hans' },
);
assert('未知 vendor 明确失败', invalidVendor.reason === 'invalid_vendor');

const rwsMissingPair = resolveWordRate(
  catalog,
  { vendor: 'RWS', sourceLang: 'en', targetLang: 'zh-Hans' },
);
assert('RWS 缺语言对时不借 Pactera 价格', rwsMissingPair.reason === 'missing_language_pair');

for (const vendor of ['Alconost', 'Skrivanek']) {
  const result = resolveWordRate(catalog, { vendor, sourceLang: 'en', targetLang: 'zh-Hans' });
  assert(`${vendor} 语言对存在`, result.sourceLanguage === 'English');
  assert(`${vendor} 缺按字费率`, result.status === 'incomplete' && result.reason === 'missing_word_rate');
  assert(`${vendor} 不返回零价`, result.aipeUsdPerWord === undefined && result.tOnlyUsdPerWord === undefined);
}

const invalidCatalog = resolveWordRate(
  { schema_version: 1, vendors: {} },
  { vendor: 'RWS', sourceLang: 'en', targetLang: 'ro-RO' },
);
assert('目录结构异常明确失败', invalidCatalog.reason === 'invalid_catalog');

const suggestions = availableWordRateVendors(catalog, {
  sourceLang: 'en',
  targetLang: 'zh-Hans',
});
assert('en→zh-Hans 建议 Pactera', suggestions.includes('Pactera'));
assert('只推荐有按字费率的 vendor', !suggestions.includes('Alconost'));

console.log(`\npricing-rules 测试: ${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
