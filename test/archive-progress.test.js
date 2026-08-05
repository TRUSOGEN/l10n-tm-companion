import assert from 'node:assert/strict';
import { createArchiveProgress, renderArchiveProgress, updateArchiveProgress } from '../lib/archive-progress.js';

let state = createArchiveProgress({ estimatedRequests: 10, totalLanguages: 5, startedAt: 1000 });
assert.equal(state.percent, 0);
assert.equal(state.etaMs, null);

state = updateArchiveProgress(state, { phase: 'Original TM (A)', completedRequests: 4, completedLanguages: 2, activeOperations: ['A', 'C'], sampleDurationMs: 100 }, 1100);
assert.deepEqual(state.activeOperations, ['A', 'C']);
assert.equal(state.etaMs, null, 'fewer than three samples must not produce ETA');
const progressed = state;
state = updateArchiveProgress(state, { completedRequests: 2, completedLanguages: 1, sampleDurationMs: 200 }, 1200);
assert.equal(state.completedRequests, 4, 'out-of-order completion must not regress');
assert.equal(state.percent, progressed.percent, 'percent must not regress');
state = updateArchiveProgress(state, { completedRequests: 5, sampleDurationMs: 300 }, 1300);
assert.equal(state.etaMs, 1000);
for (let duration = 400; duration <= 1000; duration += 100) {
  state = updateArchiveProgress(state, { sampleDurationMs: duration }, 1300 + duration);
}
assert.equal(state.samples.length, 8);
assert.deepEqual(state.samples, [300, 400, 500, 600, 700, 800, 900, 1000]);
state = updateArchiveProgress(state, { phase: 'Complete' }, 3000);
assert.equal(state.percent, 100);
assert.equal(state.etaMs, 0);

function element() {
  return {
    textContent: '',
    style: {},
    attrs: {},
    classList: { remove(value) { this.removed = value; } },
    setAttribute(name, value) { this.attrs[name] = value; },
  };
}
const elements = Object.fromEntries(['root', 'live', 'phase', 'operations', 'languages', 'requests', 'elapsed', 'eta', 'progressbar'].map((key) => [key, element()]));
renderArchiveProgress(state, elements);
assert.equal(elements.progressbar.attrs['aria-valuenow'], '100');
assert.match(elements.live.textContent, /Complete/);
assert.equal(elements.root.classList.removed, 'hidden');
console.log('archive-progress tests passed');
