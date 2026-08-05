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

const SENSITIVE_KEY = /^(?:token|secret|ak|sk|access[_-]?key|secret[_-]?key|authorization)$/i;

function printableError(error) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, ...(error.code ? { code: error.code } : {}) };
  }
  if (error && typeof error === 'object') return error;
  return { message: String(error ?? 'Unknown error') };
}

export function sanitizeRawDetails(error) {
  const seen = new WeakSet();
  const sanitized = JSON.stringify(printableError(error), (key, value) => {
    if (SENSITIVE_KEY.test(key)) return undefined;
    if (value && typeof value === 'object') {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    if (typeof value === 'string') {
      return value.replace(/\b(token|secret|ak|sk|access[_-]?key|secret[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1: [REDACTED]');
    }
    return value;
  }, 2);
  return sanitized || String(error ?? 'Unknown error');
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
