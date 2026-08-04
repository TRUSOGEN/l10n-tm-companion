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
    item.tm_candidates = Array.isArray(tm.tm_candidates) ? tm.tm_candidates : [];
    item.match_category = tm.match_category ?? null;
  });
}

const MAX_SCOPE_CONCURRENCY = 3;

/**
 * 全局在飞 TM 请求上限的默认值。
 *
 * 经实测（2026-08-04），Starling PPE 批量 TM 接口在 12 并发下 P95 表现稳定且无限流。
 */
export const DEFAULT_REQUEST_CONCURRENCY = 12;

/**
 * 创建共享并发闸门：保证同时执行的任务不超过 limit，FIFO 放行，异常归还额度。
 *
 * 纯函数，不访问 DOM/Chrome/网络。`limit` 为非法值（0、负数、NaN、非数字、undefined）
 * 时固定回退到 1，避免出现无限并发或永久死锁。
 *
 * @param {number} limit 同时执行的任务上限。
 * @returns {(fn: () => (Promise<any>|any)) => Promise<any>} 受闸门约束的执行器。
 */
export function createRequestLimiter(limit) {
  const parsed = Math.floor(Number(limit));
  const max = Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
  const queue = [];
  let active = 0;
  const pump = () => {
    while (active < max && queue.length > 0) {
      const task = queue.shift();
      active += 1;
      task();
    }
  };
  return function run(fn) {
    return new Promise((resolve, reject) => {
      queue.push(() => {
        Promise.resolve()
          .then(fn)
          .then(
            (value) => {
              active -= 1;
              resolve(value);
              pump();
            },
            (error) => {
              active -= 1;
              reject(error);
              pump();
            },
          );
      });
      pump();
    });
  };
}

/**
 * 将展示 scope 与待 ROI 补算 scope 分离。
 *
 * @param {object[]} scopes 全部已选语言 scope。
 * @param {string} [priorityKey] 当前展示 scope key；未命中时使用第一项。
 * @returns {{priority: object[], deferred: object[]}} 稳定分区结果。
 */
export function partitionPriorityScope(scopes, priorityKey = '') {
  const source = Array.isArray(scopes) ? scopes : [];
  if (source.length === 0) return { priority: [], deferred: [] };
  const priorityIndex = source.findIndex((scope) => scope?.key === priorityKey);
  const index = priorityIndex >= 0 ? priorityIndex : 0;
  return {
    priority: [source[index]],
    deferred: source.filter((_scope, scopeIndex) => scopeIndex !== index),
  };
}

/**
 * 以受控并发执行任务并保持输出顺序。
 *
 * @param {object[]} values 输入列表。
 * @param {number} concurrency 并发上限。
 * @param {(value: object, index: number) => Promise<object>} worker 单项执行器。
 * @returns {Promise<object[]>} 与输入同序的结果。
 */
async function mapWithConcurrency(values, concurrency, worker) {
  const normalized = Number(concurrency ?? 1);
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > MAX_SCOPE_CONCURRENCY) {
    throw new Error(`scope concurrency must be between 1 and ${MAX_SCOPE_CONCURRENCY}`);
  }
  const results = new Array(values.length);
  let nextIndex = 0;
  const runWorker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(values[index], index);
    }
  };
  const workerCount = Math.min(normalized, values.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
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
  return mapWithConcurrency(scopes, input.concurrency ?? 1, async (scope, scopeIndex) => {
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
      return {
        scope,
        items: incompleteItems(items, 'original_tm_query_failed', message),
        error: message,
      };
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
    return { scope, items: rewritten, rate };
  });
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
  return mapWithConcurrency(
    sourceRuns,
    input.concurrency ?? 1,
    async (sourceRun, scopeIndex) => {
    const { scope, rate, error } = sourceRun;
    input.onProgress?.(scope, scopeIndex, sourceRuns.length);
    const items = (sourceRun.items || []).map((item) => {
      const finalSource = typeof input.finalSourceForItem === 'function'
        ? input.finalSourceForItem(item, scope)
        : item.final_source_text;
      return {
        ...item,
        final_source_text: finalSource,
        ...(typeof finalSource === 'string' && finalSource.trim()
          ? { review_status: 'confirmed' }
          : {}),
      };
    });
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
      return { scope, items, rate, ...(error ? { error } : {}) };
    },
  );
}

/** 返回跨 scope 对齐 source 的稳定键。 */
function scopeItemKey(item, index) {
  if (item?.row != null) return `row:${item.row}`;
  if (item?.id != null) return `id:${item.id}`;
  return `index:${index}`;
}

/**
 * 把优先展示 scope 中的一次 Inspire 决策复制到其他目标语言 scope。
 *
 * @param {object[]} items 新 scope 已完成 A TM 的条目。
 * @param {Map<string, object>} referenceByKey 展示 scope 条目索引。
 * @returns {object[]} 带同一组 AI 候选的条目。
 */
function reuseRewriteDecisions(items, referenceByKey) {
  return items.map((item, index) => {
    const reference = referenceByKey.get(scopeItemKey(item, index));
    if (!reference) {
      throw new Error(`deferred_roi_source_alignment_failed: ${scopeItemKey(item, index)}`);
    }
    return {
      ...item,
      reached_threshold: reference.reached_threshold,
      ai_translation: reference.ai_translation || '',
      reasoning: reference.reasoning || '',
      reuse_tm: reference.reuse_tm === true,
      ai_candidates: Array.isArray(reference.ai_candidates)
        ? reference.ai_candidates.map((candidate) => ({ ...candidate }))
        : [],
      rewrite_eligible: reference.rewrite_eligible === true,
      ai_task_id: reference.ai_task_id,
      ai_duration_ms: reference.ai_duration_ms,
      ai_http_request_count: reference.ai_http_request_count,
      ai_poll_count: reference.ai_poll_count,
    };
  });
}

