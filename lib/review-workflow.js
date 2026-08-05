/**
 * Focus 逐条最终确认状态机。
 *
 * 本模块只管理 Draft、Confirming、Confirmed、Dirty 与 Error 状态，不访问 DOM、
 * Starling 或飞书。调用方必须按 Final TM 查询成功、Sheet 写回成功的顺序提交结果。
 */

import { extractProtectedTokens } from './source-rewrite-policy.js';

const AI_REJECTION_MESSAGES = Object.freeze({
  protected_tokens_changed: 'protected tokens changed',
  meaning_changed: 'meaning changed',
  needs_context: 'more context is required',
  review_rule_risk: 'Glossary, Legal, or content-review rules rejected the candidate',
  post_tm_incomplete: 'Post-TM validation did not complete',
  tm_score_not_improved: 'Post-TM score did not improve',
});

/** 将候选文案转换为稳定的展示比较键。 */
function normalizeCandidateText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

/** 只有完整 Post-TM 分数严格高于原 TM 时，条目才属于“有提升”。 */
export function hasPostTmImprovement(item = {}) {
  const originalScore = Number(item.similarity);
  const postScore = item.post_rewrite_tm?.status === 'complete'
    ? Number(item.post_rewrite_tm.score)
    : NaN;
  return Number.isFinite(originalScore)
    && Number.isFinite(postScore)
    && postScore > originalScore;
}

/**
 * 返回通过全部安全校验、可由人工选择的 AI 改写。
 *
 * 旧快照没有 `reviewableCandidates` 字段时，`tm_score_not_improved` 是旧门禁唯一
 * 因分数未提升而拒绝的状态，仍可安全恢复到新审阅视图。
 */
export function getReviewableAiCandidates(item = {}) {
  const quality = item.ai_quality || {};
  const candidates = Array.isArray(quality.reviewableCandidates)
    ? quality.reviewableCandidates
    : (Array.isArray(quality.candidates)
      ? quality.candidates.filter((candidate) => (
        candidate?.gate_status === 'accepted'
        || candidate?.rejection_reason === 'tm_score_not_improved'
      ))
      : []);
  return candidates.filter((candidate) => Boolean(String(candidate?.ai_translation || '').trim()));
}

/** 是否存在通过全部安全校验、可由人工选择的 AI 改写。 */
export function hasReviewableAiRewrite(item = {}) {
  return getReviewableAiCandidates(item).length > 0;
}

/** 按 Review 顶部筛选保留条目原始顺序。 */
export function filterReviewItems(items = [], filter = 'all') {
  const source = Array.isArray(items) ? items : [];
  if (filter === 'all') return source.slice();
  if (filter === 'improved') return source.filter(hasReviewableAiRewrite);
  throw new Error(`unsupported_review_filter:${filter}`);
}

/**
 * 去除 Writer 原生 revisions 中的重复文案。
 *
 * 同一展示文案出现多次时保留真实 Post-TM 分数更高的一条，避免 Focus 把重复结果
 * 伪装成多个选择。
 */
export function dedupeAiCandidates(candidates = []) {
  const byText = new Map();
  (Array.isArray(candidates) ? candidates : []).forEach((candidate) => {
    const key = normalizeCandidateText(candidate?.ai_translation);
    if (!key) return;
    const previous = byText.get(key);
    const score = Number(candidate?.post_rewrite_tm?.score);
    const previousScore = Number(previous?.post_rewrite_tm?.score);
    if (!previous || (Number.isFinite(score) && (!Number.isFinite(previousScore) || score > previousScore))) {
      byText.set(key, candidate);
    }
  });
  return [...byText.values()];
}

/** 判断候选是否就是当前 Final copy，以此生成唯一、可恢复的选择状态。 */
export function isAiCandidateSelected(review, candidate) {
  const finalText = normalizeCandidateText(review?.finalText);
  return Boolean(finalText) && finalText === normalizeCandidateText(candidate?.ai_translation);
}

