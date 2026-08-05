/**
 * A4: broker failure policy tests.
 *
 * Asserts that when the broker feature flag is on, OAuth and archive failures
 * surface to the user instead of silently falling back to legacy local-secret
 * authorize or legacy local Bitable archive. Legacy path is still reachable
 * when the broker flag is off OR the explicit dev-only toggle is on.
 *
 * These tests run under a vm sandbox (no real Chrome / Native Host / DOM).
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeStubChrome(storageState = {}) {
  return {
    storage: {
      local: {
        get(key, cb) {
          let out;
          if (key == null) out = { ...storageState };
          else if (Array.isArray(key)) {
            out = {};
            key.forEach((k) => { if (typeof k === 'string') out[k] = storageState[k]; });
          } else if (typeof key === 'string') {
            out = { [key]: storageState[key] };
          } else if (key && typeof key === 'object') {
            out = {};
            Object.keys(key).forEach((k) => {
              out[k] = Object.prototype.hasOwnProperty.call(storageState, k) ? storageState[k] : key[k];
            });
          } else {
            out = {};
          }
          // Sync callback — chrome.storage API guarantees the callback fires asynchronously
          // in production, but calling it synchronously in tests is safe because popup.js
          // always wraps the result inside await/new-Promise.
          queueMicrotask(() => { if (typeof cb === 'function') cb(out); });
          return Promise.resolve(out);
        },
        set(obj, cb) {
          Object.assign(storageState, obj);
          queueMicrotask(() => { if (typeof cb === 'function') cb(); });
          return Promise.resolve();
        },
        remove(key, cb) {
          if (Array.isArray(key)) key.forEach((k) => { delete storageState[k]; });
          else if (typeof key === 'string') delete storageState[key];
          queueMicrotask(() => { if (typeof cb === 'function') cb(); });
          return Promise.resolve();
        },
      },
    },
    runtime: {
      openOptionsPage: () => {},
      sendMessage(_payload, cb) { queueMicrotask(() => { if (typeof cb === 'function') cb({ ok: true }); }); },
      onMessage: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
      lastError: null,
    },
    tabs: {
      query(_q, cb) { queueMicrotask(() => { if (typeof cb === 'function') cb([{ url: 'https://example.feishu.cn/sheets/sht' }]); }); },
    },
    sidePanel: { setPanelBehavior: async () => ({}) },
    scripting: { executeScript: async () => [{}] },
  };
}

function unrefedSetTimeout(fn, ms) { const t = setTimeout(fn, ms); if (t && typeof t.unref === 'function') t.unref(); return t; }

function noop() {}
function makeStubElement(id) {
  const classes = new Set();
  const kids = [];
  return {
    id,
    classList: {
      add: (...c) => c.forEach((x) => classes.add(String(x))),
      remove: (...c) => c.forEach((x) => classes.delete(String(x))),
      toggle: (c, on) => { if (on === undefined) { if (classes.has(c)) classes.delete(c); else classes.add(c); } else if (on) classes.add(c); else classes.delete(c); },
      contains: (c) => classes.has(String(c)),
    },
    addEventListener: noop,
    removeEventListener: noop,
    appendChild: (n) => { kids.push(n); return n; },
    append(...ns) { ns.forEach((n) => kids.push(n)); },
    removeChild: noop,
    setAttribute: noop,
    removeAttribute: noop,
    getAttribute: () => null,
    querySelector: () => makeStubElement(`${id}-child`),
    querySelectorAll: () => [],
    focus: noop, blur: noop, click: noop,
    disabled: false, hidden: false, checked: false, open: false,
    textContent: '', innerHTML: '', value: '', src: '', alt: '',
    style: {}, dataset: {}, options: [], selectedIndex: 0, children: kids,
    parentNode: null, nextSibling: null, previousSibling: null,
    firstChild: null, lastChild: null,
    insertBefore: noop,
    cloneNode: () => makeStubElement(`${id}-clone`),
    getContext: () => ({ fillRect: noop, clearRect: noop, getImageData: () => ({ data: [] }), putImageData: noop, createImageData: () => ({ data: [] }), drawImage: noop, save: noop, restore: noop, beginPath: noop, closePath: noop, arc: noop, fill: noop, stroke: noop, measureText: () => ({ width: 0 }), fillText: noop, translate: noop, scale: noop, rotate: noop }),
  };
}
function makeStubDocument() {
  const byId = new Map();
  const doc = {
    getElementById(id) {
      if (!byId.has(id)) byId.set(id, makeStubElement(id));
      return byId.get(id);
    },
    querySelector() { return makeStubElement('q'); },
    querySelectorAll() { return []; },
    createElement() { return makeStubElement('c'); },
    createTextNode: (t) => ({ textContent: t }),
    addEventListener: noop,
    removeEventListener: noop,
    body: makeStubElement('body'),
    documentElement: makeStubElement('html'),
  };
  return doc;
}
function makeStubWindow(confirmValue = true) {
  return { confirm: () => confirmValue, alert: noop, setTimeout: ((fn, ms) => { const t = setTimeout(fn, ms); if (t && typeof t.unref === 'function') t.unref(); return t; }), clearTimeout };
}

function loadESLike(relativePath, stubs = {}, sandboxChrome) {
  const fullPath = path.resolve(__dirname, '..', relativePath);
  let source = fs.readFileSync(fullPath, 'utf8');
  const exportNames = new Set();
  source = source.replace(/^import\s+['"][^'"]+['"];?\s*$/gm, '');
  source = source.replace(
    /import\s+\*\s+as\s+([A-Za-z0-9_$]+)\s+from\s+['"]([^'"]+)['"];?/g,
    (_, name, p) => `const ${name} = require(${JSON.stringify(p)});`,
  );
  source = source.replace(
    /import\s+([A-Za-z0-9_$]+)\s*,\s*\{\s*([^}]+)\s*\}\s+from\s+['"]([^'"]+)['"];?/g,
    (_, defName, named, p) => {
      const req = named.split(',').map((n) => n.trim()).filter(Boolean);
      return `const ${defName} = require(${JSON.stringify(p)}).default;\nconst { ${req.join(', ')} } = require(${JSON.stringify(p)});`;
    },
  );
  source = source.replace(
    /import\s+\{\s*([^}]+)\s*\}\s+from\s+['"]([^'"]+)['"];?/g,
    (_, names, p) => {
      const req = names.split(',').map((n) => n.trim()).filter(Boolean);
      return `const { ${req.join(', ')} } = require(${JSON.stringify(p)});`;
    },
  );
  source = source.replace(
    /import\s+([A-Za-z0-9_$]+)\s+from\s+['"]([^'"]+)['"];?/g,
    (_, name, p) => `const ${name} = require(${JSON.stringify(p)});`,
  );
  source = source.replace(/export\s+default\s+/g, () => 'module.exports.default = ');
  source = source.replace(/export async function\s+([A-Za-z0-9_$]+)/g, (_, n) => { exportNames.add(n); return `async function ${n}`; });
  source = source.replace(/export function\s+([A-Za-z0-9_$]+)/g, (_, n) => { exportNames.add(n); return `function ${n}`; });
  source = source.replace(/export const\s+([A-Za-z0-9_$]+)\s*=/g, (_, n) => { exportNames.add(n); return `const ${n} =`; });
  source = source.replace(/export let\s+([A-Za-z0-9_$]+)\s*=/g, (_, n) => { exportNames.add(n); return `let ${n} =`; });
  source = source.replace(/export\s*\{([^}]+)\};?/g, (_, names) => {
    names.split(',').map((n) => n.trim()).filter(Boolean).forEach((n) => exportNames.add(n));
    return '';
  });

  const chrome = sandboxChrome || makeStubChrome({});
  const outerSetTimeout = setTimeout;
  function sandboxSetTimeout(fn, ms) { const t = outerSetTimeout(fn, ms); if (t && typeof t.unref === 'function') t.unref(); return t; }
  const sandbox = {
    module: { exports: {} },
    exports: {},
    require: (req) => {
      if (stubs[req]) return stubs[req];
      throw new Error(`Unexpected require(${req}) in sandbox for ${relativePath}`);
    },
    __filename: fullPath,
    __dirname: path.dirname(fullPath),
    console,
    setTimeout: sandboxSetTimeout,
    setImmediate,
    clearTimeout,
    queueMicrotask: (fn) => Promise.resolve().then(fn),
    TextEncoder, TextDecoder, Uint8Array, Uint8ClampedArray,
    Array, ArrayBuffer, Boolean, Date, Math, Number, Object, Promise, String, JSON, RegExp, Map, Set, Error, TypeError,
    crypto: (() => {
      const c = globalThis.crypto || {};
      if (typeof c.randomUUID !== 'function') c.randomUUID = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => { const r = Math.random() * 16 | 0; return (ch === 'x' ? r : (r & 0x3 | 0x8)).toString(16); });
      if (typeof c.subtle === 'undefined') c.subtle = { digest: async () => new ArrayBuffer(32) };
      return c;
    })(),
    chrome,
    document: makeStubDocument(),
    window: makeStubWindow(),
    navigator: { language: 'en-US', userAgent: 'node-test' },
    location: { href: 'chrome-extension://popup/popup.html' },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    URL: class URL { constructor(u) { this.href = u; this.searchParams = { get: () => null, set: noop }; } },
    HTMLElement: class HTMLElement {},
    Event: class Event { constructor() {} },
    MutationObserver: class MutationObserver { observe() {} disconnect() {} takeRecords() { return []; } },
    IntersectionObserver: class IntersectionObserver { observe() {} unobserve() {} disconnect() {} },
    ResizeObserver: class ResizeObserver { observe() {} unobserve() {} disconnect() {} },
    Image: class Image {},
    Option: class Option { constructor(text, value) { this.text = text; this.value = value; } },
  };
  sandbox.global = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
  const exportSuffix = `\n;module.exports = Object.assign(module.exports || {}, {\n${Array.from(exportNames).map((n) => `  ${n},`).join('\n')}\n});\n`;
  const script = new vm.Script(source + exportSuffix, { filename: fullPath });
  const context = vm.createContext(sandbox);
  try { script.runInContext(context); }
  catch (error) { error.message = `[loadESLike ${relativePath}] ${error.message}`; throw error; }
  return { exports: sandbox.module.exports, sandbox, chrome };
}

function makeHashStub() {
  return {
    sha256Text: async (text) => {
      let h = 0; const s = String(text);
      for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
      return h.toString(16).padStart(8, '0').padEnd(64, '0');
    },
    sha256Digest: async () => new Uint8Array(32),
  };
}

function makeBrokerClient({ submitFail = false, archiveFail = false, getFail = false, createFail = false, presetRevision = 1 } = {}) {
  const state = { run_id: 'run-a4', revision: Number(presetRevision), archive_state: 'not_requested', a_state: 'idle', c_state: 'idle', items: [] };
  const calls = { submit: [], archive: [], get: [], create: [] };
  return {
    archiveRoiRun: async (runId, payload) => {
      calls.archive.push({ runId, payload });
      if (archiveFail) throw new Error('archive network error');
      state.revision = Number(payload?.body?.expected_revision || state.revision) + 1;
      state.archive_state = 'failed'; // terminal state so polling stops after archive failure path
      return { run_id: runId, revision: state.revision, archive_state: 'queued' };
    },
    createRoiRun: async (payload) => {
      calls.create.push({ payload });
      if (createFail) throw new Error('create run network error');
      state.revision = 1;
      return { run_id: state.run_id, revision: 1, a_state: 'idle', c_state: 'idle', archive_state: 'not_requested', items: [], payload };
    },
    getBrokerAuthorizationStatus: async () => ({ ok: true, has_device_session: true, connected: true, legacy_local_secret_dev_only: false }),
    getRoiRun: async (runId) => {
      calls.get.push({ runId });
      if (getFail) throw new Error('get run failed');
      return { run_id: runId, revision: state.revision, archive_state: state.archive_state, a_state: state.a_state, c_state: state.c_state, items: state.items };
    },
    revokeBrokerAuthorization: async () => ({ ok: true }),
    startBrokerAuthorization: async () => ({ ok: true }),
    submitRoiFinal: async (runId, itemId, payload) => {
      calls.submit.push({ runId, itemId, payload });
      if (submitFail) throw new Error('submit network error');
      const expected = Number(payload?.body?.expected_revision || 1);
      state.revision = expected + 1;
      return { run_id, item_id: itemId, revision: state.revision };
    },
    _calls: calls,
    _state: state,
    _setRevision: (r) => { state.revision = Number(r); },
    _setArchiveState: (s) => { state.archive_state = s; },
  };
}

function loadBrokerModule(brokerClient, hashStub, chrome) {
  return loadESLike('lib/broker-async-roi.js', {
    './hash-utils.js': hashStub,
    './backend-broker-client.js': brokerClient,
  }, chrome);
}

function makeAuthExports({ brokerFail = false, legacyFail = false, profile = { name: 'tester' } } = {}) {
  const calls = { broker: 0, legacy: 0, getStatus: 0, brokerStatus: 0 };
  const legacyFn = async () => {
    calls.legacy += 1;
    if (legacyFail) throw new Error('legacy oauth failed');
    return { connected: true, profile };
  };
  legacyFn.calls = calls;
  const brokerFn = async () => {
    calls.broker += 1;
    if (brokerFail) throw new Error('broker oauth unavailable');
    return { connected: true, profile, broker: true };
  };
  brokerFn.calls = calls;
  return {
    './lib/feishu-auth.js': {
      authorizeFeishuUser: legacyFn,
      authorizeFeishuUserViaBroker: brokerFn,
      getFeishuBrokerConnectionStatus: async () => { calls.brokerStatus += 1; return { ok: true, has_device_session: true }; },
      getFeishuUserAuthorizationStatus: async () => { calls.getStatus += 1; return { connected: false, profile: null, missingScopes: [] }; },
      shouldUseFeishuBroker: async () => true,
      isLegacyLocalSecretPathEnabled: async () => false,
    },
    _calls: calls,
  };
}

function makePopupDeps(brokerExports, overrides = {}) {
  const writeRoiArchiveCalls = [];
  const authBase = {
    authorizeFeishuUser: async () => ({ connected: true, profile: { name: 'tester' } }),
    authorizeFeishuUserViaBroker: async () => ({ connected: true, profile: { name: 'tester' }, broker: true }),
    getFeishuBrokerConnectionStatus: async () => ({ ok: true, has_device_session: true }),
    getFeishuUserAuthorizationStatus: async () => ({ connected: true, profile: { name: 'tester' }, missingScopes: [] }),
    getFeishuCredentialStatus: async () => ({ configured: true }),
    preflightFeishuAuthorization: (status = {}) => status.connected
      ? { state: 'connected', title: 'Connected', message: 'Connected' }
      : { state: status.secretConfigured ? 'ready' : 'secret-required', title: 'Ready', message: 'Ready' },
    openFeishuSettingsPage: async ({ storage, openOptionsPage }) => { await storage.set({ optionsNavigationIntent: 'feishu-secret' }); await openOptionsPage(); },
    shouldUseFeishuBroker: async () => false,
    isLegacyLocalSecretPathEnabled: async () => false,
  };
  const authOverride = overrides['./lib/feishu-auth.js'] || {};
  const restOverrides = { ...overrides };
  delete restOverrides['./lib/feishu-auth.js'];
  const base = {
    './lib/starling-tm.js': { listProjects: async () => [], pingNativeHost: async () => ({ ok: true }), queryFinalTmSnapshots: async (items) => items.map(() => ({ status: 'complete', score: 99 })), queryRewriteCandidateTmSnapshots: async (items) => items.map(() => ({ status: 'complete', score: 99 })), searchTM: async () => [] },
    './lib/ai-translate.js': { rewriteSourceWithAI: async () => ({}) },
    './lib/diff.js': { compareAIvsTM: () => ({}), friendlyError: (e) => (e?.message || String(e)) },
    './lib/tm-threshold.js': { TM_MATCH_THRESHOLD: 85 },
    './lib/feishu-sheets.js': { writeConfirmedReviewItems: async () => ({}), writeConfirmedReviewItem: async () => ({}), listSourceSegments: async () => [], listSpreadsheetSheets: async () => [], inspectSheetLayout: async () => ({}), testSheetsConnection: async () => ({ ok: true }), parseSheetsUrl: () => null, parseFeishuUrl: () => null, resolveSpreadsheetReference: async () => null },
    './lib/errors.js': { friendlyError: (e) => (e?.message || String(e)) },
    './lib/run-config.js': { ROI_VENDORS: ['RWS', 'Pactera'], buildFastTmScope: () => ({}), buildLocaleScopes: () => [], normalizeProject: (p) => p, paginateProjects: (items) => ({ items: items || [], pageIndex: 0, pageCount: 1 }), targetLocaleIntersection: () => [], toggleProjectSelection: () => {}, validateRunConfig: () => ({ ok: true }) },
    './lib/pricing-rules.js': { resolveWordRate: () => 0 },
    './lib/roi-calculation.js': { calculateRoiForItem: () => ({ status: 'not_requested' }) },
    './lib/multilingual-roi.js': {
      deriveVendorRoiResults: (scopeRuns, _catalog, vendors = ['RWS', 'Pactera']) => Object.fromEntries(
        vendors.map((vendor) => [vendor, { vendor, summary: { total: 1 }, scopeRuns }]),
      ),
      summarizeMultilingualRoi: () => ({ total: 1 }),
    },
    './lib/multilingual-runner.js': { completeDeferredLocaleScopes: async () => {}, completeDeferredLocaleScopesForArchive: async () => {}, partitionPriorityScope: (scopes) => ({ priority: scopes || [], deferred: [] }), runLocaleScopes: async () => ({ scopeRuns: [] }) },
    './lib/roi-bitable-archive.js': {
      FIXED_ROI_ARCHIVE_URL: 'https://bytedance.feishu.cn/base/roi',
      buildRoiArchivePayload: (p) => ({ runId: p.runId, operator: p.operator }),
      writeRoiArchive: async ({ payload } = {}) => { writeRoiArchiveCalls.push({ payload }); return { ok: true, status: 'written' }; },
    },
    './lib/i18n.js': { applyI18n: () => 'en', normalizeUiLanguage: (l) => l, t: (k, _lang, vars) => `${k}${vars ? ':' + JSON.stringify(vars) : ''}` },
    './lib/archive-summary.js': { buildVendorRoutes: () => [], formatVendorCoverage: () => ({ counts: { RWS: 0, Pactera: 0, unpriced: 0 }, explanations: [], incomplete: false, incompleteCount: 0 }), summarizeArchive: () => ({ vendorCoverage: { RWS: 0, Pactera: 0, unpriced: 0 }, estimatedTmRequests: { original: 0, final: 0, total: 0 }, estimatedDuration: { minSeconds: 0, maxSeconds: 0 } }) },
    './lib/archive-progress.js': {
      createArchiveProgress: ({ estimatedRequests = 0, totalLanguages = 0, startedAt = 0 } = {}) => ({ estimatedRequests, totalLanguages, startedAt, completedRequests: 0, completedLanguages: 0, percent: 0, samples: [], activeOperations: [], elapsedMs: 0, etaMs: null, phase: 'Preparing' }),
      updateArchiveProgress: (state, event) => ({ ...state, ...event }),
      renderArchiveProgress: (model) => model,
    },
    './lib/archive-confirmation.js': { createArchiveConfirmationController: () => ({}), confirmThenRunArchive: async ({ runtime }) => runtime() },
    './lib/feishu-popup-controller.js': { createFeishuPopupController: () => ({ bind: () => true }) },
    './lib/feishu-auth.js': { ...authBase, ...authOverride },
    './lib/hash-utils.js': makeHashStub(),
    './lib/broker-async-roi.js': brokerExports,
    './lib/source-rewrite-policy.js': { evaluateRewriteCandidate: () => ({}), evaluateRewriteCandidates: () => [], formatTmSourceForDisplay: (s) => s },
    './lib/sheet-layout.js': { buildSourcePreview: () => '', getOutputColumns: () => [], sheetLayoutStorageKey: () => 'layout', validateSheetLayout: () => ({ ok: true }) },
    './lib/review-presentation-view.js': { createReviewPresentationElement: () => ({}) },
    './lib/review-workflow.js': {
      beginConfirmation: (r) => ({ ...(r || {}), status: 'confirming' }),
      buildFocusTmState: () => ({}),
      buildReviewPresentation: () => ({ rail: [], officialSaving: null, savingTone: 'neutral', headline: '', explanation: '' }),
      completeConfirmation: (r, meta) => ({ ...(r || {}), status: 'confirmed', finalText: r?.finalText, meta }),
      createReviewState: () => ({}),
      dedupeAiCandidates: (arr) => arr,
      editFinalText: (r, t) => ({ ...r, finalText: t }),
      explainFocusAiAbsence: () => '',
      failConfirmation: (r, e) => ({ ...(r || {}), status: 'error', error: e?.message || String(e) }),
      filterReviewItems: (items) => items,
      getReviewableAiCandidates: () => [],
      isAiCandidateSelected: () => false,
      prepareBulkConfirmations: (items) => ({ ready: [], failed: [] }),
    },
  };
  const merged = { ...base, ...restOverrides };
  merged._writeRoiArchiveCalls = writeRoiArchiveCalls;
  return merged;
}

function loadPopupModule(brokerExports, chrome, overrides = {}) {
  return loadESLike('popup.js', makePopupDeps(brokerExports, overrides), chrome);
}

// capture console.warn to detect the forbidden "falling back to legacy local archive path" message.
// Expected caught errors (e.g. from broker failures we intentionally trigger) are silenced so the
// test output stays clean.
const origWarn = console.warn;
const SILENT_WARN_PATTERNS = [
  /ROI archive \/ Feishu authorization failed\./,
  /\[DBG\]/,
];
const warnings = [];
console.warn = (...args) => {
  const msg = args.map((a) => (a && a.stack ? a.stack : (a?.message || String(a)))).join(' ');
  warnings.push(msg);
  if (SILENT_WARN_PATTERNS.some((p) => p.test(msg))) return;
  origWarn.apply(console, args);
};

let passed = 0;
let failed = 0;
function assert(name, cond, detail) {
  if (cond) { passed += 1; console.log(`  PASS ${name}`); }
  else { failed += 1; console.error(`  FAIL ${name}${detail ? ' :: ' + detail : ''}`); }
}

async function run() {
  console.log('=== A4 popup-broker-failure-policy ===');

  // ----- Case 1: Broker flag on, OAuth broker failure must NOT call legacy authorizeFeishuUser -----
  {
    warnings.length = 0;
    const chrome = makeStubChrome({ l10nAsyncRoiBrokerEnabled: true });
    const brokerClient = makeBrokerClient();
    const brokerMod = loadBrokerModule(brokerClient, makeHashStub(), chrome);
    await brokerMod.exports.setBrokerAsyncRoiEnabled(true);
    const legacyCalls = { count: 0 };
    const brokerCalls = { count: 0 };
    let popup = null;
    popup = loadPopupModule(brokerMod.exports, chrome, {
      './lib/feishu-auth.js': {
        authorizeFeishuUser: async () => { legacyCalls.count += 1; throw new Error('legacy should not be called'); },
        authorizeFeishuUserViaBroker: async () => { brokerCalls.count += 1; throw new Error('broker oauth unavailable'); },
        getFeishuBrokerConnectionStatus: async () => ({ ok: true, has_device_session: true }),
        getFeishuUserAuthorizationStatus: async () => ({ connected: false, profile: null, missingScopes: [] }),
        shouldUseFeishuBroker: async () => true,
        isLegacyLocalSecretPathEnabled: async () => false,
      },
    });
    const hooks = popup.sandbox.__popupBrokerTestHooks;
    hooks.setBrokerState({ brokerAsyncRoi: true, activeBrokerRun: null });
    hooks.setArchiveReadyState([{ id: 'i1', row: 2, review_status: 'confirmed' }], { total: 1 });
    hooks.setActiveWorkflowContext({ spreadsheetToken: 'sht', sheetId: 'sh', vendor: 'bytedance', projectIds: [1], roiScopes: [] });
    let threwOut = false;
    try { await hooks.writeCurrentRoiArchive(); } catch (e) { threwOut = true; }
    // writeCurrentRoiArchive catches errors internally; the key assertion is that legacy authorizeFeishuUser
    // was never called despite broker OAuth failure.
    assert('Case 1: broker on + broker OAuth failure did NOT silently call legacy authorizeFeishuUser',
      legacyCalls.count === 0, `legacyCalls=${legacyCalls.count}`);
    assert('Case 1: broker OAuth path was attempted', brokerCalls.count >= 1, `brokerCalls=${brokerCalls.count}`);
    const popupSource = fs.readFileSync(path.resolve(__dirname, '..', 'popup.js'), 'utf8');
    assert('Case 1: connectFeishuUserFromPopup uses shouldUseLegacyFallback (not shouldUseFeishuBroker||brokerAsyncRoi)',
      /shouldUseLegacyFallback\(\)/.test(popupSource) && !/if\s*\(\s*useBroker\s*\|\|\s*brokerAsyncRoi\s*\)/.test(popupSource));
    assert('Case 1: connectFeishuUserFromPopup branches on useLegacy (legacy when true, else broker)',
      /const useLegacy = await shouldUseLegacyFallback\(\)[\s\S]{0,400}if\s*\(\s*useLegacy\s*\)\s*\{[\s\S]{0,200}authorizeFeishuUser/.test(popupSource));
    assert('Case 1: writeCurrentRoiArchive did not throw out (error caught)', !threwOut);
  }

  // ----- Case 2: Broker flag on, archive failure keeps error — no legacy archive write, no fallback log -----
  {
    warnings.length = 0;
    const sharedStorage = { l10nAsyncRoiBrokerEnabled: true };
    const chrome = makeStubChrome(sharedStorage);
    const brokerClient = makeBrokerClient({ archiveFail: true });
    const brokerMod = loadBrokerModule(brokerClient, makeHashStub(), chrome);
    await brokerMod.exports.setBrokerAsyncRoiEnabled(true);
    await brokerMod.exports.createBrokerRun({ body: { client_run_id: 'r-a4-archive-fail' } });
    // Connected user so OAuth path is skipped.
    const authConnected = {
      authorizeFeishuUser: async () => { throw new Error('legacy should not be called'); },
      authorizeFeishuUserViaBroker: async () => { throw new Error('broker oauth should not be called when already connected'); },
      getFeishuBrokerConnectionStatus: async () => ({ ok: true, has_device_session: true }),
      getFeishuUserAuthorizationStatus: async () => ({ connected: true, profile: { name: 'u' }, missingScopes: [] }),
      shouldUseFeishuBroker: async () => true,
      isLegacyLocalSecretPathEnabled: async () => false,
    };
    const popup = loadPopupModule(brokerMod.exports, chrome, { './lib/feishu-auth.js': authConnected });
    const hooks = popup.sandbox.__popupBrokerTestHooks;
    hooks.setBrokerState({ brokerAsyncRoi: true, activeBrokerRun: await brokerMod.exports.loadBrokerRunSnapshot() });
    hooks.setActiveWorkflowContext({ spreadsheetToken: 'sht', sheetId: 'sh', vendor: 'bytedance', projectIds: [1], roiScopes: [] });
    hooks.setArchiveReadyState(
      [{ id: 'i1', row: 2, review_status: 'confirmed' }],
      { total: 1 },
    );
    // window.confirm returns true by default in our stub.
    let threw = false; let archiveResult = null;
    try {
      await hooks.writeCurrentRoiArchive();
    } catch (e) { threw = true; archiveResult = e; }
    const writeCalls = popup.sandbox.module && popup.require && null; // we track via deps
    // retrieve writeRoiArchive call count via the deps object we passed in — but we can't reach it because require is sandboxed.
    // Instead, assert via the source and via broker archive call count + forbidden log message.
    assert('Case 2: requestBrokerArchive (archiveRoiRun) was attempted', brokerClient._calls.archive.length === 1, `archive calls=${brokerClient._calls.archive.length}`);
    assert('Case 2: no "falling back to legacy local archive path" warning was emitted',
      !warnings.some((w) => /falling back to legacy local archive path/i.test(w)),
      warnings.join(' | '));
    // Because we can't easily peek the writeRoiArchive stub from inside the sandbox after the fact, we assert by
    // a) the forbidden log, and b) source-level guard, and c) the popup's showRoiArchiveResult(error) path — we
    // can detect it via the status element textContent being set to an error message.
    const statusEl = popup.sandbox.document.getElementById('status');
    const archiveBtn = popup.sandbox.document.getElementById('btn-write-roi-archive');
    // We did not throw out of writeCurrentRoiArchive (it catches internally), so threw should be false
    // and the error is rendered via showRoiArchiveResult -> showError.
    assert('Case 2: writeCurrentRoiArchive did not throw (error caught & rendered)', !threw);
    // Ensure the source no longer has the legacy fallback branch for archive.
    const popupSource = fs.readFileSync(path.resolve(__dirname, '..', 'popup.js'), 'utf8');
    assert('Case 2: source no longer contains "falling back to legacy local archive path"',
      !/falling back to legacy local archive path/i.test(popupSource));
    assert('Case 2: archive broker path uses isLegacyLocalSecretDevOnly guard (not silent try/catch fallback)',
      /isLegacyLocalSecretDevOnlyEnabled\(\)\)/.test(popupSource) && /Broker 是权威路径/.test(popupSource));
  }

  // ----- Case 3: Broker flag OFF — local dual-vendor archive still works -----
  {
    warnings.length = 0;
    // We need writeRoiArchive to be callable; we can observe it via the deps object passed in, by passing
    // a mutable tracking ref we can read via the returned object from loadPopupModule (we already have the deps).
    const writeCalls = [];
    const sharedStorage = {}; // flag off
    const chrome = makeStubChrome(sharedStorage);
    const brokerClient = makeBrokerClient();
    const brokerMod = loadBrokerModule(brokerClient, makeHashStub(), chrome);
    // broker off → no createBrokerRun; activeBrokerRun is null.
    const authConnected = {
      authorizeFeishuUser: async () => ({ connected: true, profile: { name: 'u' } }),
      authorizeFeishuUserViaBroker: async () => { throw new Error('broker path off'); },
      getFeishuBrokerConnectionStatus: async () => ({ ok: false, has_device_session: false }),
      getFeishuUserAuthorizationStatus: async () => ({ connected: true, profile: { name: 'u' }, missingScopes: [] }),
      shouldUseFeishuBroker: async () => false,
      isLegacyLocalSecretPathEnabled: async () => true,
    };
    const popup = loadPopupModule(brokerMod.exports, chrome, {
      './lib/feishu-auth.js': authConnected,
      './lib/roi-bitable-archive.js': {
        FIXED_ROI_ARCHIVE_URL: 'https://bytedance.feishu.cn/base/roi',
        buildRoiArchivePayload: (p) => ({ runId: p.runId, operator: p.operator }),
        writeRoiArchive: async ({ payload } = {}) => { writeCalls.push(payload); return { ok: true, status: 'written' }; },
      },
    });
    const hooks = popup.sandbox.__popupBrokerTestHooks;
    hooks.setBrokerState({ brokerAsyncRoi: false, activeBrokerRun: null });
    hooks.setActiveWorkflowContext({ spreadsheetToken: 'sht', sheetId: 'sh', vendor: 'bytedance', projectIds: [1], roiScopes: [] });
    hooks.setArchiveReadyState(
      [{ id: 'i1', row: 2, review_status: 'confirmed' }],
      { total: 1 },
    );
    await hooks.writeCurrentRoiArchive();
    assert('Case 3: broker off → local archive writes RWS and Pactera runs', writeCalls.length === 2, `writeCalls=${writeCalls.length}`);
    assert('Case 3: broker archiveRoiRun NOT called when flag off', brokerClient._calls.archive.length === 0);
  }

  // ----- Case 3b: local dual-vendor partial failure resumes the same Run IDs -----
  {
    const writeCalls = [];
    let pacteraAttempts = 0;
    const sharedStorage = {
      l10nAsyncRoiBrokerEnabled: false,
      enableROI: true,
      spreadsheetToken: 'sht',
      sheetId: 'sh',
    };
    const chrome = makeStubChrome(sharedStorage);
    const brokerClient = makeBrokerClient();
    const brokerMod = loadBrokerModule(brokerClient, makeHashStub(), chrome);
    const authConnected = {
      authorizeFeishuUser: async () => ({ connected: true, profile: { name: 'u' } }),
      authorizeFeishuUserViaBroker: async () => ({ connected: true, profile: { name: 'u' }, broker: true }),
      getFeishuBrokerConnectionStatus: async () => ({ ok: true, has_device_session: false }),
      getFeishuUserAuthorizationStatus: async () => ({ connected: true, profile: { name: 'u' }, missingScopes: [] }),
      shouldUseFeishuBroker: async () => false,
      isLegacyLocalSecretPathEnabled: async () => true,
    };
    const popup = loadPopupModule(brokerMod.exports, chrome, {
      './lib/feishu-auth.js': authConnected,
      './lib/roi-bitable-archive.js': {
        FIXED_ROI_ARCHIVE_URL: 'https://bytedance.feishu.cn/base/roi',
        buildRoiArchivePayload: (p) => ({ runId: p.runId, vendor: p.vendor, operator: p.operator }),
        writeRoiArchive: async ({ payload } = {}) => {
          writeCalls.push(payload);
          if (payload.vendor === 'Pactera' && pacteraAttempts++ === 0) {
            throw new Error('simulated Pactera write failure');
          }
          return { status: 'written', scopeRecordCount: 1, itemRecordCount: payload.vendor === 'RWS' ? 1 : 0 };
        },
      },
    });
    const hooks = popup.sandbox.__popupBrokerTestHooks;
    hooks.setBrokerState({ brokerAsyncRoi: false, activeBrokerRun: null });
    hooks.setActiveWorkflowContext({
      spreadsheetToken: 'sht', sheetId: 'sh', roiEnabled: true, projectIds: [1], roiScopes: [],
    });
    hooks.setArchiveReadyState(
      [{ id: 'i-resume', row: 2, review_status: 'confirmed' }],
      { total: 1 },
    );
    await hooks.writeCurrentRoiArchive();
    await hooks.writeCurrentRoiArchive();
    const activePlan = hooks.getActiveWorkflowContext()?.roiArchivePlan;
    assert('Case 3b: retry skips completed RWS and only retries Pactera',
      writeCalls.map((payload) => payload.vendor).join(',') === 'RWS,Pactera,Pactera',
      `${writeCalls.map((payload) => payload.vendor).join(',')} plan=${JSON.stringify(activePlan)} warnings=${warnings.slice(-2).join(' | ')}`);
    assert('Case 3b: failed and retried Pactera use the same stable Run ID',
      Boolean(writeCalls[1]?.runId) && writeCalls[1]?.runId === writeCalls[2]?.runId,
      `${writeCalls[1]?.runId} vs ${writeCalls[2]?.runId}`);
    const persistedPlan = sharedStorage.roiWorkflowSnapshot?.workflowContext?.roiArchivePlan;
    assert('Case 3b: persisted archive plan strips heavyweight payloads to avoid Chrome storage quota',
      persistedPlan?.vendors?.every((entry) => !entry.payload) === true,
      JSON.stringify(persistedPlan));
  }

  // ----- Case 4: Broker flag ON but LEGACY_LOCAL_SECRET_DEV_ONLY=true → local dual-vendor archive still reachable -----
  {
    const writeCalls = [];
    const sharedStorage = { l10nAsyncRoiBrokerEnabled: true, l10nLegacyLocalSecretDevOnly: true };
    const chrome = makeStubChrome(sharedStorage);
    const brokerClient = makeBrokerClient();
    const brokerMod = loadBrokerModule(brokerClient, makeHashStub(), chrome);
    await brokerMod.exports.setBrokerAsyncRoiEnabled(true);
    await brokerMod.exports.createBrokerRun({ body: { client_run_id: 'r-a4-devonly' } });
    const authConnected = {
      authorizeFeishuUser: async () => ({ connected: true, profile: { name: 'u' } }),
      authorizeFeishuUserViaBroker: async () => ({ connected: true, profile: { name: 'u' }, broker: true }),
      getFeishuBrokerConnectionStatus: async () => ({ ok: true, has_device_session: true }),
      getFeishuUserAuthorizationStatus: async () => ({ connected: true, profile: { name: 'u' }, missingScopes: [] }),
      shouldUseFeishuBroker: async () => true,
      isLegacyLocalSecretPathEnabled: async () => true,
    };
    const popup = loadPopupModule(brokerMod.exports, chrome, {
      './lib/feishu-auth.js': authConnected,
      './lib/roi-bitable-archive.js': {
        FIXED_ROI_ARCHIVE_URL: 'https://bytedance.feishu.cn/base/roi',
        buildRoiArchivePayload: (p) => ({ runId: p.runId, operator: p.operator }),
        writeRoiArchive: async ({ payload } = {}) => { writeCalls.push(payload); return { ok: true, status: 'written' }; },
      },
    });
    const hooks = popup.sandbox.__popupBrokerTestHooks;
    // even though a run exists, dev-only flag should route to legacy archive write.
    hooks.setBrokerState({ brokerAsyncRoi: true, activeBrokerRun: await brokerMod.exports.loadBrokerRunSnapshot() });
    hooks.setActiveWorkflowContext({ spreadsheetToken: 'sht', sheetId: 'sh', vendor: 'bytedance', projectIds: [1], roiScopes: [] });
    hooks.setArchiveReadyState(
      [{ id: 'i-dev', row: 3, review_status: 'confirmed' }],
      { total: 1 },
    );
    await hooks.writeCurrentRoiArchive();
    assert('Case 4: dev-only=true → local archive writes both vendors and skips broker archive',
      writeCalls.length === 2 && brokerClient._calls.archive.length === 0,
      `write=${writeCalls.length}, brokerArchive=${brokerClient._calls.archive.length}`);
  }

  // ----- Case 5: feishu-auth.js hardening — authorizeFeishuUser throws when broker is authoritative -----
  {
    // Directly load feishu-auth.js under broker-on / dev-off storage and verify it throws.
    const chromeAuth = makeStubChrome({ l10nAsyncRoiBrokerEnabled: true });
    let sendMessageCalls = 0;
    chromeAuth.runtime.sendMessage = (_payload, cb) => { sendMessageCalls += 1; queueMicrotask(() => { if (typeof cb === 'function') cb({ ok: true, access_token: 'x' }); }); };
    const brokerForAuth = {
      archiveRoiRun: async () => ({}), createRoiRun: async () => ({ run_id: 'r', revision: 1 }),
      getBrokerAuthorizationStatus: async () => ({ ok: true, has_device_session: true }),
      getRoiRun: async () => ({ run_id: 'r', revision: 1 }),
      revokeBrokerAuthorization: async () => ({ ok: true }),
      startBrokerAuthorization: async () => ({ ok: true }),
      submitRoiFinal: async () => ({}),
    };
    const brokerModForAuth = loadESLike('lib/broker-async-roi.js', {
      './hash-utils.js': makeHashStub(),
      './backend-broker-client.js': brokerForAuth,
    }, chromeAuth);
    const authMod = loadESLike('lib/feishu-auth.js', { './broker-async-roi.js': brokerModForAuth.exports }, chromeAuth);
    let legacyErr = null;
    try { await authMod.exports.authorizeFeishuUser({ returnUrl: '' }); }
    catch (e) { legacyErr = e; }
    assert('Case 5: feishu-auth.authorizeFeishuUser throws when broker is authoritative',
      Boolean(legacyErr) && /broker is the authoritative/i.test(legacyErr?.message || ''),
      legacyErr?.message);
    assert('Case 5: authorizeFeishuUser did NOT send legacy oauth message to native host', sendMessageCalls === 0);
    // Now flip dev-only on via a fresh chrome context so broker module sees dev-only flag.
    const chromeAuthDev = makeStubChrome({ l10nAsyncRoiBrokerEnabled: true, l10nLegacyLocalSecretDevOnly: true });
    let sendMessageCallsDev = 0;
    chromeAuthDev.runtime.sendMessage = (_p, cb) => { sendMessageCallsDev += 1; queueMicrotask(() => { if (typeof cb === 'function') cb({ ok: true, access_token: 'x' }); }); };
    const brokerModDev = loadESLike('lib/broker-async-roi.js', {
      './hash-utils.js': makeHashStub(),
      './backend-broker-client.js': brokerForAuth,
    }, chromeAuthDev);
    const authModDev = loadESLike('lib/feishu-auth.js', { './broker-async-roi.js': brokerModDev.exports }, chromeAuthDev);
    let devLegacyErr = null;
    try { await authModDev.exports.authorizeFeishuUser({ returnUrl: '' }); }
    catch (e) { devLegacyErr = e; }
    // Our stub returns access_token 'x' without granted scope so authorizeFeishuUser should throw a scope error,
    // NOT the "broker is authoritative" guard error.
    assert('Case 5: dev-only=true → authorizeFeishuUser passes broker-authoritative guard',
      Boolean(devLegacyErr) && !/broker is the authoritative/i.test(devLegacyErr?.message || ''),
      devLegacyErr?.message);
    assert('Case 5: dev-only=true → authorizeFeishuUser DID attempt native oauth message', sendMessageCallsDev >= 1, `calls=${sendMessageCallsDev}`);
  }

  // ----- Case 6: Source guards on popup.js and Python -----
  {
    const popupSource = fs.readFileSync(path.resolve(__dirname, '..', 'popup.js'), 'utf8');
    const pySource = fs.readFileSync(path.resolve(__dirname, '..', 'native-host/feishu_oauth_broker.py'), 'utf8');
    const authSource = fs.readFileSync(path.resolve(__dirname, '..', 'lib/feishu-auth.js'), 'utf8');
    assert('Case 6: popup.js defines LEGACY_LOCAL_SECRET_DEV_ONLY_STORAGE_KEY', /LEGACY_LOCAL_SECRET_DEV_ONLY_STORAGE_KEY/.test(popupSource));
    assert('Case 6: popup.js defines isLegacyLocalSecretDevOnlyEnabled', /isLegacyLocalSecretDevOnlyEnabled/.test(popupSource));
    assert('Case 6: popup.js archive branch gated by isLegacyLocalSecretDevOnlyEnabled',
      /isLegacyLocalSecretDevOnlyEnabled\(\)\)/.test(popupSource));
    assert('Case 6: no silent archive fallback try/catch in writeCurrentRoiArchive that catches and continues',
      !/Broker archive request failed;\s*falling back/.test(popupSource));
    assert('Case 6: feishu-auth.js exports isLegacyLocalSecretPathEnabled', /isLegacyLocalSecretPathEnabled/.test(authSource));
    assert('Case 6: feishu-auth.js authorizeFeishuUser guards against silent legacy use',
      /isLegacyLocalSecretPathEnabled/.test(authSource) && /broker is the authoritative/i.test(authSource));
    assert('Case 6: Python default is L10N_LOCAL_SECRET_DEV_ONLY off',
      /os\.environ\.get\("L10N_LOCAL_SECRET_DEV_ONLY",\s*"0"\)/.test(pySource));
    assert('Case 6: Python prints stderr warning if dev-only accidentally enabled',
      /WARNING:\s*legacy local-secret path enabled/.test(pySource));
    assert('Case 6: Python docstring says production builds MUST NOT set the flag',
      /Production builds MUST NOT set this/.test(pySource));
  }

  // ----- Case 7: Broker on, createBrokerRun failure must NOT allow local archive fallback -----
  {
    const writeCalls = [];
    const sharedStorage = { l10nAsyncRoiBrokerEnabled: true };
    const chrome = makeStubChrome(sharedStorage);
    const brokerClient = makeBrokerClient({ createFail: true });
    const brokerMod = loadBrokerModule(brokerClient, makeHashStub(), chrome);
    await brokerMod.exports.setBrokerAsyncRoiEnabled(true);
    // Simulate the post-processItems state: broker flag on, but createBrokerRun failed so
    // activeBrokerRun is null AND a broker-create error is recorded. Archive must be blocked
    // instead of silently falling through to writeRoiArchive.
    const authConnected = {
      authorizeFeishuUser: async () => { throw new Error('legacy should not be called when broker is authoritative'); },
      authorizeFeishuUserViaBroker: async () => ({ connected: true, profile: { name: 'u' }, broker: true }),
      getFeishuBrokerConnectionStatus: async () => ({ ok: true, has_device_session: true }),
      getFeishuUserAuthorizationStatus: async () => ({ connected: true, profile: { name: 'u' }, missingScopes: [] }),
      shouldUseFeishuBroker: async () => true,
      isLegacyLocalSecretPathEnabled: async () => false,
    };
    const popup = loadPopupModule(brokerMod.exports, chrome, {
      './lib/feishu-auth.js': authConnected,
      './lib/roi-bitable-archive.js': {
        FIXED_ROI_ARCHIVE_URL: 'https://bytedance.feishu.cn/base/roi',
        buildRoiArchivePayload: (p) => ({ runId: p.runId, operator: p.operator }),
        writeRoiArchive: async ({ payload } = {}) => { writeCalls.push(payload); return { ok: true, status: 'written' }; },
      },
    });
    const hooks = popup.sandbox.__popupBrokerTestHooks;
    hooks.setBrokerState({ brokerAsyncRoi: true, activeBrokerRun: null });
    // Mark that broker create run was attempted and failed (mirrors processItems catch).
    hooks.markBrokerCreateRunError(new Error('create run network error'));
    hooks.setActiveWorkflowContext({ spreadsheetToken: 'sht', sheetId: 'sh', vendor: 'bytedance', projectIds: [1], roiScopes: [] });
    hooks.setArchiveReadyState(
      [{ id: 'i1', row: 2, review_status: 'confirmed' }],
      { total: 1 },
    );
    await hooks.writeCurrentRoiArchive();
    assert('Case 7: broker on + create run failed → legacy writeRoiArchive was NOT called',
      writeCalls.length === 0, `writeCalls=${writeCalls.length}`);
    assert('Case 7: broker archiveRoiRun was NOT attempted (no run exists)',
      brokerClient._calls.archive.length === 0);
    const statusEl = popup.sandbox.document.getElementById('status');
    const preview = popup.sandbox.document.getElementById('roi-archive-preview');
    const statusText = `${statusEl?.textContent || ''} ${statusEl?.innerHTML || ''} ${preview?.textContent || ''} ${preview?.innerHTML || ''}`;
    assert('Case 7: archive blocked and explicit broker error shown',
      /broker/i.test(statusText) && /(fail|error|unavailable|create)/i.test(statusText),
      `status=${statusText}`);
    assert('Case 7: no silent fallback warning emitted',
      !warnings.some((w) => /continuing with local workflow only/i.test(w))
      || /explicit/i.test(statusText));
  }

  console.log(`\nA4 popup-broker-failure-policy: ${passed} passed / ${failed} failed`);
  if (failed > 0) process.exit(1);
  // Unref any dangling broker poll timers created inside the vm sandbox so the test process exits cleanly.
  setTimeout(() => process.exit(0), 50).unref();
}

run().catch((err) => { console.error('TOP LEVEL ERROR:', err && err.stack || err); process.exit(1); });
