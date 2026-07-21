/** 验证 Settings 提供 App ID / Secret 的飞书连接入口。 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dirname, '..');
const html = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'options.js'), 'utf8');

assert(html.includes('id="test-feishu"'), 'Settings 应提供 Feishu 连接测试按钮');
assert(html.includes('id="feishuAppId"'), 'Settings 应提供 Feishu App ID 输入框');
assert(html.includes('id="feishuAppSecret"'), 'Settings 应提供 Feishu App Secret 输入框');
assert(source.includes("'feishuAppId'"), 'Settings 应读取 Feishu App ID');
assert(source.includes("'feishuAppSecret'"), 'Settings 应读取 Feishu App Secret');
assert(!source.includes("chrome.storage.local.remove(['feishuAppId', 'feishuAppSecret'])"), 'Settings 不得清除用户填写的 App Secret');
assert(!html.includes('id="connect-roi-archive-feishu"'), '旧凭证模式不展示用户 OAuth 连接按钮');

console.log('PASS: Feishu App credential Settings contract');
