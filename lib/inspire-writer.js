/**
 * Inspire Writer OpenAPI 客户端。
 *
 * 本模块只负责个人 Access Key 模式下的 Custom Agent 任务创建、状态轮询和
 * Writer 原生 copy 解析。
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

/** 从旧版 revisions 中选择最高分的非空候选，保留该导出以兼容既有调用方。 */
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
 * 将 Inspire OpenAPI 异常转为审阅卡可直接执行的简短说明。
 *
 * 原始异常不回显，避免服务端内容或凭证片段进入结果卡；未知异常仍保留“重试并检查”
 * 的明确边界，不把失败伪装成无 TM 或无改写空间。
 *
 * @param {unknown} error OpenAPI 或配置异常。
 * @returns {{reason:string,action:string}}
 */
export function explainInspireError(error) {
  const raw = String(error?.message || error || '');
  if (/Access Key is required/i.test(raw)) {
    return {
      reason: 'Inspire Access Key is missing.',
      action: 'Open Settings → LLM API and paste a personal wak_ Access Key.',
    };
  }
  if (/Custom Inspire Agent ID is required|Inspire Agent ID is required/i.test(raw)) {
    return {
      reason: 'No runnable Inspire Agent is selected.',
      action: 'Open Settings → LLM API and choose Default Agent or enter a published Custom Agent ID.',
    };
  }
  if (/Inspire API (401|403)\b/i.test(raw)) {
    return {
      reason: 'This Access Key cannot run the selected Agent.',
      action: 'Check the wak_ key, Agent ID, and its Team access in Settings.',
    };
  }
  if (/Inspire API (400|404)\b/i.test(raw)) {
    return {
      reason: 'The selected Agent or published version is unavailable.',
      action: 'Check the Agent ID, publish it in Inspire, and choose Latest published or a valid version.',
    };
  }
  if (/Inspire API 410\b|deprecated/i.test(raw)) {
    return {
      reason: 'The selected Agent version is deprecated.',
      action: 'Choose Latest published in Settings, or enter a current published version.',
    };
  }
  if (/output type must be chat/i.test(raw)) {
    return {
      reason: 'The selected Agent does not use native Chat copy output.',
      action: 'In Inspire, change Output type to Chat, publish the Agent, then try again.',
    };
  }
  if (/unexpected Agent version/i.test(raw)) {
    return {
      reason: 'The Agent did not run the pinned version.',
      action: 'Choose Latest published, or update the pinned version in Settings.',
    };
  }
  if (/no usable pass copy/i.test(raw)) {
    return {
      reason: 'The Agent completed without a usable copy.',
      action: 'Update its prompt to return native copy results only, publish it, then try again.',
    };
  }
  if (/task failed/i.test(raw)) {
    return {
      reason: 'The Agent task failed before producing a copy.',
      action: 'Open the Agent in Inspire, review its task error, then retry after publishing a fix.',
    };
  }
  if (/timed out/i.test(raw)) {
    return {
      reason: 'Inspire did not finish before the request timeout.',
      action: 'Retry once. If it persists, reduce the batch or check the Agent in Inspire.',
    };
  }
  return {
    reason: 'Inspire could not complete this rewrite.',
    action: 'Retry once. If it persists, check the Agent and Access Key in Settings.',
  };
}

