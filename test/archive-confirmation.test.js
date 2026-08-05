import assert from 'node:assert/strict';
import { createArchiveConfirmationController, confirmThenRunArchive } from '../lib/archive-confirmation.js';

class FakeClassList {
  constructor(...values) { this.values = new Set(values); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
}
class FakeElement {
  constructor(documentRef, id) {
    this.ownerDocument = documentRef;
    this.id = id;
    this.classList = new FakeClassList(id === 'dialog' ? 'hidden' : '');
    this.listeners = new Map();
    this.textContent = '';
    this.focusCount = 0;
  }
  focus() { this.ownerDocument.activeElement = this; this.focusCount += 1; }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  removeEventListener(type, fn) { if (this.listeners.get(type) === fn) this.listeners.delete(type); }
  emit(type, event = {}) { this.listeners.get(type)?.({ preventDefault() { event.prevented = true; }, ...event }); }
  querySelectorAll() { return this.controls || []; }
}
function fixture() {
  const documentRef = { activeElement: null };
  const dialog = new FakeElement(documentRef, 'dialog');
  const cancel = new FakeElement(documentRef, 'cancel');
  const start = new FakeElement(documentRef, 'start');
  dialog.controls = [cancel, start];
  const fields = Object.fromEntries(['sources', 'confirmed', 'languages', 'coverage', 'requests', 'duration'].map((key) => [key, new FakeElement(documentRef, key)]));
  const trigger = new FakeElement(documentRef, 'trigger');
  documentRef.activeElement = trigger;
  const controller = createArchiveConfirmationController({ documentRef, dialog, cancel, start, fields, trigger });
  return { documentRef, dialog, cancel, start, trigger, controller };
}
const summary = { sourceRowCount: 100, confirmedRowCount: 80, languageCount: 56, vendorCoverage: { RWS: 20, Pactera: 35, unpriced: 1 }, estimatedTmRequests: { original: 168, final: 168, total: 336 }, estimatedDuration: { minSeconds: 336, maxSeconds: 1008 } };

{
  const f = fixture();
  const result = f.controller.open(summary);
  assert.equal(f.start.focusCount, 1, 'open focuses Start');
  f.dialog.emit('keydown', { key: 'Tab' });
  assert.equal(f.documentRef.activeElement, f.cancel, 'Tab wraps last to first');
  f.dialog.emit('keydown', { key: 'Tab', shiftKey: true });
  assert.equal(f.documentRef.activeElement, f.start, 'Shift+Tab wraps first to last');
  f.dialog.emit('keydown', { key: 'Escape' });
  assert.equal(await result, false);
  assert.equal(f.trigger.focusCount, 1, 'Escape returns trigger focus');
}
{
  const f = fixture(); const result = f.controller.open(summary); f.cancel.emit('click');
  assert.equal(await result, false); assert.equal(f.trigger.focusCount, 1, 'Cancel returns trigger focus');
}
{
  const f = fixture(); const result = f.controller.open(summary); f.start.emit('click');
  assert.equal(await result, true); assert.equal(f.trigger.focusCount, 1, 'Start returns trigger focus');
}
for (const action of ['cancel', 'escape', 'start']) {
  const f = fixture(); let calls = 0;
  const promise = confirmThenRunArchive({ controller: f.controller, summary, runtime: async () => { calls += 1; } });
  if (action === 'cancel') f.cancel.emit('click');
  if (action === 'escape') f.dialog.emit('keydown', { key: 'Escape' });
  if (action === 'start') f.start.emit('click');
  await promise;
  assert.equal(calls, action === 'start' ? 1 : 0, `${action} runtime calls`);
}
console.log('archive-confirmation behavior tests passed');
