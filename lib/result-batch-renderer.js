const DEFAULT_BATCH_SIZE = 25;

/** Append ordered result cards without letting stale frames mutate the current review. */
export function appendResultCardsInBatches({
  container,
  cards,
  generation,
  isCurrent,
  activeCardId = null,
  raf = requestAnimationFrame,
  documentRef = document,
  batchSize = DEFAULT_BATCH_SIZE,
  escapeId = (value) => CSS.escape(value),
}) {
  const finish = () => {
    if (!isCurrent(generation)) return;
    container.setAttribute('aria-busy', 'false');
    if (activeCardId) {
      container.querySelector(`[data-id="${escapeId(activeCardId)}"] button`)?.focus();
    }
  };

  if (cards.length <= 50) {
    cards.forEach((card) => container.appendChild(card));
    finish();
    return;
  }

  let offset = 0;
  container.setAttribute('aria-busy', 'true');
  const appendBatch = () => {
    if (!isCurrent(generation)) return;
    const fragment = documentRef.createDocumentFragment();
    cards.slice(offset, offset + batchSize).forEach((card) => fragment.appendChild(card));
    container.appendChild(fragment);
    offset += batchSize;
    if (offset < cards.length) raf(appendBatch);
    else finish();
  };
  raf(appendBatch);
}
