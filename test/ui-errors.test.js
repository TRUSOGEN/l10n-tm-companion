import assert from 'node:assert/strict';
import { sanitizeRawDetails, toUiError } from '../lib/ui-errors.js';

const cases = [
  ['storage quota', { code: 'QUOTA_BYTES', message: 'storage quota exceeded' }, {}, 'Storage is full', 'retry'],
  ['headerless Sheet', { code: 'SHEET_HEADER_MISSING', message: 'headerless sheet' }, {}, 'Spreadsheet headers required', 'configure-sheet-layout'],
  ['Secret missing', { code: 'FEISHU_SECRET_MISSING', message: 'secret missing' }, { operation: 'authorize' }, 'Feishu setup required', 'open-settings'],
  ['OAuth/Broker', { code: 'FEISHU_BROKER_ERROR', message: 'OAuth broker unavailable' }, {}, 'Feishu connection failed', 'retry'],
  ['word rate missing', { code: 'WORD_RATE_MISSING', message: 'word rate incomplete' }, {}, 'Word rate is incomplete', 'open-settings'],
  ['final TM failed', { code: 'FINAL_TM_FAILED', message: 'final TM query failed' }, {}, 'Final TM query failed', 'retry'],
  ['Starling credential', { code: 'STARLING_CREDENTIAL_MISSING', message: 'Starling credential missing' }, {}, 'Starling setup required', 'open-settings'],
  ['Starling timeout', { code: 'STARLING_TIMEOUT', message: 'Starling request timeout' }, {}, 'Starling request timed out', 'retry'],
  ['Starling rate limit', { code: 'STARLING_RATE_LIMIT', message: 'Starling rate limit exceeded' }, {}, 'Starling rate limit reached', 'retry'],
  ['partial archive', { code: 'PARTIAL_ARCHIVE_FAILED', message: 'archive partially failed' }, {}, 'Archive partially completed', 'resume-archive'],
];

for (const [name, error, context, title, actionId] of cases) {
  const model = toUiError(error, context);
  assert.deepEqual(Object.keys(model), ['title', 'message', 'primaryAction', 'secondaryAction', 'rawDetails', 'severity'], `${name}: six-field model`);
  assert.equal(model.title, title, `${name}: title`);
  assert.equal(model.primaryAction?.id, actionId, `${name}: recovery action`);
  assert.deepEqual(model.secondaryAction, { id: 'copy-details', label: 'Copy Details' }, `${name}: details action`);
}

const model = toUiError({ code: 'FEISHU_SECRET_MISSING', message: 'secret missing', requestId: 'req-42' }, { operation: 'authorize' });
assert.deepEqual(model.primaryAction, { id: 'open-settings', label: 'Open Settings' });

const details = sanitizeRawDetails({
  code: 'SERVER_E401',
  message: 'request failed',
  requestId: 'req-42',
  token: 'sensitive',
  secret: 'feishu-secret-value',
  ak: 'access-key-value',
  sk: 'secret-key-value',
});
assert.match(details, /req-42/);
assert.match(details, /SERVER_E401/);
assert.doesNotMatch(details, /sensitive|feishu-secret-value|access-key-value|secret-key-value/);

const unknown = toUiError(new Error('unexpected failure'));
assert.equal(unknown.severity, 'error');
assert.deepEqual(unknown.primaryAction, { id: 'retry', label: 'Retry' });
assert.match(unknown.rawDetails, /unexpected failure/);

console.log('ui-errors: all tests passed');
