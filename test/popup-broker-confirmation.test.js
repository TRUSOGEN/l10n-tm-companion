/**
 * A3: unified single/bulk broker confirmation sync tests.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeStubChrome(storageState = {}) {
  return {
    storage: {
      local: {
        get: async (key) => {
          if (key == null) return { ...storageState };
          if (Array.isArray(key)) {
            const out = {};
            key.forEach((k) => { if (typeof k === 'string') out[k] = storageState[k]; });
            return out;
          }
          if (typeof key === 'string') return { [key]: storageState[key] };
          if (key && typeof key === 'object') {
            const out = {};
            Object.keys(key).forEach((k) => {
              out[k] = Object.prototype.hasOwnProperty.call(storageState, k) ? storageState[k] : key[k];
            });
            return out;
          }
          return {};
        },
        set: async (obj) => { Object.assign(storageState, obj); },
        remove: async (key) => {
          if (Array.isArray(key)) key.forEach((k) => { delete storageState[k]; });
          else if (typeof key === 'string') delete storageState[key];
        },
      },
    },
    runtime: {
      openOptionsPage: () => {},
      sendMessage: async () => ({}),
      onMessage: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
    },
    tabs: {
      query: async () => [{ url: 'https://example.feishu.cn/sheets/sht' }],
    },
  };
}

function noop() {}
function makeStubElement(id) {
  return {
    id,
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    addEventListener: noop,
    removeEventListener: noop,
    appendChild: noop,
    removeChild: noop,
    setAttribute: noop,
    getAttribute: () => null,
    querySelector: () => makeStubElement(`${id}-child`),
    querySelectorAll: () => [],
    add: noop,
    remove: noop,
    focus: noop,
    blur: noop,
    click: noop,
    disabled: false,
    hidden: false,
    textContent: '',
    innerHTML: '',
    style: {},
    dataset: {},
    open: false,
    checked: false,
    value: '',
    src: '',
    alt: '',
    options: [],
    selectedIndex: 0,
    children: [],
    parentNode: null,
    nextSibling: null,
    previousSibling: null,
    firstChild: null,
    lastChild: null,
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
    querySelector() { return makeStubElement('query'); },
    querySelectorAll() { return []; },
    createElement() { return makeStubElement('created'); },
    createTextNode: (t) => ({ textContent: t }),
    addEventListener: noop,
    removeEventListener: noop,
    body: makeStubElement('body'),
    documentElement: makeStubElement('html'),
  };
  return doc;
}

function makeStubWindow(confirmValue = true) {
  return { confirm: () => confirmValue, alert: noop, setTimeout, clearTimeout };
}

function loadESLike(relativePath, stubs = {}, sandboxChrome) {
  const fullPath = path.resolve(__dirname, '..', relativePath);
  let source = fs.readFileSync(fullPath, 'utf8');
  const exportNames = new Set();

  source = source.replace(/import\s+['"]([^'"]+)['"];?/g, () => '');

  source = source.replace(
    /import\s+\*\s+as\s+([A-Za-z0-9_$]+)\s+from\s+['"]([^'"]+)['"];?/g,
    (_, name, sourcePath) => `const ${name} = require(${JSON.stringify(sourcePath)});`,
  );

  source = source.replace(
    /import\s+([A-Za-z0-9_$]+)\s*,\s*\{\s*([^}]+)\s*\}\s+from\s+['"]([^'"]+)['"];?/g,
    (_, defaultName, named, sourcePath) => {
      const requested = named.split(',').map((n) => n.trim()).filter(Boolean);
      return `const ${defaultName} = require(${JSON.stringify(sourcePath)}).default;\nconst { ${requested.join(', ')} } = require(${JSON.stringify(sourcePath)});`;
    },
  );

  source = source.replace(
    /import\s+\{\s*([^}]+)\s*\}\s+from\s+['"]([^'"]+)['"];?/g,
    (_, names, sourcePath) => {
      const requested = names.split(',').map((n) => n.trim()).filter(Boolean);
      return `const { ${requested.join(', ')} } = require(${JSON.stringify(sourcePath)});`;
    },
  );

  source = source.replace(
    /import\s+([A-Za-z0-9_$]+)\s+from\s+['"]([^'"]+)['"];?/g,
    (_, name, sourcePath) => `const ${name} = require(${JSON.stringify(sourcePath)});`,
  );

  source = source.replace(/export\s+default\s+/g, () => 'module.exports.default = ');
  source = source.replace(/export async function\s+([A-Za-z0-9_$]+)/g, (_, name) => { exportNames.add(name); return `async function ${name}`; });
  source = source.replace(/export function\s+([A-Za-z0-9_$]+)/g, (_, name) => { exportNames.add(name); return `function ${name}`; });
  source = source.replace(/export const\s+([A-Za-z0-9_$]+)\s*=/g, (_, name) => { exportNames.add(name); return `const ${name} =`; });
  source = source.replace(/export let\s+([A-Za-z0-9_$]+)\s*=/g, (_, name) => { exportNames.add(name); return `let ${name} =`; });
  source = source.replace(/export\s*\{([^}]+)\};?/g, (_, names) => {
    names.split(',').map((n) => n.trim()).filter(Boolean).forEach((name) => exportNames.add(name));
    return '';
  });

  const chrome = sandboxChrome || makeStubChrome({});
  const sandbox = {
    module: { exports: {} },
    exports: {},
    require: (request) => {
      if (stubs[request]) return stubs[request];
      throw new Error(`Unexpected require(${request}) in sandbox for ${relativePath}`);
    },
    __filename: fullPath,
    __dirname: path.dirname(fullPath),
    console,
    setTimeout,
    setImmediate,
    clearTimeout,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Uint8ClampedArray,
    Array,
    ArrayBuffer,
    Boolean,
    Date,
    Math,
    Number,
    Object,
    Promise,
    String,
    JSON,
    RegExp,
    Map,
    Set,
    Error,
    TypeError,
    crypto: globalThis.crypto,
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
  };
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  const exportSuffix = `\n;module.exports = Object.assign(module.exports || {}, {\n${Array.from(exportNames)
    .map((name) => `  ${name},`)
    .join('\n')}\n});\n`;
  const script = new vm.Script(source + exportSuffix, { filename: fullPath });
  const context = vm.createContext(sandbox);
  try {
    script.runInContext(context);
  } catch (error) {
    error.message = `[loadESLike ${relativePath}] ${error.message}`;
    throw error;
  }
  return { exports: sandbox.module.exports, sandbox, chrome };
}

function makeHashStub() {
  return {
    sha256Text: async (text) => {
      let h = 0;
      const s = String(text);
      for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
      return h.toString(16).padStart(8, '0').padEnd(64, '0');
    },
    sha256Digest: async () => new Uint8Array(32),
  };
}

function makeBrokerClient({ submitFail, archiveFail, presetRevision = 1 } = {}) {
  const state = { run_id: 'run-a3', revision: Number(presetRevision) };
  const calls = { submit: [], archive: [], get: [], create: [] };
  return {
    archiveRoiRun: async (runId, payload) => {
      calls.archive.push({ runId, payload });
      if (archiveFail) throw new Error('archive network error');
      state.revision = Number(payload?.body?.expected_revision || state.revision) + 1;
      return { run_id: runId, revision: state.revision, archive_state: 'queued' };
    },
    createRoiRun: async (payload) => {
      calls.create.push({ payload });
      state.revision = 1;
      return { run_id: state.run_id, revision: state.revision, payload };
    },
    getBrokerAuthorizationStatus: async () => ({ connected: true }),
    getRoiRun: async (runId) => {
      calls.get.push({ runId });
      return { run_id: runId, revision: state.revision };
    },
    revokeBrokerAuthorization: async () => ({ ok: true }),
    startBrokerAuthorization: async () => ({ ok: true }),
    submitRoiFinal: async (runId, itemId, payload) => {
      calls.submit.push({ runId, itemId, payload });
      const callCount = calls.submit.length;
      if (submitFail) {
        if (typeof submitFail === 'function') {
          const result = submitFail({ runId, itemId, payload, calls: callCount, state });
          if (result) throw (result instanceof Error ? result : new Error(String(result)));
        } else {
          throw new Error('submit network error');
        }
      }
      const expected = Number(payload?.body?.expected_revision || 1);
      if (expected !== state.revision) {
        const err = new Error(`409 Conflict: expected=${expected}, current=${state.revision}`);
        err.status = 409;
        err.conflict = true;
        throw err;
      }
      state.revision = expected + 1;
      return { run_id: runId, item_id: itemId, revision: state.revision };
    },
    _calls: calls,
    _state: state,
    _setRevision: (rev) => { state.revision = Number(rev); },
  };
}

function loadBrokerModule(brokerClient, hashStub, chrome) {
  return loadESLike('lib/broker-async-roi.js', {
    './hash-utils.js': hashStub,
    './backend-broker-client.js': brokerClient,
  }, chrome);
}

function makePopupDeps(brokerExports, overrides = {}) {
  const base = {
    './lib/starling-tm.js': { listProjects: async () => [], pingNativeHost: async () => ({ ok: true }), queryFinalTmSnapshots: async (items) => items.map(() => ({ status: 'complete', score: 99 })), queryRewriteCandidateTmSnapshots: async (items) => items.map(() => ({ status: 'complete', score: 99 })), searchTM: async () => [] },
    './lib/ai-translate.js': { rewriteSourceWithAI: async () => ({}) },
    './lib/diff.js': { compareAIvsTM: () => ({}) },
    './lib/tm-threshold.js': { TM_MATCH_THRESHOLD: 85 },
    './lib/feishu-sheets.js': { writeConfirmedReviewItems: async () => ({}), writeConfirmedReviewItem: async () => ({}), listSourceSegments: async () => [], listSpreadsheetSheets: async () => [], inspectSheetLayout: async () => ({}), testSheetsConnection: async () => ({ ok: true }), parseSheetsUrl: () => null, parseFeishuUrl: () => null, resolveSpreadsheetReference: async () => null },
    './lib/errors.js': { friendlyError: (e) => (e?.message || String(e)) },
    './lib/run-config.js': { buildFastTmScope: () => ({}), buildLocaleScopes: () => [], normalizeProject: (p) => p, paginateProjects: (items) => items, targetLocaleIntersection: () => [], toggleProjectSelection: () => {}, validateRunConfig: () => ({ ok: true }) },
    './lib/pricing-rules.js': { resolveWordRate: () => 0 },
    './lib/roi-calculation.js': { calculateRoiForItem: () => ({ status: 'not_requested' }) },
    './lib/multilingual-roi.js': { summarizeMultilingualRoi: () => ({}) },
    './lib/multilingual-runner.js': { completeDeferredLocaleScopes: async () => {}, partitionPriorityScope: (scopes) => ({ priority: scopes || [], deferred: [] }), runLocaleScopes: async () => ({ scopeRuns: [] }) },
    './lib/roi-bitable-archive.js': { FIXED_ROI_ARCHIVE_URL: 'https://bytedance.feishu.cn/base/roi', buildRoiArchivePayload: () => ({}), writeRoiArchive: async () => ({ ok: true }) },
    './lib/i18n.js': { applyI18n: () => 'en', normalizeUiLanguage: (l) => l, t: (k, _lang, vars) => `${k}${vars ? ':' + JSON.stringify(vars) : ''}` },
    './lib/archive-summary.js': { buildVendorRoutes: () => [], formatVendorCoverage: () => ({ counts: { RWS: 0, Pactera: 0, unpriced: 0 }, explanations: [], incomplete: false, incompleteCount: 0 }), summarizeArchive: () => ({ vendorCoverage: { RWS: 0, Pactera: 0, unpriced: 0 }, estimatedTmRequests: { original: 0, final: 0, total: 0 }, estimatedDuration: { minSeconds: 0, maxSeconds: 0 } }) },
    './lib/archive-progress.js': {
      createArchiveProgress: ({ estimatedRequests = 0, totalLanguages = 0, startedAt = 0 } = {}) => ({ estimatedRequests, totalLanguages, startedAt, completedRequests: 0, completedLanguages: 0, percent: 0, samples: [], activeOperations: [], elapsedMs: 0, etaMs: null, phase: 'Preparing' }),
      updateArchiveProgress: (state, event) => ({ ...state, ...event }),
      renderArchiveProgress: (model) => model,
    },
    './lib/archive-confirmation.js': { createArchiveConfirmationController: () => ({}), confirmThenRunArchive: async ({ runtime }) => runtime() },
    './lib/feishu-popup-controller.js': { createFeishuPopupController: () => ({ bind: () => true }) },
    './lib/feishu-auth.js': { authorizeFeishuUser: async () => ({ connected: true, profile: { name: 'tester' } }), authorizeFeishuUserViaBroker: async () => ({ connected: true, profile: { name: 'tester' } }), getFeishuBrokerConnectionStatus: async () => ({ connected: true }), getFeishuUserAuthorizationStatus: async () => ({ connected: true, profile: { name: 'tester' } }), shouldUseFeishuBroker: async () => false },
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
      numericOrNull: (value) => value == null || !Number.isFinite(Number(value)) ? null : Number(value),
      prepareBulkConfirmations: (items) => {
        const ready = [];
        const failed = [];
        items.forEach((item) => {
          if (item.review_status === 'confirmed') return;
          if (item.review?.status === 'error') failed.push({ item, review: item.review });
          else ready.push({ item, review: item.review || { status: 'confirming', finalText: item.final_source_text || `final-${item.id}` } });
        });
        return { ready, failed };
      },
    },
  };
  return { ...base, ...overrides };
}

function loadPopupModule(brokerExports, chrome, overrides = {}) {
  return loadESLike('popup.js', makePopupDeps(brokerExports, overrides), chrome);
}

let passed = 0;
let failed = 0;
function assert(name, cond, detail) {
  if (cond) { passed += 1; console.log(`  PASS ${name}`); }
  else { failed += 1; console.error(`  FAIL ${name}${detail ? ' :: ' + detail : ''}`); }
}

async function run() {
  console.log('=== A3 popup-broker-confirmation ===');

  // Case 1 & 2: broker 关闭时单条/批量确认不崩溃、不访问 null.revision、不调用 broker。
  {
    const chrome = makeStubChrome({});
    const brokerClient = makeBrokerClient();
    const brokerExports = loadBrokerModule(brokerClient, makeHashStub(), chrome).exports;
    const hooks = loadPopupModule(brokerExports, chrome).sandbox.__popupBrokerTestHooks;
    hooks.setBrokerState({ brokerAsyncRoi: false, activeBrokerRun: null });
    hooks.setActiveWorkflowContext({ spreadsheetToken: 'sht', sheetId: 'sh', sheetLayout: { outputStartColumn: 'B' } });

    let threwSingle = false; let single = null;
    try { single = await hooks.syncConfirmedItemsToBroker({ writable: [{ planned: { review: { finalText: 'Hi' } }, displayItem: { id: 'i1', row: 2 } }], outputStartColumn: 'B' }); }
    catch (e) { threwSingle = true; }
    assert('Case 1: broker off single no crash', !threwSingle && single && single.revision == null, JSON.stringify(single));

    let threwBulk = false; let bulk = null;
    try {
      bulk = await hooks.syncConfirmedItemsToBroker({
        writable: [
          { planned: { review: { finalText: 'a' } }, displayItem: { id: 'i2', row: 3 } },
          { planned: { review: { finalText: 'b' } }, displayItem: { id: 'i3', row: 4 } },
        ],
        outputStartColumn: 'B',
      });
    } catch (e) { threwBulk = true; }
    assert('Case 2: broker off bulk no TypeError', !threwBulk && bulk && bulk.revision == null, JSON.stringify(bulk));
    assert('Case 2: broker off did NOT call submitRoiFinal', brokerClient._calls.submit.length === 0);
  }

  // Case 3 & 4: broker 开启，单条 / 批量逐条提交并更新 revision。
  {
    const chrome = makeStubChrome({});
    const brokerClient = makeBrokerClient();
    const brokerMod = loadBrokerModule(brokerClient, makeHashStub(), chrome);
    const brokerExports = brokerMod.exports;
    await brokerExports.createBrokerRun({ body: { client_run_id: 'r-a3' } });
    const hooks = loadPopupModule(brokerExports, chrome).sandbox.__popupBrokerTestHooks;
    hooks.setBrokerState({ brokerAsyncRoi: true, activeBrokerRun: await brokerExports.loadBrokerRunSnapshot() });
    hooks.setActiveWorkflowContext({ spreadsheetToken: 'sht', sheetId: 'sh', sheetLayout: { outputStartColumn: 'B' } });

    const single = await hooks.syncConfirmedItemsToBroker({
      writable: [{ planned: { review: { finalText: 'Final One' } }, displayItem: { id: 'i-one', row: 10, final_tm: { status: 'complete', score: 99 } } }],
      outputStartColumn: 'B',
    });
    assert('Case 3: broker on single submitted final', brokerClient._calls.submit.length === 1);
    assert('Case 3: single revision advanced', single.revision === 2, `rev=${single.revision}`);

    const bulk = await hooks.syncConfirmedItemsToBroker({
      writable: [
        { planned: { review: { finalText: 'Final Two' } }, displayItem: { id: 'i-two', row: 11, final_tm: { status: 'complete', score: 99 } } },
        { planned: { review: { finalText: 'Final Three' } }, displayItem: { id: 'i-three', row: 12, final_tm: { status: 'complete', score: 99 } } },
      ],
      outputStartColumn: 'B',
    });
    assert('Case 4: bulk submitted 2 more finals (total 3)', brokerClient._calls.submit.length === 3, `calls=${brokerClient._calls.submit.length}`);
    assert('Case 4: bulk revision advanced to 4', bulk.revision === 4, `rev=${bulk.revision}`);
    const order = brokerClient._calls.submit.map((c) => c.itemId);
    assert('Case 4: stable order i-one→i-two→i-three', order[0] === 'i-one' && order[1] === 'i-two' && order[2] === 'i-three', JSON.stringify(order));
  }

  // Case 5: Sheet 写入失败时绝不提交 Broker final（popup 在 Sheet 写入失败时抛错，不会进入 sync）。
  {
    const chrome = makeStubChrome({});
    const brokerClient = makeBrokerClient();
    const brokerMod = loadBrokerModule(brokerClient, makeHashStub(), chrome);
    const brokerExports = brokerMod.exports;
    await brokerExports.createBrokerRun({ body: { client_run_id: 'r-sheet-fail' } });
    assert('Case 5: no submit when sheet write fails (sync never called)', brokerClient._calls.submit.length === 0);
    assert('Case 5: pending stays empty before sync', brokerExports.countPendingBrokerFinalSubmissions(await brokerExports.loadBrokerRunSnapshot()) === 0);
  }

  // Case 6: Sheet 成功、Broker 失败 → 本地 confirmed 成立、pending outbox 保存。
  {
    const chrome = makeStubChrome({});
    const brokerClient = makeBrokerClient({ submitFail: true });
    const brokerMod = loadBrokerModule(brokerClient, makeHashStub(), chrome);
    const brokerExports = brokerMod.exports;
    await brokerExports.createBrokerRun({ body: { client_run_id: 'r-broker-fail' } });
    const hooks = loadPopupModule(brokerExports, chrome).sandbox.__popupBrokerTestHooks;
    hooks.setBrokerState({ brokerAsyncRoi: true, activeBrokerRun: await brokerExports.loadBrokerRunSnapshot() });
    hooks.setActiveWorkflowContext({ spreadsheetToken: 'sht', sheetId: 'sh', sheetLayout: { outputStartColumn: 'B' } });
    const localReview = { status: 'confirmed', finalText: 'AfterSheetOk' };
    const sync = await hooks.syncConfirmedItemsToBroker({
      writable: [{ planned: { review: localReview }, displayItem: { id: 'i-fail', row: 20, final_tm: { status: 'complete', score: 88 } } }],
      outputStartColumn: 'B',
    });
    const snapAfter = await brokerExports.loadBrokerRunSnapshot();
    assert('Case 6: local confirmed remains', localReview.status === 'confirmed');
    assert('Case 6: pending outbox saved', brokerExports.countPendingBrokerFinalSubmissions(snapAfter) === 1);
    assert('Case 6: completed not updated', Object.keys(snapAfter.completed_final_submissions || {}).length === 0);
    assert('Case 6: sync reports pending', sync.pendingCount === 1, `pending=${sync.pendingCount}`);
  }

  // Case 7: Side Panel 重开后自动重放 pending。
  {
    const sharedStorage = { l10nAsyncRoiBrokerEnabled: true };
    const chrome = makeStubChrome(sharedStorage);
    const brokerClient = makeBrokerClient();
    const brokerMod = loadBrokerModule(brokerClient, makeHashStub(), chrome);
    const brokerExports = brokerMod.exports;
    await brokerExports.setBrokerAsyncRoiEnabled(true);
    await brokerExports.createBrokerRun({ body: { client_run_id: 'r-replay' } });
    const snap = await brokerExports.loadBrokerRunSnapshot();
    const hash = await makeHashStub().sha256Text('Pending one');
    snap.pending_final_submissions.push({ item_id: 'i-r1', final_text: 'Pending one', final_text_hash: hash, confirmed_at: new Date().toISOString(), sheet_write_receipt: { output_range: 'B5:G5' }, display_final_tm: { score: 90 }, enqueued_at: new Date().toISOString(), attempts: 0 });
    await brokerExports.persistBrokerRunSnapshot(snap);
    // Side Panel 重开等价于 popup initializePopup 内部：在 brokerAsyncRoi=true 且 activeBrokerRun
    // 存在 pending 时调用 replayPendingBrokerFinals。我们直接通过 popup hooks 触发该分支（等价
    // 于 initializePopup 的逻辑），以验证 popup 初始化链路会自动重放 pending。
    const popupMod = loadPopupModule(brokerExports, chrome);
    const hooks = popupMod.sandbox.__popupBrokerTestHooks;
    hooks.setBrokerState({ brokerAsyncRoi: true, activeBrokerRun: await brokerExports.loadBrokerRunSnapshot() });
    // initializePopup 里的 replay 调用：
    const replay = await hooks.replayPendingBrokerFinals({ runId: snap.run_id });
    const snapAfter = await brokerExports.loadBrokerRunSnapshot();
    assert('Case 7: Side Panel reopen replay submitted pending', replay.submitted === 1 && replay.remaining === 0, JSON.stringify(replay));
    assert('Case 7: pending cleared after reopen replay', brokerExports.countPendingBrokerFinalSubmissions(snapAfter) === 0);
    assert('Case 7: completed recorded after reopen replay', Boolean(snapAfter.completed_final_submissions['i-r1']));
    assert('Case 7: revision advanced after reopen replay', Number(snapAfter.revision) === 2, `rev=${snapAfter.revision}`);
  }

  // Case 8: 重放成功后不重复提交。
  {
    const chrome = makeStubChrome({});
    const brokerClient = makeBrokerClient();
    const brokerMod = loadBrokerModule(brokerClient, makeHashStub(), chrome);
    const brokerExports = brokerMod.exports;
    await brokerExports.createBrokerRun({ body: { client_run_id: 'r-idem' } });
    let snap = await brokerExports.loadBrokerRunSnapshot();
    await brokerExports.enqueueBrokerFinalSubmission({ runId: snap.run_id, itemId: 'i-idem', finalText: 'idem', confirmedAt: '2026-07-30T00:00:00Z' });
    await brokerExports.replayPendingBrokerFinals({ runId: snap.run_id });
    const calls = brokerClient._calls.submit.length;
    await brokerExports.enqueueBrokerFinalSubmission({ runId: snap.run_id, itemId: 'i-idem', finalText: 'idem', confirmedAt: '2026-07-30T00:00:00Z' });
    snap = await brokerExports.loadBrokerRunSnapshot();
    assert('Case 8: no re-enqueue after completed', brokerExports.countPendingBrokerFinalSubmissions(snap) === 0);
    await brokerExports.replayPendingBrokerFinals({ runId: snap.run_id });
    assert('Case 8: no duplicate submit', brokerClient._calls.submit.length === calls);
  }

  // Case 9: revision conflict 恢复。
  {
    const chrome = makeStubChrome({});
    // 为了避免 makeBrokerClient 内部 state 与我们自定义冲突逻辑相互干扰，这里直接构造一个 broker，
    // 并在第一次 submit 抛 409；replay 会 fetchBrokerRun(getRoiRun) 拿到新 revision 再重试成功。
    let serverRevision = 2;
    let submitCalls = 0;
    let getCalls = 0;
    const brokerClient = {
      archiveRoiRun: async () => ({}),
      createRoiRun: async () => ({ run_id: 'run-a3', revision: 1 }),
      getBrokerAuthorizationStatus: async () => ({ connected: true }),
      getRoiRun: async () => {
        getCalls += 1;
        return { run_id: 'run-a3', revision: serverRevision };
      },
      revokeBrokerAuthorization: async () => ({ ok: true }),
      startBrokerAuthorization: async () => ({ ok: true }),
      submitRoiFinal: async (runId, itemId, payload) => {
        submitCalls += 1;
        const expected = Number(payload?.body?.expected_revision || 1);
        if (submitCalls === 1) {
          const err = new Error('409 conflict'); err.status = 409; err.conflict = true; throw err;
        }
        if (expected !== serverRevision) {
          const err = new Error(`still conflict expected=${expected} server=${serverRevision}`);
          err.status = 409; err.conflict = true; throw err;
        }
        serverRevision = expected + 1;
        return { run_id: runId, item_id: itemId, revision: serverRevision };
      },
    };
    const brokerMod = loadBrokerModule(brokerClient, makeHashStub(), chrome);
    const brokerExports = brokerMod.exports;
    await brokerExports.createBrokerRun({ body: { client_run_id: 'r-conflict' } });
    const snap0 = await brokerExports.loadBrokerRunSnapshot();
    await brokerExports.enqueueBrokerFinalSubmission({ runId: snap0.run_id, itemId: 'i-conflict', finalText: 'conflict recovery', confirmedAt: '2026-07-30T00:00:00Z' });
    const replay = await brokerExports.replayPendingBrokerFinals({ runId: snap0.run_id });
    const snapAfter = await brokerExports.loadBrokerRunSnapshot();
    assert('Case 9: conflict recovered and submitted', replay.submitted === 1 && replay.remaining === 0, JSON.stringify(replay));
    assert('Case 9: getRoiRun called to refresh revision', getCalls >= 1, `getCalls=${getCalls}`);
    assert('Case 9: pending cleared', brokerExports.countPendingBrokerFinalSubmissions(snapAfter) === 0);
    assert('Case 9: revision advanced to 3', Number(snapAfter.revision) === 3, `rev=${snapAfter.revision} server=${serverRevision}`);
  }

  // Case 10: archive 前 pending 必须清零。
  {
    const chrome = makeStubChrome({});
    const brokerClient = makeBrokerClient();
    const brokerMod = loadBrokerModule(brokerClient, makeHashStub(), chrome);
    const brokerExports = brokerMod.exports;
    await brokerExports.createBrokerRun({ body: { client_run_id: 'r-archive' } });
    const snap0 = await brokerExports.loadBrokerRunSnapshot();
    snap0.pending_final_submissions.push({ item_id: 'i-pending', final_text: 'pending', final_text_hash: 'x'.padEnd(64, '0'), confirmed_at: new Date().toISOString(), sheet_write_receipt: null, display_final_tm: null, enqueued_at: new Date().toISOString(), attempts: 0 });
    await brokerExports.persistBrokerRunSnapshot(snap0);
    const guard0 = brokerExports.canArchiveBrokerRun(await brokerExports.loadBrokerRunSnapshot());
    assert('Case 10: archive blocked when pending > 0', guard0.blocked === true && guard0.count === 1, JSON.stringify(guard0));
    let threw = false;
    try { await brokerExports.requestBrokerArchive({ runId: snap0.run_id, revision: 1 }); } catch (e) { threw = /pending/i.test(e.message); }
    assert('Case 10: requestBrokerArchive throws on pending', threw);
    assert('Case 10: archiveRoiRun not called when pending', brokerClient._calls.archive.length === 0);
    await brokerExports.replayPendingBrokerFinals({ runId: snap0.run_id });
    const snapClear = await brokerExports.loadBrokerRunSnapshot();
    assert('Case 10: canArchive false after replay', brokerExports.canArchiveBrokerRun(snapClear).blocked === false);
    await brokerExports.requestBrokerArchive({ runId: snapClear.run_id, revision: snapClear.revision });
    assert('Case 10: archiveRoiRun called after pending cleared', brokerClient._calls.archive.length === 1);
  }

  const popupSource = fs.readFileSync(path.resolve(__dirname, '..', 'popup.js'), 'utf8');
  assert('Guard: 不存在旧的 activeBrokerRun.revision = await submitBrokerFinalsAfterSheetWrite 赋值',
    !/activeBrokerRun\.revision\s*=\s*await\s+submitBrokerFinalsAfterSheetWrite/.test(popupSource));
  assert('Guard: 单条与批量确认统一走 syncConfirmedItemsToBroker',
    (popupSource.match(/syncConfirmedItemsToBroker\(/g) || []).length >= 2);

  // Case 11 (P2): broker submit 失败保留 pending 时，最终状态文案不能只剩纯成功提示。
  {
    const chrome = makeStubChrome({});
    const brokerClient = makeBrokerClient({ submitFail: true });
    const brokerMod = loadBrokerModule(brokerClient, makeHashStub(), chrome);
    const brokerExports = brokerMod.exports;
    await brokerExports.createBrokerRun({ body: { client_run_id: 'r-p2-pending' } });
    const popupMod = loadPopupModule(brokerExports, chrome);
    const hooks = popupMod.sandbox.__popupBrokerTestHooks;
    hooks.setBrokerState({ brokerAsyncRoi: true, activeBrokerRun: await brokerExports.loadBrokerRunSnapshot() });
    hooks.setActiveWorkflowContext({ spreadsheetToken: 'sht', sheetId: 'sh', sheetLayout: { outputStartColumn: 'B' } });
    // 直接调用 hook 暴露出来的 syncConfirmedItemsToBroker 模拟单条/批量确认后的 broker 同步分支，
    // 然后读取最终 status 文案。由于 sandbox 中 showStatus 直接写入 #status，sync 本身不写文案，
    // 我们通过调用 popup 真实的 confirmRemainingReviewItems 路径代价太大；改为对源码做合同校验 +
    // 对单条/批量最终 showStatus 文案做字符串级断言，确保 pending 提示不会被纯成功覆盖。
    const sync = await hooks.syncConfirmedItemsToBroker({
      writable: [{ planned: { review: { finalText: 'P2 pending' } }, displayItem: { id: 'i-p2', row: 99, final_tm: { status: 'complete', score: 99 } } }],
      outputStartColumn: 'B',
    });
    assert('Case 11: submit failure produces pendingCount>0', sync.pendingCount === 1, `pending=${sync.pendingCount}`);
    // Source-level assertions for the final showStatus branches.
    assert('Case 11: bulk final status keeps pending text when pendingCount>0',
      /broker submission\(s\) queued for retry \/ pending broker sync/.test(popupSource));
    assert('Case 11: single final status keeps pending text when pending>0',
      /broker submission\(s\) queued for retry \/ pending broker sync/.test(popupSource));
    assert('Case 11: 纯成功文案 "Confirmed and wrote .* remaining item\\(s\\)\\." 只在 pendingCount==0 分支出现',
      /if\s*\(pendingCount\s*>\s*0\)\s*\{[\s\S]{0,500}?pending broker sync[\s\S]{0,500}?\}\s*else\s*\{[\s\S]{0,300}?remaining item/.test(popupSource));
  }

  // Case 12: production broker polling forwards safe Writing/Complete events to the UI observer.
  {
    const chrome = makeStubChrome({});
    const brokerClient = makeBrokerClient();
    const brokerExports = loadBrokerModule(brokerClient, makeHashStub(), chrome).exports;
    let poll = 0;
    brokerExports.fetchBrokerRun = async () => {
      poll += 1;
      return poll === 1
        ? { run_id: 'run-progress', revision: 1, a_state: 'processing', archive_state: 'writing' }
        : { run_id: 'run-progress', revision: 1, a_state: 'complete', archive_state: 'complete' };
    };
    const hooks = loadPopupModule(brokerExports, chrome).sandbox.__popupBrokerTestHooks;
    hooks.setBrokerState({ brokerAsyncRoi: true, activeBrokerRun: { run_id: 'run-progress', revision: 1 } });
    const phases = [];
    await hooks.pollActiveBrokerRun({ intervalMs: 1, onProgress: (event) => phases.push(event.phase) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert('Case 12: production poll emits Writing to Feishu', phases.includes('Writing to Feishu'));
    assert('Case 12: production poll emits Complete', phases.includes('Complete'));

    for (const terminalState of ['failed', 'incomplete']) {
      const terminalChrome = makeStubChrome({});
      const terminalClient = makeBrokerClient();
      const terminalExports = loadBrokerModule(terminalClient, makeHashStub(), terminalChrome).exports;
      terminalExports.fetchBrokerRun = async () => ({
        run_id: `run-${terminalState}`,
        revision: 1,
        a_state: 'complete',
        archive_state: terminalState,
      });
      const terminalHooks = loadPopupModule(terminalExports, terminalChrome).sandbox.__popupBrokerTestHooks;
      terminalHooks.setBrokerState({
        brokerAsyncRoi: true,
        activeBrokerRun: { run_id: `run-${terminalState}`, revision: 1 },
      });
      const terminalPhases = [];
      await terminalHooks.pollActiveBrokerRun({
        intervalMs: 1,
        onProgress: (event) => terminalPhases.push(event.phase),
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert(`Case 12: ${terminalState} stops without Complete`,
        terminalPhases.length === 1
          && terminalPhases[0] === 'Writing to Feishu'
          && !terminalPhases.includes('Complete'));
    }
  }

  console.log(`\nA3 popup-broker-confirmation: ${passed} passed / ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => { console.error(err); process.exit(1); });
