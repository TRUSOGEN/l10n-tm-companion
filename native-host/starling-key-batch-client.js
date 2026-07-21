#!/usr/bin/env node
/**
 * Starling Source String Key 批量查询客户端。
 *
 * Python bridge 通过 stdin 提供原文与项目 ID；本脚本在单个 Node 进程内复用已安装
 * `@byted/starling-agent-core` 的 `StarlingClient`，并发调用 `/project/search`。
 * 这保留逐个 source/project 的 Starling 查询语义，同时避免为每一次查询启动
 * `starling-cli` 子进程。stdout 只输出机器可读业务结果，绝不输出凭证、签名或 Header。
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const EMPTY_RESULT_MAX_ATTEMPTS = 4;

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
  if (!cliRoot) throw new Error('STARLING_AGENT_CLI_ROOT is required');
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

function errorMessage(error) {
  /** 仅保留服务端排障所需的错误文本。 */
  return String(error?.message || error || 'Unknown Starling key search error');
}

async function mapWithConcurrency(values, concurrency, worker) {
  /** 以确定的最大并发度执行异步任务并保持输入顺序。 */
  const results = new Array(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function searchOne(client, sourceText, projectId) {
  /** 查询一个 source/project 组合；空结果按既有策略最多尝试四次。 */
  let lastResponse = null;
  for (let attempt = 0; attempt < EMPTY_RESULT_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await client.get('/project/search', {
        projectId,
        searchScope: 0,
        searchKey: sourceText,
      });
      lastResponse = response;
      if (Array.isArray(response?.data) && response.data.length > 0) break;
    } catch (error) {
      return { project_id: projectId, error: errorMessage(error) };
    }
  }
  return { project_id: projectId, response: lastResponse };
}

async function main() {
  /** 执行所有 source/project 组合，并逐条保留候选响应供 Python 做精确匹配判定。 */
  const input = readInput();
  const texts = Array.isArray(input.texts) ? input.texts : [];
  const projectIds = Array.isArray(input.project_ids) ? input.project_ids : [];
  const maxConcurrency = Number.isInteger(input.max_concurrency)
    ? Math.min(Math.max(input.max_concurrency, 1), 16)
    : 8;
  if (texts.length === 0 || projectIds.length === 0) {
    throw new Error('texts and project_ids must be non-empty arrays');
  }

  const { loadConfig, StarlingClient } = await loadStarlingCore();
  const client = new StarlingClient(await loadConfig());
  const requests = [];
  texts.forEach((sourceText, textIndex) => {
    projectIds.forEach((projectId) => {
      requests.push({ textIndex, sourceText, projectId });
    });
  });
  const candidates = await mapWithConcurrency(requests, maxConcurrency, (request) =>
    searchOne(client, request.sourceText, request.projectId).then((result) => ({
      text_index: request.textIndex,
      ...result,
    }))
  );
  const results = texts.map((sourceText, index) => ({
    source_text: sourceText,
    candidates: candidates.filter((candidate) => candidate.text_index === index)
      .map(({ text_index, ...candidate }) => candidate),
  }));
  writeOutput({ ok: true, results });
}

main().catch((error) => {
  writeOutput({ ok: false, error: { message: errorMessage(error) } });
  process.exitCode = 1;
});
