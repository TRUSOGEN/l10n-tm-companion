const emptyCounts = Object.freeze({ RWS: 0, Pactera: 0, unpriced: 0 });

export function buildReviewContextModel({ coverage, destination } = {}) {
  const counts = { ...emptyCounts, ...(coverage?.counts || {}) };
  const target = {
    type: destination?.type || 'Destination',
    location: destination?.location || 'not selected',
    fullPath: destination?.fullPath || 'Not selected',
  };
  const incompleteCount = Number(coverage?.incompleteCount || 0);
  return {
    counts,
    destination: target,
    summary: `A→B→C · RWS ${counts.RWS} · Pactera ${counts.Pactera} · Unpriced ${counts.unpriced} · ${target.type}/${target.location}`,
    incomplete: coverage?.incomplete
      ? `${incompleteCount} served scope(s) are missing a word rate, TM score, or confirmed final score.`
      : '',
  };
}

export function renderReviewContext(documentRef, model) {
  const tray = documentRef.getElementById('review-context');
  if (!tray) return;
  documentRef.getElementById('review-context-summary').textContent = model.summary;
  documentRef.getElementById('review-context-coverage').textContent = `RWS ${model.counts.RWS} · Pactera ${model.counts.Pactera} · Unpriced ${model.counts.unpriced}`;
  const incomplete = documentRef.getElementById('review-context-incomplete');
  incomplete.textContent = model.incomplete;
  incomplete.classList[model.incomplete ? 'remove' : 'add']('hidden');
  documentRef.getElementById('review-context-destination').textContent = model.destination.fullPath;
}
