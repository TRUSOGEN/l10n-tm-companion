const TYPES = [
  { key: 'auto_revised', label: 'Auto-revised', note: 'based on review', pattern: /Auto-revised based on review/i },
  { key: 'below_50', label: 'Below 50', note: 'Top-3 TM shown without AI rewrite', pattern: /Orig Match % \([^)]*\) is below 50; show Top-3 TM without AI rewrite/i },
  { key: 'not_improved', label: 'Not improved', note: 'candidate was not auto-applied', pattern: /TM score did not improve, so it was not auto-applied/i },
  { key: 'no_safe_rewrite', label: 'No safe rewrite', note: 'original source kept', pattern: /Inspire returned the original source unchanged; no safe rewrite was available/i },
];

function decisionText(item = {}) {
  return [item.reasoning, item.explanation, item.presentation?.explanation, item.aiAbsence]
    .map((value) => String(value || ''))
    .join(' ');
}

export function classifyReviewDecision(item = {}) {
  const match = TYPES.find((type) => type.pattern.test(decisionText(item)));
  return match ? { key: match.key, label: match.label } : null;
}

export function aggregateReviewDecisions(items = []) {
  const counts = new Map();
  items.forEach((item) => {
    const decision = classifyReviewDecision(item);
    if (decision) counts.set(decision.key, (counts.get(decision.key) || 0) + 1);
  });
  return TYPES
    .filter((type) => counts.has(type.key))
    .map(({ key, label, note }) => ({ key, count: counts.get(key), label, note }));
}
