// 端到端逻辑验证：测试 diff.js + ai-translate.js 的纯逻辑部分
// 用 mock LLM / mock TM，覆盖 TM 优化工作流边界场景。
// similarity / new_match 均为 0-100 百分制（对齐 starling-cli /corpus/tm/match 的 score）。

import { compareAIvsTM, textSimilarity } from '../lib/diff.js';
import { buildPrompt, parseAIResponse, translateWithAI, rewriteSourceWithAI, buildRewritePrompt } from '../lib/ai-translate.js';

let pass = 0, fail = 0;
function assert(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

console.log('\n=== diff.js: compareAIvsTM (TM 优化流程) ===');

// 1. no_tm: 无 TM 匹配
{
  const r = compareAIvsTM({ source_text: 'hello', ai_translation: 'hello2', tm_match: '', similarity: 0 });
  assert('no_tm 状态', r.ai_vs_tm.status === 'no_tm');
  assert('no_tm 无差异列表', r.ai_vs_tm.key_differences.length === 0);
}

// 2. same: 原文已达标(>=85) reuse_tm=true
{
  const r = compareAIvsTM({ source_text: 'Done', ai_translation: 'Done', tm_match: '完成', similarity: 100, reached_threshold: true, reuse_tm: true });
  assert('same 状态(达标reuse)', r.ai_vs_tm.status === 'same');
}

// 3. improved: New Match % 高于 Orig Match %
{
  const r = compareAIvsTM({ source_text: 'gift', ai_translation: 'send gift', tm_match: 'ギフト送信', similarity: 40, new_match: 90 });
  assert('improved 状态(New>Orig)', r.ai_vs_tm.status === 'improved');
  assert('improved 有差异(Orig/New)', r.ai_vs_tm.key_differences.length > 0);
}

// 4. different: New Match 未提升
{
  const r = compareAIvsTM({ source_text: 'gift', ai_translation: 'gift item', tm_match: 'ギフト送信', similarity: 40, new_match: 35 });
  assert('different 状态(New<=Orig)', r.ai_vs_tm.status === 'different');
}

// 5. New Match >=85 直接 improved
{
  const r = compareAIvsTM({ source_text: 'x', ai_translation: 'x2', tm_match: 't', similarity: 30, new_match: 85 });
  assert('New>=85 视为 improved', r.ai_vs_tm.status === 'improved');
}

// 6. 无 New Match 数据时按 Orig 判断
{
  const r1 = compareAIvsTM({ source_text: 'x', ai_translation: 'A', tm_match: 'B', similarity: 80, reuse_tm: true });
  assert('无NewMatch+高Orig→same', r1.ai_vs_tm.status === 'same');
  const r2 = compareAIvsTM({ source_text: 'x', ai_translation: 'A', tm_match: 'B', similarity: 30 });
  assert('无NewMatch+低Orig→different', r2.ai_vs_tm.status === 'different');
}

// 7. 空文案 / 特殊字符不崩溃
{
  const r1 = compareAIvsTM({ source_text: '', ai_translation: '', tm_match: '', similarity: 0 });
  assert('空文案不崩溃', r1.ai_vs_tm.status === 'no_tm');
}

console.log('\n=== diff.js: textSimilarity (New Match 算法) ===');

// 7b. 完全相同 → 100
assert('完全相同=100', textSimilarity('Done', 'Done') === 100);
// 7c. 完全不同 → 低分
assert('完全不同低分', textSimilarity('Done', 'Privacy settings') < 40);
// 7d. 部分重叠（Settings vs Privacy settings）→ 中等偏低（new_match_v1：token_set=0.5 但字符/ngram 拉低）
{
  const s = textSimilarity('Settings', 'Privacy settings');
  assert('部分重叠有分但偏低', s > 10 && s < 60, `actual ${s}`);
}
// 7e. 改写后更接近 TM 原文 → 分数高于原文直接比
{
  const origSim = textSimilarity('gift', 'send a gift');       // 原文 vs TM原文
  const newSim = textSimilarity('send a gift', 'send a gift'); // 改写后 vs TM原文
  assert('改写后相似度提升', newSim > origSim, `${newSim} > ${origSim}`);
  assert('改写后接近满分', newSim === 100);
}
// 7f. 空输入 → 0
assert('空输入=0', textSimilarity('', 'Done') === 0);
assert('都空=0', textSimilarity('', '') === 0);
// 7g. 大小写不敏感
assert('大小写不敏感=100', textSimilarity('Done', 'DONE') === 100);

console.log('\n=== ai-translate.js: buildPrompt (保留原翻译 prompt 测试) ===');

// 8. prompt 含源文本与目标语言
{
  const p = buildPrompt({ source_text: 'hello', tm_match: '', similarity: 0 }, 'ja');
  assert('prompt 含源文本', p.includes('hello'));
  assert('prompt 含日语目标', p.includes('日本語'));
  assert('prompt 要求 JSON 格式', p.includes('"ai_translation"'));
}

// 9. 高相似度 prompt 含 reuse 提示
{
  const p = buildPrompt({ source_text: 'hi', tm_match: 'こんにちは', similarity: 96, origin: 'LIVE v1' }, 'ja');
  assert('高相似度 prompt 含 reuse 建议', p.includes('>= 95%'));
  assert('prompt 含 TM 匹配', p.includes('こんにちは'));
}

console.log('\n=== ai-translate.js: rewriteSourceWithAI (TM 优化改写) ===');

// 9b. 改写 prompt 含源文本且要求不翻译
{
  const p = buildRewritePrompt({
    source_text: 'TikTok LIVE',
    tm_source: 'LIVE will begin shortly',
    tm_match: '直播即将开始',
    similarity: 22,
    origin: 'yangmeng.42',
  });
  assert('改写prompt含源文本', p.includes('TikTok LIVE'));
  assert('改写prompt禁止翻译', p.toLowerCase().includes('not translate') || p.includes('do NOT translate'));
  assert('改写prompt含英文TM source', p.includes('LIVE will begin shortly'));
  assert('改写prompt不把target translation当source', !p.includes('直播即将开始'));
  assert('改写prompt要求JSON', p.includes('"ai_translation"'));
}

// Inspire 直接返回 revisions，默认选择最高分候选并保留全部备选。
{
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.endsWith('/openapi/tasks')) {
      return { ok: true, status: 200, json: async () => ({ _id: 'task-1', status: 'completed' }), text: async () => '' };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ copies: [{ revisions: [
        { revision: 'Best rewrite', title: 'best', score: 0.95 },
        { revision: 'Alternative', title: 'alt', score: 0.8 },
      ] }] }),
      text: async () => '',
    };
  };
  const out = await rewriteSourceWithAI([
    { source_text: 'Rewrite me', tm_source: 'Reference source', tm_match: '目标译文', similarity: 20 },
  ], {
    llmProvider: 'inspire',
    llmEndpoint: 'https://inspire.bytedance.net/writer/api',
    llmApiKey: 'wak_test',
    llmModel: 'gemini_3f',
    inspireTeamId: 'team-1',
    llmThinkingLevel: 'low',
  });
  globalThis.fetch = origFetch;
  assert('Inspire 使用最高分 revision', out[0].ai_translation === 'Best rewrite');
  assert('Inspire 保留全部候选', out[0].ai_candidates.length === 2);
  assert('Inspire 保存 task id', out[0].ai_task_id === 'task-1');
}

