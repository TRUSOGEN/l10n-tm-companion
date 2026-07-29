/** 验证用户授权入口位于 Side Panel，App Secret 仅通过系统弹窗写入 Keychain。 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dirname, '..');
const html = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'options.js'), 'utf8');

assert(!html.includes('id="connect-feishu-user"'), 'Settings 不应继续承载普通用户授权入口');
assert(html.includes('id="feishu-user-avatar"'), 'Settings 应展示已授权用户头像');
assert(html.includes('id="feishu-user-name"'), 'Settings 应展示已授权用户名称');
assert(!html.includes('id="feishuAppId"'), '固定 Feishu App ID 不应要求普通用户输入');
assert(!html.includes('id="feishuAppSecret"'), 'Settings DOM 不得直接承载 App Secret');
assert(html.includes('id="configure-feishu-app"'), 'Settings 应提供系统安全配置入口');
assert(!source.includes('authorizeFeishuUser'), 'Settings 不应启动普通用户 OAuth');
assert(source.includes('configureFeishuApplication'), 'Secret setup 应调用 Native Host 安全配置');
assert(source.includes('getFeishuUserAuthorizationStatus'), 'Settings 应读取已授权用户资料');
assert(!source.includes('saveFeishuAppSecret'), 'Settings 不得保存共享 App Secret');
assert(source.includes("chrome.storage.local.remove(['feishuAppId', 'feishuAppSecret'])"), '升级时必须清除 Chrome 中的历史明文凭证');
assert(!source.includes("'feishuAppSecret',\n  'enableAI'"), 'App Secret 不得继续进入常规 Chrome storage keys');

console.log('PASS: Feishu user OAuth Settings contract');
