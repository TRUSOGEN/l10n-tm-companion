/** Inspire Custom Agent 创建链路与原生 copy 候选契约测试。 */

import assert from 'node:assert/strict';
import { rewriteSourceWithAI } from '../lib/ai-translate.js';
import { createInspireRewrite } from '../lib/inspire-writer.js';

const requests = [];
const fetchImpl = async (url, init = {}) => {
  requests.push({ url, init });
  if (url.endsWith('/openapi/agents/agent-live-tm/tasks')) {
    return response(200, {
      _id: 'task-agent-1',
      status: 'pending',
      customAgentId: 'agent-live-tm',
      agentVersionNumber: 7,
      agentType: 'chat',
    });
  }
  if (url.endsWith('/openapi/tasks/task-agent-1/status')) {
    return response(200, { status: 'completed' });
  }
  if (url.endsWith('/openapi/tasks/task-agent-1/copies')) {
    return response(200, {
      status: 'completed',
      copies: [
        { _id: 'copy-1', status: 'pass', copy: 'Finish 3 LIVE missions.', summary: 'Passed.' },
        { _id: 'copy-2', status: 'fail', copy: 'Unsafe copy', summary: 'Rejected.' },
        { _id: 'copy-3', status: 'pass', copy: 'Complete 3 LIVE missions.', summary: 'Passed.' },
      ],
    });
  }
  throw new Error(`Unexpected URL: ${url}`);
};

const result = await createInspireRewrite({
  prompt: 'SOURCE\nComplete 3 LIVE missions.',
  config: {
    endpoint: 'https://inspire.bytedance.net/writer/api',
    accessKey: 'wak_test_only',
    agentId: 'agent-live-tm',
    agentVersion: 7,
    model: 'gemini_3f',
    thinkingLevel: 'low',
    pollIntervalMs: 0,
    timeoutMs: 5_000,
  },
  fetchImpl,
});

assert.equal(requests[0].url, 'https://inspire.bytedance.net/writer/api/openapi/agents/agent-live-tm/tasks');
const createBody = JSON.parse(requests[0].init.body);
assert.deepEqual(createBody, {
  prompt: 'SOURCE\nComplete 3 LIVE missions.',
  llmModel: 'gemini_3f',
  thinkingLevel: 'low',
  version: 7,
});
assert.deepEqual(
  result.candidates.map((candidate) => candidate.revision),
  ['Finish 3 LIVE missions.', 'Complete 3 LIVE missions.'],
  'Custom Agent 只接收 pass copy，并保持服务端顺序',
);
assert.equal(result.taskId, 'task-agent-1');
assert.equal(result.agentVersionNumber, 7);
assert.equal(result.requestCount, 3);
assert.equal(result.pollCount, 1);

{
  const originalFetch = globalThis.fetch;
  let createRequest = null;
  globalThis.fetch = async (url, init = {}) => {
    if (url.endsWith('/openapi/agents/6a7036d4ef9ca901ee5c7a65/tasks')) {
      createRequest = { url, body: JSON.parse(init.body) };
      return response(200, {
        _id: 'task-pipeline',
        status: 'completed',
        customAgentId: '6a7036d4ef9ca901ee5c7a65',
        agentVersionNumber: 7,
        agentType: 'chat',
      });
    }
    if (url.endsWith('/openapi/tasks/task-pipeline/copies')) {
      return response(200, {
        status: 'completed',
        copies: [{
          _id: 'copy-pipeline',
          status: 'pass',
          copy: 'Finish 3 LIVE missions to get 100 points.',
          summary: 'Passed all checks.',
          source: 'generated',
        }],
      });
    }
    throw new Error(`Unexpected pipeline URL: ${url}`);
  };
  const rewritten = await rewriteSourceWithAI([{
    source_text: 'Complete 3 LIVE missions to earn 100 points.',
    tm_source: 'Finish 3 LIVE missions to get 100 points.',
    tm_match: '完成 3 个直播任务即可获得 100 积分。',
    similarity: 78,
  }], {
    llmProvider: 'inspire',
    llmEndpoint: 'https://inspire.bytedance.net/writer/api',
    llmApiKey: 'wak_test',
    llmModel: 'gemini_3f',
    llmThinkingLevel: 'low',
    inspireRequestGate: async () => {},
  });
  globalThis.fetch = originalFetch;
  assert.ok(!('version' in createRequest.body), '默认 Agent 必须省略 version，自动使用最新非废弃发布版本');
  assert.ok(!('teamId' in createRequest.body), 'Custom Agent 创建请求不得继续发送 teamId');
  assert.equal(rewritten[0].ai_translation, 'Finish 3 LIVE missions to get 100 points.');
  assert.equal(rewritten[0].ai_candidates.length, 1);
  assert.equal(rewritten[0].ai_agent_version, 7, '结果必须记录服务端实际执行的版本，便于审计');
}

