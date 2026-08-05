import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preflightFeishuAuthorization } from '../lib/feishu-auth.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dirname, '..');
const popupHtml = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const popupSource = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const optionsHtml = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
const optionsSource = fs.readFileSync(path.join(root, 'options.js'), 'utf8');

assert.deepEqual(preflightFeishuAuthorization({ connected: true, displayName: 'Yegen' }), {
  state: 'connected', actionId: 'reconnect', title: 'Connected', message: 'Yegen',
});
assert.equal(preflightFeishuAuthorization({ secretConfigured: true }).state, 'ready');
assert.deepEqual(preflightFeishuAuthorization({}), {
  state: 'secret-required',
  actionId: 'open-settings',
  title: 'Feishu setup required',
  message: 'Add the App Secret in Settings, then return to authorize.',
});

for (const id of ['feishu-auth-card', 'connect-feishu-user', 'feishu-secret-diagnostic', 'feishu-secret-action']) {
  assert(popupHtml.includes(`id="${id}"`), `popup must preserve/add #${id}`);
}
assert(popupSource.includes("optionsNavigationIntent: 'feishu-secret'"), 'navigation intent must be persisted');
const openSettingsBody = popupSource.match(/async function openFeishuSettings\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
assert(openSettingsBody.indexOf("optionsNavigationIntent: 'feishu-secret'") < openSettingsBody.indexOf('chrome.runtime.openOptionsPage()'), 'intent must be saved before Settings opens');
assert(optionsHtml.includes('id="feishu-secret"'), 'Settings must expose a stable Feishu section id');
assert(optionsHtml.includes('id="feishu-secret-action"'), 'Settings must expose a stable Secret action id');
assert(optionsSource.includes('function focusOptionsSection(hash, intent)'), 'Settings must implement deep-link focus');
assert(optionsSource.includes('.scrollIntoView('), 'deep link must scroll to the section');
assert(optionsSource.includes('.focus('), 'deep link must focus the action');
assert(optionsSource.includes("optionsNavigationIntent"), 'Settings must consume persisted intent');
assert(optionsSource.includes("location.hash"), 'Settings must consume URL hash');
assert(optionsHtml.includes('return to Side Panel to continue authorization'), 'Settings must explain the return step');
assert(!optionsHtml.includes('type="text" id="feishuAppSecret"'), 'Secret must never use a plain text field');

console.log('Feishu Secret preflight and Settings deep link: passed');
