/**
 * Starling 官方配置凭证 helper 回归测试。
 *
 * 测试用临时 Starling Core 固定 saveConfig/loadConfig 的字段协议，并验证 helper
 * 不截断 AK/SK、官方配置文件权限为 0600，且 stdout 仅返回机器可读结果。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '..');
const helperPath = path.join(repoRoot, 'native-host', 'starling-credentials-client.js');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'starling-credentials-test-'));
const cliRoot = path.join(tempRoot, 'cli');
const coreRoot = path.join(
  cliRoot,
  'node_modules',
  '@byted',
  'starling-agent-core',
);
const coreDist = path.join(coreRoot, 'dist');
const configPath = path.join(tempRoot, 'home', '.starling-cli', '.starlingrc.json');

fs.mkdirSync(coreDist, { recursive: true });
fs.writeFileSync(
  path.join(coreRoot, 'package.json'),
  JSON.stringify({ type: 'module' }),
);
fs.writeFileSync(
  path.join(coreDist, 'index.js'),
  `import fs from 'node:fs';
import path from 'node:path';
const configPath = process.env.TEST_STARLING_CONFIG;
export function saveConfig(config) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
}
export async function loadConfig() {
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}
`,
);

function callHelper(input) {
  const result = spawnSync(process.execPath, [helperPath], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: path.join(tempRoot, 'home'),
      STARLING_AGENT_CLI_ROOT: cliRoot,
      TEST_STARLING_CONFIG: configPath,
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim());
}

try {
  const saveResult = callHelper({
    action: 'save',
    access_key: 'test-ak',
    secret_key: 'test-sk',
  });
  assert.equal(saveResult.ok, true, 'save 应成功');

  const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(saved.accessKey, 'test-ak', '官方配置应收到完整 AK');
  assert.equal(saved.secretKey, 'test-sk', '官方配置应收到完整 SK');
  assert.equal(fs.statSync(configPath).mode & 0o777, 0o600, '配置文件权限应为 0600');

  const getResult = callHelper({ action: 'get' });
  assert.equal(getResult.ok, true, 'get 应成功');
  assert.equal(getResult.access_key, 'test-ak', 'get 应返回完整 AK');
  assert.equal(getResult.secret_key, 'test-sk', 'get 应返回完整 SK');
  console.log('starling credentials client: 8 passed, 0 failed');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
