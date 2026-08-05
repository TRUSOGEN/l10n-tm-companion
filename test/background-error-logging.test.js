/**
 * background.js 日志脱敏测试。
 *
 * Service Worker 是 classic script（manifest 未声明 type: module，测试也用 vm 直接加载），
 * 无法 import lib/ui-errors.js。因此后台日志的约定是：只打印错误类型/代码，
 * 完全不输出 error.message 与 error 对象本身，从根上杜绝凭据泄漏。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SECRET = 'AKLTsuper-secret-value-should-never-log';

function loadBackground({ panelError, injectError }) {
  const warnings = [];
  const noop = () => {};
  const sandbox = {
    console: {
      log: noop,
      error: noop,
      warn: (...args) => warnings.push(args),
    },
    chrome: {
      sidePanel: {
        setPanelBehavior() {
          return panelError ? Promise.reject(panelError) : Promise.resolve();
        },
      },
      runtime: {
        lastError: null,
        onMessage: { addListener(listener) { sandbox.__bgListener = listener; } },
        sendNativeMessage() {},
      },
      tabs: { query(_, cb) { cb([{ id: 1 }]); }, sendMessage() {} },
      scripting: {
        executeScript() {
          return injectError ? Promise.reject(injectError) : Promise.resolve();
        },
      },
    },
    setImmediate,
    setTimeout,
    Promise,
  };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
  vm.runInContext(source, sandbox, { filename: 'background.js' });
  return { sandbox, warnings };
}

function flatten(warnings) {
  return warnings
    .flat()
    .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg, Object.getOwnPropertyNames(arg || {}))))
    .join(' | ');
}

async function run() {
  // 1) Side Panel behavior 失败日志不得包含 message / error 对象
  const panelError = Object.assign(new Error(`setPanelBehavior failed: access_key=${SECRET}`), { code: 'E_SIDE_PANEL' });
  const panel = loadBackground({ panelError });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(panel.warnings.length, 1, '期望恰好一条 Side Panel 警告');
  const panelLog = flatten(panel.warnings);
  assert.doesNotMatch(panelLog, new RegExp(SECRET), '后台日志不得包含凭据');
  assert.doesNotMatch(panelLog, /setPanelBehavior failed/, '后台日志不得包含原始 error.message');
  assert.match(panelLog, /Error/, '应保留错误类型便于排查');
  assert.match(panelLog, /E_SIDE_PANEL/, '应保留错误代码便于排查');
  for (const args of panel.warnings) {
    for (const arg of args) {
      assert.ok(!(arg instanceof Error), 'console.warn 不得直接接收 Error 对象');
    }
  }

  // 2) content.js 兜底注入失败日志同样脱敏
  const injectError = Object.assign(new Error(`inject failed authorization: Bearer ${SECRET}`), { code: 'E_INJECT' });
  const inject = loadBackground({ injectError });
  await new Promise((resolve) => setImmediate(resolve));
  const ok = await inject.sandbox.injectContentScriptIfNeeded(1);
  assert.equal(ok, false, '注入失败应返回 false');
  const injectLog = flatten(inject.warnings);
  assert.doesNotMatch(injectLog, new RegExp(SECRET), '注入失败日志不得包含凭据');
  assert.doesNotMatch(injectLog, /inject failed/, '注入失败日志不得包含原始 message');
  assert.match(injectLog, /E_INJECT/, '注入失败日志应保留错误代码');
  for (const args of inject.warnings) {
    for (const arg of args) {
      assert.ok(!(arg instanceof Error), 'console.warn 不得直接接收 Error 对象');
    }
  }

  // 3) 源码守卫：background.js 不得再出现 error.message 直接进日志的写法
  const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
  for (const line of source.split('\n')) {
    if (!/console\.(warn|error|log)\(/.test(line)) continue;
    assert.doesNotMatch(line, /\?\.message/, `console 日志不得输出 error.message: ${line.trim()}`);
  }

  console.log('background-error-logging: all tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