/**
 * 创建一个 Inspire 改写任务并等待完成。
 *
 * @param {{prompt:string,config:object,fetchImpl?:Function}} input 调用参数。
 * @returns {Promise<{revision:string,title:string,score:number|null,candidates:object[],taskId:string,agentVersionNumber:number|null,durationMs:number}>}
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
    `${normalized.endpoint}/openapi/agents/${encodeURIComponent(normalized.agentId)}/tasks`,
    {
      method: 'POST',
      headers: inspireHeaders(normalized.accessKey),
      body: JSON.stringify({
        prompt,
        llmModel: normalized.model,
        thinkingLevel: normalized.thinkingLevel,
        ...(normalized.agentVersion == null ? {} : { version: normalized.agentVersion }),
      }),
    },
  );
  const taskId = String(createData?._id || '').trim();
  if (!taskId) throw new Error('Inspire create task response is missing _id');
  const returnedAgentId = String(createData?.customAgentId || '').trim();
  if (returnedAgentId && returnedAgentId !== normalized.agentId) {
    throw new Error(`Inspire task returned unexpected customAgentId: ${returnedAgentId}`);
  }
  const agentType = String(createData?.agentType || '').trim();
  if (agentType && agentType !== 'chat') {
    throw new Error(`Inspire Agent output type must be chat, got: ${agentType}`);
  }
  const returnedVersion = Number(createData?.agentVersionNumber);
  if (normalized.agentVersion != null && Number.isFinite(returnedVersion)
      && returnedVersion !== normalized.agentVersion) {
    throw new Error(`Inspire task returned unexpected Agent version: ${returnedVersion}`);
  }

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
  if (status !== 'completed') {
    const taskData = await request(
      'detail',
      `${normalized.endpoint}/openapi/tasks/${encodeURIComponent(taskId)}`,
      { headers: inspireHeaders(normalized.accessKey) },
    );
    const failedReason = String(taskData?.failedReason || '').trim();
    throw new Error(`Inspire task failed: ${taskId}${failedReason ? ` (${failedReason})` : ''}`);
  }

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
    candidates = normalizeAgentCopies(copiesData?.copies).slice(0, 3);
    best = candidates[0] || null;
    if (best || attempt === 3) break;
    await delay(normalized.pollIntervalMs);
  }
  if (!best) {
    throw new Error(
      `Inspire task completed with no usable pass copy: ${taskId} `
      + `(${summarizeCopiesResponse(lastCopiesData)}, promptChars=${prompt.length})`,
    );
  }
  return {
    ...best,
    candidates,
    taskId,
    agentVersionNumber: Number.isFinite(returnedVersion) ? returnedVersion : null,
    durationMs: Date.now() - startedAt,
    requestCount,
    pollCount,
  };
}

/** 把 Agent 的 pass copy 转为内部 revision 形状，并保持服务端顺序。 */
function normalizeAgentCopies(copies) {
  const seen = new Set();
  const output = [];
  (Array.isArray(copies) ? copies : []).forEach((copy) => {
    if (String(copy?.status || '') !== 'pass') return;
    const revision = typeof copy?.copy === 'string' ? copy.copy.trim() : '';
    const key = revision.replace(/\s+/g, ' ').toLocaleLowerCase();
    if (!revision || seen.has(key)) return;
    seen.add(key);
    output.push({
      revision,
      title: typeof copy?.summary === 'string' ? copy.summary.trim() : '',
      score: null,
      copyId: String(copy?._id || '').trim(),
      source: String(copy?.source || '').trim(),
    });
  });
  return output;
}

/** 只记录 copies 的数量与字段名，不把服务端生成内容写进错误。 */
function summarizeCopiesResponse(data) {
  const copies = Array.isArray(data?.copies) ? data.copies : [];
  const copyKeys = [...new Set(copies.flatMap((entry) => (
    entry && typeof entry === 'object' ? Object.keys(entry) : []
  )))].sort();
  const passCopies = copies.filter((copy) => String(copy?.status || '') === 'pass').length;
  return `copies=${copies.length}, passCopies=${passCopies}, copyKeys=${copyKeys.join('|') || 'none'}`;
}

/** 校验并规范化本机 Demo 所需的 Inspire 配置。 */
function normalizeConfig(config) {
  const accessKey = String(config.accessKey || '').trim();
  const agentId = String(config.agentId || '').trim();
  const rawAgentVersion = config.agentVersion;
  const agentVersion = rawAgentVersion == null || rawAgentVersion === ''
    ? null
    : Number(rawAgentVersion);
  const model = normalizeInspireModelId(config.model || 'gemini_3f');
  const thinkingLevel = String(config.thinkingLevel || 'low').trim();
  if (!accessKey) throw new Error('Inspire Access Key is required');
  if (!agentId) throw new Error('Inspire Agent ID is required');
  if (agentVersion != null && (!Number.isSafeInteger(agentVersion) || agentVersion <= 0)) {
    throw new Error(`Invalid Inspire Agent version: ${rawAgentVersion}`);
  }
  if (!['low', 'medium', 'high'].includes(thinkingLevel)) {
    throw new Error(`Invalid Inspire thinkingLevel: ${thinkingLevel}`);
  }
  return {
    endpoint: String(config.endpoint || DEFAULT_ENDPOINT).trim().replace(/\/+$/, ''),
    accessKey,
    agentId,
    agentVersion,
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
