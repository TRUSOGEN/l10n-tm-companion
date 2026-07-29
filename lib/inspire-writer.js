/**
 * Inspire Writer OpenAPI 客户端。
 *
 * 本模块只负责个人 Access Key 模式下的任务创建、状态轮询和 revisions 解析。
 * 它不访问 Chrome storage，也不决定业务 prompt，便于在浏览器与 Node 测试中复用。
 */

import { normalizeInspireModelId } from './inspire-models.js';

const DEFAULT_ENDPOINT = 'https://inspire.bytedance.net/writer/api';
const TERMINAL_STATUSES = new Set(['completed', 'failed']);

/**
 * 创建共享请求节流器，保证相邻 HTTP 请求起点满足指定 QPS 间隔。
 *
 * @param {{maxQps?:number,now?:Function,sleep?:Function}} options 限流与可测试时钟配置。
 * @returns {Function} 每次实际发起请求前必须等待的异步 gate。
 */
export function createRequestRateLimiter({
  maxQps = 10,
  now = () => Date.now(),
  sleep = delay,
} = {}) {
  const normalizedQps = Number(maxQps);
  if (!Number.isFinite(normalizedQps) || normalizedQps <= 0) {
    throw new Error(`Invalid Inspire max QPS: ${maxQps}`);
  }
  const intervalMs = 1000 / normalizedQps;
  let nextStartAt = 0;
  let queueTail = Promise.resolve();

  return async function waitForRequestSlot() {
    let releaseQueue;
    let requestStartAt;
    const previous = queueTail;
    queueTail = new Promise((resolve) => { releaseQueue = resolve; });
    await previous;
    try {
      const scheduledAt = Math.max(nextStartAt, now());
      const waitMs = Math.max(0, scheduledAt - now());
      if (waitMs > 0) await sleep(waitMs);
      requestStartAt = Math.max(scheduledAt, now());
      nextStartAt = requestStartAt + intervalMs;
    } finally {
      releaseQueue();
    }
    return requestStartAt;
  };
}

/** 从 revisions 中选择最高分的非空候选，并保留原始候选数据。 */
export function selectBestRevision(revisions) {
  const usable = (Array.isArray(revisions) ? revisions : [])
    .filter((entry) => typeof entry?.revision === 'string' && entry.revision.trim())
    .map((entry) => ({
      revision: entry.revision.trim(),
      title: typeof entry.title === 'string' ? entry.title : '',
      score: Number.isFinite(Number(entry.score)) ? Number(entry.score) : 0,
    }))
    .sort((left, right) => right.score - left.score);
  return usable[0] || null;
}

/**
 * 创建一个 Inspire 改写任务并等待完成。
 *
 * @param {{prompt:string,config:object,fetchImpl?:Function}} input 调用参数。
 * @returns {Promise<{revision:string,title:string,score:number,candidates:object[],taskId:string,durationMs:number}>}
 */
