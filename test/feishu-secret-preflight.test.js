import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  consumeFeishuSettingsNavigation,
  openFeishuSettingsPage,
  preflightFeishuAuthorization,
  resolveFeishuAuthorizationPreflight,
} from '../lib/feishu-auth.js';

assert.equal(preflightFeishuAuthorization({ connected: true }).state, 'connected');
assert.equal(preflightFeishuAuthorization({ secretConfigured: true }).state, 'ready');
assert.equal(preflightFeishuAuthorization({}).actionId, 'open-settings');

let secretChecks = 0;
let oauthCalls = 0;
const legacyMissing = await resolveFeishuAuthorizationPreflight({
  useLegacy: true,
  getAuthorizationStatus: async () => ({ connected: false }),
  getCredentialStatus: async () => { secretChecks += 1; return { configured: false }; },
});
if (legacyMissing.state !== 'secret-required') oauthCalls += 1;
assert.equal(oauthCalls, 0, 'legacy missing Secret must stop before OAuth');
assert.equal(secretChecks, 1);
const brokerReady = await resolveFeishuAuthorizationPreflight({
  useLegacy: false,
  getAuthorizationStatus: async () => ({ connected: false }),
  getCredentialStatus: async () => { secretChecks += 1; throw new Error('must not run'); },
});
assert.equal(brokerReady.state, 'ready');
assert.equal(secretChecks, 1, 'broker authority must not query local Secret');

const order = [];
await openFeishuSettingsPage({
  storage: { set: async () => { order.push('storage'); } },
  openOptionsPage: async () => { order.push('open'); },
});
assert.deepEqual(order, ['storage', 'open']);
await assert.rejects(openFeishuSettingsPage({ storage: { set: async () => { throw new Error('storage failed'); } }, openOptionsPage: async () => order.push('unexpected') }), /storage failed/);
assert(!order.includes('unexpected'));
await assert.rejects(openFeishuSettingsPage({ storage: { set: async () => {} }, openOptionsPage: async () => { throw new Error('open failed'); } }), /open failed/);

function element() {
  return { classList: { removed: [], remove(value) { this.removed.push(value); } }, scrollCalls: 0, focusCalls: 0, scrollIntoView() { this.scrollCalls += 1; }, focus() { this.focusCalls += 1; } };
}
const nodes = { 'feishu-secret': element(), 'feishu-secret-action': element(), 'feishu-secret-guidance': element() };
const removed = [];
const consumed = await consumeFeishuSettingsNavigation({
  hash: '',
  storage: { get: async () => ({ optionsNavigationIntent: 'feishu-secret' }), remove: async (keys) => removed.push(keys) },
  documentRef: { getElementById: (id) => nodes[id] },
});
assert.equal(consumed, true);
assert.equal(nodes['feishu-secret'].scrollCalls, 1);
assert.equal(nodes['feishu-secret-action'].focusCalls, 1);
assert.deepEqual(removed, [['optionsNavigationIntent']]);
const hashConsumed = await consumeFeishuSettingsNavigation({
  hash: '#feishu-secret', storage: { get: async () => ({}), remove: async () => assert.fail('hash needs no clear') }, documentRef: { getElementById: (id) => nodes[id] },
});
assert.equal(hashConsumed, true);

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dirname, '..');
const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
for (const id of ['feishu-auth-card', 'connect-feishu-user', 'feishu-secret-diagnostic', 'feishu-secret-action']) assert(html.includes(`id="${id}"`));
assert(popup.includes("document.addEventListener('visibilitychange'"), 'return lifecycle must refresh preflight');
assert(popup.includes("window.addEventListener?.('focus'"), 'focus lifecycle must refresh preflight');
assert(popup.includes("button.classList.remove('hidden')"), 'refresh must restore Connect');
assert(popup.includes('catch (error)'), 'Settings open rejection must be rendered');
assert(popup.includes('authorizeFeishuUser({ returnUrl })'));

console.log('Feishu Secret executable behavior: passed');
