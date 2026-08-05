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

// Sensitive roots are matched against the normalized key (letters/digits only, lowercased),
// so prefixed/suffixed product spellings such as feishuAppSecret, starlingSecretKey,
// starlingAccessKey, access_key_id or userAccessToken are all covered.
const SENSITIVE_ROOTS = [
  'secret', 'token', 'accesskey', 'apikey', 'authorization', 'password', 'passwd',
  'credential', 'privatekey', 'signature', 'cookie', 'bearer',
];
const SENSITIVE_EXACT = new Set(['ak', 'sk', 'akid', 'skid', 'auth', 'pwd', 'key']);
const REDACTED = '[REDACTED]';

// Key names inside free-form strings and JSON payloads: any identifier that contains a
// sensitive root, with optional separators (`app_secret`, `access-key`, `Access Key Id`).
const KEY_ROOT = String.raw`(?:s[ _-]?e[ _-]?c[ _-]?r[ _-]?e[ _-]?t|t[ _-]?o[ _-]?k[ _-]?e[ _-]?n|access[ _-]?key|api[ _-]?key|authorization|pass[ _-]?word|credential|private[ _-]?key|signature|cookie)`;
const KEY_NAME = String.raw`[A-Za-z0-9_.\-]*${KEY_ROOT}[A-Za-z0-9_.\-]*`;
const VALUE = String.raw`(?:"[^"]*"|'[^']*'|[^\s,;}\])]+)`;
const KEYED_ASSIGNMENT = new RegExp(String.raw`("?)(${KEY_NAME})\1\s*[:=]\s*(?:bearer\s+)?${VALUE}`, 'gi');
const SHORT_KEY_ASSIGNMENT = new RegExp(String.raw`("?)\b(ak|sk|akid|pwd)\b\1\s*[:=]\s*${VALUE}`, 'gi');
// Value-shape fallbacks: Volcano/Starling style AKLT keys and bare Bearer values.
const AKLT_VALUE = /\bAKLT[A-Za-z0-9_\-=+/]{6,}/g;
const BEARER_VALUE = /\bbearer\s+[A-Za-z0-9._\-=+/]{8,}/gi;

function normalizeKey(key) {
  return String(key).replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

function isSensitiveKey(key) {
  const normalized = normalizeKey(key);
  if (!normalized) return false;
  if (SENSITIVE_EXACT.has(normalized)) return true;
  return SENSITIVE_ROOTS.some((root) => normalized.includes(root));
}

function redactAssignment(match, quote, key) {
  return `${quote}${key}${quote}: ${quote ? `${quote}${REDACTED}${quote}` : REDACTED}`;
}

function sanitizeString(value) {
  return value
    .replace(KEYED_ASSIGNMENT, redactAssignment)
    .replace(SHORT_KEY_ASSIGNMENT, redactAssignment)
    .replace(BEARER_VALUE, `Bearer ${REDACTED}`)
    .replace(AKLT_VALUE, REDACTED);
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
