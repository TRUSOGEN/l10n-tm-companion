import assert from 'node:assert/strict';
import { createArchiveProgress, renderArchiveProgress, updateArchiveProgress } from '../lib/archive-progress.js';

let state = createArchiveProgress({ estimatedRequests: 10, totalLanguages: 5, startedAt: 1000 });
assert.equal(state.percent, 0);
assert.equal(state.etaMs, null);
state = updateArchiveProgress(state, { phase: 'Original TM (A)', completedRequests: 4, completedLanguages: 2, activeOperations: ['A', 'C'], sampleDurationMs: 100 }, 1100);
assert.deepEqual(state.activeOperations, ['A', 'C']);
assert.equal(state.etaMs, null);
const progressed = state;
state = updateArchiveProgress(state, { completedRequests: 2, completedLanguages: 1, sampleDurationMs: 200 }, 1200);
assert.equal(state.completedRequests, 4);
assert.equal(state.percent, progressed.percent);
state = updateArchiveProgress(state, { completedRequests: 5, sampleDurationMs: 300 }, 1300);
assert.equal(state.etaMs, 1000);
for (let duration = 400; duration <= 1000; duration += 100) state = updateArchiveProgress(state, { sampleDurationMs: duration }, 1300 + duration);
assert.deepEqual(state.samples, [300, 400, 500, 600, 700, 800, 900, 1000]);

// Out-of-order concurrent A/C events cannot regress phase or reactivate operations after TM.
state = updateArchiveProgress(state, { phase: 'Final TM (C)', activeOperations: ['A', 'C'] }, 2400);
state = updateArchiveProgress(state, { phase: 'Original TM (A)', activeOperations: ['A'] }, 2500);
assert.equal(state.phase, 'Final TM (C)');
assert.deepEqual(state.activeOperations, ['A']);
state = updateArchiveProgress(state, { phase: 'Calculating ROI' }, 2600);
state = updateArchiveProgress(state, { phase: 'Final TM (C)', activeOperations: ['A', 'C'] }, 2700);
assert.equal(state.phase, 'Calculating ROI');
assert.deepEqual(state.activeOperations, []);

// 100 rows / batch 40 means three requests per operation. A 300ms scope sample is 100ms/request,
// so ETA multiplies by remaining requests exactly once rather than by batch count twice.
let batched = createArchiveProgress({ estimatedRequests: 6, totalLanguages: 1, startedAt: 0 });
batched = updateArchiveProgress(batched, { completedRequests: 1, sampleDurationMs: 300, sampleRequestCount: 3 }, 300);
batched = updateArchiveProgress(batched, { completedRequests: 2, sampleDurationMs: 300, sampleRequestCount: 3 }, 600);
batched = updateArchiveProgress(batched, { completedRequests: 3, sampleDurationMs: 300, sampleRequestCount: 3 }, 900);
assert.deepEqual(batched.samples, [100, 100, 100]);
assert.equal(batched.etaMs, 300);

state = updateArchiveProgress(state, { phase: 'Complete' }, 3000);
assert.equal(state.percent, 100);
assert.equal(state.etaMs, 0);
function element() {
  return { textContent: '', style: {}, attrs: {}, classList: { remove(value) { this.removed = value; } }, setAttribute(name, value) { this.attrs[name] = value; } };
}
const elements = Object.fromEntries(['root', 'live', 'phase', 'operations', 'languages', 'requests', 'elapsed', 'eta', 'progressTrack', 'progressFill'].map((key) => [key, element()]));
renderArchiveProgress(state, elements);
assert.equal(elements.progressTrack.attrs['aria-valuenow'], '100');
assert.equal(elements.progressTrack.style.width, undefined, 'ARIA track width must not be mutated');
assert.equal(elements.progressFill.style.width, undefined, 'progress motion must not animate layout width');
assert.equal(elements.progressFill.style.transform, 'scaleX(1)', 'visual fill uses compositor-only transform');
assert.match(elements.live.textContent, /Complete/);
console.log('archive-progress tests passed');
