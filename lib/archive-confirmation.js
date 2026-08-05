function formatSummary(summary) {
  const coverage = summary.vendorCoverage;
  return {
    sources: String(summary.sourceRowCount),
    confirmed: String(summary.confirmedRowCount),
    languages: String(summary.languageCount),
    coverage: `RWS ${coverage.RWS} · Pactera ${coverage.Pactera} · unpriced ${coverage.unpriced}`,
    requests: `${summary.estimatedTmRequests.original} A + ${summary.estimatedTmRequests.final} C = ${summary.estimatedTmRequests.total}`,
    duration: `${summary.estimatedDuration.minSeconds}–${summary.estimatedDuration.maxSeconds}s`,
  };
}

export function createArchiveConfirmationController({ documentRef, dialog, cancel, start, fields, trigger } = {}) {
  let activeClose = null;
  return {
    open(summary) {
      if (activeClose) activeClose(false);
      const returnFocus = trigger || documentRef.activeElement;
      const formatted = formatSummary(summary);
      Object.entries(fields).forEach(([key, element]) => { element.textContent = formatted[key]; });
      dialog.classList.remove('hidden');
      return new Promise((resolve) => {
        let settled = false;
        const close = (started) => {
          if (settled) return;
          settled = true;
          dialog.classList.add('hidden');
          dialog.removeEventListener('keydown', onKeydown);
          cancel.removeEventListener('click', onCancel);
          start.removeEventListener('click', onStart);
          activeClose = null;
          returnFocus?.focus?.();
          resolve(started);
        };
        const onCancel = () => close(false);
        const onStart = () => close(true);
        const onKeydown = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            close(false);
            return;
          }
          if (event.key !== 'Tab') return;
          const controls = [...dialog.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
          if (!controls.length) return;
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && documentRef.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && documentRef.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        };
        activeClose = close;
        cancel.addEventListener('click', onCancel);
        start.addEventListener('click', onStart);
        dialog.addEventListener('keydown', onKeydown);
        start.focus();
      });
    },
    close(reason = 'cancel') { activeClose?.(reason === 'start'); },
  };
}

export async function confirmThenRunArchive({ controller, summary, runtime }) {
  if (!(await controller.open(summary))) return false;
  await runtime();
  return true;
}
