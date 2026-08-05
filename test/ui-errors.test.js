import assert from 'node:assert/strict';
import { sanitizeRawDetails, toUiError } from '../lib/ui-errors.js';

const cases = [
  ['storage quota', { code: 'QUOTA_BYTES', message: 'storage quota exceeded' }, {}, 'Storage is full', 'retry', 'Retry'],
  ['headerless Sheet', { code: 'SHEET_HEADER_MISSING', message: 'headerless sheet' }, {}, 'Spreadsheet headers required', 'configure-sheet-layout', 'Configure Sheet Layout'],
  ['Secret missing', { code: 'FEISHU_SECRET_MISSING', message: 'secret missing' }, { operation: 'authorize' }, 'Feishu setup required', 'open-settings', 'Open Settings'],
  ['OAuth/Broker', { code: 'FEISHU_BROKER_ERROR', message: 'OAuth broker unavailable' }, {}, 'Feishu connection failed', 'retry', 'Retry'],
  ['word rate missing', { code: 'WORD_RATE_MISSING', message: 'word rate incomplete' }, {}, 'Word rate is incomplete', 'open-settings', 'Open Settings'],
  ['final TM failed', { code: 'FINAL_TM_FAILED', message: 'final TM query failed' }, {}, 'Final TM query failed', 'retry', 'Retry'],
  ['Starling credential', { code: 'STARLING_CREDENTIAL_MISSING', message: 'Starling credential missing' }, {}, 'Starling setup required', 'open-settings', 'Open Settings'],
  ['Starling timeout', { code: 'STARLING_TIMEOUT', message: 'Starling request timeout' }, {}, 'Starling request timed out', 'retry', 'Retry'],
  ['Starling rate limit', { code: 'STARLING_RATE_LIMIT', message: 'Starling rate limit exceeded' }, {}, 'Starling rate limit reached', 'retry', 'Retry'],
  ['partial archive', { code: 'PARTIAL_ARCHIVE_FAILED', message: 'archive partially failed' }, {}, 'Archive partially completed', 'resume-archive', 'Resume Archive'],
];

for (const [name, error, context, title, actionId, actionLabel] of cases) {
  const model = toUiError(error, context);
  assert.deepEqual(Object.keys(model), ['title', 'message', 'primaryAction', 'secondaryAction', 'rawDetails', 'severity'], `${name}: six-field model`);
  assert.equal(model.title, title, `${name}: title`);
  assert.deepEqual(model.primaryAction, { id: actionId, label: actionLabel }, `${name}: recovery action`);
  assert.deepEqual(model.secondaryAction, { id: 'copy-details', label: 'Copy Details' }, `${name}: details action`);
  assert.equal(model.severity, 'error', `${name}: severity`);
  assert.doesNotThrow(() => JSON.stringify(model), `${name}: serializable`);
}

const secrets = [
  'bearer-real-credential', 'quoted app secret', 'client-secret-real', 'access-token-real',
  'refresh-token-real', 'auth-token-real', 'ak-id-real', 'aws-secret-real', 'nested-secret',
];
const stringDetails = sanitizeRawDetails({
  message: 'Authorization: Bearer bearer-real-credential; appSecret="quoted app secret" client_secret: client-secret-real, accessToken=access-token-real refreshToken: refresh-token-real authToken=auth-token-real akId: ak-id-real aws_secret_access_key="aws-secret-real"',
});
for (const secret of secrets.slice(0, 8)) assert.doesNotMatch(stringDetails, new RegExp(secret), `redacts ${secret}`);
assert.match(stringDetails, /\[REDACTED\]/);

const structured = sanitizeRawDetails({
  appSecret: 'quoted app secret',
  client_secret: 'client-secret-real',
  'access-token': 'access-token-real',
  children: [{ refreshToken: 'refresh-token-real' }, { nested: { auth_token: 'auth-token-real', akId: 'ak-id-real', secretAccessKey: 'nested-secret' } }],
});
for (const secret of secrets) assert.doesNotMatch(structured, new RegExp(secret), `structured redacts ${secret}`);

const cause = new Error('Authorization: Bearer cause-bearer-secret');
cause.clientSecret = 'cause-client-secret';
const error = new Error('request failed');
error.name = 'RemoteRequestError';
error.code = 'SERVER_E401';
error.requestId = 'req-42';
error.cause = cause;
error.metadata = { accessToken: 'extension-token', safe: 'diagnostic' };
error.self = error;
const details = sanitizeRawDetails(error);
assert.match(details, /RemoteRequestError|request failed/);
assert.match(details, /req-42/);
assert.match(details, /SERVER_E401/);
assert.match(details, /diagnostic/);
assert.match(details, /\[Circular\]/);
assert.doesNotMatch(details, /cause-bearer-secret|cause-client-secret|extension-token/);
assert.doesNotThrow(() => JSON.parse(details));

const cyclic = { requestId: 'cyclic-request', client_secret: 'cyclic-secret' };
cyclic.items = [cyclic, { authorization: 'Bearer nested-bearer-secret' }];
const cyclicDetails = sanitizeRawDetails(cyclic);
assert.match(cyclicDetails, /cyclic-request/);
assert.match(cyclicDetails, /\[Circular\]/);
assert.doesNotMatch(cyclicDetails, /cyclic-secret|nested-bearer-secret/);
assert.doesNotThrow(() => JSON.parse(cyclicDetails));

const unknown = toUiError(new Error('unexpected failure'));
assert.deepEqual(Object.keys(unknown), ['title', 'message', 'primaryAction', 'secondaryAction', 'rawDetails', 'severity']);
assert.equal(unknown.severity, 'error');
assert.deepEqual(unknown.primaryAction, { id: 'retry', label: 'Retry' });
assert.deepEqual(unknown.secondaryAction, { id: 'copy-details', label: 'Copy Details' });
assert.match(unknown.rawDetails, /unexpected failure/);

console.log('ui-errors: all tests passed');
