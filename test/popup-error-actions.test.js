import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../popup.js', import.meta.url), 'utf8');
const block = source.slice(source.indexOf('export async function executeUiErrorAction'), source.indexOf('function showUiError'))
  .replaceAll('export ', '');

class Element {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.dataset = {}; this.className = ''; this.classList = { remove: (name) => { this.removed = name; } }; }
  append(...children) { this.children.push(...children); }
  replaceChildren() { this.children = []; }
  addEventListener(type, callback) { this.listener = callback; }
  focus() { this.focused = true; }
}
const elements = {
  'working-sheet-details': new Element('details'),
  'sheet-context-config': new Element(),
  'sheet-source-column': new Element('select'),
};
const document = { createElement: (tag) => new Element(tag), getElementById: (id) => elements[id] };
const sandbox = { document, navigator: {}, chrome: {}, ROI_WORKFLOW_SNAPSHOT_KEY: 'roiWorkflowSnapshot' };
vm.runInNewContext(`${block};globalThis.actions={executeUiErrorAction,renderUiError}`, sandbox);
const { executeUiErrorAction, renderUiError } = sandbox.actions;

let settingsOpened = false;
await executeUiErrorAction('open-settings', { openSettings: () => { settingsOpened = true; } });
assert.equal(settingsOpened, true);
await executeUiErrorAction('configure-sheet-layout', { documentRef: document });
assert.equal(elements['working-sheet-details'].open, true);
assert.equal(elements['sheet-context-config'].removed, 'hidden');
assert.equal(elements['sheet-source-column'].focused, true);
let retried = 0;
await executeUiErrorAction('retry', { retry: () => { retried += 1; } });
assert.equal(retried, 1);
let copied = '';
await executeUiErrorAction('copy-details', { rawDetails: '{"requestId":"req-42"}', clipboard: { writeText: async (text) => { copied = text; } } });
assert.equal(copied, '{"requestId":"req-42"}');
let resumed;
const snapshot = { workflowContext: { roiArchivePlan: { baseRunId: 'roi-existing', vendors: [{ runId: 'roi-existing-rws' }] } } };
await executeUiErrorAction('resume-archive', { snapshot, resume: (value) => { resumed = value; } });
assert.equal(resumed.runId, 'roi-existing');
assert.deepEqual([...resumed.runIds], ['roi-existing-rws']);
assert.equal(block.includes('createRoiArchiveRunId'), false);

const container = new Element();
renderUiError({ title: 'Archive partially completed', message: 'Resume safely.', severity: 'error', rawDetails: '{"requestId":"req-42"}', primaryAction: { id: 'resume-archive', label: 'Resume Archive' }, secondaryAction: { id: 'copy-details', label: 'Copy Details' } }, container, { snapshot, resume() {} });
assert.equal(container.children[0].textContent, 'Archive partially completed');
assert.equal(container.children.at(-1).children.length, 2);
console.log('popup-error-actions tests: 7 passed, 0 failed');
