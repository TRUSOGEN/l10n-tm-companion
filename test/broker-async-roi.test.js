/**
 * A2: async SHA-256 serialization test.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HELLO_SHA256 = '185f8db32271fe25f561a6fc938b2e264306ec304eda518007d1764826381969';
const HEX_64 = /^[0-9a-f]{64}$/;

function loadESLike(relativePath, stubs = {}) {
  const fullPath = path.resolve(__dirname, '..', relativePath);
  let source = fs.readFileSync(fullPath, 'utf8');
  const exportNames = new Set();

  source = source.replace(
    /import\s+\{\s*([^}]+)\s*\}\s+from\s+['"]([^'"]+)['"];?/g,
    (_, names, sourcePath) => {
      const requested = names.split(',').map((n) => n.trim()).filter(Boolean);
      return `const { ${requested.join(', ')} } = require(${JSON.stringify(sourcePath)});`;
    },
  );

  source = source.replace(/export async function\s+([A-Za-z0-9_$]+)/g, (_, name) => {
    exportNames.add(name);
    return `async function ${name}`;
  });
  source = source.replace(/export function\s+([A-Za-z0-9_$]+)/g, (_, name) => {
    exportNames.add(name);
    return `function ${name}`;
  });
  source = source.replace(/export const\s+([A-Za-z0-9_$]+)\s*=/g, (_, name) => {
    exportNames.add(name);
    return `const ${name} =`;
  });
  source = source.replace(/export let\s+([A-Za-z0-9_$]+)\s*=/g, (_, name) => {
    exportNames.add(name);
    return `let ${name} =`;
  });
  source = source.replace(/export\s*\{([^}]+)\};?/g, (_, names) => {
    const requested = names.split(',').map((n) => n.trim()).filter(Boolean);
    requested.forEach((name) => exportNames.add(name));
    return '';
  });

  const sandbox = {
    module: { exports: {} },
    exports: {},
    require: (request) => {
      if (stubs[request]) return stubs[request];
      return require(request);
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
    Array,
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
    crypto: globalThis.crypto,
    chrome: {
      storage: {
        local: {
          get: async () => ({}),
          set: async () => {},
          remove: async () => {},
        },
      },
    },
  };
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;

  const exportSuffix = `\nmodule.exports = {\n${Array.from(exportNames)
    .map((name) => `  ${name},`)
    .join('\n')}\n};\n`;
  const script = new vm.Script(source + exportSuffix, { filename: fullPath });
  const context = vm.createContext(sandbox);
  script.runInContext(context);
  return sandbox.module.exports;
}

async function run() {
  let failures = 0;

  const hashExports = loadESLike('lib/hash-utils.js');
  if (typeof hashExports.sha256Text !== 'function' || typeof hashExports.sha256Digest !== 'function') {
    failures += 1;
    console.error('FAIL: hash-utils exports missing sha256Text/sha256Digest');
  }

  const hello = await hashExports.sha256Text('Hello');
  if (hello !== HELLO_SHA256) {
    failures += 1;
    console.error('FAIL: Hello SHA-256 mismatch', hello);
  }
  const crlf = await hashExports.sha256Text('a\r\nb café');
  const lf = await hashExports.sha256Text('a\nb cafe\u0301');
  if (crlf !== lf || !HEX_64.test(crlf)) {
    failures += 1;
    console.error('FAIL: CRLF/LF/NFC hash mismatch or not 64 hex', crlf, lf);
  }
  const spaces = await hashExports.sha256Text('  a  b  ');
  const collapsed = await hashExports.sha256Text('a b');
  if (spaces === collapsed) {
    failures += 1;
    console.error('FAIL: spaces must not be trimmed/collapsed');
  }

  const brokerStub = {
    archiveRoiRun: async () => ({ revision: 1 }),
    createRoiRun: async (payload) => ({ run_id: 'run-1', revision: 1, payload: payload.body || payload }),
    getBrokerAuthorizationStatus: async () => ({ connected: false }),
    getRoiRun: async () => ({ run_id: 'run-1', revision: 1 }),
    revokeBrokerAuthorization: async () => ({ ok: true }),
    startBrokerAuthorization: async () => ({ ok: true }),
    submitRoiFinal: async (_runId, _itemId, payload) => ({ revision: 2, ...payload }),
  };
  const storageState = {};
  const chromeStub = {
    storage: {
      local: {
        get: async (key) => (typeof key === 'string' ? { [key]: storageState[key] } : {}),
        set: async (obj) => Object.assign(storageState, obj),
        remove: async () => {},
      },
    },
  };

  const brokerExports = loadESLike('lib/broker-async-roi.js', {
    './hash-utils.js': hashExports,
    './backend-broker-client.js': brokerStub,
  });
  brokerExports.chrome = chromeStub;
  // Inject chrome into module scope by re-executing bindings is unnecessary for payload tests because
  // payload helpers do not use chrome. Persistence APIs do, but they are not under direct hash assertions.

  const requiredAsyncHelpers = ['canonicalSourceHash', 'buildBrokerRunPayload', 'buildSheetReceipt'];
  for (const name of requiredAsyncHelpers) {
    if (typeof brokerExports[name] !== 'function') {
      failures += 1;
      console.error('FAIL: missing broker async helper export', name);
    }
  }

  const canonicalHello = await brokerExports.canonicalSourceHash('Hello');
  if (canonicalHello !== HELLO_SHA256) {
    failures += 1;
    console.error('FAIL: canonicalSourceHash(Hello) mismatch', canonicalHello);
  }

  const payload = await brokerExports.buildBrokerRunPayload({
    clientRunId: 'r-1',
    sourceLocale: 'en',
    targetLocale: 'fr',
    projectIds: ['278'],
    projects: [{ project_id: '278', name: 'TikTok_main' }],
    sheet: { document_token: 'sht', sheet_id: 'sh', source_range: 'A2:A3' },
    items: [
      { id: 'i1', row: 2, source_text: 'Hello' },
      { id: 'i2', row: 3, source_text: 'Book\r\ncafé' },
    ],
  });
  const stringified = JSON.stringify(payload);
  if (stringified.includes('source_hash":{}') || /"source_hash":"\[object Promise\]"/.test(stringified) || stringified.includes('source_hash":{')) {
    failures += 1;
    console.error('FAIL: payload contains Promise/object for source_hash');
  }
  const items = payload.body.items;
  if (!HEX_64.test(items[0].source_hash) || items[0].source_hash !== HELLO_SHA256) {
    failures += 1;
    console.error('FAIL: source_hash for Hello incorrect', items[0]);
  }
  if (!HEX_64.test(items[1].source_hash)) {
    failures += 1;
    console.error('FAIL: source_hash for second item invalid', items[1]);
  }

  function canonicalizeTextForTest(text) {
    return String(text || '').replace(/\r\n?/g, '\n').normalize('NFC');
  }

  const finalText = 'Final text  ';
  const expectedReceiptHash = await hashExports.sha256Text(canonicalizeTextForTest(finalText) + ':written');
  const receipt = await brokerExports.buildSheetReceipt({
    config: { spreadsheetToken: 'sht', sheetId: 'sh' },
    item: { row: 2 },
    finalText,
    outputStartColumn: 'B',
  });
  if (!receipt || !HEX_64.test(receipt.output_hash) || receipt.output_hash !== expectedReceiptHash) {
    failures += 1;
    console.error('FAIL: output_hash not awaited/valid', receipt);
  }
  if (receipt.output_range !== 'B2:G2') {
    failures += 1;
    console.error('FAIL: receipt output range wrong', receipt.output_range);
  }
  if (JSON.stringify(receipt).includes('output_hash":{}') || /"output_hash":"\[object Promise\]"/.test(JSON.stringify(receipt))) {
    failures += 1;
    console.error('FAIL: receipt contains Promise/object for output_hash');
  }

  const submitted = await brokerExports.submitBrokerFinal({
    runId: 'run-1',
    itemId: 'i1',
    revision: 1,
    finalText,
    confirmedAt: '2026-07-30T00:00:00.000Z',
    sheetWriteReceipt: receipt,
    displayFinalTm: { score: 99, match_category: '101' },
  });
  if (!HEX_64.test(submitted?.body?.final_text_hash) || submitted.body.final_text_hash !== expectedReceiptHash.replace(/:written$/, '') === false) {
    // final_text_hash is based on finalText only.
  }
  const finalHash = await hashExports.sha256Text(canonicalizeTextForTest(finalText));
  if (submitted?.body?.final_text_hash !== finalHash) {
    failures += 1;
    console.error('FAIL: final_text_hash not awaited/valid', submitted?.body?.final_text_hash, finalHash);
  }

  const popupSource = fs.readFileSync(path.resolve(__dirname, '..', 'popup.js'), 'utf8');
  const suspiciousPatterns = [
    /const\s+brokerPayload\s*=\s*buildBrokerRunPayload\(/,
    /const\s+receipt\s*=\s*buildSheetReceipt\(/,
    /final_text_hash\s*:\s*sha256Text\(/,
    /source_hash\s*:\s*(entry\.)?source_hash\s*\|\|\s*sha256Text\(/,
    /source_hash\s*:\s*sha256Text\(/,
    /output_hash\s*:\s*sha256Text\(/,
  ];
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(popupSource)) {
      failures += 1;
      console.error('FAIL: popup.js contains non-awaited hash/payload call', pattern);
    }
  }

  if (failures > 0) {
    console.error(`A2 hash/serialization test FAILED with ${failures} failure(s).`);
    process.exit(1);
  }
  console.log('PASS A2 hash/serialization: hashes are awaited 64-char hex strings and payloads serialize correctly.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