// 低分文案按最多 3 个并发调用 Inspire，结果顺序必须与输入一致。
{
  const origFetch = globalThis.fetch;
  let taskIndex = 0;
  let activeCreates = 0;
  let maxActiveCreates = 0;
  globalThis.fetch = async (url) => {
    if (url.endsWith('/openapi/tasks')) {
      taskIndex += 1;
      const currentTask = taskIndex;
      activeCreates += 1;
      maxActiveCreates = Math.max(maxActiveCreates, activeCreates);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeCreates -= 1;
      return { ok: true, status: 200, json: async () => ({ _id: `task-${currentTask}`, status: 'completed' }), text: async () => '' };
    }
    const taskId = url.match(/tasks\/(task-\d+)\/copies/)?.[1] || 'task-x';
    return {
      ok: true,
      status: 200,
      json: async () => ({ copies: [{ revisions: [{ revision: `rewrite-${taskId}`, title: 'best', score: 0.9 }] }] }),
      text: async () => '',
    };
  };
  const out = await rewriteSourceWithAI(
    Array.from({ length: 4 }, (_, index) => ({ source_text: `Source ${index}`, tm_source: 'TM', similarity: 10 })),
    {
      llmProvider: 'inspire', llmEndpoint: 'https://inspire.bytedance.net/writer/api',
      llmApiKey: 'wak_test', llmModel: 'gemini_3f', inspireTeamId: 'team-1', aiConcurrency: 3,
    },
  );
  globalThis.fetch = origFetch;
  assert('Inspire 并发上限为 3', maxActiveCreates === 3, `actual ${maxActiveCreates}`);
  assert('Inspire 并发输出保持输入顺序', out.map((item) => item.ai_task_id).join(',') === 'task-1,task-2,task-3,task-4');
}