/**
 * 为 Focus 生成可审计的 TM 展示状态。
 *
 * 新版 Native Host 提供最多三条 `tm_candidates`。旧版 Host 仅提供首条兼容字段时，
 * 保留这条真实命中并显式标记版本不兼容，避免把已有分数误报为无 TM。
 */
export function buildFocusTmState(item = {}) {
  const candidates = Array.isArray(item.tm_candidates)
    ? item.tm_candidates.slice(0, 3)
    : [];
  if (candidates.length > 0) {
    return { status: 'complete', candidates, message: '' };
  }

  const score = Number(item.similarity);
  const source = String(item.tm_source || '');
  const target = String(item.tm_match || '');
  if (Number.isFinite(score) && score > 0 && (source || target)) {
    return {
      status: 'legacy_single',
      candidates: [{
        source,
        target,
        score,
        origin: String(item.origin || 'Unknown'),
      }],
      message: 'Only the best TM match is available. Native Host update required for Top-3.',
    };
  }

  return { status: 'no_match', candidates: [], message: 'No TM match' };
}

/**
 * 解释 Focus 中没有可用 AI 候选的真实原因。
 *
 * 优先展示结构与安全门禁结果；未创建候选时再展示生成链路保存的配置或 API 错误。
 */
export function explainFocusAiAbsence(item = {}) {
  if (getReviewableAiCandidates(item).length > 0) return '';
  if ((item.ai_quality?.validCandidates || []).length > 0) return '';

  const structureErrors = (Array.isArray(item.ai_candidates) ? item.ai_candidates : [])
    .filter((candidate) => candidate?.structure_valid !== true && candidate?.structure_error)
    .map((candidate) => String(candidate.structure_error));
  if (structureErrors.length > 0) {
    return `AI candidate structure invalid: ${[...new Set(structureErrors)].join(', ')}.`;
  }

  const rejectionReasons = (Array.isArray(item.ai_quality?.candidates)
    ? item.ai_quality.candidates
    : [])
    .map((candidate) => candidate?.rejection_reason)
    .filter(Boolean);
  if (rejectionReasons.length > 0) {
    const reasons = [...new Set(rejectionReasons)]
      .map((reason) => AI_REJECTION_MESSAGES[reason] || String(reason));
    return `No safe AI candidate: ${reasons.join('; ')}.`;
  }

  const reasoning = String(item.reasoning || '').trim();
  if (reasoning) return reasoning;
  if (item.rewrite_eligible === true) {
    return 'No AI candidate was returned. Check the Inspire task status and configuration.';
  }
  return 'This source is outside the 50 ≤ TM score < 85 AI rewrite range.';
}

/** 创建一条可编辑的最终文案审阅状态。 */
export function createReviewState({ sourceText, initialText } = {}) {
  const source = String(sourceText || '');
  return {
    sourceText: source,
    finalText: String(initialText ?? source),
    status: 'draft',
    finalTm: null,
    error: '',
  };
}

/** 编辑最终文案，并使已经确认的 Final TM 立即过期。 */
export function editFinalText(state, finalText) {
  const wasConfirmed = state?.status === 'confirmed' || state?.status === 'dirty';
  return {
    ...state,
    finalText: String(finalText ?? ''),
    status: wasConfirmed ? 'dirty' : 'draft',
    finalTm: null,
    error: '',
  };
}

/** 校验最终文案后进入查询与写回中的状态。 */
export function beginConfirmation(state) {
  const finalText = String(state?.finalText || '').trim();
  if (!finalText) throw new Error('final_text_required');
  const sourceTokens = extractProtectedTokens(state?.sourceText);
  const finalTokens = extractProtectedTokens(finalText);
  if (JSON.stringify(sourceTokens) !== JSON.stringify(finalTokens)) {
    throw new Error('protected_tokens_changed');
  }
  return {
    ...state,
    finalText,
    status: 'confirming',
    finalTm: null,
    error: '',
  };
}

/**
 * 将“确认并写入其余项”拆分为可执行、失败和已确认三组。
 *
 * 这里只执行与逐条确认完全相同的本地门禁；失败项保留最终文案并进入 error，
 * 其余项才能继续批量查询 Final TM。调用方不得把 ready 直接标记为 confirmed。
 */
