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

// Real product credential field names must be redacted by sensitive-root matching,
// not by an exact allowlist of key spellings.
const productSecrets = {
  feishuAppSecret: 'feishu-app-secret-real',
  feishuAppSecretBackup: 'feishu-app-secret-backup-real',
  starlingSecretKey: 'starling-secret-key-real',
  starlingAccessKey: 'starling-access-key-real',
  starlingAccessKeyId: 'starling-access-key-id-real',
  appSecret: 'app-secret-real',
  client_secret: 'client-secret-value-real',
  accessToken: 'access-token-value-real',
  refreshToken: 'refresh-token-value-real',
  authToken: 'auth-token-value-real',
  access_key_id: 'access-key-id-value-real',
  llmApiKey: 'llm-api-key-real',
  userAccessToken: 'user-access-token-real',
  brokerCredential: 'broker-credential-real',
  keychainPassword: 'keychain-password-real',
};
const productDetails = sanitizeRawDetails({
  code: 'FEISHU_BROKER_ERROR',
  requestId: 'req-product',
  ...productSecrets,
  nested: { settings: { ...productSecrets } },
});
for (const [key, value] of Object.entries(productSecrets)) {
  assert.doesNotMatch(productDetails, new RegExp(value), `product field ${key} redacted`);
}
assert.match(productDetails, /req-product/);
assert.match(productDetails, /FEISHU_BROKER_ERROR/);
assert.doesNotThrow(() => JSON.parse(productDetails));

// JSON-shaped payloads embedded in error messages must also be redacted.
const jsonPayloadDetails = sanitizeRawDetails({
  requestId: 'req-json',
  message: 'upstream rejected body {"access_key":"json-access-key-real","secret_key": "json-secret-key-real", "feishuAppSecret":"json-feishu-secret-real", "user_access_token" : "json-user-token-real", "safeField":"keep-this-value"}',
});
for (const leak of ['json-access-key-real', 'json-secret-key-real', 'json-feishu-secret-real', 'json-user-token-real']) {
  assert.doesNotMatch(jsonPayloadDetails, new RegExp(leak), `json payload redacts ${leak}`);
}
assert.match(jsonPayloadDetails, /keep-this-value/, 'json payload keeps non-sensitive fields');
assert.match(jsonPayloadDetails, /req-json/);

// Credential-shaped values are redacted even without a recognizable key name.
const shapeDetails = sanitizeRawDetails({
  requestId: 'req-shape',
  message: 'call failed for AKLTZmFrZUFjY2Vzc0tleUlk1234 using Bearer eyJhbGciOiJIUzI1NiJ9.abcdefghijklmno.signature-part',
  note: 'retry hint: AKLTanotherFakeAccessKeyId9876',
});
assert.doesNotMatch(shapeDetails, /AKLTZmFrZUFjY2Vzc0tleUlk1234/, 'AKLT-prefixed value redacted');
assert.doesNotMatch(shapeDetails, /AKLTanotherFakeAccessKeyId9876/, 'AKLT value redacted in any field');
assert.doesNotMatch(shapeDetails, /eyJhbGciOiJIUzI1NiJ9/, 'bare Bearer value redacted');
assert.match(shapeDetails, /req-shape/);
assert.doesNotThrow(() => JSON.parse(shapeDetails));

// Locale awareness: zh-CN 用户看到中文标题/说明，action ID 与脱敏行为保持不变。
const localizedSecret = toUiError(
  { code: 'FEISHU_SECRET_MISSING', message: 'secret missing', requestId: 'req-zh' },
  { operation: 'authorize', locale: 'zh-CN' },
);
assert.deepEqual(Object.keys(localizedSecret), ['title', 'message', 'primaryAction', 'secondaryAction', 'rawDetails', 'severity']);
assert.match(localizedSecret.title, /飞书/, 'zh-CN 标题必须本地化');
assert.match(localizedSecret.message, /Settings|设置/, 'zh-CN 说明必须指向 Settings');
assert.match(localizedSecret.message, /Secret/, 'zh-CN 说明保留 Secret 术语');
assert.deepEqual(localizedSecret.primaryAction, { id: 'open-settings', label: '打开 Settings' });
assert.deepEqual(localizedSecret.secondaryAction, { id: 'copy-details', label: '复制详情' });
assert.match(localizedSecret.rawDetails, /req-zh/, '本地化不影响脱敏详情');

const localizedUnknown = toUiError(new Error('unexpected failure'), { locale: 'zh-CN' });
assert.notEqual(localizedUnknown.title, 'Something went wrong');
assert.deepEqual(localizedUnknown.primaryAction, { id: 'retry', label: '重试' });

// 未知/缺省 locale 一律回退英文，既有契约不变。
for (const locale of [undefined, 'en', 'fr-FR']) {
  const fallback = toUiError({ code: 'PARTIAL_ARCHIVE_FAILED', message: 'archive partially failed' }, { locale });
  assert.equal(fallback.title, 'Archive partially completed', `locale ${locale} 回退英文标题`);
  assert.deepEqual(fallback.primaryAction, { id: 'resume-archive', label: 'Resume Archive' });
}

// 每条规则都必须有完整中文映射，避免半中半英。
const ruleCodes = ['QUOTA_BYTES', 'SHEET_HEADER_MISSING', 'FEISHU_SECRET_MISSING', 'FEISHU_BROKER_ERROR',
  'WORD_RATE_MISSING', 'FINAL_TM_FAILED', 'STARLING_CREDENTIAL_MISSING', 'STARLING_TIMEOUT',
  'STARLING_RATE_LIMIT', 'PARTIAL_ARCHIVE_FAILED'];
for (const code of ruleCodes) {
  const english = toUiError({ code, message: code });
  const zh = toUiError({ code, message: code }, { locale: 'zh-CN' });
  assert.notEqual(english.title, 'Something went wrong', `${code} 必须命中规则`);
  assert.doesNotMatch(zh.title, /^[\x20-\x7F]+$/, `${code} 必须有中文标题`);
  assert.doesNotMatch(zh.message, /^[\x20-\x7F]+$/, `${code} 必须有中文说明`);
  assert.equal(zh.primaryAction.id, english.primaryAction.id, `${code} action ID 与语言无关`);
}

const unknown = toUiError(new Error('unexpected failure'));
assert.deepEqual(Object.keys(unknown), ['title', 'message', 'primaryAction', 'secondaryAction', 'rawDetails', 'severity']);
assert.equal(unknown.severity, 'error');
assert.deepEqual(unknown.primaryAction, { id: 'retry', label: 'Retry' });
assert.deepEqual(unknown.secondaryAction, { id: 'copy-details', label: 'Copy Details' });
assert.match(unknown.rawDetails, /unexpected failure/);

console.log('ui-errors: all tests passed');
