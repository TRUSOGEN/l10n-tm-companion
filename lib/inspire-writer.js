/**
 * Inspire Writer OpenAPI 客户端。
 *
 * 本模块只负责个人 Access Key 模式下的任务创建、状态轮询和 revisions 解析。
 * 它不访问 Chrome storage，也不决定业务 prompt，便于在浏览器与 Node 测试中复用。
 */

const DEFAULT_ENDPOINT = 'https://inspire.bytedance.net/writer/api';
const TERMINAL_STATUSES = new Set(['completed', 'failed']);

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
  const createData = await requestJson(
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
    fetchImpl,
    normalized.timeoutMs,
  );
  const taskId = String(createData?._id || '').trim();
  if (!taskId) throw new Error('Inspire create task response is missing _id');

  let status = String(createData.status || 'pending');
  while (!TERMINAL_STATUSES.has(status)) {
    if (Date.now() - startedAt >= normalized.timeoutMs) {
      throw new Error(`Inspire task timed out after ${normalized.timeoutMs}ms: ${taskId}`);
    }
    await delay(normalized.pollIntervalMs);
    const statusData = await requestJson(
      `${normalized.endpoint}/openapi/tasks/${encodeURIComponent(taskId)}/status`,
      { headers: inspireHeaders(normalized.accessKey) },
      fetchImpl,
      normalized.timeoutMs,
    );
    status = String(statusData?.status || '');
    if (!status) throw new Error(`Inspire task status response is invalid: ${taskId}`);
  }
  if (status !== 'completed') throw new Error(`Inspire task failed: ${taskId}`);

  const copiesData = await requestJson(
    `${normalized.endpoint}/openapi/tasks/${encodeURIComponent(taskId)}/copies`,
    { headers: inspireHeaders(normalized.accessKey) },
    fetchImpl,
    normalized.timeoutMs,
  );
  const candidates = (copiesData?.copies || [])
    .flatMap((copy) => Array.isArray(copy?.revisions) ? copy.revisions : [])
    .filter((entry) => typeof entry?.revision === 'string' && entry.revision.trim())
    .map((entry) => ({
      revision: entry.revision.trim(),
      title: typeof entry.title === 'string' ? entry.title : '',
      score: Number.isFinite(Number(entry.score)) ? Number(entry.score) : 0,
    }))
    .sort((left, right) => right.score - left.score);
  const best = selectBestRevision(candidates);
  if (!best) throw new Error(`Inspire task completed with no usable revision: ${taskId}`);
  return {
    ...best,
    candidates,
    taskId,
    durationMs: Date.now() - startedAt,
  };
}

/** 校验并规范化本机 Demo 所需的 Inspire 配置。 */
function normalizeConfig(config) {
  const accessKey = String(config.accessKey || '').trim();
  const teamId = String(config.teamId || '').trim();
  const model = String(config.model || 'gemini_3f').trim();
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
async function requestJson(url, init, fetchImpl, timeoutMs) {
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
