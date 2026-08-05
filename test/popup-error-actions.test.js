import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { toUiError } from '../lib/ui-errors.js';

const source = fs.readFileSync(new URL('../popup.js', import.meta.url), 'utf8');
const block = source.slice(source.indexOf('export async function executeUiErrorAction'), source.indexOf('function showUiError'))
  .replaceAll('export ', '');

class Element {
  constructor(tag = 'div') {
    this.tag = tag; this.children = []; this.dataset = {}; this.attributes = {};
    this.className = ''; this.disabled = false; this.isConnected = false;
    this.classList = { remove: (name) => { this.removed = name; } };
  }
  connect(value) { this.isConnected = value; this.children.forEach((child) => child?.connect?.(value)); }
  append(...children) { children.forEach((child) => { this.children.push(child); child?.connect?.(this.isConnected); }); }
  replaceChildren() { this.children.forEach((child) => child?.connect?.(false)); this.children = []; }
  addEventListener(type, callback) { this.listener = callback; }
  async click() { return this.listener?.({ target: this }); }
  focus() { this.focused = true; }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  querySelectorAll(selector) { return selector === 'button' ? this.children.filter((child) => child.tag === 'button') : []; }
}
const elements = {
  'working-sheet-details': new Element('details'),
  'sheet-context-config': new Element(),
  'sheet-source-column': new Element('select'),
};
const document = { createElement: (tag) => new Element(tag), getElementById: (id) => elements[id] };
const sandbox = { document, navigator: {}, chrome: {}, ROI_WORKFLOW_SNAPSHOT_KEY: 'roiWorkflowSnapshot', toUiError };
vm.runInNewContext(`${block};globalThis.actions={executeUiErrorAction,renderUiError}`, sandbox);
const { renderUiError } = sandbox.actions;
const initialModel = (action) => ({
  title: 'Recoverable error', message: 'Choose an action.', severity: 'error',
  rawDetails: '{"requestId":"req-42"}', primaryAction: action,
  secondaryAction: { id: 'copy-details', label: 'Copy Details' },
});
function render(action, context = {}) {
  const container = new Element(); container.connect(true);
  renderUiError(initialModel(action), container, context);
  return { container, buttons: container.children.at(-1).children };
}

// Retry success: real renderer click awaits the promise and disables every action while in flight.
let releaseRetry;
const retryGate = new Promise((resolve) => { releaseRetry = resolve; });
const retryUi = render({ id: 'retry', label: 'Retry' }, { retry: () => retryGate });
const retryClick = retryUi.buttons[0].click();
assert.equal(retryUi.buttons.every((button) => button.disabled), true);
assert.equal(retryUi.buttons[0].attributes['aria-busy'], 'true');
releaseRetry(); await retryClick;
assert.equal(retryUi.buttons.every((button) => !button.disabled), true);
assert.equal('aria-busy' in retryUi.buttons[0].attributes, false);

// Resume success: click passes the exact snapshot run IDs and never creates a new ID.
let resumed;
const snapshot = { workflowContext: { roiArchivePlan: { baseRunId: 'roi-existing', vendors: [{ runId: 'roi-existing-rws' }] } } };
const resumeUi = render({ id: 'resume-archive', label: 'Resume Archive' }, { snapshot, resume: (value) => { resumed = value; } });
await resumeUi.buttons[0].click();
assert.equal(resumed.runId, 'roi-existing');
assert.deepEqual([...resumed.runIds], ['roi-existing-rws']);
// Repeated clicks must keep reusing the same stable Run ID instead of minting a new one.
await resumeUi.buttons[0].click();
assert.equal(resumed.runId, 'roi-existing');
assert.deepEqual([...resumed.runIds], ['roi-existing-rws']);

// Settings guidance: the rendered action opens Settings so the user can fill the Feishu Secret.
let settingsOpened = false;
const settingsUi = render({ id: 'open-settings', label: 'Open Settings' }, { openSettings: () => { settingsOpened = true; } });
await settingsUi.buttons[0].click();
assert.equal(settingsOpened, true);

// Headerless Sheet recovery: the action reveals and focuses the column mapping controls.
const layoutUi = render({ id: 'configure-sheet-layout', label: 'Configure Columns' }, { documentRef: document });
await layoutUi.buttons[0].click();
assert.equal(elements['working-sheet-details'].open, true);
assert.equal(elements['sheet-context-config'].removed, 'hidden');
assert.equal(elements['sheet-source-column'].focused, true);

// Copy Details success path writes the sanitized raw details to the clipboard.
let copied = '';
const copyUi = render({ id: 'retry', label: 'Retry' }, {
  retry: () => {}, clipboard: { writeText: async (text) => { copied = text; } },
});
await copyUi.buttons[1].click();
assert.equal(copied, '{"requestId":"req-42"}');

// Retry rejection: no rejection escapes click; same container shows sanitized recovery details.
const rejectedUi = render({ id: 'retry', label: 'Retry' }, {
  retry: async () => { throw { code: 'RETRY_FAILED', message: 'request failed token=top-secret', requestId: 'req-retry', token: 'top-secret' }; },
});
await assert.doesNotReject(() => rejectedUi.buttons[0].click());
const rejectedText = rejectedUi.container.children[2].children[1].textContent;
assert.match(rejectedText, /req-retry/);
assert.doesNotMatch(rejectedText, /top-secret/);
assert.equal(rejectedUi.container.children.at(-1).children[0].disabled, false);

// Clipboard failure is caught and converted to a visible, sanitized recoverable error.
const clipboardUi = render({ id: 'copy-details', label: 'Copy Details' }, {
  clipboard: { writeText: async () => { throw { message: 'clipboard denied secret=clip-secret', requestId: 'req-copy' }; } },
});
await assert.doesNotReject(() => clipboardUi.buttons[0].click());
const clipboardText = clipboardUi.container.children[2].children[1].textContent;
assert.match(clipboardText, /req-copy/);
assert.doesNotMatch(clipboardText, /clip-secret/);

// Missing snapshot is also caught; it remains user-triggered and does not recurse automatically.
const missingUi = render({ id: 'resume-archive', label: 'Resume Archive' }, { snapshot: {} });
await assert.doesNotReject(() => missingUi.buttons[0].click());
assert.match(missingUi.container.children[1].textContent, /unexpected error/i);
assert.equal(missingUi.container.children.at(-1).children[0].disabled, false);

console.log('popup-error-actions behavior tests: 9 scenarios passed');
