import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReviewContextModel, renderReviewContext } from '../lib/review-context-view.js';

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach((value) => this.values.add(value)); }
  remove(...values) { values.forEach((value) => this.values.delete(value)); }
  contains(value) { return this.values.has(value); }
}
class FakeElement {
  constructor(id = '') { this.id = id; this.textContent = ''; this.innerHTML = ''; this.open = false; this.classList = new FakeClassList(); }
}
function fakeDocument() {
  const ids = ['review-context', 'review-context-summary', 'review-context-coverage', 'review-context-incomplete', 'review-context-destination'];
  const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement(id)]));
  return { elements, getElementById: (id) => elements[id] || null };
}

test('context model produces compact dynamic vendor and destination summary', () => {
  const model = buildReviewContextModel({
    coverage: { counts: { RWS: 3, Pactera: 2, unpriced: 1 }, incomplete: true, incompleteCount: 2 },
    destination: { type: 'Spreadsheet (Sheet)', location: 'rows 12-27', fullPath: 'Spreadsheet (Sheet) / very-long-token / sheet-id / rows 12-27' },
  });
  assert.equal(model.summary, 'A→B→C · RWS 3 · Pactera 2 · Unpriced 1 · Spreadsheet (Sheet)/rows 12-27');
  assert.match(model.incomplete, /2 served scope/);
});

test('details stays collapsed by default and updates structured details without duplicating methodology', () => {
  const documentRef = fakeDocument();
  const model = buildReviewContextModel({
    coverage: { counts: { RWS: 8, Pactera: 5, unpriced: 0 }, incomplete: false },
    destination: { type: 'Bitable', location: '100 items', fullPath: 'Bitable / token / table / 100 items' },
  });
  renderReviewContext(documentRef, model);
  assert.equal(documentRef.elements['review-context'].open, false);
  assert.equal(documentRef.elements['review-context-summary'].textContent, model.summary);
  assert.equal(documentRef.elements['review-context-coverage'].textContent, 'RWS 8 · Pactera 5 · Unpriced 0');
  assert.equal(documentRef.elements['review-context-destination'].textContent, model.destination.fullPath);
});
