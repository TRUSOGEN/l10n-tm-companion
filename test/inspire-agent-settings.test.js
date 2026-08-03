/** Inspire Agent 设置解析、版本策略与可操作错误提示回归测试。 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  INSPIRE_DEFAULT_AGENT,
  resolveInspireAgentConfig,
} from '../lib/inspire-models.js';
import { explainInspireError } from '../lib/inspire-writer.js';

const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'options.html'), 'utf8');

assert.deepEqual(
  resolveInspireAgentConfig({}),
  {
    agentId: INSPIRE_DEFAULT_AGENT.id,
    agentVersion: null,
    agentMode: 'default',
    versionPolicy: 'latest',
  },
  '默认 Agent 必须自动使用最新已发布版本，请求中不发送 version',
);

assert.deepEqual(
  resolveInspireAgentConfig({
    inspireAgentMode: 'custom',
    inspireCustomAgentId: 'agent-live-tm',
    inspireAgentVersionPolicy: 'pinned',
    inspireAgentVersion: '8',
  }),
  {
    agentId: 'agent-live-tm',
    agentVersion: 8,
    agentMode: 'custom',
    versionPolicy: 'pinned',
  },
  '高级配置必须允许指定已发布 Agent 和固定版本',
);

assert.throws(
  () => resolveInspireAgentConfig({ inspireAgentMode: 'custom' }),
  /Custom Inspire Agent ID is required/,
  '选择 Custom Agent 后必须要求明确 ID',
);
assert.throws(
  () => resolveInspireAgentConfig({ inspireAgentVersionPolicy: 'pinned' }),
  /positive integer/,
  '固定版本必须是正整数',
);

assert.deepEqual(
  explainInspireError(new Error('Inspire API 403: forbidden')),
  {
    reason: 'This Access Key cannot run the selected Agent.',
    action: 'Check the wak_ key, Agent ID, and its Team access in Settings.',
  },
  '鉴权失败必须明确说明密钥和 Agent Team 权限的修复位置',
);
assert.deepEqual(
  explainInspireError(new Error('Inspire Agent output type must be chat, got: markdown')),
  {
    reason: 'The selected Agent does not use native Chat copy output.',
    action: 'In Inspire, change Output type to Chat, publish the Agent, then try again.',
  },
  '输出契约不兼容时必须给出精确修复动作',
);
assert.deepEqual(
  explainInspireError(new Error('Inspire task completed with no usable pass copy: task-1')),
  {
    reason: 'The Agent completed without a usable copy.',
    action: 'Update its prompt to return native copy results only, publish it, then try again.',
  },
  '无 pass copy 时必须解释 Prompt 的修复方向',
);

assert(html.includes('id="inspireAgentMode"'), 'Settings 必须允许默认 Agent 与 Custom Agent ID 之间切换');
assert(html.includes('id="inspireCustomAgentId"'), 'Settings 必须提供高级 Custom Agent ID 输入');
assert(html.includes('id="inspireAgentVersionPolicy"'), 'Settings 必须提供 Latest / pinned 版本策略');
assert(html.includes('data-configure-feishu-app'), '设置页顶部必须提供直接写入 Feishu App Secret 的动作');
assert(!html.includes('<summary>3. Feishu App Secret</summary>'), 'Feishu App Secret 不得继续藏在折叠区');

console.log('inspire agent settings tests: passed');
