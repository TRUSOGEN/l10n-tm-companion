/**
 * Starling TM 前端请求协议回归测试。
 *
 * 该测试验证 `searchTM()` 会把批量查询所需的多项目、查询模式和 PPE 标记
 * 透传给 Native Messaging bridge，不依赖真实 Chrome 或网络请求。
 */

import {
  getStarlingCredentials,
  listProjects,
  queryFinalTmSnapshots,
  queryPostRewriteTmSnapshots,
  queryRewriteCandidateTmSnapshots,
  saveStarlingCredentials,
  searchTM,
} from '../lib/starling-tm.js';

const starlingTmModule = await import('../lib/starling-tm.js');

let passed = 0;
let failed = 0;

function assert(name, condition, extra = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name} ${extra}`);
  }
}

console.log('\n=== starling-tm.js: batch payload forwarding ===');

const originalChrome = globalThis.chrome;
let sentMessage;
globalThis.chrome = {
  runtime: {
    lastError: null,
    sendMessage: async (message) => {
      sentMessage = message;
      if (message.payload.action === 'save_starling_credentials') return { ok: true };
      if (message.payload.action === 'get_starling_credentials') {
        return { ok: true, access_key: 'test-ak', secret_key: 'test-sk' };
      }
      return { results: [] };
    },
  },
};

await searchTM(['Done', 'Settings'], 'en', 'zh', {
  projectIds: [385, 278],
  tmMode: 'batch',
  usePpe: true,
  batchConcurrency: 2,
});

assert(
  '透传多项目 ID',
  JSON.stringify(sentMessage.payload.project_ids) === JSON.stringify([385, 278]),
  JSON.stringify(sentMessage.payload),
);
assert('透传批量查询模式', sentMessage.payload.tm_mode === 'batch');
assert('透传 PPE 标记', sentMessage.payload.use_ppe === true);
assert('透传受控 Batch 并发', sentMessage.payload.batch_concurrency === 2);
assert('Batch TM 明确请求 Top-3', sentMessage.payload.limit === 3);

await listProjects({ accessKey: 'test-ak', secretKey: 'test-sk' });
assert('项目请求透传 AK', sentMessage.payload.access_key === 'test-ak');
assert('项目请求透传 SK', sentMessage.payload.secret_key === 'test-sk');

await saveStarlingCredentials({
  accessKey: 'test-ak',
  secretKey: 'test-sk',
  cliPath: '/opt/homebrew/bin/starling-cli',
});
assert('保存动作正确', sentMessage.payload.action === 'save_starling_credentials');
assert('保存请求传完整 AK', sentMessage.payload.access_key === 'test-ak');
assert('保存请求传完整 SK', sentMessage.payload.secret_key === 'test-sk');

await getStarlingCredentials({ cliPath: '/opt/homebrew/bin/starling-cli' });
assert('读取动作正确', sentMessage.payload.action === 'get_starling_credentials');

await searchTM(['Done'], 'en', 'zh-Hans', {
  projectIds: [513],
  tmMode: 'legacy',
});
assert('legacy 单项目同步 project_id', sentMessage.payload.project_id === 513);

let legacyMultiError = '';
try {
  await searchTM(['Done'], 'en', 'zh-Hans', {
    projectIds: [513, 385],
    tmMode: 'legacy',
  });
} catch (error) {
  legacyMultiError = error.message;
}
assert('legacy 多项目明确失败', legacyMultiError === 'legacy_requires_single_project');

console.log('\n=== starling-tm.js: 改写后二次 TM 快照 ===');
let postRewritePayloads = [];
globalThis.chrome.runtime.sendMessage = async (message) => {
  sentMessage = message;
  postRewritePayloads.push(message.payload);
  return {
    results: [{
      tm_match: 'Send a gift',
      tm_source: 'Send a gift',
      similarity: 91.25,
      origin: 'TM owner',
      method: 'starling-batch',
      candidate_count: 2,
    }],
  };
};

const postRewriteSnapshots = await queryPostRewriteTmSnapshots([
  { id: 'low', source_text: 'gift', similarity: 40, reached_threshold: false, ai_translation: 'Send a gift' },
  { id: 'high', source_text: 'Done', similarity: 90, reached_threshold: true, ai_translation: 'Done' },
  { id: 'empty', source_text: 'Cancel', similarity: 30, reached_threshold: false, ai_translation: '' },
], 'en', 'en', { projectIds: [513], tmMode: 'batch', usePpe: true });

assert('二次查询仅发送非空 AI rewrite', JSON.stringify(postRewritePayloads[0].texts) === JSON.stringify(['Send a gift']));
assert('二次查询沿用 source 与 target locale', postRewritePayloads[0].source_lang === 'en' && postRewritePayloads[0].target_lang === 'en');
assert('二次查询保存真实 Starling score', postRewriteSnapshots[0].status === 'complete' && postRewriteSnapshots[0].score === 91.25);
assert('达标原文明确无需二次查询', postRewriteSnapshots[1].status === 'not_required');
assert('空 AI rewrite 明确无需二次查询', postRewriteSnapshots[2].status === 'not_required');

globalThis.chrome.runtime.sendMessage = async () => ({ error: 'Starling batch TM HTTP 400: timeout (logid: test-logid)' });
const incompleteSnapshots = await queryPostRewriteTmSnapshots([
  { id: 'failed', source_text: 'gift', similarity: 40, reached_threshold: false, ai_translation: 'Send a gift' },
], 'en', 'en', { projectIds: [513], tmMode: 'batch', usePpe: true });
assert('二次查询失败标记 incomplete', incompleteSnapshots[0].status === 'incomplete');
assert('二次查询失败保留真实错误原因', incompleteSnapshots[0].error.includes('test-logid'));
assert('二次查询失败不伪造 score', !Object.hasOwn(incompleteSnapshots[0], 'score'));

globalThis.chrome.runtime.sendMessage = async () => ({
  results: [{ tm_match: 'Send a gift', similarity: 'not-a-number' }],
});
const invalidScoreSnapshots = await queryPostRewriteTmSnapshots([
  { id: 'invalid-score', source_text: 'gift', similarity: 40, reached_threshold: false, ai_translation: 'Send a gift' },
], 'en', 'en', { projectIds: [513], tmMode: 'batch', usePpe: true });
assert('异常 score 标记 incomplete', invalidScoreSnapshots[0].status === 'incomplete');
assert('异常 score 不写入快照', !Object.hasOwn(invalidScoreSnapshots[0], 'score'));

console.log('\n=== starling-tm.js: 多候选 Post-TM 快照 ===');
let candidatePayloads = [];
globalThis.chrome.runtime.sendMessage = async (message) => {
  candidatePayloads.push(message.payload);
  return {
    results: message.payload.texts.map((text, index) => ({
      tm_match: text,
      tm_source: text,
      similarity: 80 + index,
      origin: 'TM owner',
      method: 'starling-batch',
      candidate_count: 3,
    })),
  };
};
const candidateSnapshots = await queryRewriteCandidateTmSnapshots([
  {
    source_text: 'Gift',
    ai_candidates: [
      { ai_translation: 'Send a Gift', structure_valid: true },
      { ai_translation: 'Share a Gift', structure_valid: true },
    ],
  },
  {
    source_text: 'Done',
    ai_candidates: [{ ai_translation: 'Completed', structure_valid: true }],
  },
], 'en', 'en', { projectIds: [513], tmMode: 'batch', usePpe: true });
assert('三个候选使用一次 Batch 调用', candidatePayloads.length === 1);
assert('候选按行与候选位置发送', JSON.stringify(candidatePayloads[0].texts) === JSON.stringify(['Send a Gift', 'Share a Gift', 'Completed']));
assert('快照恢复为逐行嵌套结构', candidateSnapshots.length === 2 && candidateSnapshots[0].length === 2 && candidateSnapshots[1].length === 1);
assert('候选快照保存真实分数', candidateSnapshots[0][0].status === 'complete' && candidateSnapshots[1][0].score === 82);

console.log('\n=== starling-tm.js: 最终 C 文案的第三次 TM 快照 ===');
assert('导出最终 C TM 查询函数', typeof starlingTmModule.queryFinalTmSnapshots === 'function');

let finalPayloads = [];
globalThis.chrome.runtime.sendMessage = async (message) => {
  sentMessage = message;
  finalPayloads.push(message.payload);
  return {
    results: [{ tm_match: 'Save now', tm_source: 'Save now', similarity: 96.5, origin: 'TM owner', method: 'starling-batch', candidate_count: 1 }],
  };
};
const finalSnapshots = await queryFinalTmSnapshots([
  { row: 2, final_source_text: 'Save now' },
  { row: 3, final_source_text: '' },
], 'en', 'en', { projectIds: [513], tmMode: 'batch', usePpe: true });
assert('第三次查询只发送 CD 确认的非空 C', JSON.stringify(finalPayloads[0].texts) === JSON.stringify(['Save now']));
assert('第三次查询保存真实 Starling score', finalSnapshots[0].status === 'complete' && finalSnapshots[0].score === 96.5);
assert('未确认 C 明确保持 not_ready', finalSnapshots[1].status === 'not_ready');

globalThis.chrome = originalChrome;

console.log(`\nstarling-tm batch 测试: ${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
