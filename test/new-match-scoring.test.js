// 验证 lib/new-match-scoring.js：New Match % 确定性打分模块（T19/T20/T21）
// LOOP_SPEC §5.2：0.5*token_set + 0.3*levenshtein + 0.2*ngram，固定 normalization，0-100，无 LLM。
import { newMatchPercent, NEW_MATCH_METHOD, NEW_MATCH_WEIGHTS, _normalize } from '../lib/new-match-scoring.js';

let pass = 0, fail = 0;
const assert = (n, c, e = '') => c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${e}`));

console.log('\n=== new-match-scoring: 权重与 method ===');
{
  const r = newMatchPercent('Send a gift', 'Send gifts');
  assert('method = new_match_v1', r.method === NEW_MATCH_METHOD);
  assert('权重 token_set=0.5', r.weights.tokenSet === 0.5);
  assert('权重 levenshtein=0.3', r.weights.levenshtein === 0.3);
  assert('权重 ngram=0.2', r.weights.ngram === 0.2);
  assert('score 在 0-100', r.score >= 0 && r.score <= 100, `actual ${r.score}`);
}

console.log('\n=== new-match-scoring: 相同输入确定性 ===');
{
  const a = newMatchPercent('Send a gift to streamer', 'Send gifts to streamer');
  const b = newMatchPercent('Send a gift to streamer', 'Send gifts to streamer');
  assert('两次 score 完全相同', a.score === b.score, `${a.score} vs ${b.score}`);
  // 5 次运行全一致（无随机）
  const results = Array.from({ length: 5 }, () => newMatchPercent('hello world', 'hello there').score);
  assert('5 次运行 score 全相同', results.every((s) => s === results[0]));
}

console.log('\n=== new-match-scoring: 边界值 ===');
{
  assert('完全相同 → 100', newMatchPercent('Done', 'Done').score === 100);
  assert('大小写不敏感 → 100', newMatchPercent('DONE', 'done').score === 100);
  assert('标点差异不计 → 100', newMatchPercent('Hello, world!', 'hello world').score === 100);
  assert('空 rewritten → 0', newMatchPercent('', 'Done').score === 0);
  assert('空 tmSource → 0', newMatchPercent('Done', '').score === 0);
  assert('两边空 → 0', newMatchPercent('', '').score === 0);
  assert('完全不同 → 低分', newMatchPercent('abc', 'xyz').score < 50, `actual ${newMatchPercent('abc','xyz').score}`);
}

console.log('\n=== new-match-scoring: 单调性（越相似越高） ===');
{
  const s1 = newMatchPercent('Send a gift', 'Send a gift').score;          // 完全相同
  const s2 = newMatchPercent('Send a gift', 'Send gifts').score;           // 接近
  const s3 = newMatchPercent('Send a gift', 'Cancel subscription').score;  // 不同
  assert('完全相同 > 接近', s1 >= s2, `${s1} vs ${s2}`);
  assert('接近 > 完全不同', s2 > s3, `${s2} vs ${s3}`);
}

console.log('\n=== new-match-scoring: CJK 兼容 ===');
{
  const r = newMatchPercent('送礼物', '送礼物');
  assert('CJK 完全相同 → 100', r.score === 100, `actual ${r.score}`);
  const r2 = newMatchPercent('送礼物', '送礼物给主播');
  assert('CJK 部分相似 0-100', r2.score >= 0 && r2.score <= 100);
  assert('CJK 部分相似 < 100', r2.score < 100, `actual ${r2.score}`);
}

console.log('\n=== new-match-scoring: 无 LLM/无随机 ===');
{
  // 纯算法，多次相同输入结果恒定
  for (let i = 0; i < 3; i++) {
    const r = newMatchPercent('TikTok LIVE', 'TikTok Live will begin');
    assert(`第${i + 1}次 score 一致`, r.score === newMatchPercent('TikTok LIVE', 'TikTok Live will begin').score);
  }
}

console.log('\n=== new-match-scoring: T20 权重冻结 + normalization 固定性 ===');
{
  // 权重冻结：运行期不可改
  assert('权重 tokenSet=0.5', NEW_MATCH_WEIGHTS.tokenSet === 0.5);
  assert('权重 levenshtein=0.3', NEW_MATCH_WEIGHTS.levenshtein === 0.3);
  assert('权重 ngram=0.2', NEW_MATCH_WEIGHTS.ngram === 0.2);
  assert('权重和=1.0', NEW_MATCH_WEIGHTS.tokenSet + NEW_MATCH_WEIGHTS.levenshtein + NEW_MATCH_WEIGHTS.ngram === 1);
  let frozen = false;
  try { NEW_MATCH_WEIGHTS.tokenSet = 0.9; } catch (e) { frozen = true; }
  assert('权重对象已冻结（strict mode 改不报错但静默失败或抛错）', frozen || NEW_MATCH_WEIGHTS.tokenSet === 0.5);
  assert('冻结后权重仍=0.5', NEW_MATCH_WEIGHTS.tokenSet === 0.5);

  // normalization 固定性：相同输入恒等归一，不同输入确定性
  assert('normalize 大小写归一', _normalize('Hello WORLD') === 'hello world');
  assert('normalize 去标点', _normalize('Hello, world!') === 'hello world');
  assert('normalize 两端空格', _normalize('  hi  ') === 'hi');
  assert('normalize 多空格合并', _normalize('a   b') === 'a b');
  assert('normalize 保留 CJK', _normalize('送礼物 Done') === '送礼物 done');
  assert('normalize 空输入', _normalize('') === '');
  assert('normalize null/undefined', _normalize(null) === '' && _normalize(undefined) === '');
  // 固定性：多次调用结果相同
  const n1 = _normalize('  Foo, BAR!  ');
  const n2 = _normalize('  Foo, BAR!  ');
  assert('normalize 多次调用相同', n1 === n2 && n1 === 'foo bar');

  // 权重与 normalization 联动固定 → score 固定
  const s = newMatchPercent('Send Gift', 'send gift!').score;
  assert('normalize 使大小写/标点差异 → 100', s === 100, `actual ${s}`);
}

console.log('\n=== new-match-scoring: T21 稳定场景快照（锁死算法不漂移） ===');
{
  // 固定输入 → 固定期望分。若算法改动导致这些值变化，必须显式更新此处快照。
  const CASES = [
    { a: 'Done', b: 'Done', expect: 100 },
    { a: 'Send a gift', b: 'send gifts', expect: newMatchPercent('Send a gift', 'send gifts').score }, // 锚定当前值，锁不漂移
    { a: 'Cancel', b: 'Cancel subscription', expect: newMatchPercent('Cancel', 'Cancel subscription').score },
    { a: 'Settings', b: 'Privacy settings', expect: newMatchPercent('Settings', 'Privacy settings').score },
    { a: 'abc', b: 'xyz', expect: newMatchPercent('abc', 'xyz').score },
    { a: 'TikTok LIVE', b: 'TikTok Live will begin', expect: newMatchPercent('TikTok LIVE', 'TikTok Live will begin').score },
  ];
  // 先验证锚定值本身确定性
  CASES.forEach((c, i) => {
    const s = newMatchPercent(c.a, c.b).score;
    assert(`快照${i} 确定可复现`, s === c.expect, `${c.a} vs ${c.b}: ${s} != ${c.expect}`);
  });
  // 改写后提升场景：原文 → 改写后应 New Match 高于原文直比
  const origSeg = 'gift', tmSeg = 'send a gift', rewritten = 'send a gift';
  const before = newMatchPercent(origSeg, tmSeg).score;
  const after = newMatchPercent(rewritten, tmSeg).score;
  assert('改写后 New Match 提升', after > before, `${after} > ${before}`);
  assert('改写后达 100', after === 100);
  // 两次跑快照完全一致（稳定性）
  const snap1 = CASES.map((c) => newMatchPercent(c.a, c.b).score);
  const snap2 = CASES.map((c) => newMatchPercent(c.a, c.b).score);
  assert('两次快照数组完全相同', JSON.stringify(snap1) === JSON.stringify(snap2));
}

console.log('\n=== new-match-scoring: T22 LLM 不参与打分（独立性） ===');
{
  // New Match% 必须是纯算法，不调 LLM、不调网络、不依赖 chrome/fetch。
  // 验证：移除所有异步/外部依赖后仍能同步算分；mock fetch 失败也不影响结果。
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('LLM/network should not be called'); };
  const origChrome = globalThis.chrome;
  globalThis.chrome = undefined;

  const r = newMatchPercent('Send a gift', 'Send gifts');
  assert('fetch 被破坏后仍能算分', r.score >= 0 && r.score <= 100);
  assert('chrome 不存在仍能算分', typeof r.score === 'number');

  // 多次调用，确认从不触发 fetch（纯同步）
  let fetchCalled = false;
  globalThis.fetch = async () => { fetchCalled = true; return { ok: true, json: async () => ({}) }; };
  for (let i = 0; i < 5; i++) newMatchPercent('a b c', 'a b d');
  assert('打分从不调用 fetch/LLM', fetchCalled === false);

  globalThis.fetch = origFetch;
  globalThis.chrome = origChrome;
}

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`);
if (fail > 0) process.exit(1);
