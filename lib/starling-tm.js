/**
 * Starling TM 查询封装
 * =====================
 * 通过 background.js 转发到 Native Messaging Host
 * (native-host/starling-bridge.py → 批量 TM API 或旧版 Starling CLI)。
 *
 * Content Script / 普通页面无法直接 sendNativeMessage，
 * 故统一走 background 中转。
 */

/**
 * @param {string[]} texts       原文案列表
 * @param {string}   sourceLang  源语言，如 'en'
 * @param {string}   targetLang  目标语言，如 'zh'
 * @param {object}   [opts]     { cliPath, projectId, projectIds, tmMode, usePpe }
 * @returns {Promise<Array>}     TM 结果数组
 */
export async function searchTM(texts, sourceLang, targetLang, opts = {}) {
  const payload = {
    action: 'search_tm',
    texts: texts || [],
    source_lang: sourceLang || 'en',
    target_lang: targetLang || 'zh',
  };
  if (opts.cliPath) payload.cli_path = opts.cliPath;
  if (Array.isArray(opts.projectIds) && opts.projectIds.length) {
    payload.project_ids = opts.projectIds
      .map((projectId) => Number(projectId))
      .filter((projectId) => Number.isInteger(projectId) && projectId > 0);
  } else if (opts.projectId) {
    payload.project_id = Number(opts.projectId);
  }
  if (opts.tmMode) payload.tm_mode = opts.tmMode;
  if (opts.tmMode === 'legacy' && Array.isArray(payload.project_ids)) {
    if (payload.project_ids.length !== 1) {
      throw new Error('legacy_requires_single_project');
    }
    [payload.project_id] = payload.project_ids;
    delete payload.project_ids;
  }
  if (opts.usePpe === true) payload.use_ppe = true;
  if (opts.accessKey && opts.secretKey) {
    payload.access_key = opts.accessKey;
    payload.secret_key = opts.secretKey;
  }

  const response = await chrome.runtime.sendMessage({
    action: 'native_search_tm',
    payload,
  });

  if (chrome.runtime.lastError) {
    throw new Error(chrome.runtime.lastError.message);
  }
  if (response?.error) {
    throw new Error(response.error);
  }
  return response?.results || [];
}

/**
 * 查询 AI 改写文本的第二次真实 Starling TM 快照。
 *
 * 只查询首轮未达到门槛且确实生成了非空改写文本的条目。返回数组与输入条目严格
 * 同序：没有改写的条目标记为 `not_required`；任何 Native Messaging、接口响应或
 * 返回数量异常都会使本次待查询条目标记为 `incomplete`，不会伪造 0 分结果。
 *
 * @param {Array<{reached_threshold?:boolean,ai_translation?:string}>} items 本轮已完成 AI 阶段的条目。
 * @param {string} sourceLang Starling source locale。
 * @param {string} targetLang Starling target locale。
 * @param {object} [opts] 与 `searchTM()` 相同的查询配置。
 * @returns {Promise<Array<object>>} 与输入同序的 post-rewrite TM 快照。
 */
