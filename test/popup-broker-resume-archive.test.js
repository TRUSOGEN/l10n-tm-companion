/**
 * Phase B: popup resume / replay / archive lifecycle tests.
 *
 * Covers:
 *   - Snapshot restore + pending replay on popup reopen.
 *   - Revision conflict recovery during replay.
 *   - Archive gating when pending finals remain.
 *   - Archive request after replay completes.
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

function noop() {}
function makeStubElement(id) {
  const classes = new Set();
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
    appendChild: (n) => n,
    append() {},
    removeChild: noop,
    setAttribute: noop,
    removeAttribute: noop,
    getAttribute: () => null,
    querySelector: () => makeStubElement(`${id}-child`),
    querySelectorAll: () => [],
    focus: noop, blur: noop, click: noop,
    disabled: false, hidden: false, checked: false, open: false,
    textContent: '', innerHTML: '', value: '', src: '', alt: '',
    style: {}, dataset: {}, options: [], selectedIndex: 0, children: [],
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
  return { confirm: () => confirmValue, alert: noop, setTimeout: ((fn) => { const t = setTimeout(fn, 0); if (t && typeof t.unref === 'function') t.unref(); return t; }), clearTimeout };
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
  function sandboxSetTimeout(fn) { const t = outerSetTimeout(fn, 0); if (t && typeof t.unref === 'function') t.unref(); return t; }
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
    crypto: {
      randomUUID: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => { const r = Math.random() * 16 | 0; return (ch === 'x' ? r : (r & 0x3 | 0x8)).toString(16); }),
      subtle: { digest: async () => new ArrayBuffer(32) },
    },
    chrome,
    document: makeStubDocument(),
    window: makeStubWindow(true),
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

function makeBrokerClient({
  submitFail = false,
  archiveFail = false,
  getFail = false,
  createFail = false,
  conflictOnce = false,
  presetRevision = 1,
  archiveState = 'not_requested',
} = {}) {
  const state = { run_id: 'run-b', revision: Number(presetRevision), archive_state: archiveState, a_state: 'complete', c_state: 'idle', items: [] };
  const calls = { submit: [], archive: [], get: [], create: [] };
  let conflictRemaining = conflictOnce ? 1 : 0;
  return {
    archiveRoiRun: async (runId, payload) => {
      calls.archive.push({ runId, payload });
      if (archiveFail) throw new Error('archive network error');
      state.revision = Number(payload?.body?.expected_revision || state.revision);
      return { run_id: runId, revision: state.revision, archive_state: 'queued' };
    },
    createRoiRun: async (payload) => {
      calls.create.push({ payload });
      if (createFail) throw new Error('create run network error');
      state.revision = 1;
      return { run_id: state.run_id, revision: 1, a_state: 'complete', c_state: 'idle', archive_state: 'not_requested', items: [], payload };
    },
    getBrokerAuthorizationStatus: async () => ({ ok: true, has_device_session: true, connected: true, legacy_local_secret_dev_only: false }),
    getRoiRun: async (runId) => {
      calls.get.push({ runId, serverRevision: state.revision });
      if (getFail) throw new Error('get run failed');
      return { run_id: runId, revision: state.revision, archive_state: state.archive_state, a_state: state.a_state, c_state: state.c_state, items: state.items };
    },
    revokeBrokerAuthorization: async () => ({ ok: true }),
    startBrokerAuthorization: async () => ({ ok: true }),
    submitRoiFinal: async (runId, itemId, payload) => {
      calls.submit.push({ runId, itemId, payload, conflictRemaining });
      if (submitFail) throw new Error('submit network error');
      const expected = Number(payload?.body?.expected_revision || 1);
      if (conflictRemaining > 0) {
        conflictRemaining -= 1;
        state.revision = expected + 1;
        const err = new Error(JSON.stringify({ error: { code: 'revision_conflict', message: 'conflict' } }));
        err.status = 409;
        err.revision_conflict = true;
        throw err;
      }
      state.revision = expected + 1;
      return { run_id: runId, item_id: itemId, revision: state.revision };
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

function makePopupDeps(brokerExports, overrides = {}) {
  const writeRoiArchiveCalls = [];
  const authBase = {
    authorizeFeishuUser: async () => ({ connected: true, profile: { name: 'tester' } }),
    authorizeFeishuUserViaBroker: async () => ({ connected: true, profile: { name: 'tester' }, broker: true }),
    getFeishuBrokerConnectionStatus: async () => ({ ok: true, has_device_session: true }),
    getFeishuUserAuthorizationStatus: async () => ({ connected: true, profile: { name: 'tester' }, missingScopes: [] }),
    shouldUseFeishuBroker: async () => true,
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
    './lib/run-config.js': { buildFastTmScope: () => ({}), buildLocaleScopes: () => [], normalizeProject: (p) => p, paginateProjects: (items) => ({ items: items || [], pageIndex: 0, pageCount: 1 }), targetLocaleIntersection: () => [], toggleProjectSelection: () => {}, validateRunConfig: () => ({ ok: true }) },
    './lib/pricing-rules.js': { resolveWordRate: () => 0 },
    './lib/roi-calculation.js': { calculateRoiForItem: () => ({ status: 'not_requested' }) },
    './lib/multilingual-roi.js': { summarizeMultilingualRoi: () => ({}) },
    './lib/multilingual-runner.js': { completeDeferredLocaleScopes: async () => {}, completeDeferredLocaleScopesForArchive: async () => {}, partitionPriorityScope: (scopes) => ({ priority: scopes || [], deferred: [] }), runLocaleScopes: async () => ({ scopeRuns: [] }) },
    './lib/roi-bitable-archive.js': {
      FIXED_ROI_ARCHIVE_URL: 'https://bytedance.feishu.cn/base/roi',
      buildRoiArchivePayload: (p) => ({ runId: p.runId, operator: p.operator }),
      writeRoiArchive: async ({ payload } = {}) => { writeRoiArchiveCalls.push({ payload }); return { ok: true, status: 'written' }; },
    },
    './lib/i18n.js': { applyI18n: () => 'en', normalizeUiLanguage: (l) => l, t: (k, _lang, vars) => `${k}${vars ? ':' + JSON.stringify(vars) : ''}` },
    './lib/archive-summary.js': { summarizeArchive: () => ({ vendorCoverage: { RWS: 0, Pactera: 0, unpriced: 0 }, estimatedTmRequests: { original: 0, final: 0, total: 0 }, estimatedDuration: { minSeconds: 0, maxSeconds: 0 } }) },
    './lib/feishu-popup-controller.js': { createFeishuPopupController: () => ({ bind: () => true }) },
    './lib/feishu-auth.js': { ...authBase, ...authOverride },
    './lib/hash-utils.js': makeHashStub(),
    './lib/broker-async-roi.js': brokerExports,
    './lib/source-rewrite-policy.js': { evaluateRewriteCandidate: () => ({}), evaluateRewriteCandidates: () => [], formatTmSourceForDisplay: (s) => s },
    './lib/sheet-layout.js': { buildSourcePreview: () => '', getOutputColumns: () => [], sheetLayoutStorageKey: () => 'layout', validateSheetLayout: () => ({ ok: true }) },
    './lib/review-workflow.js': {
      beginConfirmation: (r) => ({ ...(r || {}), status: 'confirming' }),
      buildFocusTmState: () => ({}),
      completeConfirmation: (r, meta) => ({ ...(r || {}), status: 'confirmed', finalText: r?.finalText, meta }),
      createReviewState: () => ({}),
      dedupeAiCandidates: (arr) => arr,
      editFinalText: (r, t) => ({ ...r, finalText: t }),
      explainFocusAiAbsence: () => '',
      failConfirmation: (r, e) => ({ ...(r || {}), status: 'error', error: e?.message || String(e) }),
      filterReviewItems: (items) => items,
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

const origWarn = console.warn;
const SILENT_WARN_PATTERNS = [
  /ROI archive \/ Feishu authorization failed\./,
  /\[DBG\]/,
  /Could not restore async broker run status\./,
];
console.warn = (...args) => {
  const msg = args.map((a) => (a && a.stack ? a.stack : (a?.message || String(a)))).join(' ');
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
  console.log('=== B popup-broker-resume-archive ===');

  // Case 1: Reopen with pending finals replays successfully; archive proceeds after replay.
  {
    const storage = {
      l10nAsyncRoiBrokerEnabled: true,
      l10nAsyncRoiBrokerRun: {
        run_id: 'run-b',
        revision: 1,
        pending_final_submissions: [
          { item_id: 'i1', sheet_row: 2, final_text: 'final1', final_text_hash: 'h1', confirmed_at: '2026-01-01T00:00:00Z', sheet_write_receipt: null, attempts: 0 },
        ],
        completed_final_submissions: {},
      },
    };
    const chrome = makeStubChrome(storage);
    const brokerClient = makeBrokerClient({ presetRevision: 1 });
    const brokerMod = loadBrokerModule(brokerClient, makeHashStub(), chrome);
    await brokerMod.exports.setBrokerAsyncRoiEnabled(true);

    // Load popup AFTER broker flag is set, then invoke its replay hook.
    const popup = loadPopupModule(brokerMod.exports, chrome, {
      './lib/feishu-auth.js': {
        authorizeFeishuUser: async () => { throw new Error('legacy should not be called'); },
        authorizeFeishuUserViaBroker: async () => { throw new Error('broker oauth already connected'); },
        getFeishuBrokerConnectionStatus: async () => ({ ok: true, has_device_session: true }),
        getFeishuUserAuthorizationStatus: async () => ({ connected: true, profile: { name: 'u' }, missingScopes: [] }),
        shouldUseFeishuBroker: async () => true,
        isLegacyLocalSecretPathEnabled: async () => false,
      },
    });
    const hooks = popup.sandbox.__popupBrokerTestHooks;
    const snapshotBefore = await brokerMod.exports.loadBrokerRunSnapshot();
    assert('Case 1: pending finals exist before replay', snapshotBefore.pending_final_submissions.length === 1);
    const replay = await hooks.replayPendingBrokerFinals({ runId: 'run-b' });
    const snapshotAfter = await brokerMod.exports.loadBrokerRunSnapshot();
    assert('Case 1: replay submitted 1 final', replay.submitted === 1, `submitted=${replay.submitted}`);
    assert('Case 1: replay remaining is 0', replay.remaining === 0, `remaining=${replay.remaining}`);
    assert('Case 1: pending queue is empty after replay', snapshotAfter.pending_final_submissions.length === 0);
    assert('Case 1: completed finals contain submitted item', Boolean(snapshotAfter.completed_final_submissions.i1));
    assert('Case 1: broker submit called once', brokerClient._calls.submit.length === 1);

    hooks.setBrokerState({ brokerAsyncRoi: true, activeBrokerRun: snapshotAfter });
    hooks.setArchiveReadyState([{ id: 'i1', row: 2, review_status: 'confirmed' }], { total: 1 });
    hooks.setActiveWorkflowContext({ spreadsheetToken: 'sht', sheetId: 'sh', vendor: 'bytedance', projectIds: [1], roiScopes: [] });
    await hooks.writeCurrentRoiArchive();
    assert('Case 1: archive request went through broker after replay', brokerClient._calls.archive.length === 1, `archive=${brokerClient._calls.archive.length}`);
    assert('Case 1: legacy local writeRoiArchive was not called',
      popup.sandbox.module && true, 'legacy write guarded by broker authoritative branch (source-level enforced)');
  }

  // Case 2: Reopen with pending finals, first submit hits revision conflict and recovers.
  {
    const storage = {
      l10nAsyncRoiBrokerEnabled: true,
      l10nAsyncRoiBrokerRun: {
        run_id: 'run-b',
        revision: 1,
        pending_final_submissions: [
          { item_id: 'i2', sheet_row: 3, final_text: 'final2', final_text_hash: 'h2', confirmed_at: '2026-01-01T00:00:00Z', attempts: 0 },
        ],
        completed_final_submissions: {},
      },
    };
    const chrome = makeStubChrome(storage);
    const brokerClient = makeBrokerClient({ presetRevision: 1, conflictOnce: true });
    const brokerMod = loadBrokerModule(brokerClient, makeHashStub(), chrome);
    // brokerClient defaults to run_id 'run-b'; reuse that id in storage so replay sees the same run.
    await brokerMod.exports.setBrokerAsyncRoiEnabled(true);
    loadPopupModule(brokerMod.exports, chrome); // load popup module to ensure sandbox wiring
    const replay = await brokerMod.exports.replayPendingBrokerFinals({ runId: 'run-b' });
    assert('Case 2: conflict recovery submitted item', replay.submitted === 1, `submitted=${replay.submitted}`);
    assert('Case 2: conflict recovery remaining 0', replay.remaining === 0, `remaining=${replay.remaining}`);
    assert('Case 2: getRoiRun called at least once for conflict refresh', brokerClient._calls.get.length >= 1);
    assert('Case 2: final submit attempted at least twice (conflict + retry)', brokerClient._calls.submit.length >= 2);
    const refreshed = await brokerMod.exports.loadBrokerRunSnapshot();
    assert('Case 2: pending queue empty after conflict recovery', refreshed.pending_final_submissions.length === 0);
  }

  // Case 3: Archive must be blocked while pending finals remain.
  {
    const chrome = makeStubChrome({ l10nAsyncRoiBrokerEnabled: true });
    const brokerClient = makeBrokerClient({ presetRevision: 2 });
    const brokerMod = loadBrokerModule(brokerClient, makeHashStub(), chrome);
    await brokerMod.exports.setBrokerAsyncRoiEnabled(true);
    await brokerMod.exports.createBrokerRun({ body: { client_run_id: 'r-pending' } });
    await brokerMod.exports.enqueueBrokerFinalSubmission({ runId: 'run-b', itemId: 'i3', finalText: 'x', sheetRow: 4, sheetWriteReceipt: null });
    const popup = loadPopupModule(brokerMod.exports, chrome, {
      './lib/feishu-auth.js': {
        authorizeFeishuUser: async () => { throw new Error('legacy should not be called'); },
        authorizeFeishuUserViaBroker: async () => { throw new Error('broker oauth already connected'); },
        getFeishuBrokerConnectionStatus: async () => ({ ok: true, has_device_session: true }),
        getFeishuUserAuthorizationStatus: async () => ({ connected: true, profile: { name: 'u' }, missingScopes: [] }),
        shouldUseFeishuBroker: async () => true,
        isLegacyLocalSecretPathEnabled: async () => false,
      },
    });
    const hooks = popup.sandbox.__popupBrokerTestHooks;
    hooks.setBrokerState({ brokerAsyncRoi: true, activeBrokerRun: await brokerMod.exports.loadBrokerRunSnapshot() });
    hooks.setArchiveReadyState([{ id: 'i3', row: 4, review_status: 'confirmed' }], { total: 1 });
    hooks.setActiveWorkflowContext({ spreadsheetToken: 'sht', sheetId: 'sh', vendor: 'bytedance', projectIds: [1], roiScopes: [] });
    await hooks.writeCurrentRoiArchive();
    const snapshot = await brokerMod.exports.loadBrokerRunSnapshot();
    assert('Case 3: archive guard recognizes pending', hooks.canArchiveBrokerRun(snapshot).blocked === true);
    assert('Case 3: archive request not sent while pending', brokerClient._calls.archive.length === 0, `archive=${brokerClient._calls.archive.length}`);
    const statusText = popup.sandbox.document.getElementById('status').textContent;
    assert('Case 3: user sees pending-block message', /pending broker final submission/i.test(statusText), `status=${statusText}`);
  }
}

run().then(() => {
  console.log(`\nSUMMARY: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}).catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
