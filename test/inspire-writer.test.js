/** Inspire Writer OpenAPI 客户端与候选选择回归测试。 */

import assert from 'node:assert/strict';
import {
  createRequestRateLimiter,
  createInspireRewrite,
  selectBestRevision,
} from '../lib/inspire-writer.js';

const baseConfig = {
  endpoint: 'https://inspire.bytedance.net/writer/api',
  accessKey: 'wak_test_only',
  agentId: 'agent-live-tm',
  agentVersion: 7,
  model: 'gemini_3f',
  thinkingLevel: 'low',
  pollIntervalMs: 0,
  timeoutMs: 5_000,
};

const best = selectBestRevision([
  { revision: 'Second choice', title: 'B', score: 0.71 },
  { revision: 'Best choice', title: 'A', score: 0.94 },
  { revision: '', title: 'empty', score: 1 },
]);
assert.equal(best.revision, 'Best choice', '应选择最高分非空 revision');

{
  let nowMs = 0;
  const limiter = createRequestRateLimiter({
    maxQps: 100,
    now: () => nowMs,
    sleep: async (waitMs) => { nowMs += waitMs; },
  });
  const requestStarts = await Promise.all(
    Array.from({ length: 12 }, () => limiter()),
  );
  assert.deepEqual(
    requestStarts,
    Array.from({ length: 12 }, (_, index) => index * 10),
    '100 QPS 限流器应把并发请求起点至少间隔 10ms',
  );
}

{
  const requests = [];
  const requestSlots = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url, init });
    if (url.endsWith('/openapi/agents/agent-live-tm/tasks')) {
      return response(200, { _id: 'task-1', status: 'pending' });
    }
    if (url.endsWith('/openapi/tasks/task-1/status')) {
      return response(200, { status: 'completed', totalTime: 3210 });
    }
    if (url.endsWith('/openapi/tasks/task-1/copies')) {
      return response(200, {
        status: 'completed',
        copies: [
          { status: 'pass', copy: 'Send a LIVE Gift', summary: 'Aligned with TM' },
          { status: 'pass', copy: 'Send LIVE Gifts', summary: 'Alternative' },
          { status: 'pass', copy: 'Send the LIVE Gift', summary: 'Third' },
          { status: 'pass', copy: 'LIVE Gift sending', summary: 'Fourth' },
        ],
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await createInspireRewrite({
    prompt: 'Rewrite source copy',
    config: {
      ...baseConfig,
      requestGate: async () => { requestSlots.push(requestSlots.length + 1); },
    },
    fetchImpl,
  });
  assert.equal(result.revision, 'Send a LIVE Gift');
  assert.equal(result.candidates.length, 3, '每个 Inspire task 最多保留三个候选');
  assert.equal(result.taskId, 'task-1');
  assert.equal(requests.length, 3, '创建、状态和 copies 各请求一次');
  assert.equal(requestSlots.length, 3, '所有 Inspire HTTP 请求都必须经过同一个限流入口');
  assert.equal(result.requestCount, 3, '结果应记录实际 HTTP 请求数');
  assert.equal(result.pollCount, 1, '结果应记录 status polling 次数');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer wak_test_only');
  const createBody = JSON.parse(requests[0].init.body);
  assert.equal(createBody.version, 7);
  assert.ok(!('teamId' in createBody));
  assert.equal(createBody.llmModel, 'gemini_3f');
  assert.equal(createBody.thinkingLevel, 'low');
}

{
  let copiesRequests = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith('/openapi/agents/agent-live-tm/tasks')) {
      return response(200, { _id: 'task-delayed-copies', status: 'completed' });
    }
    if (url.endsWith('/copies')) {
      copiesRequests += 1;
      return copiesRequests === 1
        ? response(200, { status: 'completed', copies: [] })
        : response(200, {
          status: 'completed',
          copies: [{ status: 'pass', copy: 'Delayed visible revision', summary: 'ready' }],
        });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const result = await createInspireRewrite({
    prompt: 'retry copies visibility',
    config: baseConfig,
    fetchImpl,
  });
  assert.equal(result.revision, 'Delayed visible revision');
  assert.equal(copiesRequests, 2, 'completed 后空 copies 应对同一 task 做只读重试');
}

{
  const fetchImpl = async (url) => {
    if (url.endsWith('/openapi/agents/agent-live-tm/tasks')) return response(200, { _id: 'task-failed', status: 'pending' });
    return response(200, { status: 'failed' });
  };
  await assert.rejects(
    createInspireRewrite({ prompt: 'x', config: baseConfig, fetchImpl }),
    /failed/,
    '任务失败必须忠实暴露',
  );
}

{
  const startedAt = Date.now();
  const fetchImpl = async (_url, init = {}) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  });
  await assert.rejects(
    createInspireRewrite({
      prompt: 'request timeout probe',
      config: { ...baseConfig, timeoutMs: 1_000, requestTimeoutMs: 25 },
      fetchImpl,
    }),
    /timed out after 25ms/,
    '单次 HTTP 请求必须使用独立短超时，不能占满整个任务截止时间',
  );
  assert.ok(Date.now() - startedAt < 500, '请求级超时应在任务总截止时间前结束');
}

{
  let createBody = null;
  const fetchImpl = async (url, init = {}) => {
    if (url.endsWith('/openapi/agents/agent-live-tm/tasks')) {
      createBody = JSON.parse(init.body);
      return response(200, { _id: 'task-migrated-model', status: 'completed' });
    }
    return response(200, {
      copies: [{ status: 'pass', copy: 'Migrated model output', summary: 'ok' }],
    });
  };
  await createInspireRewrite({
    prompt: 'Rewrite with GPT 5.4 high',
    config: {
      ...baseConfig,
      model: 'gpt-5.4-2026-03-05',
      thinkingLevel: 'high',
    },
    fetchImpl,
  });
  assert.equal(createBody.llmModel, 'gpt-5.4', '历史 GPT 5.4 ID 应在请求前迁移');
  assert.equal(createBody.thinkingLevel, 'high', '模型迁移不得改变 high thinking level');
}

{
  const fetchImpl = async (url) => {
    if (url.endsWith('/openapi/agents/agent-live-tm/tasks')) return response(200, { _id: 'task-empty', status: 'completed' });
    return response(200, { status: 'completed', copies: [{ status: 'fail', copy: 'Rejected' }] });
  };
  await assert.rejects(
    createInspireRewrite({ prompt: 'x', config: baseConfig, fetchImpl }),
    /no usable pass copy.*copies=1, passCopies=0, copyKeys=copy\|status, promptChars=1/,
    '没有可用 pass copy 时必须报告响应形状并禁止伪装成功',
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

console.log('inspire-writer tests: 18 passed, 0 failed');
