const MAX_SAMPLES = 8;
const PHASES = [
  'Preparing',
  'Original TM (A)',
  'Final TM (C)',
  'Calculating ROI',
  'Writing to Feishu',
  'Complete',
];

function finiteNonNegative(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizeOperations(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return [...new Set(value.filter((operation) => operation === 'A' || operation === 'C'))];
}

export function createArchiveProgress({ estimatedRequests = 0, totalLanguages = 0, startedAt = Date.now() } = {}) {
  return {
    phase: 'Preparing',
    completedRequests: 0,
    estimatedRequests: finiteNonNegative(estimatedRequests),
    completedLanguages: 0,
    totalLanguages: finiteNonNegative(totalLanguages),
    activeOperations: [],
    elapsedMs: 0,
    etaMs: null,
    percent: 0,
    samples: [],
    startedAt: finiteNonNegative(startedAt, Date.now()),
  };
}

export function updateArchiveProgress(state, event = {}, now = Date.now()) {
  const previous = state || createArchiveProgress();
  const estimatedRequests = Math.max(previous.estimatedRequests, finiteNonNegative(event.estimatedRequests));
  const totalLanguages = Math.max(previous.totalLanguages, finiteNonNegative(event.totalLanguages));
  const completedRequests = Math.max(previous.completedRequests, finiteNonNegative(event.completedRequests));
  const completedLanguages = Math.max(previous.completedLanguages, finiteNonNegative(event.completedLanguages));
  const rawSample = Number(event.sampleDurationMs);
  const sampleRequestCount = Math.max(1, finiteNonNegative(event.sampleRequestCount, 1));
  const sample = rawSample / sampleRequestCount;
  const samples = Number.isFinite(sample) && sample > 0
    ? [...previous.samples, sample].slice(-MAX_SAMPLES)
    : [...previous.samples].slice(-MAX_SAMPLES);
  const requestedPhase = PHASES.includes(event.phase) ? event.phase : previous.phase;
  const previousPhaseIndex = Math.max(0, PHASES.indexOf(previous.phase));
  const requestedPhaseIndex = Math.max(0, PHASES.indexOf(requestedPhase));
  const phase = PHASES[Math.max(previousPhaseIndex, requestedPhaseIndex)];
  const complete = phase === 'Complete';
  const measuredPercent = estimatedRequests > 0 ? (completedRequests / estimatedRequests) * 100 : 0;
  const percent = complete ? 100 : Math.max(previous.percent, Math.min(99, Math.max(0, measuredPercent)));
  const remaining = Math.max(0, estimatedRequests - completedRequests);
  const etaMs = complete
    ? 0
    : samples.length < 3
      ? null
      : Math.round((samples.reduce((sum, value) => sum + value, 0) / samples.length) * remaining);
  return {
    phase,
    completedRequests,
    estimatedRequests,
    completedLanguages,
    totalLanguages,
    activeOperations: complete || PHASES.indexOf(phase) > PHASES.indexOf('Final TM (C)')
      ? []
      : normalizeOperations(event.activeOperations, previous.activeOperations),
    elapsedMs: Math.max(previous.elapsedMs, finiteNonNegative(event.elapsedMs), finiteNonNegative(now) - previous.startedAt),
    etaMs,
    percent,
    samples,
    startedAt: previous.startedAt,
  };
}

export function formatArchiveDuration(ms) {
  if (ms == null) return 'Estimating time';
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

/** Executable renderer shared by production and tests. */
export function renderArchiveProgress(model, elements) {
  const { root, live, phase, operations, languages, requests, elapsed, eta, progressTrack, progressFill } = elements;
  root?.classList?.remove('hidden');
  if (phase) phase.textContent = model.phase;
  if (operations) operations.textContent = model.activeOperations.length ? model.activeOperations.join(' + ') : '—';
  if (languages) languages.textContent = `${model.completedLanguages}/${model.totalLanguages}`;
  if (requests) requests.textContent = `${model.completedRequests}/${model.estimatedRequests}`;
  if (elapsed) elapsed.textContent = formatArchiveDuration(model.elapsedMs);
  if (eta) eta.textContent = model.etaMs == null ? 'Estimating time' : formatArchiveDuration(model.etaMs);
  if (progressTrack) progressTrack.setAttribute('aria-valuenow', String(Math.round(model.percent)));
  if (progressFill) progressFill.style.transform = `scaleX(${model.percent / 100})`;
  if (live) live.textContent = `${model.phase}. ${Math.round(model.percent)}% complete.`;
  return model;
}