console.log('\n=== ai-translate.js: parseAIResponse ===');

// 10. 正常 JSON
{
  const r = parseAIResponse('{"ai_translation":"テスト","reasoning":"ok","reuse_tm":true}', { source_text: 'test' });
  assert('解析正常 JSON translation', r.ai_translation === 'テスト');
  assert('解析正常 JSON reuse_tm', r.reuse_tm === true);
}

// 11. JSON 包裹在 markdown 围栏/额外文本中
{
  const r = parseAIResponse('Here is the result:\n```json\n{"ai_translation":"x","reasoning":"y","reuse_tm":false}\n```\nDone', { source_text: 't' });
  assert('从围栏中提取 JSON', r.ai_translation === 'x');
}

// 12. JSON 解析失败 -> 原始文本
{
  const r = parseAIResponse('plain text no json', { source_text: 't' });
  assert('JSON 失败回退原始文本', r.ai_translation === 'plain text no json');
  assert('JSON 失败标记原因', r.reasoning.includes('JSON parse failed'));
}

console.log('\n=== ai-translate.js: translateWithAI (mock LLM) ===');

// 13. 未配置 LLM -> 优雅降级
{
  const items = [{ source_text: 'hi' }];
  const out = await translateWithAI(items, { targetLang: 'ja' });
  assert('未配置 LLM 返回空翻译', out[0].ai_translation === '');
  assert('未配置 LLM 给出英文原因', /not configured/i.test(out[0].reasoning));
}

// 14. 配置完整 -> 走 fetch(mock)，返回解析结果
{
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ content: [{ text: '{"ai_translation":"ギフト","reasoning":"r","reuse_tm":false}' }] }),
    text: async () => '',
  });
  const items = [{ source_text: 'Send a gift', tm_match: 'ギフト送信', similarity: 40 }];
  const out = await translateWithAI(items, { llmEndpoint: 'https://api.anthropic.com/v1/messages', llmApiKey: 'k', llmModel: 'claude-sonnet-4-6', targetLang: 'ja' });
  globalThis.fetch = origFetch;
  assert('mock LLM 返回翻译', out[0].ai_translation === 'ギフト');
  assert('mock LLM 保留原 item 字段', out[0].tm_match === 'ギフト送信');
}

// 15. LLM API 报错 -> 单条降级不崩溃
{
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => 'server error' });
  const items = [{ source_text: 'hi' }, { source_text: 'yo' }];
  const out = await translateWithAI(items, { llmEndpoint: 'https://api.anthropic.com/x', llmApiKey: 'k', llmModel: 'm', targetLang: 'ja' });
  globalThis.fetch = origFetch;
  assert('API 报错不崩溃', out.length === 2);
  assert('API 报错降级原因', out[0].reasoning.includes('AI Error'));
}

console.log('\n=== ai-translate.js: rewriteSourceWithAI (TM 优化改写) ===');

// 16. Orig>=85 不改写，标记 reached_threshold
{
  const items = [{ source_text: 'Done', tm_match: '完成', similarity: 100 }];
  const out = await rewriteSourceWithAI(items, {});
  assert('达标标记 reached_threshold', out[0].reached_threshold === true);
  assert('达标不改写(沿用原文)', out[0].ai_translation === 'Done');
  assert('达标 reuse_tm', out[0].reuse_tm === true);
}

// 17. Orig<85 + 未配置 LLM -> 空 ai_translation 但仍标记 reached_threshold=false
{
  const items = [{ source_text: 'gift', tm_match: 'ギフト', similarity: 30 }];
  const out = await rewriteSourceWithAI(items, {});
  assert('未达标 reached_threshold=false', out[0].reached_threshold === false);
  assert('未配置LLM空改写', out[0].ai_translation === '');
  assert('未配置LLM给英文原因', /not configured/i.test(out[0].reasoning));
}

// 18. Orig<85 + 配置LLM -> 调 fetch mock 返回改写
{
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ content: [{ text: '{"ai_translation":"send a gift","reasoning":"closer to TM","reuse_tm":false}' }] }),
    text: async () => '',
  });
  const items = [{ source_text: 'gift', tm_match: 'send gift', similarity: 30, origin: 'tester' }];
  const out = await rewriteSourceWithAI(items, { llmEndpoint: 'https://api.anthropic.com/x', llmApiKey: 'k', llmModel: 'm' });
  globalThis.fetch = origFetch;
  assert('改写返回 ai_translation', out[0].ai_translation === 'send a gift');
  assert('改写 reached_threshold=false', out[0].reached_threshold === false);
}

