/** Inspire Writer 模型枚举与历史配置迁移契约测试。 */

import assert from 'node:assert/strict';
import {
  INSPIRE_MODEL_OPTIONS,
  INSPIRE_TM_AGENT_ID,
  INSPIRE_DEFAULT_AGENT,
  INSPIRE_DEFAULT_AGENT_LAST_OBSERVED_VERSION,
  getInspireAgentDisplayName,
  normalizeInspireModelId,
} from '../lib/inspire-models.js';

assert.equal(
  INSPIRE_TM_AGENT_ID,
  '6a7046ed7eb6d102364e292e',
  '默认 Agent 必须指向用户确认的 TM_AI_Revision',
);
assert.equal(INSPIRE_DEFAULT_AGENT.name, 'TM_AI_Revision');
assert.equal(INSPIRE_DEFAULT_AGENT_LAST_OBSERVED_VERSION, 5, '应记录当前页面可见发布版本，且不作为请求锁定参数');
assert.equal(
  getInspireAgentDisplayName({}, { agentId: INSPIRE_DEFAULT_AGENT.id, agentMode: 'default' }),
  'TM_AI_Revision',
);
assert.equal(
  getInspireAgentDisplayName({ inspireCustomAgentName: 'TT Copy Optimizer' }, { agentId: 'custom-1', agentMode: 'custom' }),
  'TT Copy Optimizer',
);
assert.equal(
  getInspireAgentDisplayName({}, { agentId: 'custom-1', agentMode: 'custom' }),
  'Custom Agent · custom-1',
  '自定义名称为空时必须保留 Agent ID 作为审计回退',
);

assert.deepEqual(
  INSPIRE_MODEL_OPTIONS.map(({ value }) => value),
  ['gemini_3f', 'gemini-3.1-pro', 'gpt-5.4-mini', 'gpt-5.4'],
  '模型下拉必须严格使用 Inspire OpenAPI 返回的允许枚举',
);

assert.equal(normalizeInspireModelId('gemini-3.1-p-priority'), 'gemini-3.1-pro');
assert.equal(normalizeInspireModelId('gpt-5.4-mini-2026-03-17'), 'gpt-5.4-mini');
assert.equal(normalizeInspireModelId('gpt-5.4-2026-03-05'), 'gpt-5.4');
assert.equal(normalizeInspireModelId('gpt-5.4'), 'gpt-5.4', '正式模型 ID 不应改变');
assert.equal(normalizeInspireModelId('future-model'), 'future-model', '未知 ID 应交给服务端正确失败');

console.log('inspire model contract tests: passed');
