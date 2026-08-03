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
assert.equal(t('focus', 'en'), 'Review & edit');
assert.equal(t('focus', 'zh-CN'), '审阅与修改');
assert.equal(t('reviewStatusDirty', 'en'), 'Edited · confirm again');
assert.equal(t('reviewStatusDirty', 'zh-CN'), '已修改，需重新确认');
assert.equal(t('confirmReview', 'en'), 'Confirm & save');
assert.equal(t('confirmReview', 'zh-CN'), '确认并保存');
assert.equal(t('reconfirmReview', 'en'), 'Confirm changes & save');
assert.equal(t('reconfirmReview', 'zh-CN'), '确认修改并保存');
assert.match(t('roiSharedHint', 'zh-CN'), /共享目标语言只需选择一次/);
assert.ok(html.includes('data-i18n="workflow"'));
assert.ok(html.includes('id="ui-language"'));
assert.ok(
  html.includes('id="btn-confirm-remaining"')
    && html.includes('data-i18n="confirmRemaining"'),
  '批量确认按钮必须由同一套双语文案驱动',
);
assert.ok(css.includes('height: 100vh'), 'Side Panel 必须使用可用视口高度');
assert.ok(options.includes('value="inspire"'));
assert.ok(!options.includes('id="inspireTeamId"'));
assert.ok(options.includes('Skip this step when AI rewrite is off.'));
assert.ok(options.includes('id="llmThinkingLevel"'));
assert.ok(options.includes('<select id="llmModel"'), '模型必须使用选择器而不是自由文本输入');
assert.ok(options.includes('value="gemini-3.1-pro"'));
assert.ok(options.includes('value="gpt-5.4-mini"'));
assert.ok(options.includes('value="gpt-5.4"'));
assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'), '动效必须尊重 reduced motion');
assert.ok(css.includes('--motion-fast:'), '动效必须复用统一时长 token');
assert.ok(css.includes('transform: translateY'), '进入动效只能使用 transform/opacity 等合成属性');
assert.equal(typeof applyI18n, 'function');

console.log('side-panel-i18n tests: passed');
