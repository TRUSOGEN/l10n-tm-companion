/** DOM renderer shared by compact cards and Focus View. */
export function createReviewPresentationElement(documentRef, model = {}, { compact = false } = {}) {
  if (!documentRef?.createElement) throw new Error('document_required');
  const root = documentRef.createElement('div');
  root.className = `review-presentation${compact ? ' is-compact' : ''}`;
  root.dataset.tone = model.savingTone || 'neutral';
  root.setAttribute('role', 'status');

  const rail = documentRef.createElement('div');
  rail.className = 'score-rail';
  rail.setAttribute('aria-label', 'A to B to C review');
  const baselineValue = (model.rail || [])[0]?.score;
  const baseline = baselineValue === null || baselineValue === undefined ? NaN : Number(baselineValue);
  (model.rail || []).forEach((stage, index) => {
    const node = documentRef.createElement('span');
    node.className = `score-stage stage-${String(stage.key || '').toLowerCase()} tone-${stage.tone || 'neutral'}`;
    const score = stage.score === null || stage.score === undefined ? NaN : Number(stage.score);
    const delta = stage.key !== 'A' && Number.isFinite(score) && Number.isFinite(baseline)
      ? ` (${score - baseline >= 0 ? '+' : '−'}${Math.abs(Math.round(score - baseline))})`
      : '';
    node.textContent = `${stage.key} · ${stage.label}${Number.isFinite(score) ? ` ${Math.round(score)}%${delta}` : ' —'}`;
    rail.append(node);
    if (index < model.rail.length - 1) {
      const arrow = documentRef.createElement('span');
      arrow.className = 'score-arrow';
      arrow.textContent = '→';
      arrow.setAttribute('aria-hidden', 'true');
      rail.append(arrow);
    }
  });

  const headline = documentRef.createElement('strong');
  headline.className = 'review-headline';
  headline.textContent = model.headline || 'Review A → B → C';
  const saving = documentRef.createElement('div');
  saving.className = 'review-saving';
  if (Number.isFinite(model.officialSaving)) {
    const amount = Math.abs(model.officialSaving).toFixed(2);
    saving.textContent = `Official A−C saving: ${model.officialSaving < 0 ? '−' : ''}$${amount}`;
  } else {
    saving.textContent = 'Official A−C saving: pending confirmed C';
  }
  const explanationText = String(model.explanation || '');
  const isRepeatedContextCopy = [
    /A is the original baseline, B is AI-assisted review evidence/i,
    /Inspire returned the original source unchanged; no safe rewrite was available/i,
    /Auto-revised based on review/i,
    /Orig Match % \([^)]*\) is below 50; show Top-3 TM without AI rewrite/i,
    /TM score did not improve, so it was not auto-applied/i,
  ].some((pattern) => pattern.test(explanationText));
  const itemExplanation = explanationText
    .replace(/\s*Official saving (?:still )?compares A with confirmed C only\.?\s*$/i, '')
    .trim();
  root.append(rail, headline, saving);
  if (itemExplanation && !isRepeatedContextCopy) {
    const explanation = documentRef.createElement('p');
    explanation.className = 'review-explanation';
    explanation.textContent = itemExplanation;
    root.append(explanation);
  }
  return root;
}
