import assert from 'node:assert/strict';
import { sanitizeRawDetails, toUiError } from '../lib/ui-errors.js';

const cases = [
  ['storage quota', { code: 'QUOTA_BYTES', message: 'storage quota exceeded', requestId: 'req-quota' }, {}, 'Storage is full', 'Chrome storage has reached its quota. Free some space, then try again.', 'retry', 'Retry'],
  ['headerless Sheet', { code: 'SHEET_HEADER_MISSING', message: 'headerless sheet', requestId: 'req-header' }, {}, 'Spreadsheet headers required', 'Add the required header row before continuing.', 'configure-sheet-layout', 'Configure Sheet Layout'],
  ['Secret missing', { code: 'FEISHU_SECRET_MISSING', message: 'secret missing', requestId: 'req-secret' }, { operation: 'authorize' }, 'Feishu setup required', 'Configure the Feishu Secret in Settings, then connect again.', 'open-settings', 'Open Settings'],
  ['OAuth/Broker', { code: 'FEISHU_BROKER_ERROR', message: 'OAuth broker unavailable', requestId: 'req-oauth' }, {}, 'Feishu connection failed', 'The authoritative Feishu connection failed. Try connecting again.', 'retry', 'Retry'],
  ['word rate missing', { code: 'WORD_RATE_MISSING', message: 'word rate incomplete', requestId: 'req-rate' }, {}, 'Word rate is incomplete', 'Configure the missing vendor word rate before archiving.', 'open-settings', 'Open Settings'],
  ['final TM failed', { code: 'FINAL_TM_FAILED', message: 'final TM query failed', requestId: 'req-tm' }, {}, 'Final TM query failed', 'Final TM must be queried successfully before ROI can be calculated.', 'retry', 'Retry'],
  ['Starling credential', { code: 'STARLING_CREDENTIAL_MISSING', message: 'Starling credential missing', requestId: 'req-starling-auth' }, {}, 'Starling setup required', 'Configure valid Starling credentials in Settings.', 'open-settings', 'Open Settings'],
  ['Starling timeout', { code: 'STARLING_TIMEOUT', message: 'Starling request timeout', requestId: 'req-timeout' }, {}, 'Starling request timed out', 'The Starling service did not respond in time. Try again.', 'retry', 'Retry'],
  ['Starling rate limit', { code: 'STARLING_RATE_LIMIT', message: 'Starling rate limit exceeded', requestId: 'req-limit' }, {}, 'Starling rate limit reached', 'Wait briefly, then retry the Starling request.', 'retry', 'Retry'],
  ['partial archive', { code: 'PARTIAL_ARCHIVE_FAILED', message: 'archive partially failed', requestId: 'req-archive' }, {}, 'Archive partially completed', 'Resume the same archive run to finish incomplete work.', 'resume-archive', 'Resume Archive'],
];

for (const [name, error, context, title, message, actionId, actionLabel] of cases) {
  const model = toUiError(error, context);
  assert.deepEqual(Object.keys(model), ['title', 'message', 'primaryAction', 'secondaryAction', 'rawDetails', 'severity'], `${name}: six-field model`);
  assert.equal(model.title, title, `${name}: title`);
  assert.equal(model.message, message, `${name}: message`);
  assert.deepEqual(model.primaryAction, { id: actionId, label: actionLabel }, `${name}: recovery action`);
  assert.deepEqual(model.secondaryAction, { id: 'copy-details', label: 'Copy Details' }, `${name}: details action`);
  assert.equal(model.severity, 'error', `${name}: severity`);
  assert.equal(typeof model.rawDetails, 'string', `${name}: rawDetails contract`);
  const parsedDetails = JSON.parse(model.rawDetails);
  assert.equal(parsedDetails.code, error.code, `${name}: rawDetails code`);
  assert.equal(parsedDetails.requestId, error.requestId, `${name}: rawDetails requestId`);
  assert.doesNotThrow(() => JSON.stringify(model), `${name}: serializable`);
}

const secrets = [
  'bearer-real-credential', 'quoted app secret', 'client-secret-real', 'access-token-real',
  'refresh-token-real', 'auth-token-real', 'ak-id-real', 'aws-secret-real', 'nested-secret',
  'access-key-id-camel-real', 'access-key-id-snake-real', 'access-key-id-kebab-real',
];
const stringDetails = sanitizeRawDetails({
  message: 'Authorization: Bearer bearer-real-credential; appSecret="quoted app secret" client_secret: client-secret-real, accessToken=access-token-real refreshToken: refresh-token-real authToken=auth-token-real akId: ak-id-real aws_secret_access_key="aws-secret-real"; accessKeyId=access-key-id-camel-real, access_key_id: access-key-id-snake-real; access-key-id="access-key-id-kebab-real"',
});
for (const secret of secrets) assert.doesNotMatch(stringDetails, new RegExp(secret), `redacts ${secret}`);
assert.match(stringDetails, /\[REDACTED\]/);

const structured = sanitizeRawDetails({
  appSecret: 'quoted app secret',
  client_secret: 'client-secret-real',
  'access-token': 'access-token-real',
  children: [{ refreshToken: 'refresh-token-real' }, { nested: { auth_token: 'auth-token-real', akId: 'ak-id-real', secretAccessKey: 'nested-secret' } }],
  accessKeyId: 'access-key-id-camel-real',
  access_key_id: 'access-key-id-snake-real',
  'access-key-id': 'access-key-id-kebab-real',
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
