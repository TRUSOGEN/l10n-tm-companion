/** 英文默认、中文切换、插值与可见属性翻译契约测试。 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyI18n, normalizeUiLanguage, t } from '../lib/i18n.js';

const root = path.resolve(import.meta.dirname, '..');

function stripComments(source) {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

assert.equal(normalizeUiLanguage(undefined), 'en', '首次安装未保存语言时必须回到英文');
assert.equal(normalizeUiLanguage('zh-CN'), 'zh-CN', '用户选择中文后必须保留中文');
assert.equal(
  t('finalQueryProgress', 'en', { projects: 'A, B', locale: 'fr', current: 2, total: 21 }),
  'Querying final C TM: A, B · fr (2/21)...',
  '动态文案必须使用参数插值',
);

const textElement = { dataset: { i18n: 'sheet' }, textContent: '' };
const placeholderElement = {
  dataset: { i18nPlaceholder: 'manualPlaceholder' },
  attributes: {},
  setAttribute(name, value) { this.attributes[name] = value; },
};
const titleElement = {
  dataset: { i18nTitle: 'validateFinalTitle' },
  attributes: {},
  setAttribute(name, value) { this.attributes[name] = value; },
};
const fakeRoot = {
  documentElement: { lang: '' },
  querySelectorAll(selector) {
    if (selector === '[data-i18n]') return [textElement];
    if (selector === '[data-i18n-placeholder]') return [placeholderElement];
    if (selector === '[data-i18n-title]') return [titleElement];
    return [];
  },
};
applyI18n(fakeRoot, 'zh-CN');
assert.equal(fakeRoot.documentElement.lang, 'zh-CN');
assert.equal(textElement.textContent, '工作表');
assert.equal(placeholderElement.attributes.placeholder, '输入最终译文…');
assert.match(titleElement.attributes.title, /第三次 TM/);

const popupHtml = stripComments(fs.readFileSync(path.join(root, 'popup.html'), 'utf8'));
const popupJs = stripComments(fs.readFileSync(path.join(root, 'popup.js'), 'utf8'));
assert.equal(/[\p{Script=Han}]/u.test(popupHtml), false, '英文默认 HTML 的可见内容不能包含中文');
assert.equal(/[\p{Script=Han}]/u.test(popupJs), false, 'Popup 业务代码的用户字符串不能硬编码中文');

console.log('i18n contract tests: 10 passed, 0 failed');
