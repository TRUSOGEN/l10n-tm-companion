// 验证 feishu-bitable.js 的 token 缓存、batch_create 切批、字段映射、错误处理。
import { writeToBitable, getTenantToken, _resetTokenCache } from '../lib/feishu-bitable.js';

let pass = 0, fail = 0;
const assert = (n, c, e = '') => c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${e}`));

// mock fetch：记录调用，按 URL 返回不同响应
function mockFetch(responses) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), body: opts?.body });
    const r = responses.shift();
    if (r.throw) throw new Error(r.throw);
    return {
      ok: true,
      json: async () => r.json,
      text: async () => JSON.stringify(r.json),
    };
  };
  return calls;
}

console.log('\n=== feishu-bitable: token 缓存 ===');
{
  _resetTokenCache();
  // 重置模块内缓存
  const calls = mockFetch([
    { json: { code: 0, tenant_access_token: 'TOKEN_A', expire: 7200 } },
  ]);
  const t1 = await getTenantToken('id', 'secret');
  assert('首次获取 token', t1 === 'TOKEN_A');
  const t2 = await getTenantToken('id', 'secret'); // 应命中缓存，不再 fetch
  assert('缓存命中同一 token', t2 === 'TOKEN_A');
  assert('只调一次 fetch', calls.length === 1, `actual ${calls.length}`);
}

console.log('\n=== feishu-bitable: 写入 + 字段映射 + 切批 ===');
{
  _resetTokenCache();
  // 重置缓存：用一个会过期的场景
  const calls = mockFetch([
    { json: { code: 0, tenant_access_token: 'T', expire: 7200 } },
    // 第一批 500 条
    { json: { code: 0, data: { records: Array(500).fill({ id: 'r' }) } } },
    // 第二批 30 条
    { json: { code: 0, data: { records: Array(30).fill({ id: 'r' }) } } },
  ]);
  const items = Array(530).fill(0).map((_, i) => ({
    source_text: `src${i}`, tm_match: 'tm', similarity: 85,
    origin: 'LIVE', ai_translation: 'ai', new_match: 70, reached_threshold: false,
    ai_vs_tm: { status: 'improved', changes: 'c', key_differences: [] },
  }));
  const out = await writeToBitable(items, {
    feishuAppId: 'id', feishuAppSecret: 'secret',
    bitableAppToken: 'appT', bitableTableId: 'tblT',
    fieldMapping: { source: 'Source', reachedThreshold: 'Reached 85%?' }, // 覆盖默认
  });
  assert('写入记录总数 530', out.length === 530, `actual ${out.length}`);
  // calls: 1 token + 2 batch
  assert('共 3 次 fetch (token+2批)', calls.length === 3, `actual ${calls.length}`);
  // 第二批 body 应只有 30 条
  const batch2 = JSON.parse(calls[2].body);
  assert('第二批 30 条', batch2.records.length === 30, `actual ${batch2.records.length}`);
  // 字段映射生效：source 字段名应为 Source（被 fieldMapping 覆盖）
  const firstBatch = JSON.parse(calls[1].body);
  assert('字段映射覆盖生效', 'Source' in firstBatch.records[0].fields, Object.keys(firstBatch.records[0].fields).join(','));
  assert('reachedThreshold 映射生效', 'Reached 85%?' in firstBatch.records[0].fields);
  // Orig Match % 直接取整（已是百分制）
  assert('Orig Match % 取整 85', firstBatch.records[0].fields['Orig Match %'] === 85, `actual ${firstBatch.records[0].fields['Orig Match %']}`);
  // New Match % 取整
  assert('New Match % 取整 70', firstBatch.records[0].fields['New Match %'] === 70, `actual ${firstBatch.records[0].fields['New Match %']}`);
  // reached_threshold 写入为复选框布尔
  assert('Reached 85%? 为 false', firstBatch.records[0].fields['Reached 85%?'] === false, `actual ${firstBatch.records[0].fields['Reached 85%?']}`);
}

console.log('\n=== feishu-bitable: 缺配置报错 ===');
{
  try { await writeToBitable([], { feishuAppId: '', feishuAppSecret: '' }); assert('缺 AppID 抛错', false, '未抛错'); }
  catch (e) { assert('缺 AppID 抛错', /App ID/.test(e.message), e.message); }
}

console.log('\n=== feishu-bitable: API code 非 0 报错 ===');
{
  _resetTokenCache();
  const calls = mockFetch([
    { json: { code: 0, tenant_access_token: 'T', expire: 7200 } },
    { json: { code: 1254030, msg: 'permission denied' } },
  ]);
  try {
    await writeToBitable([{ source_text: 'x' }], { feishuAppId: 'id', feishuAppSecret: 's', bitableAppToken: 'a', bitableTableId: 't' });
    assert('API 错误抛出', false, '未抛错');
  } catch (e) {
    assert('API 错误抛出', /permission denied/.test(e.message), e.message);
  }
}

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`);
if (fail > 0) process.exit(1);
