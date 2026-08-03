/**
 * Broker client for the L10n TM Companion backend.
 *
 * All long-lived credentials are stored on the broker and in the macOS Keychain
 * device token. The extension only ever sees the short-lived Feishu user
 * access_token (needed to call Sheets directly as the user) and an opaque
 * device session token that it passes back to the Native Host.
 */

const BROKER_ACTIONS = Object.freeze({
  OAUTH_START: 'feishu_broker_oauth_start',
  OAUTH_STATUS: 'feishu_broker_status',
  OAUTH_REVOKE: 'feishu_broker_revoke',
  ROI_CREATE_RUN: 'roi_broker_create_run',
  ROI_SUBMIT_FINAL: 'roi_broker_submit_final',
  ROI_GET_RUN: 'roi_broker_get_run',
  ROI_ARCHIVE: 'roi_broker_archive',
});

function sendNativeAction(action, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: 'native_broker_request', payload: { action, ...payload } }, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(`Native Host unavailable: ${err.message}`));
        return;
      }
      if (!response || response.ok === false || response.error) {
        reject(new Error(response?.error || 'Broker request failed.'));
        return;
      }
      resolve(response.data || response);
    });
  });
}

export async function startBrokerAuthorization({ returnUrl = '' } = {}) {
  return sendNativeAction(BROKER_ACTIONS.OAUTH_START, { return_url: returnUrl });
}

export async function getBrokerAuthorizationStatus() {
  return sendNativeAction(BROKER_ACTIONS.OAUTH_STATUS);
}

export async function revokeBrokerAuthorization() {
  return sendNativeAction(BROKER_ACTIONS.OAUTH_REVOKE);
}

export async function createRoiRun(payload) {
  return sendNativeAction(BROKER_ACTIONS.ROI_CREATE_RUN, payload);
}

export async function submitRoiFinal(runId, itemId, payload) {
  return sendNativeAction(BROKER_ACTIONS.ROI_SUBMIT_FINAL, { run_id: runId, item_id: itemId, ...payload });
}

export async function getRoiRun(runId) {
  return sendNativeAction(BROKER_ACTIONS.ROI_GET_RUN, { run_id: runId });
}

export async function archiveRoiRun(runId, payload) {
  return sendNativeAction(BROKER_ACTIONS.ROI_ARCHIVE, { run_id: runId, ...payload });
}

export { BROKER_ACTIONS };
