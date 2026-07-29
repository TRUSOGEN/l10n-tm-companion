/**
 * 飞书用户授权与历史共享应用鉴权入口。
 *
 * 普通用户通过 OAuth + PKCE 授权，插件保存短期 user_access_token 和最小用户资料，
 * 用于用户本人可访问的 Sheet/Bitable 调用及 ROI Operator 审计。App Secret 相关接口
 * 仅为已配置安装的兼容路径，Settings 不再要求普通用户输入 Secret。
 */

export const FEISHU_APP_ID = 'cli_aab1ca4137badbc4';
export const FEISHU_USER_SCOPE = [
  'sheets:spreadsheet.meta:read',
  'sheets:spreadsheet:read',
  'sheets:spreadsheet:write_only',
  'wiki:node:read',
  'base:table:read',
  'base:table:create',
  'base:field:read',
  'base:field:create',
  'base:record:read',
  'base:record:retrieve',
  'base:record:create',
  'base:record:update',
  'base:view:read',
  'base:view:write_only',
  'contact:user.base:readonly',
  'contact:user.employee_id:readonly',
].join(' ');
const REQUIRED_USER_SCOPES = Object.freeze(FEISHU_USER_SCOPE.split(/\s+/).filter(Boolean));
const FEISHU_USER_AUTH_SCHEMA_VERSION = 2;

let tokenCache = null;
const USER_SESSION_KEYS = Object.freeze([
  'feishuUserAccessToken',
  'feishuUserTokenExpiresAt',
  'feishuUserScope',
  'feishuUserProfile',
  'feishuUserAuthSchemaVersion',
]);

/** 将飞书返回的 scope 规范为去重的空格分隔字符串。 */
function normalizeGrantedScope(scope) {
  if (typeof scope !== 'string') return '';
  return [...new Set(scope.split(/\s+/).filter(Boolean))].join(' ');
}

/** 返回当前产品契约中尚未被 token 实际授予的用户身份权限。 */
function findMissingUserScopes(scope) {
  const grantedScopes = new Set(normalizeGrantedScope(scope).split(/\s+/).filter(Boolean));
  return REQUIRED_USER_SCOPES.filter((required) => !grantedScopes.has(required));
}

/**
 * 使当前用户 token 失效，同时保留实际 scope 和既有用户资料用于 Reconnect 引导。
 *
 * API 权限错误或 OAuth scope 不完整时调用；不得继续复用已知无权的 token。
 */
export async function invalidateFeishuUserAuthorization(actualScope = '') {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  await chrome.storage.local.remove([
    'feishuUserAccessToken',
    'feishuUserTokenExpiresAt',
    'feishuUserAuthSchemaVersion',
  ]);
  await chrome.storage.local.set({
    feishuUserScope: normalizeGrantedScope(actualScope),
  });
}

/** 向 Native Host 请求飞书凭证动作，并统一暴露可读错误。 */
function sendCredentialAction(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: 'native_feishu_credentials', payload },
      (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(`Feishu Native Host unavailable: ${runtimeError.message}`));
          return;
        }
        if (!response || response.error || response.ok === false) {
          reject(new Error(response?.error || 'Feishu credential operation failed.'));
          return;
        }
        resolve(response);
      },
    );
  });
}

/** 查询当前 macOS 用户的 Keychain 中是否已有共享应用 Secret。 */
export async function getFeishuCredentialStatus() {
  const response = await sendCredentialAction({ action: 'feishu_secret_status' });
  return { configured: response.configured === true };
}

/** 通过 Native Host 的系统隐藏输入框完成应用 Owner 的本机安全配置。 */
export async function configureFeishuApplication() {
  const response = await sendCredentialAction({ action: 'feishu_configure_app_secret' });
  return { configured: response.configured === true };
}

/**
 * 使用系统浏览器完成 PKCE 授权，并保存当前飞书用户的最小审计资料。
 *
 * @param {{returnUrl?: string}} options callback 标签页关闭受限时返回的原页面地址。
 */
