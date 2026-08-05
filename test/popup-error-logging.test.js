import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { toUiError } from '../lib/ui-errors.js';

const source = fs.readFileSync(new URL('../popup.js', import.meta.url), 'utf8');

// Behaviour 1: popup owns a single sanitized logging exit and actually uses it.
const block = source
  .slice(source.indexOf('export function logSanitizedError'), source.indexOf('function showUiError'))
  .replaceAll('export ', '');
const sandbox = { toUiError };
vm.runInNewContext(`${block};globalThis.exported={logSanitizedError}`, sandbox);
const { logSanitizedError } = sandbox.exported;

const calls = [];
const logger = { warn: (...args) => calls.push(args) };
const archiveError = new Error('archive write failed for feishuAppSecret=feishu-secret-real');
archiveError.code = 'PARTIAL_ARCHIVE_FAILED';
archiveError.requestId = 'req-archive-log';
archiveError.starlingSecretKey = 'starling-secret-real';
archiveError.metadata = { userAccessToken: 'user-token-real', locale: 'de-DE' };

logSanitizedError('ROI archive / Feishu authorization failed.', archiveError, logger);

assert.equal(calls.length, 1, 'logs exactly once');
const [[scope, payload]] = calls;
assert.equal(scope, 'ROI archive / Feishu authorization failed.');
assert.equal(typeof payload, 'string', 'logs a sanitized string, never the raw error object');
assert.equal(payload, toUiError(archiveError).rawDetails, 'logs toUiError(error).rawDetails');
for (const leak of ['feishu-secret-real', 'starling-secret-real', 'user-token-real']) {
  assert.doesNotMatch(payload, new RegExp(leak), `log payload redacts ${leak}`);
}
assert.match(payload, /req-archive-log/, 'log payload keeps the Request ID');
assert.match(payload, /PARTIAL_ARCHIVE_FAILED/, 'log payload keeps the error code');
assert.match(payload, /de-DE/, 'log payload keeps non-sensitive diagnostics');
assert.doesNotThrow(() => JSON.parse(payload), 'log payload stays machine readable');

// Behaviour 2: no console call in popup.js may receive a raw error/exception value.
const consoleCalls = source.match(/console\.(?:warn|error|log|debug|info)\([^\n]*\)/g) || [];
const leaking = consoleCalls.filter((call) => /\b\w*(?:error|err|exception|reason)\b\s*[,)]/i.test(call)
  && !/rawDetails/.test(call));
assert.deepEqual(leaking, [], `console calls must not receive raw errors: ${leaking.join(' | ')}`);

console.log('popup-error-logging tests: 12 assertions passed');
