// 验证 lib/tm-bm25.js：确定性 BM25 fallback。
// 关键：相同输入永远相同输出；method=local_bm25_v1；无 LLM/随机。
import { bm25Match, BM25_METHOD } from '../lib/tm-bm25.js';

let pass = 0, fail = 0;
const assert = (n, c, e = '') => c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${e}`));

const CORPUS = [
  { source: 'Send a gift to your favorite streamer', target: '送礼物给你喜欢的主播' },
  { source: 'Cancel subscription', target: '取消订阅' },
  { source: 'Settings', target: '设置' },
  { source: 'Send gifts', target: '送礼' },
];

console.log('\n=== tm-bm25: 基本匹配 ===');
{
  const r = bm25Match('Send a gift', CORPUS);
  assert('返回 method=local_bm25_v1', r.method === BM25_METHOD);
  assert('candidate_count=4', r.candidate_count === 4, `actual ${r.candidate_count}`);
  assert('best 命中送礼那条', r.best?.source === 'Send a gift to your favorite streamer' || r.best?.source === 'Send gifts', r.best?.source);
  assert('tm_source 非空', !!r.tm_source);
  assert('tm_match 非空', !!r.tm_match);
  assert('score 在 0-100', r.score >= 0 && r.score <= 100, `actual ${r.score}`);
  assert('score>0（有匹配）', r.score > 0, `actual ${r.score}`);
}

console.log('\n=== tm-bm25: 确定性（相同输入相同输出） ===');
{
  const a = bm25Match('Send a gift', CORPUS);
  const b = bm25Match('Send a gift', CORPUS);
  assert('两次结果相同 best', a.best?.source === b.best?.source);
  assert('两次 score 相同', a.score === b.score);
  assert('两次 method 相同', a.method === b.method);
}

console.log('\n=== tm-bm25: 不同 query 不同 best ===');
{
  const r1 = bm25Match('Cancel', CORPUS);
  const r2 = bm25Match('Settings', CORPUS);
  assert('Cancel → 取消订阅', r1.best?.source === 'Cancel subscription', r1.best?.source);
  assert('Settings → 设置', r2.best?.source === 'Settings', r2.best?.source);
  assert('两个 best 不同', r1.best?.source !== r2.best?.source);
}

console.log('\n=== tm-bm25: 边界 ===');
{
  const empty = bm25Match('Send', []);
  assert('空 corpus → best=null', empty.best === null);
  assert('空 corpus → score=0', empty.score === 0);
  assert('空 corpus → candidate_count=0', empty.candidate_count === 0);
  assert('空 corpus 仍返回 method', empty.method === BM25_METHOD);

  const noQuery = bm25Match('', CORPUS);
  assert('空 query → best=null', noQuery.best === null);
  assert('空 query → candidate_count 仍=4', noQuery.candidate_count === 4);

  const noOverlap = bm25Match('xyzqqqnosuchword', CORPUS);
  assert('无 token 重叠 → best=null', noOverlap.best === null);
  assert('无 token 重叠 → score=0', noOverlap.score === 0);
}

console.log('\n=== tm-bm25: tie-break 确定性（相等分数取先出现的） ===');
{
  // 两个完全相同的候选，应稳定取第一个
  const dup = [
    { source: 'Hello', target: '你好' },
    { source: 'Hello', target: '你好2' },
  ];
  const r = bm25Match('Hello', dup);
  assert('重复候选稳定取第一个', r.best?.target === '你好', r.best?.target);
  const r2 = bm25Match('Hello', dup);
  assert('重复候选再次相同', r.best?.target === r2.best?.target);
}

console.log('\n=== tm-bm25: 无 LLM / 无随机（纯算法） ===');
{
  // 多次跑结果完全一致
  const results = Array.from({ length: 5 }, () => bm25Match('gift streamer', CORPUS));
  const allSameScore = results.every((r) => r.score === results[0].score);
  const allSameBest = results.every((r) => r.best?.source === results[0].best?.source);
  assert('5 次运行 score 全相同', allSameScore);
  assert('5 次运行 best 全相同', allSameBest);
}

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`);
if (fail > 0) process.exit(1);