export async function authorizeFeishuUser({ returnUrl = '' } = {}) {
  const response = await sendCredentialAction({
    action: 'feishu_user_oauth',
    scope: FEISHU_USER_SCOPE,
    return_url: typeof returnUrl === 'string' ? returnUrl : '',
  });
  if (!response?.access_token) {
    throw new Error('Feishu user authorization did not return access_token.');
  }
  const grantedScope = normalizeGrantedScope(response.scope);
  if (!grantedScope) {
    await invalidateFeishuUserAuthorization('');
    throw new Error(
      'Feishu user authorization did not return granted scope. '
      + 'The token was rejected instead of assuming the requested permissions were granted.',
    );
  }
  const missingScopes = findMissingUserScopes(grantedScope);
  if (missingScopes.length > 0) {
    await invalidateFeishuUserAuthorization(grantedScope);
    throw new Error(
      `Feishu user authorization is missing required permissions: ${missingScopes.join(', ')}. `
      + 'Ask the app owner to create and publish a new app version containing these user-identity '
      + 'permissions, then authorize again.',
    );
  }
  const expiresIn = Math.max(120, Number(response.expires_in) || 7200);
  const expiresAt = Date.now() + expiresIn * 1000;
  const profile = await fetchFeishuUserProfile(response.access_token);
  await chrome.storage.local.set({
    feishuUserAccessToken: response.access_token,
    feishuUserTokenExpiresAt: expiresAt,
    feishuUserScope: grantedScope,
    feishuUserProfile: profile,
    feishuUserAuthSchemaVersion: FEISHU_USER_AUTH_SCHEMA_VERSION,
  });
  return {
    accessToken: response.access_token,
    expiresAt,
    scope: grantedScope,
    profile,
  };
}

/** 查询本地是否存在尚未过期的用户授权与资料。 */
export async function getFeishuUserAuthorizationStatus() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local?.get) {
    return {
      connected: false,
      accessToken: '',
      expiresAt: 0,
      scope: '',
      profile: null,
      missingScopes: [...REQUIRED_USER_SCOPES],
      scopeVerified: false,
    };
  }
  const stored = await chrome.storage.local.get(USER_SESSION_KEYS);
  const expiresAt = Number(stored.feishuUserTokenExpiresAt);
  const scope = normalizeGrantedScope(stored.feishuUserScope);
  const missingScopes = findMissingUserScopes(scope);
  const scopeVerified = stored.feishuUserAuthSchemaVersion === FEISHU_USER_AUTH_SCHEMA_VERSION;
  const connected = Boolean(
    stored.feishuUserAccessToken
    && Number.isFinite(expiresAt)
    && expiresAt > Date.now() + 60_000
    && missingScopes.length === 0
    && scopeVerified
  );
  return {
    connected,
    accessToken: connected ? stored.feishuUserAccessToken : '',
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
    scope,
    profile: stored.feishuUserProfile || null,
    missingScopes,
    scopeVerified,
  };
}

/** 读取飞书 user_info，并只保留 ROI 审计和 UI 所需字段。 */
export async function fetchFeishuUserProfile(accessToken, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl('https://open.feishu.cn/open-apis/authen/v1/user_info', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json();
  if (!response.ok || (payload.code !== undefined && payload.code !== 0)) {
    throw new Error(payload.msg || `Feishu user_info failed: HTTP ${response.status || 'unknown'}`);
  }
  const data = payload.data || payload;
  const profile = {
    name: String(data.name || ''),
    enName: String(data.en_name || ''),
    userId: String(data.user_id || ''),
    openId: String(data.open_id || data.sub || ''),
    avatarUrl: String(
      data.avatar_url
      || data.avatar_big
      || data.avatar_middle
      || data.avatar_thumb
      || '',
    ),
  };
  if (!profile.name && !profile.enName && !profile.openId) {
    throw new Error('Feishu user_info did not return an identifiable user.');
  }
  return profile;
}

/** 验证并保存 App Secret；成功时立即缓存本次取得的短期 token。 */
export async function saveFeishuAppSecret(appSecret) {
  const secret = String(appSecret || '').trim();
  if (!secret) throw new Error('Feishu App Secret is required.');
  const response = await sendCredentialAction({
    action: 'feishu_save_secret',
    app_secret: secret,
  });
  rememberToken(response);
  return response.access_token;
}

/** 返回有效的短期 tenant token，缓存即将过期时从 Keychain 重新换取。 */
export async function getFeishuAccessToken() {
  const user = await getFeishuUserAuthorizationStatus();
  if (user.connected) return user.accessToken;
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.accessToken;
  }
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    throw new Error('Feishu user authorization is required. Connect your Feishu account in Settings.');
  }
  const response = await sendCredentialAction({ action: 'feishu_get_access_token' });
  rememberToken(response);
  return response.access_token;
}

/** 仅供测试或主动登出流程清理当前 Service Worker 的内存缓存。 */
export function _resetFeishuTokenCache() {
  tokenCache = null;
}

/** 校验 Native Host 的 token 响应并记录保守过期时间。 */
function rememberToken(response) {
  if (!response?.access_token) {
    throw new Error('Feishu token response did not include access_token.');
  }
  const expiresIn = Math.max(120, Number(response.expires_in) || 7200);
  tokenCache = {
    accessToken: response.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}