export async function createInspireRewrite({ prompt, config = {}, fetchImpl = fetch }) {
  const normalized = normalizeConfig(config);
  if (!String(prompt || '').trim()) throw new Error('Inspire prompt is required');

  const startedAt = Date.now();
  const deadlineAt = startedAt + normalized.timeoutMs;
  let requestCount = 0;
  let pollCount = 0;
  const request = (kind, url, init) => {
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) {
      throw new Error(`Inspire task timed out after ${normalized.timeoutMs}ms`);
    }
    requestCount += 1;
    if (kind === 'status') pollCount += 1;
    normalized.onRequest?.({ kind, requestCount, pollCount });
    return requestJson(
      url,
      init,
      fetchImpl,
      Math.min(normalized.requestTimeoutMs, remainingMs),
      normalized.requestGate,
    );
  };
  const createData = await request(
    'create',
    `${normalized.endpoint}/openapi/tasks`,
    {
      method: 'POST',
      headers: inspireHeaders(normalized.accessKey),
      body: JSON.stringify({
        prompt,
        teamId: normalized.teamId,
        llmModel: normalized.model,
        thinkingLevel: normalized.thinkingLevel,
      }),
    },
  );
  const taskId = String(createData?._id || '').trim();
  if (!taskId) throw new Error('Inspire create task response is missing _id');

  let status = String(createData.status || 'pending');
  while (!TERMINAL_STATUSES.has(status)) {
    if (Date.now() - startedAt >= normalized.timeoutMs) {
      throw new Error(`Inspire task timed out after ${normalized.timeoutMs}ms: ${taskId}`);
    }
    await delay(normalized.pollIntervalMs);
    const statusData = await request(
      'status',
      `${normalized.endpoint}/openapi/tasks/${encodeURIComponent(taskId)}/status`,
      { headers: inspireHeaders(normalized.accessKey) },
    );
    status = String(statusData?.status || '');
    if (!status) throw new Error(`Inspire task status response is invalid: ${taskId}`);
  }
  if (status !== 'completed') throw new Error(`Inspire task failed: ${taskId}`);

  let candidates = [];
  let best = null;
  let lastCopiesData = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const copiesData = await request(
      'copies',
      `${normalized.endpoint}/openapi/tasks/${encodeURIComponent(taskId)}/copies`,
      { headers: inspireHeaders(normalized.accessKey) },
    );
    lastCopiesData = copiesData;
    candidates = (copiesData?.copies || [])
      .flatMap((copy) => Array.isArray(copy?.revisions) ? copy.revisions : [])
      .filter((entry) => typeof entry?.revision === 'string' && entry.revision.trim())
      .map((entry) => ({
        revision: entry.revision.trim(),
        title: typeof entry.title === 'string' ? entry.title : '',
        score: Number.isFinite(Number(entry.score)) ? Number(entry.score) : 0,
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, 3);
    best = selectBestRevision(candidates);
    if (best || attempt === 3) break;
    await delay(normalized.pollIntervalMs);
  }
  if (!best) {
    throw new Error(
      `Inspire task completed with no usable revision: ${taskId} `
      + `(${summarizeCopiesResponse(lastCopiesData)}, promptChars=${prompt.length})`,
    );
  }
  return {
    ...best,
    candidates,
    taskId,
    durationMs: Date.now() - startedAt,
    requestCount,
    pollCount,
  };
}

/** 只记录 copies/revisions 的数量与字段名，不把服务端生成内容写进错误。 */
function summarizeCopiesResponse(data) {
  const copies = Array.isArray(data?.copies) ? data.copies : [];
  const revisions = copies.flatMap((copy) => Array.isArray(copy?.revisions) ? copy.revisions : []);
  const revisionKeys = [...new Set(revisions.flatMap((entry) => (
    entry && typeof entry === 'object' ? Object.keys(entry) : []
  )))].sort();
  return `copies=${copies.length}, revisions=${revisions.length}, revisionKeys=${revisionKeys.join('|') || 'none'}`;
}

/** 校验并规范化本机 Demo 所需的 Inspire 配置。 */
function normalizeConfig(config) {
  const accessKey = String(config.accessKey || '').trim();
  const teamId = String(config.teamId || '').trim();
  const model = normalizeInspireModelId(config.model || 'gemini_3f');
  const thinkingLevel = String(config.thinkingLevel || 'low').trim();
  if (!accessKey) throw new Error('Inspire Access Key is required');
  if (!teamId) throw new Error('Inspire teamId is required');
  if (!['low', 'medium', 'high'].includes(thinkingLevel)) {
    throw new Error(`Invalid Inspire thinkingLevel: ${thinkingLevel}`);
  }
  return {
    endpoint: String(config.endpoint || DEFAULT_ENDPOINT).trim().replace(/\/+$/, ''),
    accessKey,
    teamId,
    model,
    thinkingLevel,
    pollIntervalMs: Math.max(0, Number(config.pollIntervalMs ?? 2000)),
    timeoutMs: Math.max(1000, Number(config.timeoutMs ?? 120000)),
    requestTimeoutMs: Math.max(10, Number(config.requestTimeoutMs ?? 30000)),
    requestGate: typeof config.requestGate === 'function' ? config.requestGate : null,
    onRequest: typeof config.onRequest === 'function' ? config.onRequest : null,
  };
}

/** 生成 Access Key 模式的固定请求头。 */
function inspireHeaders(accessKey) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessKey}`,
  };
}

/** 执行一个 JSON 请求并把服务端错误原样带入异常。 */
async function requestJson(url, init, fetchImpl, timeoutMs, requestGate = null) {
  if (requestGate) await requestGate();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response?.ok) {
      const body = await response?.text?.();
      throw new Error(`Inspire API ${response?.status ?? 'unknown'}: ${String(body || '').slice(0, 300)}`);
    }
    return await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`Inspire request timed out after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** 等待下一次状态轮询；测试可把间隔设为 0。 */
function delay(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}
