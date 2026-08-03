/** Inspire Agent 审计标记与 Settings 字段的静态 UI 回归测试。 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const optionsHtml = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
const optionsJs = fs.readFileSync(path.join(root, 'options.js'), 'utf8');
const popupJs = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const popupCss = fs.readFileSync(path.join(root, 'popup.css'), 'utf8');

assert(optionsHtml.includes('id="inspireCustomAgentName"'), 'Custom Agent 应支持可读名称');
assert(optionsJs.includes("'inspireCustomAgentName'"), 'Custom Agent 名称必须持久化并进入运行配置');
assert(popupJs.includes('function renderAiAgentAttribution'), '结果卡必须提供 Agent 审计标记渲染器');
assert(popupJs.includes('ai_agent_name') && popupJs.includes('ai_agent_version'), '结果卡必须使用运行时实际 Agent 名称和版本');
assert(popupJs.includes('renderAiAgentAttribution(item)'), '结果卡与最终编辑区必须展示同一审计标记');
assert(popupCss.includes('.ai-agent-attribution'), '审计标记必须采用低干扰小字样式');

console.log('inspire agent attribution UI tests: passed');
