/**
 * 验证 Side Panel 首页承担普通用户飞书授权，并在授权完成后即时刷新状态。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dirname, '..');
const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');

assert(html.includes('id="feishu-auth-card"'), '首页必须展示飞书授权卡片');
assert(html.includes('id="connect-feishu-user"'), '首页必须提供飞书授权按钮');
assert(html.includes('id="feishu-auth-status"'), '首页必须展示授权结果');
assert(source.includes('async function connectFeishuUserFromPopup()'), '首页必须实现用户授权动作');
assert(
  source.includes("document.getElementById('connect-feishu-user').addEventListener"),
  '首页必须绑定飞书授权按钮',
);
assert(source.includes('await runHealthCheck();'), '授权完成后必须即时刷新健康检查');
assert(source.includes('async function getActiveReturnUrl()'), '首页授权前必须读取当前原页面 URL');
assert(
  source.includes('authorizeFeishuUser({ returnUrl })'),
  '首页授权必须把原页面 URL 交给 OAuth callback',
);
assert(
  source.includes('status.missingScopes'),
  '旧 token 缺少当前必需 scope 时，首页必须展示缺失权限并引导重新授权',
);
assert(
  source.includes('status.scopeVerified === false'),
  '1.3.2 及更早 token 必须在首页提示重新验证实际 scope',
);
assert(!source.includes('connect your Feishu account in Settings'), '首页不得继续把普通用户引导到 Settings');
assert(!source.includes('Connect your Feishu account in Settings'), '工作表检查不得继续把普通用户引导到 Settings');

console.log('popup Feishu OAuth contract: passed');