export async function queryPostRewriteTmSnapshots(items, sourceLang, targetLang, opts = {}) {
  const snapshots = (items || []).map(() => ({ status: 'not_required' }));
  const eligibleIndexes = [];

  (items || []).forEach((item, index) => {
    const rewrite = typeof item?.ai_translation === 'string'
      ? item.ai_translation.trim()
      : '';
    if (item?.reached_threshold !== true && rewrite) eligibleIndexes.push(index);
  });
  if (eligibleIndexes.length === 0) return snapshots;

  try {
    const rewrites = eligibleIndexes.map((index) => items[index].ai_translation.trim());
    const results = await searchTM(rewrites, sourceLang, targetLang, opts);
    if (!Array.isArray(results) || results.length !== eligibleIndexes.length) {
      throw new Error(
        `post_rewrite_tm_response_count_mismatch: got ${Array.isArray(results) ? results.length : 'non-array'}, expected ${eligibleIndexes.length}`
      );
    }
    results.forEach((result, resultIndex) => {
      if (!result || typeof result !== 'object') {
        throw new Error(`post_rewrite_tm_response_invalid_at_index_${resultIndex}`);
      }
      if (!Number.isFinite(result.similarity)) {
        throw new Error(`post_rewrite_tm_score_invalid_at_index_${resultIndex}`);
      }
      const index = eligibleIndexes[resultIndex];
      snapshots[index] = {
        status: 'complete',
        score: result.similarity,
        tmMatch: result.tm_match || '',
        tmSource: result.tm_source || '',
        origin: result.origin || '',
        method: result.method || 'starling',
        methodVersion: result.method_version || '',
        candidateCount: result.candidate_count ?? 0,
        match_category: result.match_category ?? null,
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    eligibleIndexes.forEach((index) => {
      snapshots[index] = {
        status: 'incomplete',
        reason: 'post_rewrite_tm_query_failed',
        error: message,
      };
    });
  }
  return snapshots;
}

/**
 * 查询 CD 最终确认文案 C 的第三次真实 Starling TM 快照。
 *
 * 只有非空 `final_source_text` 才能进入最终查询。C 是实际送翻文本，调用方必须把
 * 失败状态保留下来并阻止正式 ROI，不能用 A 或 B 的历史分数替代。
 *
 * @param {Array<{final_source_text?:string}>} items 已由 CD 确认的条目。
 * @param {string} sourceLang Starling source locale。
 * @param {string} targetLang Starling target locale。
 * @param {object} [opts] 与 `searchTM()` 相同的查询配置。
 * @returns {Promise<Array<object>>} 与输入同序的最终 TM 快照。
 */
export async function queryFinalTmSnapshots(items, sourceLang, targetLang, opts = {}) {
  const snapshots = (items || []).map(() => ({ status: 'not_ready' }));
  const eligibleIndexes = [];
  (items || []).forEach((item, index) => {
    const finalSource = typeof item?.final_source_text === 'string'
      ? item.final_source_text.trim()
      : '';
    if (finalSource) eligibleIndexes.push(index);
  });
  if (eligibleIndexes.length === 0) return snapshots;

  try {
    const finalSources = eligibleIndexes.map((index) => items[index].final_source_text.trim());
    const results = await searchTM(finalSources, sourceLang, targetLang, opts);
    if (!Array.isArray(results) || results.length !== eligibleIndexes.length) {
      throw new Error(
        `final_tm_response_count_mismatch: got ${Array.isArray(results) ? results.length : 'non-array'}, expected ${eligibleIndexes.length}`
      );
    }
    results.forEach((result, resultIndex) => {
      if (!result || typeof result !== 'object') {
        throw new Error(`final_tm_response_invalid_at_index_${resultIndex}`);
      }
      if (!Number.isFinite(result.similarity)) {
        throw new Error(`final_tm_score_invalid_at_index_${resultIndex}`);
      }
      snapshots[eligibleIndexes[resultIndex]] = {
        status: 'complete',
        score: result.similarity,
        tmMatch: result.tm_match || '',
        tmSource: result.tm_source || '',
        origin: result.origin || '',
        method: result.method || 'starling',
        methodVersion: result.method_version || '',
        candidateCount: result.candidate_count ?? 0,
        match_category: result.match_category ?? null,
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    eligibleIndexes.forEach((index) => {
      snapshots[index] = {
        status: 'incomplete',
        reason: 'final_tm_query_failed',
        error: message,
      };
    });
  }
  return snapshots;
}

/**
 * 探测 native host 是否可用（不查询 TM）。
 * @returns {Promise<{pong:boolean, cli:string}|{error:string}>}
 */
export async function pingNativeHost(opts = {}) {
  const payload = { action: 'ping' };
  if (opts.cliPath) payload.cli_path = opts.cliPath;

  const response = await chrome.runtime.sendMessage({
    action: 'native_search_tm',
    payload,
  });

  if (chrome.runtime.lastError) {
    return { error: chrome.runtime.lastError.message };
  }
  return response?.error ? { error: response.error } : response;
}

/**
 * 拉取 Starling 项目列表（设置页「项目卡片选择」用）。
 * @param {object} [opts] { cliPath }
 * @returns {Promise<{ok:boolean, projects?:Array<{id,name,source_language,target_language}>, error?:string}>}
 */
export async function listProjects(opts = {}) {
  const payload = { action: 'list_projects' };
  if (opts.cliPath) payload.cli_path = opts.cliPath;
  if (opts.accessKey && opts.secretKey) {
    payload.access_key = opts.accessKey;
    payload.secret_key = opts.secretKey;
  }

  const response = await chrome.runtime.sendMessage({
    action: 'native_search_tm',
    payload,
  });

  if (chrome.runtime.lastError) {
    return { ok: false, error: chrome.runtime.lastError.message };
  }
  return response || { ok: false, error: 'No response received' };
}

/**
 * 通过 Native Host 将完整 AK/SK 写入官方 Starling CLI 配置。
 *
 * @param {{accessKey:string, secretKey:string, cliPath?:string}} opts 凭证与可选 CLI 路径。
 * @returns {Promise<{ok:boolean}>} 官方配置写入结果。
 */
export async function saveStarlingCredentials(opts) {
  const payload = {
    action: 'save_starling_credentials',
    access_key: opts.accessKey,
    secret_key: opts.secretKey,
  };
  if (opts.cliPath) payload.cli_path = opts.cliPath;
  const response = await chrome.runtime.sendMessage({
    action: 'native_search_tm',
    payload,
  });
  if (chrome.runtime.lastError) {
    throw new Error(chrome.runtime.lastError.message);
  }
  if (response?.error || response?.ok !== true) {
    throw new Error(response?.error || 'Starling credentials save failed');
  }
  return response;
}

/**
 * 从 Native Host 的官方 Starling CLI 配置读取完整 AK/SK。
 *
 * @param {{cliPath?:string}} [opts] 可选 CLI 路径。
 * @returns {Promise<{ok:boolean, access_key:string, secret_key:string}>} 完整凭证。
 */
export async function getStarlingCredentials(opts = {}) {
  const payload = { action: 'get_starling_credentials' };
  if (opts.cliPath) payload.cli_path = opts.cliPath;
  const response = await chrome.runtime.sendMessage({
    action: 'native_search_tm',
    payload,
  });
  if (chrome.runtime.lastError) {
    throw new Error(chrome.runtime.lastError.message);
  }
  if (response?.error || response?.ok !== true) {
    throw new Error(response?.error || 'Starling credentials read failed');
  }
  return response;
}

/**
 * 按原文批量查 Starling 源文案 key（用 /project/search，不是 TM match）。
 *
 * ⚠️ 背景（2026-06-30）：用户反馈「TM 查不到 key」。根因是之前用 /corpus/tm/match
 * 查 TM 库，TM 条目本身不存 key；key 在源文案层，必须用 /project/search 按源文案搜。
 * 用户在 Starling 平台能搜到 key（如 ttlsMerchant_gneMerchantRejectMsgKTP_msg1），
 * 走的就是这个接口。
 *
 * @param {string[]} texts       原文案列表
 * @param {object}   [opts]     { cliPath, projectId }
 * @returns {Promise<Array<{key:string, score:number, exact:boolean, source_content:string, target_content:string, ...}>>}
 */
export async function searchKeys(texts, opts = {}) {
  const payload = {
    action: 'search_key',
    texts: texts || [],
  };
  if (opts.cliPath) payload.cli_path = opts.cliPath;
  if (opts.accessKey && opts.secretKey) {
    payload.access_key = opts.accessKey;
    payload.secret_key = opts.secretKey;
  }
  // 多项目支持（2026-07-03）：projectIds 数组优先，兼容旧 projectId 单值
  if (Array.isArray(opts.projectIds) && opts.projectIds.length) {
    payload.project_ids = opts.projectIds.map((p) => Number(p)).filter((n) => !Number.isNaN(n));
  } else if (opts.projectId) {
    payload.project_id = Number(opts.projectId);
  }

  const response = await chrome.runtime.sendMessage({
    action: 'native_search_tm',
    payload,
  });

  if (chrome.runtime.lastError) {
    throw new Error(chrome.runtime.lastError.message);
  }
  if (response?.error) {
    throw new Error(response.error);
  }
  return response?.results || [];
}
