/** Side Panel 清单、双语和按需 ROI 静态契约测试。 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyI18n, normalizeUiLanguage, t } from '../lib/i18n.js';

const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'popup.css'), 'utf8');
const options = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
const optionsSource = fs.readFileSync(path.join(root, 'options.js'), 'utf8');

assert.equal(manifest.side_panel.default_path, 'popup.html');
assert.equal(manifest.action.default_popup, undefined, '扩展图标不应继续打开短暂 Popup');
assert.ok(manifest.permissions.includes('sidePanel'));
assert.ok(manifest.host_permissions.includes('https://inspire.bytedance.net/*'));
assert.equal(normalizeUiLanguage('zh-CN'), 'zh-CN');
assert.equal(normalizeUiLanguage('fr'), 'en');
assert.equal(t('detail', 'zh-CN'), '展开详情');
assert.equal(t('detail', 'en'), 'Details');
assert.match(t('roiSharedHint', 'zh-CN'), /共享目标语言只需选择一次/);
assert.ok(html.includes('data-i18n="workflow"'));
assert.ok(html.includes('id="ui-language"'));
assert.ok(css.includes('height: 100vh'), 'Side Panel 必须使用可用视口高度');
assert.ok(options.includes('value="inspire"'));
assert.ok(options.includes('id="inspireTeamId"'));
assert.ok(options.includes('id="llmThinkingLevel"'));
assert.ok(options.includes('<select id="llmModel"'), '模型必须使用选择器而不是自由文本输入');
assert.ok(optionsSource.includes('gemini-3.1-p-priority'));
assert.ok(optionsSource.includes('gpt-5.4-mini-2026-03-17'));
assert.ok(optionsSource.includes('gpt-5.4-2026-03-05'));
assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'), '动效必须尊重 reduced motion');
assert.ok(css.includes('--motion-fast:'), '动效必须复用统一时长 token');
assert.ok(css.includes('transform: translateY'), '进入动效只能使用 transform/opacity 等合成属性');
assert.equal(typeof applyI18n, 'function');

console.log('side-panel-i18n tests: 22 passed, 0 failed');
