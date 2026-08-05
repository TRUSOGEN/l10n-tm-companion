const ACTIONS = {
  'open-settings': { id: 'open-settings', label: 'Open Settings' },
  'configure-sheet-layout': { id: 'configure-sheet-layout', label: 'Configure Sheet Layout' },
  retry: { id: 'retry', label: 'Retry' },
  'resume-archive': { id: 'resume-archive', label: 'Resume Archive' },
  'copy-details': { id: 'copy-details', label: 'Copy Details' },
};

const RULES = [
  [/QUOTA|storage quota/i, 'Storage is full', 'Chrome storage has reached its quota. Free some space, then try again.', 'retry'],
  [/SHEET_HEADER_MISSING|headerless|header.*missing/i, 'Spreadsheet headers required', 'Add the required header row before continuing.', 'configure-sheet-layout'],
  [/FEISHU_SECRET_MISSING|secret missing/i, 'Feishu setup required', 'Configure the Feishu Secret in Settings, then connect again.', 'open-settings'],
  [/FEISHU_(OAUTH|BROKER)|OAuth.*Broker|broker.*(?:error|unavailable)/i, 'Feishu connection failed', 'The authoritative Feishu connection failed. Try connecting again.', 'retry'],
  [/WORD_RATE_(?:MISSING|INCOMPLETE)|word rate.*(?:missing|incomplete)/i, 'Word rate is incomplete', 'Configure the missing vendor word rate before archiving.', 'open-settings'],
  [/FINAL_TM_(?:MISSING|FAILED)|final TM.*(?:missing|failed)/i, 'Final TM query failed', 'Final TM must be queried successfully before ROI can be calculated.', 'retry'],
  [/STARLING_(?:CREDENTIAL|AUTH).*(?:MISSING|INVALID)|Starling credential/i, 'Starling setup required', 'Configure valid Starling credentials in Settings.', 'open-settings'],
  [/STARLING_TIMEOUT|Starling.*(?:timeout|timed out)/i, 'Starling request timed out', 'The Starling service did not respond in time. Try again.', 'retry'],
  [/STARLING_RATE_LIMIT|Starling.*rate limit/i, 'Starling rate limit reached', 'Wait briefly, then retry the Starling request.', 'retry'],
  [/PARTIAL_ARCHIVE|archive.*partial/i, 'Archive partially completed', 'Resume the same archive run to finish incomplete work.', 'resume-archive'],
];

const SENSITIVE_KEYS = new Set([
  'token', 'secret', 'ak', 'sk', 'authorization', 'accesskey', 'accesskeyid', 'secretkey', 'apikey',
  'appsecret', 'clientsecret', 'accesstoken', 'refreshtoken', 'authtoken', 'akid',
  'secretaccesskey', 'awssecretaccesskey',
]);
const CREDENTIAL_NAME = String.raw`(?:authorization|app[ _-]?secret|client[ _-]?secret|access[ _-]?token|refresh[ _-]?token|auth[ _-]?token|access[ _-]?key[ _-]?id|ak[ _-]?id|secret[ _-]?access[ _-]?key|aws[ _-]?secret[ _-]?access[ _-]?key|api[ _-]?key|access[ _-]?key|secret[ _-]?key|token|secret|ak|sk)`;
const CREDENTIAL_ASSIGNMENT = new RegExp(String.raw`\b(${CREDENTIAL_NAME})\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|.*?)(?=\s+${CREDENTIAL_NAME}\s*[:=]|[,;]|\s*$)`, 'gi');
const AUTHORIZATION_HEADER = /\bauthorization\b\s*(?::|=|\s)\s*(?:bearer\s+)?(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;

function isSensitiveKey(key) {
  return SENSITIVE_KEYS.has(String(key).replace(/[\s_-]/g, '').toLowerCase());
}

function sanitizeString(value) {
  return value
    .replace(AUTHORIZATION_HEADER, 'Authorization: [REDACTED]')
    .replace(CREDENTIAL_ASSIGNMENT, '$1: [REDACTED]');
}

function printableError(error) {
  if (error instanceof Error) return error;
  if (error && typeof error === 'object') return error;
  return { message: String(error ?? 'Unknown error') };
}

function sanitizeValue(value, seen) {
  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'bigint') return String(value);
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  const output = Array.isArray(value) ? [] : {};
  const keys = value instanceof Error
    ? [...new Set(['name', 'message', ...Object.getOwnPropertyNames(value)])]
    : Object.keys(value);

  for (const key of keys) {
    if (key === 'stack' || isSensitiveKey(key)) continue;
    try {
      output[key] = sanitizeValue(value[key], seen);
    } catch {
      output[key] = '[Unavailable]';
    }
  }
  return output;
}

export function sanitizeRawDetails(error) {
  try {
    return JSON.stringify(sanitizeValue(printableError(error), new WeakSet()), null, 2)
      || JSON.stringify(String(error ?? 'Unknown error'));
  } catch {
    return JSON.stringify({ message: 'Unable to serialize error details' });
  }
}

export function toUiError(error, context = {}) {
  const source = printableError(error);
  const searchable = `${source.code || ''} ${source.message || ''} ${context.operation || ''}`;
  const rule = RULES.find(([pattern]) => pattern.test(searchable));
  const [, title, message, actionId] = rule || [null, 'Something went wrong', 'An unexpected error occurred. Try the operation again.', 'retry'];

  return {
    title,
    message,
    primaryAction: ACTIONS[actionId],
    secondaryAction: ACTIONS['copy-details'],
    rawDetails: sanitizeRawDetails(error),
    severity: 'error',
  };
}