export function prepareBulkConfirmations(items = []) {
  return (Array.isArray(items) ? items : []).reduce((result, item) => {
    const review = item?.review;
    if (review?.status === 'confirmed') {
      result.skipped.push({ item, review });
      return result;
    }
    try {
      result.ready.push({ item, review: beginConfirmation(review) });
    } catch (error) {
      result.failed.push({ item, review: failConfirmation(review, error), error });
    }
    return result;
  }, { ready: [], failed: [], skipped: [] });
}

/** 在 Final TM 和 Sheet 写回都成功后完成确认。 */
export function completeConfirmation(state, { finalTm, sheetWriteSucceeded } = {}) {
  if (state?.status !== 'confirming') throw new Error('confirmation_not_started');
  if (finalTm?.status !== 'complete' || !Number.isFinite(Number(finalTm.score))) {
    throw new Error('final_tm_incomplete');
  }
  if (sheetWriteSucceeded !== true) throw new Error('sheet_write_failed');
  return {
    ...state,
    status: 'confirmed',
    finalTm: { ...finalTm, score: Number(finalTm.score) },
    error: '',
  };
}

/** 保留当前最终文案并记录真实确认错误。 */
export function failConfirmation(state, error) {
  return {
    ...state,
    status: 'error',
    finalTm: null,
    error: error instanceof Error ? error.message : String(error || 'confirmation_failed'),
  };
}

/** Build the auditable A → B → C review model. B is never part of official money. */
export function buildReviewPresentation(input = {}) {
  const stages = [
    ['A', input.original || input.a || {}, 'Original'],
    ['B', input.ai || input.b || {}, 'AI-assisted'],
    ['C', input.final || input.c || {}, 'Confirmed final'],
  ];
  const rail = stages.map(([key, stage, label]) => {
    const score = stage.score === null || stage.score === undefined || stage.score === ''
      ? NaN
      : Number(stage.score);
    return { key, score: Number.isFinite(score) ? score : null, tone: key === 'B' ? 'ai' : (key === 'C' ? 'confirmed' : 'neutral'), label };
  });
  const aCost = stages[0][1].cost === null || stages[0][1].cost === undefined ? NaN : Number(stages[0][1].cost);
  const cCost = stages[2][1].cost === null || stages[2][1].cost === undefined ? NaN : Number(stages[2][1].cost);
  const officialSaving = Number.isFinite(aCost) && Number.isFinite(cCost) ? aCost - cCost : null;
  const aScore = rail[0].score;
  const bScore = rail[1].score;
  const safe = input.candidateSafety?.safe === true || input.candidateSafety === true;
  const noImprovement = safe && aScore !== null && bScore !== null && bScore <= aScore;
  if (noImprovement) {
    return {
      rail,
      officialSaving,
      savingTone: officialSaving !== null && officialSaving < 0 ? 'warning' : 'neutral',
      headline: 'Safe rewrite available',
      explanation: 'TM score did not improve, so it was not auto-applied. Official saving compares A with confirmed C only.',
    };
  }
  const savingTone = officialSaving === null ? 'neutral' : (officialSaving < 0 ? 'warning' : 'positive');
  const rejectionReason = String(input.candidateSafety?.reason || '').trim();
  if (input.candidateSafety && input.candidateSafety.safe === false) {
    return {
      rail,
      officialSaving,
      savingTone,
      headline: 'No safe rewrite',
      explanation: `${rejectionReason || 'The AI candidate did not pass safety gates'}. Official saving still compares A with confirmed C only.`,
    };
  }
  const headline = officialSaving === null
    ? 'Review A → B → C'
    : (officialSaving < 0 ? 'Confirmed cost increased' : 'Confirmed saving');
  return {
    rail,
    officialSaving,
    savingTone,
    headline,
    explanation: 'A is the original baseline, B is AI-assisted review evidence, and C is the confirmed final. Official saving compares A with C only.',
  };
}
