/**
 * 多语言 ROI scope 执行器。
 *
 * 本模块将项目×目标语言 scope 串行展开，并通过注入的 TM、AI、费率与计价函数生成
 * 可审计运行结果。它不访问 DOM、Chrome 或网络，便于验证单个 scope 失败不影响后续 scope。
 */

function incompleteItems(items, reason, error = '') {
  return items.map((item) => ({
    ...item,
    roi: { status: 'incomplete', reason, error },
  }));
}

function applyOriginalTm(items, results) {
  items.forEach((item, index) => {
    const tm = results[index];
    if (!tm || typeof tm !== 'object') return;
    item.tm_match = tm.tm_match || '';
    item.tm_source = tm.tm_source || '';
    item.similarity = tm.similarity;
    item.origin = tm.origin || '';
    item.tm_method = tm.method || 'starling';
    item.tm_candidate_count = tm.candidate_count ?? 0;
    item.match_category = tm.match_category ?? null;
  });
}

/**
 * 执行全部 locale scope，并保留每个 scope 的真实查询与计价结果。
 *
 * @param {object} input 执行输入与可替换依赖。
 * @returns {Promise<Array<{scope:object,items:object[],rate?:object,error?:string}>>} scope 运行结果。
 */
export async function runLocaleScopes(input) {
  const scopes = Array.isArray(input.scopes) ? input.scopes : [];
  const sourceItems = Array.isArray(input.items) ? input.items : [];
  const runs = [];
  for (const [scopeIndex, scope] of scopes.entries()) {
    input.onProgress?.(scope, scopeIndex, scopes.length);
    const items = sourceItems.map((item) => ({ ...item }));
    let originals;
    try {
      originals = await input.queryOriginalTm(items.map((item) => item.source_text), scope);
      if (!Array.isArray(originals) || originals.length !== items.length) {
        throw new Error(`original_tm_response_count_mismatch: got ${Array.isArray(originals) ? originals.length : 'non-array'}, expected ${items.length}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      runs.push({ scope, items: incompleteItems(items, 'original_tm_query_failed', message), error: message });
      continue;
    }
    applyOriginalTm(items, originals);
    const rewritten = await input.rewriteItems(items, scope);
    let snapshots;
    try {
      snapshots = await input.queryPostRewriteTm(rewritten, scope);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      snapshots = rewritten.map(() => ({ status: 'incomplete', reason: 'post_rewrite_tm_query_failed', error: message }));
    }
    const rate = input.resolveRate(scope);
    rewritten.forEach((item, index) => {
      item.post_rewrite_tm = snapshots[index];
      input.decorateItem?.(item);
      item.roi = input.calculateRoi(item, rate);
    });
    runs.push({ scope, items: rewritten, rate });
  }
  return runs;
}

/**
 * 对 CD 在 Spreadsheet 中确认后的最终文案 C 执行第三次 TM，并生成正式 A−C ROI。
 *
 * 首轮 A 与 AI 候选 B 的运行结果作为输入保留；本函数只读取最终文本、查询 C，并把
 * 最终快照交给 `calculateRoi`。缺少 C 或 C 查询失败时，ROI 保持 incomplete，绝不使用
 * B 的分数替代最终送翻结果。
 *
 * @param {object} input `scopeRuns` 为首次流程结果，`finalSourceForItem` 返回每条最终文本。
 * @returns {Promise<Array<{scope:object,items:object[],rate?:object,error?:string}>>} 带 final_tm 的 scope 结果。
 */
export async function runFinalLocaleScopes(input) {
  const sourceRuns = Array.isArray(input?.scopeRuns) ? input.scopeRuns : [];
  const runs = [];
  for (const [scopeIndex, sourceRun] of sourceRuns.entries()) {
    const { scope, rate, error } = sourceRun;
    input.onProgress?.(scope, scopeIndex, sourceRuns.length);
    const items = (sourceRun.items || []).map((item) => ({
      ...item,
      final_source_text: typeof input.finalSourceForItem === 'function'
        ? input.finalSourceForItem(item, scope)
        : item.final_source_text,
    }));
    let snapshots;
    try {
      snapshots = await input.queryFinalTm(items, scope);
      if (!Array.isArray(snapshots) || snapshots.length !== items.length) {
        throw new Error(`final_tm_response_count_mismatch: got ${Array.isArray(snapshots) ? snapshots.length : 'non-array'}, expected ${items.length}`);
      }
    } catch (queryError) {
      const message = queryError instanceof Error ? queryError.message : String(queryError);
      snapshots = items.map((item) => {
        const finalSource = typeof item.final_source_text === 'string' ? item.final_source_text.trim() : '';
        return finalSource
          ? { status: 'incomplete', reason: 'final_tm_query_failed', error: message }
          : { status: 'not_ready' };
      });
    }
    items.forEach((item, index) => {
      item.final_tm = snapshots[index];
      item.roi = input.calculateRoi(item, rate);
    });
    runs.push({ scope, items, rate, ...(error ? { error } : {}) });
  }
  return runs;
}