// 18b. 84% 未达标，85% 达标，默认门槛必须与计费口径一致
{
  const out = await rewriteSourceWithAI([
    { source_text: 'below', tm_match: 'below tm', similarity: 84 },
    { source_text: 'at', tm_match: 'at tm', similarity: 85 },
  ], {});
  assert('84% 触发改写', out[0].reached_threshold === false);
  assert('85% 不改写', out[1].reached_threshold === true && out[1].reuse_tm === true);

  const oldScore84 = compareAIvsTM({ source_text: 'x', ai_translation: 'y', tm_match: 'z', similarity: 84 });
  const oldScore85 = compareAIvsTM({ source_text: 'x', ai_translation: 'y', tm_match: 'z', similarity: 85 });
  assert('无 New Match 时 84% 为 different', oldScore84.ai_vs_tm.status === 'different');
  assert('无 New Match 时 85% 为 same', oldScore85.ai_vs_tm.status === 'same');

  const newScore84 = compareAIvsTM({ source_text: 'x', ai_translation: 'y', tm_match: 'z', similarity: 82, new_match: 84 });
  const newScore85 = compareAIvsTM({ source_text: 'x', ai_translation: 'y', tm_match: 'z', similarity: 82, new_match: 85 });
  assert('New Match 84% 且提升不足 5 分为 different', newScore84.ai_vs_tm.status === 'different');
  assert('New Match 85% 为 improved', newScore85.ai_vs_tm.status === 'improved');
}

// 19. 端到端 pipeline: TM(Orig) -> 改写 -> New Match -> diff
{
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ content: [{ text: '{"ai_translation":"send a gift","reasoning":"r","reuse_tm":false}' }] }),
    text: async () => '',
  });
  const items = [{ source_text: 'gift', tm_match: 'send gift', similarity: 30, origin: 'LIVE v1' }];
  const ai = await rewriteSourceWithAI(items, { llmEndpoint: 'https://api.anthropic.com/x', llmApiKey: 'k', llmModel: 'm' });
  ai[0].new_match = 88; // 模拟改写后再查 TM 得到 88
  const final = ai.map(compareAIvsTM);
  globalThis.fetch = origFetch;
  assert('pipeline 最终含 ai_translation', final[0].ai_translation === 'send a gift');
  assert('pipeline 最终含 ai_vs_tm', !!final[0].ai_vs_tm);
  assert('pipeline status=improved (New>Orig)', final[0].ai_vs_tm.status === 'improved');
}

console.log('\n=== ai-translate.js: callLLM 走 native host 绕过 CORS ===');
{
  // 扩展环境：有 chrome.runtime.sendNativeMessage → 走 native host 路径（不 fetch）
  const origChrome = globalThis.chrome;
  const sent = [];
  globalThis.chrome = {
    runtime: {
      sendNativeMessage: () => {},  // 标志扩展环境，触发 callLLM 走 native 路径
      sendMessage: async (msg) => {
        sent.push(msg);
        // 模拟 background 转发后 native host 返回 { ok:true, text:'改写后原文' }
        return { ok: true, text: 'rewrite-by-native' };
      },
    },
  };
  const out = await translateWithAI(
    [{ source_text: 'gift', tm_match: 'send gift', similarity: 30, origin: 'LIVE' }],
    { llmEndpoint: 'https://llmbox-global.byteintl.net/v1/messages', llmApiKey: 'at-x', llmModel: 'glm-5.2', targetLang: 'zh', provider: 'claude' }
  );
  assert('扩展环境走 native host（发 native_llm_call）', sent.some((m) => m.action === 'native_llm_call'));
  assert('payload 含 endpoint/api_key/model/prompt', sent[0].payload.action === 'llm_call' && sent[0].payload.endpoint && sent[0].payload.prompt);
  assert('native host 返回文本被采用', out[0].ai_translation === 'rewrite-by-native');
  globalThis.chrome = origChrome;
}

