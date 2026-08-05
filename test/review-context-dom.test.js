import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'popup.css'), 'utf8');

function indexOfId(id) { return html.indexOf(`id="${id}"`); }

test('Review DOM has one collapsed context tray before filters and results', () => {
  const detailsTag = html.match(/<details id="review-context"[^>]*>/)?.[0] || '';
  assert.ok(detailsTag && !/\sopen(?:\s|=|>)/.test(detailsTag), 'context details defaults collapsed');
  assert.ok(indexOfId('review-context') < indexOfId('review-filter'));
  assert.ok(indexOfId('review-filter') < indexOfId('results'));
  assert.ok(indexOfId('results') < indexOfId('btn-confirm-remaining'));
  assert.equal((html.match(/A<\/strong> is the original baseline/g) || []).length, 1, 'full methodology appears globally once');
  for (const id of ['review-context-summary', 'review-context-coverage', 'review-context-explanations', 'review-context-incomplete', 'review-context-destination']) {
    assert.ok(indexOfId(id) > indexOfId('review-context'), `${id} belongs to context tray`);
  }
});

test('Review CSS contracts cover keyboard focus, 44px targets, wrapping, and 375px containment', () => {
  assert.match(css, /\.review-context > summary:focus-visible\s*\{[^}]*outline:/s);
  assert.match(css, /\.review-context > summary\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /\.results-footer \.btn\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /\.review-context-path\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(css, /@media \(max-width:\s*375px\)/);
});
