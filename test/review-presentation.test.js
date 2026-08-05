import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReviewPresentation, numericOrNull } from '../lib/review-workflow.js';
import { createReviewPresentationElement } from '../lib/review-presentation-view.js';
import { buildVendorRoutes, formatVendorCoverage } from '../lib/archive-summary.js';
import { deriveVendorRoiResults } from '../lib/multilingual-roi.js';

class FakeElement {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.className = ''; this.textContent = ''; this.attributes = {}; }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  querySelector(selector) {
    if (selector.startsWith('.')) return this.walk().find((node) => node.className.split(' ').includes(selector.slice(1))) || null;
    return null;
  }
  walk() { return [this, ...this.children.flatMap((node) => node.walk())]; }
}
const documentRef = { createElement: (tag) => new FakeElement(tag) };

test('official saving is strictly A minus C and B is explanatory only', () => {
  const model = buildReviewPresentation({ original: { score: 55, cost: 12 }, ai: { score: 99, cost: -1000 }, final: { score: 80, cost: 7 } });
  assert.deepEqual(model.rail.map(({ key, score }) => ({ key, score })), [{ key: 'A', score: 55 }, { key: 'B', score: 99 }, { key: 'C', score: 80 }]);
  assert.equal(model.officialSaving, 5);
});

test('renderer exposes warning role and official A-C amount', () => {
  const model = buildReviewPresentation({ original: { score: 80, cost: 4 }, ai: { score: 99, cost: -99 }, final: { score: 70, cost: 9 } });
  const view = createReviewPresentationElement(documentRef, model);
  assert.equal(view.dataset.tone, 'warning');
  assert.equal(view.querySelector('.review-saving').textContent, 'Official A−C saving: −$5.00');
  assert.equal(view.querySelector('.review-explanation').textContent, model.explanation);
  assert.equal(view.attributes.role, 'status');
});

test('safe no-uplift and rejected candidate explanations render in shared view', () => {
  const safe = buildReviewPresentation({ original: { score: 70, cost: 8 }, ai: { score: 70 }, final: { score: 70, cost: 8 }, candidateSafety: { safe: true } });
  assert.equal(safe.headline, 'Safe rewrite available');
  assert.match(createReviewPresentationElement(documentRef, safe).querySelector('.review-explanation').textContent, /not auto-applied/);
  const rejected = buildReviewPresentation({ original: { score: 70 }, candidateSafety: { safe: false, reason: 'protected tokens changed' }, final: {} });
  assert.match(createReviewPresentationElement(documentRef, rejected).querySelector('.review-explanation').textContent, /protected tokens changed/);
});

test('production coverage comes from real dual-vendor routes, not one vendor summary', () => {
  const catalog = {
    schema_version: 1,
    vendors: {
      RWS: [{ source_locale: 'en', target_locale: 'fr', source_language: 'English', target_language: 'French', provenance: 'test', hourly_rate_usd: 30, aipe_usd_per_1000_words: 60, t_only_usd_per_1000_words: 120 }],
      Pactera: [{ source_locale: 'en', target_locale: 'ja', source_language: 'English', target_language: 'Japanese', provenance: 'test', hourly_rate_usd: 25, aipe_usd_per_1000_words: 50, t_only_usd_per_1000_words: 100 }],
    },
  };
  const scopeRuns = [
    { scope: { key: 'fr', sourceLocale: 'en', targetLocale: 'fr' }, items: [{ similarity: 70, review_status: 'confirmed', final_tm: { status: 'complete', score: 90 }, word_count: 10, final_source_text: 'x' }] },
    { scope: { key: 'ja', sourceLocale: 'en', targetLocale: 'ja' }, items: [{ similarity: 60, word_count: 10 }] },
    { scope: { key: 'de', sourceLocale: 'en', targetLocale: 'de' }, items: [{ similarity: 55, word_count: 10 }] },
  ];
  const vendorResults = deriveVendorRoiResults(scopeRuns, catalog, ['RWS', 'Pactera']);
  const routes = buildVendorRoutes({ plannedScopes: scopeRuns.map((run) => run.scope), vendorResults });
  const coverage = formatVendorCoverage({ routes });
  assert.equal(coverage.counts.RWS, 1);
  assert.equal(coverage.counts.Pactera, 1);
  assert.equal(coverage.counts.unpriced, 1, 'de is served by neither vendor and stays unpriced');
  assert.equal(coverage.incomplete, true, 'ja has no confirmed final score yet');
  assert.match(coverage.explanations.join(' '), /routed outside vendor pricing/);
  assert.doesNotThrow(() => formatVendorCoverage({ routes: routes.filter((route) => route.served === false) }));
});

test('production numeric adapter preserves missing and non-finite amounts as null', () => {
  assert.equal(numericOrNull(null), null);
  assert.equal(numericOrNull(undefined), null);
  assert.equal(numericOrNull(Number.NaN), null);
  assert.equal(numericOrNull(Number.POSITIVE_INFINITY), null);
  assert.equal(numericOrNull('12.5'), 12.5);
  assert.equal(numericOrNull(0), 0);
});

test('renderer reports pending confirmed C when A/C amount is missing and never invents $0.00', () => {
  const model = buildReviewPresentation({
    original: { score: 70, cost: numericOrNull(null) },
    ai: { score: 75 },
    final: { score: null, cost: numericOrNull(undefined) },
    candidateSafety: { safe: true },
  });
  assert.equal(model.officialSaving, null);
  const view = createReviewPresentationElement(documentRef, model);
  assert.equal(view.querySelector('.review-saving').textContent, 'Official A−C saving: pending confirmed C');
  assert.doesNotMatch(view.querySelector('.review-saving').textContent, /\$0\.00/);
});