console.log('\n=== ai-translate.js: native host 返回 ok=false 时降级报错 ===');
{
  const origChrome = globalThis.chrome;
  globalThis.chrome = {
    runtime: {
      sendNativeMessage: () => {},
      sendMessage: async () => ({ ok: false, error: 'HTTP 401: unauthorized', status: 401 }),
    },
  };
  const out = await translateWithAI(
    [{ source_text: 'gift', tm_match: 'send gift', similarity: 30, origin: 'LIVE' }],
    { llmEndpoint: 'https://llmbox-global.byteintl.net/v1/messages', llmApiKey: 'bad', llmModel: 'glm-5.2', targetLang: 'zh', provider: 'claude' }
  );
  assert('native host 失败不崩溃', out[0].ai_translation === '');
  assert('native host 失败给原因', /native host|LLM via|401/i.test(out[0].reasoning));
  globalThis.chrome = origChrome;
}

console.log('\n=== TM 结果映射稳定性（bridge 返回 → item 字段） ===');
{
  // 模拟 starling-bridge.py 返回的 TM 结果结构（与 popup.js processItems 合并逻辑一致）
  // 关键不变量：similarity 不被 ×100（已是百分制）；tm_source 独立保留（不被原文覆盖）；origin 透传。
  function mapTmResult(item, tm) {
    return {
      ...item,
      tm_match: tm.tm_match,
      tm_source: tm.tm_source,
      similarity: tm.similarity,
      origin: tm.origin,
    };
  }

  const items = [
    { source_text: 'Done', row: 2 },
    { source_text: 'Confirm', row: 3 },
    { source_text: 'Cancel', row: 4 },
  ];
  const tmResults = [
    { tm_match: '完成', tm_source: 'Done', similarity: 100, origin: 'starling' },
    { tm_match: '確認', tm_source: 'Confirm', similarity: 100, origin: 'starling' },
    { tm_match: '', tm_source: '', similarity: 0, origin: 'no_match' },
  ];
  const mapped = items.map((it, i) => mapTmResult(it, tmResults[i]));

  // 确定性：相同输入两次映射结果相同
  const mapped2 = items.map((it, i) => mapTmResult(it, tmResults[i]));
  assert('两次映射结果相同', JSON.stringify(mapped) === JSON.stringify(mapped2));

  assert('tm_match 正确映射', mapped[0].tm_match === '完成' && mapped[1].tm_match === '確認');
  assert('tm_source 独立保留（不被原文覆盖）', mapped[0].tm_source === 'Done' && mapped[1].tm_source === 'Confirm');
  assert('similarity 保持百分制（不再 ×100）', mapped[0].similarity === 100 && mapped[1].similarity === 100);
  assert('origin 透传', mapped[0].origin === 'starling');
  assert('无匹配条目 similarity=0', mapped[2].similarity === 0);
  assert('无匹配条目 tm_match 空', mapped[2].tm_match === '');
  assert('原 source_text 不被 TM 覆盖', mapped[0].source_text === 'Done' && mapped[1].source_text === 'Confirm');
  assert('row 字段保留', mapped[2].row === 4);

  // similarity 边界值不被改写（85.5 不应被四舍五入破坏映射）
  const frac = mapTmResult({ source_text: 'x' }, { tm_match: 'y', tm_source: 'x', similarity: 85.5, origin: 'z' });
  assert('小数 similarity 原样映射', frac.similarity === 85.5);
}

console.log('\n=== TM method/version 元数据（T18） ===');
{
  // bridge 返回的 TM 结果应带 method / method_version / candidate_count
  // Starling 路径：method=starling；BM25 fallback：method=local_bm25_v1（已在 tm-bm25.test.js 验证）
  function mapTmWithMethod(item, tm) {
    return {
      ...item,
      tm_match: tm.tm_match,
      tm_source: tm.tm_source,
      similarity: tm.similarity,
      origin: tm.origin,
      tm_method: tm.method || 'starling',
      tm_candidate_count: tm.candidate_count ?? 0,
    };
  }
  const starlingTm = { tm_match: '完成', tm_source: 'Done', similarity: 100, origin: 'starling', method: 'starling', method_version: 'starling-cli-1.1.16', candidate_count: 5 };
  const m = mapTmWithMethod({ source_text: 'Done', row: 2 }, starlingTm);
  assert('Starling 结果带 method=starling', m.tm_method === 'starling');
  assert('candidate_count 透传', m.tm_candidate_count === 5);
  assert('缺 method 时默认 starling', mapTmWithMethod({}, { tm_match: 'x', similarity: 0, origin: 'o' }).tm_method === 'starling');
  assert('缺 candidate_count 时默认 0', mapTmWithMethod({}, { tm_match: 'x', similarity: 0, origin: 'o' }).tm_candidate_count === 0);
}

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`);
if (fail > 0) process.exit(1);
