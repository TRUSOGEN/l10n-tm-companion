const ACTIONS = {
  'open-settings': { id: 'open-settings', label: 'Open Settings' },
  'configure-sheet-layout': { id: 'configure-sheet-layout', label: 'Configure Sheet Layout' },
  retry: { id: 'retry', label: 'Retry' },
  'resume-archive': { id: 'resume-archive', label: 'Resume Archive' },
  'copy-details': { id: 'copy-details', label: 'Copy Details' },
};

// 中文 UI 下的标题/说明/动作文案。未提供或未知 locale 一律回退英文，action ID 与语言无关。
const ZH_ACTION_LABELS = {
  'open-settings': '打开 Settings',
  'configure-sheet-layout': '配置表格列映射',
  retry: '重试',
  'resume-archive': '继续归档',
  'copy-details': '复制详情',
};
const ZH_MESSAGES = {
  'Storage is full': ['存储空间已满', 'Chrome 存储已达配额上限。请清理空间后重试。'],
  'Spreadsheet headers required': ['需要表格表头', '请先补齐表头行或手动确认列映射，再继续。'],
  'Feishu setup required': ['需要完成飞书配置', '请在 Settings 中填写飞书 App Secret，保存后返回继续授权。'],
  'Feishu connection failed': ['飞书连接失败', '权威的飞书连接失败，请重新尝试连接；插件不会降级到本机授权。'],
  'Word rate is incomplete': ['缺少按字费率', '请先在 Settings 补齐该 vendor 的按字费率，再执行归档。'],
  'Final TM query failed': ['Final TM 查询失败', '正式 ROI 必须基于真实 Final TM，请重试查询。'],
  'Starling setup required': ['需要配置 Starling 凭据', '请在 Settings 填写有效的 Starling AK/SK。'],
  'Starling request timed out': ['Starling 请求超时', 'Starling 服务未在预期时间内响应，请重试。'],
  'Starling rate limit reached': ['Starling 触发限流', '请稍等片刻后重试该 Starling 请求。'],
  'Archive partially completed': ['归档只完成了一部分', '请继续同一个归档 Run 完成剩余工作，Run ID 不会变化。'],
  'Something went wrong': ['出现未预期的错误', '发生了未预期的错误，请重试该操作。'],
};

function localizeAction(action, locale) {
  if (!action || locale !== 'zh-CN') return action;
  return { id: action.id, label: ZH_ACTION_LABELS[action.id] || action.label };
}

function normalizeLocale(locale) {
  return locale === 'zh-CN' ? 'zh-CN' : 'en';
}

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

// Diagnostic allowlist: telemetry-only fields must survive redaction so support can
// tell "secret missing" from "secret wrong" without ever seeing the credential itself.
const DIAGNOSTIC_SUFFIXES = ['configured', 'count', 'present', 'length'];
const DIAGNOSTIC_PATHS = new Set(['scope.key']);

function isDiagnosticEntry(key, value, path) {
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number' && Number.isFinite(value)) return true;
  const normalized = normalizeKey(key);
  if (DIAGNOSTIC_SUFFIXES.some((suffix) => normalized.endsWith(suffix) && normalized !== suffix)) return true;
  const trail = [...path, key].map((part) => normalizeKey(part)).filter(Boolean);
  const tail = trail.slice(-2).join('.');
  return DIAGNOSTIC_PATHS.has(tail);
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

function sanitizeValue(value, seen, path = []) {
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
    if (key === 'stack') continue;
    let entry;
    try {
      entry = value[key];
    } catch {
      output[key] = '[Unavailable]';
      continue;
    }
    if (isSensitiveKey(key) && !isDiagnosticEntry(key, entry, path)) continue;
    try {
      output[key] = sanitizeValue(entry, seen, Array.isArray(value) ? path : [...path, key]);
    } catch {
      output[key] = '[Unavailable]';
    }
  }
  return output;
}

export function sanitizeRawDetails(error) {
  try {
    return JSON.stringify(sanitizeValue(printableError(error), new WeakSet(), []), null, 2)
      || JSON.stringify(String(error ?? 'Unknown error'));
  } catch {
    return JSON.stringify({ message: 'Unable to serialize error details' });
  }
}

export function toUiError(error, context = {}) {
  const source = printableError(error);
  const locale = normalizeLocale(context.locale);
  const searchable = `${source.code || ''} ${source.message || ''} ${context.operation || ''}`;
  const rule = RULES.find(([pattern]) => pattern.test(searchable));
  const [, englishTitle, englishMessage, actionId] = rule
    || [null, 'Something went wrong', 'An unexpected error occurred. Try the operation again.', 'retry'];
  const [title, message] = locale === 'zh-CN' && ZH_MESSAGES[englishTitle]
    ? ZH_MESSAGES[englishTitle]
    : [englishTitle, englishMessage];

  return {
    title,
    message,
    primaryAction: localizeAction(ACTIONS[actionId], locale),
    secondaryAction: localizeAction(ACTIONS['copy-details'], locale),
    rawDetails: sanitizeRawDetails(error),
    severity: 'error',
  };
}