/**
 * 在 ROI 归档前补齐未执行语言的 A/B/C TM，并合并为全部 scope。
 *
 * @param {object} input 全量 scope、当前展示结果和可替换查询依赖。
 * @returns {Promise<object[]>} 按 allScopes 顺序排列的完整 scope 结果。
 */
export async function completeDeferredLocaleScopes(input) {
  const allScopes = Array.isArray(input?.allScopes) ? input.allScopes : [];
  const existingScopeRuns = Array.isArray(input?.existingScopeRuns)
    ? input.existingScopeRuns
    : [];
  const existingByKey = new Map(existingScopeRuns.map((run) => [run.scope?.key, run]));
  const deferredScopes = allScopes.filter((scope) => !existingByKey.has(scope?.key));
  if (deferredScopes.length === 0) {
    return allScopes.map((scope) => existingByKey.get(scope.key)).filter(Boolean);
  }
  const referenceRun = existingScopeRuns[0];
  if (!referenceRun?.items?.length) {
    throw new Error('deferred_roi_reference_scope_required');
  }
  const referenceByKey = new Map(
    referenceRun.items.map((item, index) => [scopeItemKey(item, index), item]),
  );
  // A（原文 TM）与 C（CD 确认后的最终文案 TM）之间没有数据依赖：C 的查询输入只来自
  // `finalSourceForItem()` 读取的展示 scope 人工确认结果，与 A 的查询结果无关。因此按
  // scope 流水线同时发出两者，把墙钟时间从「A 全量 + C 全量」压回一轮。
  // 全局在飞请求总量由共享 limiter 兜住，scope 之间不再需要人为限制数量。
  const limiter = createRequestLimiter(input.requestConcurrency ?? DEFAULT_REQUEST_CONCURRENCY);
  const total = deferredScopes.length;
  let initialDone = 0;
  let finalDone = 0;
  const sourceItems = Array.isArray(input.sourceItems) ? input.sourceItems : [];
  const deferredRuns = await Promise.all(deferredScopes.map(async (scope) => {
    const items = sourceItems.map((item) => ({ ...item }));
    const finalItems = items.map((item) => {
      const finalSource = typeof input.finalSourceForItem === 'function'
        ? input.finalSourceForItem(item, scope)
        : item.final_source_text;
      return {
        ...item,
        final_source_text: finalSource,
        ...(typeof finalSource === 'string' && finalSource.trim()
          ? { review_status: 'confirmed' }
          : {}),
      };
    });
    const originalTask = (async () => {
      const originals = await limiter(
        () => input.queryOriginalTm(items.map((item) => item.source_text), scope),
      );
      if (!Array.isArray(originals) || originals.length !== items.length) {
        throw new Error(`original_tm_response_count_mismatch: got ${Array.isArray(originals) ? originals.length : 'non-array'}, expected ${items.length}`);
      }
      return originals;
    })().then(
      (originals) => ({ ok: true, originals }),
      (error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }),
    ).finally(() => {
      input.onProgress?.('initial', scope, initialDone, total);
      initialDone += 1;
    });
    const finalTask = (async () => {
      const snapshots = await limiter(() => input.queryFinalTm(finalItems, scope));
      if (!Array.isArray(snapshots) || snapshots.length !== finalItems.length) {
        throw new Error(`final_tm_response_count_mismatch: got ${Array.isArray(snapshots) ? snapshots.length : 'non-array'}, expected ${finalItems.length}`);
      }
      return snapshots;
    })().then(
      (snapshots) => snapshots,
      (queryError) => {
        const message = queryError instanceof Error ? queryError.message : String(queryError);
        return finalItems.map((item) => {
          const finalSource = typeof item.final_source_text === 'string' ? item.final_source_text.trim() : '';
          return finalSource
            ? { status: 'incomplete', reason: 'final_tm_query_failed', error: message }
            : { status: 'not_ready' };
        });
      },
    ).finally(() => {
      input.onProgress?.('final', scope, finalDone, total);
      finalDone += 1;
    });
    const [originalResult, finalSnapshots] = await Promise.all([originalTask, finalTask]);
    if (!originalResult.ok) {
      // A 失败的 scope 必须保留可审计的 incomplete + reason，绝不用其他语言或 B 的分数顶替。
      return {
        scope,
        items: incompleteItems(finalItems, 'original_tm_query_failed', originalResult.error),
        error: originalResult.error,
      };
    }
    applyOriginalTm(items, originalResult.originals);
    // 延后语言只复用展示 scope 的一次 AI 改写决策，不重新调 LLM、不重查 B 的 TM。
    const rewritten = reuseRewriteDecisions(items, referenceByKey);
    let postSnapshots;
    try {
      postSnapshots = await input.queryPostRewriteTm(rewritten, scope);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      postSnapshots = rewritten.map(() => ({ status: 'incomplete', reason: 'post_rewrite_tm_query_failed', error: message }));
    }
    const rate = input.resolveRate(scope);
    const merged = rewritten.map((item, index) => {
      const finalItem = finalItems[index];
      const next = {
        ...item,
        post_rewrite_tm: postSnapshots[index],
        final_source_text: finalItem.final_source_text,
        ...(finalItem.review_status ? { review_status: finalItem.review_status } : {}),
      };
      input.decorateItem?.(next);
      next.final_tm = finalSnapshots[index];
      next.roi = input.calculateRoi(next, rate);
      return next;
    });
    return { scope, items: merged, rate };
  }));
  deferredRuns.forEach((run) => existingByKey.set(run.scope.key, run));
  return allScopes.map((scope) => existingByKey.get(scope.key)).filter(Boolean);
}
