/**
 * A1 failing test: background.js / native envelope routing for broker requests.
 *
 * We load background.js in a minimal stub environment so we can inspect the
 * listener behavior without Chrome. The test asserts that a native_broker_request
 * is forwarded to Native Host as:
 *
 *   { action: 'native_broker_request', payload: {...} }
 *
 * and not as the unwrapped payload (which would make the Native Host see
 * roi_broker_create_run at top level and return Unknown action).
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const captured = [];
const sandbox = {
  console,
  chrome: {
    sidePanel: {
      setPanelBehavior() {
        return Promise.resolve();
      },
    },
    runtime: {
      lastError: null,
      onMessage: {
        addListener(listener) {
          sandbox.__bgListener = listener;
        },
      },
      sendNativeMessage(host, message, callback) {
        captured.push({ host, message });
        setImmediate(() => {
          callback({ ok: true, routed_action: message?.payload?.action, top_level_action: message?.action });
        });
      },
    },
    tabs: {
      query(_, cb) { cb([{ id: 1 }]); },
      sendMessage() {},
    },
    scripting: {
      executeScript() { return Promise.resolve(); },
    },
  },
  setImmediate,
  Promise,
  setTimeout,
};
sandbox.global = sandbox;
vm.createContext(sandbox);

const bgSource = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
vm.runInContext(bgSource, sandbox, { filename: 'background.js' });

function sendMessage(msg) {
  return new Promise((resolve) => {
    sandbox.__bgListener(msg, { id: 'sender' }, (response) => resolve(response));
  });
}

async function run() {
  let failures = 0;
  const cases = [
    { action: 'feishu_broker_oauth_start' },
    { action: 'feishu_broker_status' },
    { action: 'feishu_broker_revoke' },
    { action: 'feishu_broker_token' },
    { action: 'roi_broker_create_run', body: { client_run_id: 'r-1' } },
    { action: 'roi_broker_submit_final', run_id: 'r-1', item_id: 'i-1', body: {} },
    { action: 'roi_broker_get_run', run_id: 'r-1' },
    { action: 'roi_broker_archive', run_id: 'r-1', body: {} },
    { action: 'unknown_broker_action' },
  ];
  for (const c of cases) {
    captured.length = 0;
    const payload = { ...c };
    const response = await sendMessage({ action: 'native_broker_request', payload });
    const sent = captured[0];
    if (!sent) {
      failures += 1;
      console.error(`FAIL [${c.action}]: no native message sent`);
      continue;
    }
    if (sent.host !== 'com.l10n.tm_companion') {
      failures += 1;
      console.error(`FAIL [${c.action}]: wrong host`, sent.host);
    }
    if (sent.message?.action !== 'native_broker_request') {
      failures += 1;
      console.error(`FAIL [${c.action}]: top-level action must be native_broker_request, got`, sent.message?.action);
    }
    if (sent.message?.payload?.action !== c.action) {
      failures += 1;
      console.error(`FAIL [${c.action}]: payload action lost`, sent.message?.payload);
    }
    if (c.action === 'unknown_broker_action' && response?.top_level_action !== 'native_broker_request') {
      failures += 1;
      console.error(`FAIL: unknown subaction still requires envelope routing`, response);
    }
  }
  if (failures > 0) {
    console.error(`A1 JS routing test FAILED with ${failures} failure(s).`);
    process.exit(1);
  }
  console.log('PASS A1 JS routing: background forwards full native_broker_request envelope.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
