/** 飞书固定 App ID、Keychain 消息与短期 token 缓存契约。 */

import assert from 'node:assert/strict';

const calls = [];
const localState = {};
let oauthResponseScope;
const grantedUserScope = [
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
oauthResponseScope = grantedUserScope;
globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        const normalize = (k) => (Array.isArray(k) ? k : [k]);
        const keyList = normalize(keys).filter(Boolean);
        return Object.fromEntries(
          keyList.filter((key) => key in localState).map((key) => [key, localState[key]]),
        );
      },
      async set(values) {
        Object.assign(localState, values);
      },
      async remove(keys) {
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach((key) => delete localState[key]);
      },
    },
  },
  runtime: {
    lastError: null,
    sendMessage(message, callback) {
      calls.push(message);
      const action = message.payload?.action;
      if (action === 'feishu_secret_status') callback({ ok: true, configured: true });
      else if (action === 'feishu_save_secret') callback({ ok: true, access_token: 'tenant-saved', expires_in: 7200 });
      else if (action === 'feishu_get_access_token') callback({ ok: true, access_token: 'tenant-fetched', expires_in: 7200 });
      else if (action === 'feishu_configure_app_secret') callback({ ok: true, configured: true });
      else if (action === 'feishu_user_oauth') callback({
        ok: true,
        access_token: 'user-token',
        expires_in: 7200,
        ...(oauthResponseScope === undefined ? {} : { scope: oauthResponseScope }),
      });
      else callback({ error: `unexpected ${action}` });
    },
  },
};

globalThis.fetch = async (url, options = {}) => {
  assert.match(String(url), /\/open-apis\/authen\/v1\/user_info$/);
  assert.equal(options.headers.Authorization, 'Bearer user-token');
  return {
    ok: true,
    async json() {
      return {
        code: 0,
        data: {
          name: '测试用户',
          en_name: 'Test User',
          open_id: 'ou_test',
          user_id: 'u_test',
          avatar_url: 'https://example.com/avatar.png',
        },
      };
    },
  };
};

const {
  FEISHU_APP_ID,
  FEISHU_USER_SCOPE,
  authorizeFeishuUser,
  configureFeishuApplication,
  getFeishuAccessToken,
  getFeishuCredentialStatus,
  getFeishuUserAuthorizationStatus,
  saveFeishuAppSecret,
} = await import('../lib/feishu-auth.js');

assert.equal(FEISHU_APP_ID, 'cli_aab1ca4137badbc4');
const requestedScopes = new Set(FEISHU_USER_SCOPE.split(/\s+/));
assert.equal(requestedScopes.has('sheets:spreadsheet.meta:read'), true);
assert.equal(requestedScopes.has('sheets:spreadsheet:read'), true);
assert.equal(requestedScopes.has('sheets:spreadsheet:write_only'), true);
assert.equal(requestedScopes.has('sheets:spreadsheet'), false, '不得再请求未开通的旧版总 scope');
assert.equal(requestedScopes.has('wiki:node:read'), true);
assert.equal(requestedScopes.has('wiki:wiki:readonly'), false, '不得请求后台未开通的旧 Wiki scope');
assert.equal(requestedScopes.has('base:field:create'), true, '首次归档补字段需要新增字段权限');
assert.equal(requestedScopes.has('base:record:read'), true, '特定记录读取仍需保留精细权限');
assert.equal(requestedScopes.has('base:record:retrieve'), true, '写入前容量检查列出记录需要检索权限');
assert.equal(requestedScopes.has('base:view:read'), true, '基础 ROI 视图需要读取权限');
assert.equal(requestedScopes.has('base:view:write_only'), true, '首次补齐基础 ROI 视图需要写权限');
assert.equal(requestedScopes.has('contact:user.employee_id:readonly'), true);
assert.equal(requestedScopes.has('auth:user.id:read'), false, 'user ID scope 必须使用飞书后台实际权限 ID');
assert.deepEqual(await getFeishuCredentialStatus(), { configured: true });
assert.equal(await saveFeishuAppSecret('secret-once'), 'tenant-saved');
assert.equal(await getFeishuAccessToken(), 'tenant-saved', '保存后应复用短期 token 缓存');
assert.equal(calls.some((call) => call.payload?.app_secret === 'secret-once'), true);
assert.equal(
  calls.find((call) => call.payload?.action === 'feishu_save_secret')?.payload?.allow_legacy_local_secret,
  true,
  'Broker 关闭时必须把已验证的 legacy 选择显式传给 Native Host',
);
assert.equal(calls.every((call) => call.action === 'native_feishu_credentials'), true);

const originalPageUrl = 'https://bytedance.larkoffice.com/wiki/original';
const authorization = await authorizeFeishuUser({ returnUrl: originalPageUrl });
assert.equal(authorization.profile.name, '测试用户');
assert.equal(authorization.profile.userId, 'u_test');
assert.equal(authorization.profile.avatarUrl, 'https://example.com/avatar.png');
const oauthCall = calls.find((call) => call.payload?.action === 'feishu_user_oauth');
assert.equal(oauthCall.payload.return_url, originalPageUrl, 'OAuth 必须把原页面 URL 传给本机 callback');
assert.equal(oauthCall.payload.allow_legacy_local_secret, true);
assert.equal(localState.feishuUserAuthSchemaVersion, 2, '新版 token 必须记录实际 scope 校验版本');
assert.equal((await getFeishuUserAuthorizationStatus()).connected, true);
assert.equal(await getFeishuAccessToken(), 'user-token', '有效用户 token 应优先用于用户身份调用');

localState.feishuUserAuthSchemaVersion = 1;
const unverifiableAuthorization = await getFeishuUserAuthorizationStatus();
assert.equal(unverifiableAuthorization.connected, false, '旧版伪 scope token 必须一次性要求重新授权');
assert.equal(unverifiableAuthorization.scopeVerified, false);
localState.feishuUserAuthSchemaVersion = 2;

localState.feishuUserScope = grantedUserScope.replace('base:view:read', '').trim();
const staleAuthorization = await getFeishuUserAuthorizationStatus();
assert.equal(staleAuthorization.connected, false, '缺少当前必需 scope 的旧 token 必须要求重新授权');
assert.equal(staleAuthorization.missingScopes.includes('base:view:read'), true);

oauthResponseScope = grantedUserScope.replace('base:record:retrieve', '').trim();
await assert.rejects(
  authorizeFeishuUser(),
  /base:record:retrieve.*publish a new app version.*authorize again/i,
  '飞书实际签发的 token 缺 scope 时必须在调用 ROI API 前正确失败',
);
assert.equal(localState.feishuUserAccessToken, undefined, '拒绝的 user token 不得留在本地');
assert.equal(localState.feishuUserScope.includes('base:record:retrieve'), false);

oauthResponseScope = undefined;
await assert.rejects(
  authorizeFeishuUser(),
  /did not return granted scope/i,
  '不得再把请求 scope 伪装成飞书实际授予的 scope',
);
assert.equal(localState.feishuUserAccessToken, undefined);

const ownerSetup = await configureFeishuApplication();
assert.deepEqual(ownerSetup, { configured: true });
assert.equal(calls.at(-1).payload.action, 'feishu_configure_app_secret');
assert.equal('app_secret' in calls.at(-1).payload, false, 'Owner setup 不得让 App Secret 经过 Chrome');
assert.equal(calls.at(-1).payload.allow_legacy_local_secret, true);

console.log('feishu auth tests: 33 passed, 0 failed');
