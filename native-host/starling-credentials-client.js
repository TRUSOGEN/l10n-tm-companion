#!/usr/bin/env node
/**
 * Starling 官方配置凭证读写客户端。
 *
 * Python Native Host 通过 stdin 传入 save/get 动作；本脚本只调用已安装
 * `@byted/starling-agent-core` 的 saveConfig/loadConfig，不复制配置路径或格式。
 * stdout 始终只输出一条 JSON，save 响应不回显凭证，get 按 UI 需求返回完整值。
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

function readInput() {
  /** 读取 bridge 通过 stdin 发送的单条 JSON 请求。 */
  return JSON.parse(fs.readFileSync(0, 'utf8'));
}

function writeOutput(payload) {
  /** 向 bridge 输出唯一的机器可读 JSON 结果。 */
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function loadStarlingCore() {
  /** 从 starling-cli 安装目录加载官方 ESM 配置实现。 */
  const cliRoot = process.env.STARLING_AGENT_CLI_ROOT;
  if (!cliRoot) {
    throw new Error('STARLING_AGENT_CLI_ROOT is required');
  }
  const coreEntry = path.join(
    cliRoot,
    'node_modules',
    '@byted',
    'starling-agent-core',
    'dist',
    'index.js',
  );
  if (!fs.existsSync(coreEntry)) {
    throw new Error('Starling Core ESM entrypoint not found');
  }
  return import(pathToFileURL(coreEntry).href);
}

function requireCredential(value, field) {
  /** 校验 save 动作的完整非空凭证字段。 */
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  return value;
}

async function main() {
  /** 执行官方配置 save/get，并使用稳定字段名与 bridge 通信。 */
  const input = readInput();
  const { loadConfig, saveConfig } = await loadStarlingCore();
  if (input.action === 'save') {
    saveConfig({
      accessKey: requireCredential(input.access_key, 'access_key'),
      secretKey: requireCredential(input.secret_key, 'secret_key'),
    });
    writeOutput({ ok: true });
    return;
  }
  if (input.action === 'get') {
    const config = await loadConfig();
    writeOutput({
      ok: true,
      access_key: config.accessKey || '',
      secret_key: config.secretKey || '',
    });
    return;
  }
  throw new Error('Unsupported credentials action');
}

main().catch(() => {
  writeOutput({ ok: false, error: 'Starling credentials operation failed' });
  process.exitCode = 1;
});
