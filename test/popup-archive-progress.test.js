import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderArchiveProgress } from '../lib/archive-progress.js';

const html = fs.readFileSync(new URL('../popup.html', import.meta.url), 'utf8');
const popup = fs.readFileSync(new URL('../popup.js', import.meta.url), 'utf8');
for (const id of ['roi-archive-progress', 'archive-progress-live', 'archive-progress-phase', 'archive-progress-operations', 'archive-progress-languages', 'archive-progress-requests', 'archive-progress-elapsed', 'archive-progress-eta']) {
  assert.match(html, new RegExp(`id=["']${id}["']`));
}
assert.match(html, /aria-live="polite"/);
assert.match(html, /role="progressbar"/);
assert.match(popup, /renderArchiveProgress\(archiveProgressState, archiveProgressElements\(\)\)/);

// Execute the exact renderer imported by production, rather than only checking source strings.
const node = () => ({ textContent: '', style: {}, classList: { remove() {} }, setAttribute(name, value) { this[name] = value; } });
const elements = Object.fromEntries(['root', 'live', 'phase', 'operations', 'languages', 'requests', 'elapsed', 'eta', 'progressbar'].map((key) => [key, node()]));
renderArchiveProgress({ phase: 'Final TM (C)', activeOperations: ['A', 'C'], completedLanguages: 7, totalLanguages: 56, completedRequests: 14, estimatedRequests: 112, elapsedMs: 5000, etaMs: null, percent: 12.5 }, elements);
assert.equal(elements.operations.textContent, 'A + C');
assert.equal(elements.languages.textContent, '7/56');
assert.equal(elements.requests.textContent, '14/112');
assert.equal(elements.eta.textContent, 'Estimating time');
assert.equal(elements.progressbar['aria-valuenow'], '13');
console.log('popup archive progress tests passed');
