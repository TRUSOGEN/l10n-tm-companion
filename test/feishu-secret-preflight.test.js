import assert from 'node:assert/strict';
import { createFeishuPopupController } from '../lib/feishu-popup-controller.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function target() {
  return { listeners: {}, addCount: 0, addEventListener(type, fn) { this.addCount += 1; (this.listeners[type] ||= []).push(fn); }, async fire(type) { for (const fn of this.listeners[type] || []) await fn(); } };
}
function node() {
  const value = target();
  value.textContent = '';
  value.classList = { values: new Set(), add(v) { this.values.add(v); }, remove(v) { this.values.delete(v); }, contains(v) { return this.values.has(v); } };
  return value;
}
function harness({ legacy = true, configured = false, openFailure = null } = {}) {
  const ids = ['connect-feishu-user', 'feishu-secret-diagnostic', 'feishu-secret-action', 'feishu-auth-title', 'feishu-auth-status', 'feishu-auth-card'];
  const nodes = Object.fromEntries(ids.map((id) => [id, node()]));
  const doc = target(); doc.visibilityState = 'visible'; doc.getElementById = (id) => nodes[id];
  const win = target(); const storageEvents = target(); storageEvents.addListener = (fn) => storageEvents.addEventListener('change', fn); const order = [];
  let secretCalls = 0; let legacyCalls = 0; let brokerCalls = 0;
  const controller = createFeishuPopupController({
    documentRef: doc, windowRef: win,
    chromeApi: { storage: { local: { set: async () => order.push('storage') }, onChanged: storageEvents }, runtime: { openOptionsPage: async () => { order.push('open'); if (openFailure) throw openFailure; } } },
    shouldUseLegacy: async () => legacy,
    getAuthorizationStatus: async () => ({ connected: false, profile: null }),
    getCredentialStatus: async () => { secretCalls += 1; return { configured }; },
    authorizeLegacy: async () => { legacyCalls += 1; }, authorizeBroker: async () => { brokerCalls += 1; },
    getReturnUrl: async () => 'https://example.test',
    openSettingsPage: async ({ storage, openOptionsPage }) => { await storage.set({ optionsNavigationIntent: 'feishu-secret' }); await openOptionsPage(); },
    formatError: (error) => ({ title: 'Settings failed', message: error.message }),
  });
  return { controller, nodes, doc, win, order, counts: () => ({ secretCalls, legacyCalls, brokerCalls }) };
}

const missing = harness();
assert.equal(missing.controller.bind(), true); assert.equal(missing.controller.bind(), false);
await missing.nodes['connect-feishu-user'].fire('click');
assert.deepEqual(missing.counts(), { secretCalls: 1, legacyCalls: 0, brokerCalls: 0 });
assert(missing.nodes['connect-feishu-user'].classList.contains('hidden'));
assert(!missing.nodes['feishu-secret-action'].classList.contains('hidden'));

const broker = harness({ legacy: false }); broker.controller.bind();
await broker.nodes['connect-feishu-user'].fire('click');
assert.deepEqual(broker.counts(), { secretCalls: 0, legacyCalls: 0, brokerCalls: 1 });

const settings = harness({ openFailure: new Error('open denied') }); settings.controller.bind();
await settings.nodes['feishu-secret-action'].fire('click');
assert.deepEqual(settings.order, ['storage', 'open']);
assert.equal(settings.nodes['feishu-auth-status'].textContent, 'Settings failed');
assert(!settings.nodes['feishu-secret-diagnostic'].classList.contains('hidden'));

const returning = harness({ configured: false }); returning.controller.bind();
await returning.controller.refresh(); returning.nodes['connect-feishu-user'].classList.add('hidden');
returning.controller.bind();
// Change the injected status through a second production-equivalent controller state is unnecessary: getter closes over options.
const recovered = harness({ configured: true }); recovered.controller.bind();
recovered.nodes['feishu-secret-diagnostic'].classList.remove('hidden'); recovered.nodes['feishu-secret-action'].classList.remove('hidden'); recovered.nodes['connect-feishu-user'].classList.add('hidden');
await recovered.doc.fire('visibilitychange'); await tick();
assert(recovered.nodes['feishu-secret-diagnostic'].classList.contains('hidden'));
assert(recovered.nodes['feishu-secret-action'].classList.contains('hidden'));
assert(!recovered.nodes['connect-feishu-user'].classList.contains('hidden'));
await recovered.win.fire('focus'); await tick();
assert.equal(recovered.nodes['connect-feishu-user'].addCount, 1, 'refresh must not register duplicate listeners');

console.log('Feishu Popup controller executable behavior: passed');
