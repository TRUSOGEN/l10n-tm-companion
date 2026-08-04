/**
 * 英文 Source 改写的确定性安全门禁与 TM 可读预览。
 */

/** 仅生成展示文本；调用方必须继续保存和使用原始 TM source。 */
export function formatTmSourceForDisplay(raw) {
  return String(raw || '')
    .replace(/\{\{#([a-zA-Z0-9_.-]+)(?:\s+[^}]*)?\}\}/g, '')
    .replace(/\{\{\/[a-zA-Z0-9_.-]+\}\}/g, '')
    .replace(/\{\{else\}\}/g, ' / ')
    .replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, '{$1}')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 提取必须逐项保持的结构 token。 */
export function extractProtectedTokens(text) {
  const input = String(text || '');
  const patterns = [
    /https?:\/\/[^\s)]+/g,
    /\{\{[\s\S]*?\}\}/g,
    /\{[^{}\n]+\}/g,
    /\b\d+(?:[.,]\d+)?%?\b/g,
    /\b[A-Z][A-Z0-9_+-]{1,}\b/g,
    /\b[A-Z][A-Z0-9_]*(?:\+{1,2}|#)(?![A-Za-z0-9_])/g,
    /\bX\b/g,
    /\b[A-Z][a-z]+[A-Z][A-Za-z0-9]*\b/g,
    /\b[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*\b/g,
  ];
  return patterns.flatMap((pattern) => input.match(pattern) || []).sort();
}

/** 判断候选是否可默认采用；人工仍可查看被拦截的候选。 */
export function evaluateRewriteCandidate(item) {
  const sourceTokens = extractProtectedTokens(item?.source_text);
  const candidateTokens = extractProtectedTokens(item?.ai_translation);
  const structureValid = JSON.stringify(sourceTokens) === JSON.stringify(candidateTokens);
  const originalScore = Number(item?.similarity);
  const rewrittenScore = item?.post_rewrite_tm?.status === 'complete'
    ? Number(item.post_rewrite_tm.score)
    : NaN;
  const tmImproved = Number.isFinite(originalScore) && Number.isFinite(rewrittenScore)
    && rewrittenScore > originalScore;
  return {
    structureValid,
    tmImproved,
    defaultChoice: structureValid && tmImproved && item?.ai_translation ? 'ai' : 'source',
    reason: !structureValid ? 'protected_tokens_changed'
      : (!tmImproved ? 'tm_score_not_improved' : 'ready'),
  };
}

/**
 * 对同一 source 的多个结构化候选执行确定性安全门禁并选择展示结果。
 *
 * @param {object} item 含原文、Score A 与 `ai_candidates` 的条目。
 * @param {Array<object>} snapshots 与候选同序的真实 Post-TM 快照。
 * @returns {{candidates:Array,reviewableCandidates:Array,validCandidates:Array,representativePostTm:object,displayText:string}}
 */
export function evaluateRewriteCandidates(item, snapshots = []) {
  const originalScore = Number(item?.similarity);
  const candidates = (Array.isArray(item?.ai_candidates) ? item.ai_candidates : [])
    .slice(0, 3)
    .map((candidate, index) => {
      const snapshot = snapshots[index] || { status: 'not_available' };
      const sourceTokens = extractProtectedTokens(item?.source_text);
      const candidateTokens = extractProtectedTokens(candidate?.ai_translation);
      const protectedTokensValid = JSON.stringify(sourceTokens) === JSON.stringify(candidateTokens);
      const structureValid = candidate?.structure_valid === true && protectedTokensValid;
      const semanticSafe = candidate?.semantic_status === 'same_meaning';
      const risks = Array.isArray(candidate?.risks) ? candidate.risks : [];
      const rulesSafe = risks.length === 0;
      const tmComplete = snapshot?.status === 'complete' && Number.isFinite(Number(snapshot.score));
      const tmImproved = tmComplete && Number.isFinite(originalScore)
        && Number(snapshot.score) > originalScore;
      // 人工可审阅的候选必须通过结构、语义、规则和完整 Post-TM 校验；分数提升
      // 仅决定能否自动作为初始 Final copy。
      const reviewable = structureValid && semanticSafe && rulesSafe && tmComplete;
      const rejectionReason = !structureValid
        ? 'protected_tokens_changed'
        : (!semanticSafe
          ? (candidate?.semantic_status === 'meaning_changed' ? 'meaning_changed' : 'needs_context')
          : (!rulesSafe
            ? 'review_rule_risk'
            : (!tmComplete
              ? 'post_tm_incomplete'
              : (!tmImproved ? 'tm_score_not_improved' : ''))));
      return {
        ...candidate,
        post_rewrite_tm: snapshot,
        reviewable,
        gate_status: rejectionReason ? 'rejected' : 'accepted',
        rejection_reason: rejectionReason,
      };
    });

  const validCandidates = candidates
    .filter((candidate) => candidate.gate_status === 'accepted')
    .sort((left, right) => (
      Number(right.post_rewrite_tm.score) - Number(left.post_rewrite_tm.score)
    ));
  const reviewableCandidates = candidates
    .filter((candidate) => candidate.reviewable === true)
    .sort((left, right) => (
      Number(right.post_rewrite_tm.score) - Number(left.post_rewrite_tm.score)
    ));
  const queriedCandidates = candidates
    .filter((candidate) => (
      candidate.post_rewrite_tm?.status === 'complete'
      && Number.isFinite(Number(candidate.post_rewrite_tm.score))
    ))
    .sort((left, right) => (
      Number(right.post_rewrite_tm.score) - Number(left.post_rewrite_tm.score)
    ));
  const representative = validCandidates[0] || reviewableCandidates[0] || queriedCandidates[0] || null;
  const representativePostTm = representative
    ? {
      ...representative.post_rewrite_tm,
      rejectionReason: representative.rejection_reason || '',
    }
    : (candidates.some((candidate) => candidate.post_rewrite_tm?.status === 'incomplete')
      ? { status: 'incomplete', reason: 'post_rewrite_tm_query_failed' }
      : { status: 'not_available' });

  return {
    candidates,
    reviewableCandidates,
    validCandidates,
    representativePostTm,
    displayText: validCandidates[0]?.ai_translation || '',
  };
}
