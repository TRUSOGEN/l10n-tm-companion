#!/usr/bin/env node
/**
 * Starling 批量 TM Match HTTP 客户端。
 *
 * Python bridge 通过 stdin 传入请求体与 PPE 开关；本脚本复用已安装
 * `@byted/starling-agent-cli` 的 `@byted/starling-agent-core`，由官方
 * StarlingClient 读取本机 AK/SK 并生成 agw-auth 签名。
 *
 * stdout 只输出一条 JSON 结果，不输出凭证、签名或请求 Header。
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
  /** 从 starling-cli 安装目录加载官方 ESM 签名客户端。 */
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
    throw new Error(`Starling Core ESM entrypoint not found: ${coreEntry}`);
  }
  return import(pathToFileURL(coreEntry).href);
}

function normalizeError(error) {
  /** 仅保留排障所需字段，禁止把凭证或请求 Header 写回 stdout。 */
  const candidate = error && typeof error === 'object' ? error : {};
  return {
    message: String(candidate.message || error || 'Unknown Starling request error'),
    status: Number.isInteger(candidate.status) ? candidate.status : 0,
    logid: candidate.logid || null,
  };
}

async function main() {
  /** 调用批量 TM Match 接口并返回原始业务 JSON。 */
  const input = readInput();
  const { loadConfig, StarlingClient } = await loadStarlingCore();
  const config = await loadConfig();
  const client = new StarlingClient(config);
  const headers = input.use_ppe === true
    ? {
      'x-use-ppe': '1',
      'x-tt-env': 'ppe_openapi_integ',
    }
    : undefined;
  const response = await client.postWithHeaders(
    '/corpus/tm/match/batch',
    input.body,
    headers,
  );
  writeOutput({ ok: true, response });
}

main().catch((error) => {
  writeOutput({ ok: false, error: normalizeError(error) });
  process.exitCode = 1;
});
