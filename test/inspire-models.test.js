/** Inspire Writer 模型枚举与历史配置迁移契约测试。 */

import assert from 'node:assert/strict';
import {
  INSPIRE_MODEL_OPTIONS,
  INSPIRE_TM_AGENT_ID,
  INSPIRE_TM_AGENT_VERSION,
  normalizeInspireModelId,
} from '../lib/inspire-models.js';

assert.equal(
  INSPIRE_TM_AGENT_ID,
  '6a7036d4ef9ca901ee5c7a65',
  'TM_inspire 的真实 published Agent ID 必须由程序固定',
);
assert.equal(INSPIRE_TM_AGENT_VERSION, 7, '插件必须锁定已完成真实 E2E 的 Agent Version 7');

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

console.log('inspire model contract tests: 8 passed, 0 failed');