{
  const originalFetch = globalThis.fetch;
  let createRequest = null;
  globalThis.fetch = async (url, init = {}) => {
    if (url.endsWith('/openapi/agents/agent-custom-9/tasks')) {
      createRequest = { url, body: JSON.parse(init.body) };
      return response(200, {
        _id: 'task-custom-pinned',
        status: 'completed',
        customAgentId: 'agent-custom-9',
        agentVersionNumber: 9,
        agentType: 'chat',
      });
    }
    if (url.endsWith('/openapi/tasks/task-custom-pinned/copies')) {
      return response(200, {
        copies: [{ status: 'pass', copy: 'Finish 3 LIVE missions.', summary: 'Passed.' }],
      });
    }
    throw new Error(`Unexpected custom pipeline URL: ${url}`);
  };
  const rewritten = await rewriteSourceWithAI([{
    source_text: 'Complete 3 LIVE missions.',
    tm_source: 'Finish 3 LIVE missions.',
    similarity: 78,
  }], {
    llmProvider: 'inspire',
    llmEndpoint: 'https://inspire.bytedance.net/writer/api',
    llmApiKey: 'wak_test',
    llmModel: 'gemini_3f',
    inspireAgentMode: 'custom',
    inspireCustomAgentId: 'agent-custom-9',
    inspireAgentVersionPolicy: 'pinned',
    inspireAgentVersion: 9,
    inspireRequestGate: async () => {},
  });
  globalThis.fetch = originalFetch;
  assert.ok(createRequest.url.endsWith('/agent-custom-9/tasks'), '高级 Custom Agent ID 必须成为 OpenAPI path 参数');
  assert.equal(createRequest.body.version, 9, 'Pinned version 必须成为 OpenAPI 请求参数');
  assert.equal(rewritten[0].ai_agent_version, 9);
}

{
  const fetchImplFailed = async (url) => {
    if (url.endsWith('/openapi/agents/agent-live-tm/tasks')) {
      return response(200, { _id: 'task-failed-detail', status: 'pending' });
    }
    if (url.endsWith('/openapi/tasks/task-failed-detail/status')) {
      return response(200, { status: 'failed' });
    }
    if (url.endsWith('/openapi/tasks/task-failed-detail')) {
      return response(200, { status: 'failed', failedReason: 'agent output generation failed' });
    }
    throw new Error(`Unexpected failed-task URL: ${url}`);
  };
  await assert.rejects(
    createInspireRewrite({
      prompt: 'SOURCE\nFailure sample',
      config: {
        endpoint: 'https://inspire.bytedance.net/writer/api',
        accessKey: 'wak_test_only',
        agentId: 'agent-live-tm',
        agentVersion: 7,
        pollIntervalMs: 0,
        timeoutMs: 5_000,
      },
      fetchImpl: fetchImplFailed,
    }),
    /agent output generation failed/,
    '任务失败后必须读取任务详情并暴露 failedReason',
  );
}

{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.endsWith('/openapi/agents/6a7036d4ef9ca901ee5c7a65/tasks')) {
      return response(200, {
        _id: 'task-placeholder',
        status: 'completed',
        agentVersionNumber: 7,
        agentType: 'chat',
      });
    }
    if (url.endsWith('/openapi/tasks/task-placeholder/copies')) {
      return response(200, {
        copies: [{ status: 'pass', copy: 'Finish {count} LIVE missions.', summary: 'Passed.' }],
      });
    }
    throw new Error(`Unexpected placeholder URL: ${url}`);
  };
  const rewritten = await rewriteSourceWithAI([{
    source_text: 'Complete {count} LIVE missions.',
    tm_source: 'Finish {count} LIVE missions.',
    similarity: 78,
  }], {
    llmProvider: 'inspire',
    llmEndpoint: 'https://inspire.bytedance.net/writer/api',
    llmApiKey: 'wak_test',
    llmModel: 'gemini_3f',
    inspireRequestGate: async () => {},
  });
  globalThis.fetch = originalFetch;
  assert.equal(
    rewritten[0].ai_translation,
    'Finish {count} LIVE missions.',
    '包含 placeholder 的普通 pass copy 不得被误判为损坏 JSON',
  );
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

console.log('inspire-custom-agent tests: 5 passed, 0 failed');
