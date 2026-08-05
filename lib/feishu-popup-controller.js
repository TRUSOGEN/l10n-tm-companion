import { preflightFeishuAuthorization } from './feishu-auth.js';

export function createFeishuPopupController({
  documentRef, windowRef, chromeApi, shouldUseLegacy, getAuthorizationStatus,
  getCredentialStatus, authorizeLegacy, authorizeBroker, getReturnUrl,
  openSettingsPage, formatError = (error) => ({ title: 'Could not open Settings', message: error?.message || String(error) }),
}) {
  let bound = false;
  const get = (id) => documentRef.getElementById(id);

  async function refresh() {
    const status = await getAuthorizationStatus();
    const legacy = await shouldUseLegacy();
    const credential = legacy ? await getCredentialStatus() : { configured: true };
    const model = preflightFeishuAuthorization({
      connected: status.connected,
      displayName: status.profile?.name || status.profile?.enName,
      secretConfigured: credential.configured,
    });
    const connect = get('connect-feishu-user');
    const diagnostic = get('feishu-secret-diagnostic');
    const action = get('feishu-secret-action');
    const title = get('feishu-auth-title');
    const statusText = get('feishu-auth-status');
    diagnostic.classList.add('hidden');
    action.classList.add('hidden');
    connect.classList.remove('hidden');
    if (model.state === 'secret-required') {
      title.textContent = model.title;
      statusText.textContent = model.message;
      diagnostic.textContent = model.message;
      diagnostic.classList.remove('hidden');
      action.classList.remove('hidden');
      connect.classList.add('hidden');
    }
    return { model, status, legacy };
  }

  async function connect() {
    const { model, legacy } = await refresh();
    if (model.state === 'secret-required') return model;
    const returnUrl = await getReturnUrl();
    if (legacy) await authorizeLegacy({ returnUrl });
    else await authorizeBroker({ returnUrl });
    await refresh();
    return model;
  }

  async function openSettings() {
    try {
      await openSettingsPage({ storage: chromeApi.storage.local, openOptionsPage: () => chromeApi.runtime.openOptionsPage() });
    } catch (error) {
      const model = formatError(error);
      get('feishu-auth-card').classList.add('error');
      get('feishu-auth-status').textContent = model.title;
      const diagnostic = get('feishu-secret-diagnostic');
      diagnostic.textContent = model.message || model.action || String(error);
      diagnostic.classList.remove('hidden');
    }
  }

  function bind() {
    if (bound) return false;
    bound = true;
    get('connect-feishu-user').addEventListener('click', connect);
    get('feishu-secret-action').addEventListener('click', openSettings);
    documentRef.addEventListener('visibilitychange', () => {
      if (documentRef.visibilityState === 'visible') void refresh();
    });
    windowRef.addEventListener?.('focus', () => { void refresh(); });
    chromeApi.storage.onChanged?.addListener((changes, area) => {
      if (area === 'local' && (changes.feishuUserAccessToken || changes.optionsNavigationIntent)) void refresh();
    });
    return true;
  }

  return { bind, connect, openSettings, refresh };
}
