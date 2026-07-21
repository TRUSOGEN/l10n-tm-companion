/** Inspire Writer OpenAPI 客户端与候选选择回归测试。 */

import assert from 'node:assert/strict';
import {
  createInspireRewrite,
  selectBestRevision,
} from '../lib/inspire-writer.js';

const baseConfig = {
  endpoint: 'https://inspire.bytedance.net/writer/api',
  accessKey: 'wak_test_only',
  teamId: 'team-live-cd',
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
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url, init });
    if (url.endsWith('/openapi/tasks')) {
      return response(200, { _id: 'task-1', status: 'pending' });
    }
    if (url.endsWith('/openapi/tasks/task-1/status')) {
      return response(200, { status: 'completed', totalTime: 3210 });
    }
    if (url.endsWith('/openapi/tasks/task-1/copies')) {
      return response(200, {
        status: 'completed',
        copies: [{
          revisions: [
            { revision: 'Send a LIVE Gift', title: 'Aligned with TM', score: 0.92 },
            { revision: 'Send LIVE Gifts', title: 'Alternative', score: 0.81 },
          ],
        }],
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await createInspireRewrite({
    prompt: 'Rewrite source copy',
    config: baseConfig,
    fetchImpl,
  });
  assert.equal(result.revision, 'Send a LIVE Gift');
  assert.equal(result.candidates.length, 2, '应保留全部候选供 UI 展开审阅');
  assert.equal(result.taskId, 'task-1');
  assert.equal(requests.length, 3, '创建、状态和 copies 各请求一次');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer wak_test_only');
  const createBody = JSON.parse(requests[0].init.body);
  assert.equal(createBody.teamId, 'team-live-cd');
  assert.equal(createBody.llmModel, 'gemini_3f');
  assert.equal(createBody.thinkingLevel, 'low');
}

{
  const fetchImpl = async (url) => {
    if (url.endsWith('/openapi/tasks')) return response(200, { _id: 'task-failed', status: 'pending' });
    return response(200, { status: 'failed' });
  };
  await assert.rejects(
    createInspireRewrite({ prompt: 'x', config: baseConfig, fetchImpl }),
    /failed/,
    '任务失败必须忠实暴露',
  );
}

{
  const fetchImpl = async (url) => {
    if (url.endsWith('/openapi/tasks')) return response(200, { _id: 'task-empty', status: 'completed' });
    return response(200, { status: 'completed', copies: [{ revisions: [] }] });
  };
  await assert.rejects(
    createInspireRewrite({ prompt: 'x', config: baseConfig, fetchImpl }),
    /no usable revision/,
    '没有可用 revision 时禁止伪装成功',
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

console.log('inspire-writer tests: 11 passed, 0 failed');
