// 批量 TM 客户端必须通过官方 ESM 入口加载 Core，避免 CommonJS 的 p-retry 导入兼容性问题。
const fs = require('fs');
const path = require('path');

const clientPath = path.join(__dirname, '..', 'native-host', 'starling-batch-client.js');
const source = fs.readFileSync(clientPath, 'utf8');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

test('使用 ESM Core 入口', () => {
  assert(
    /'dist',\s*'index\.js'/.test(source) && source.includes('pathToFileURL(coreEntry).href'),
    '批量客户端必须从 Core 的 ESM entrypoint 动态导入',
  );
});

test('主流程等待异步 Core 加载', () => {
  assert(
    source.includes('await loadStarlingCore()'),
    '主流程必须等待异步 ESM 导入完成',
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
