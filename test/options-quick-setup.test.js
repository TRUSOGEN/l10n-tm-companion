/** Settings 首次配置必须以四步直达入口替代 Guide 与长说明。 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'options.css'), 'utf8');

assert(html.includes('class="setup-steps"'), 'Settings 顶部必须提供四步配置清单');
assert.equal(
  (html.match(/class="setup-step-number"/g) || []).length,
  4,
  '配置清单必须严格为四步',
);
assert(html.includes('https://starling.bytedance.net/personal_center#aksk'), '第一步必须直达 Starling AK/SK');
assert(html.includes('https://inspire.bytedance.net'), '第二步必须直达 Inspire Writer');
assert(html.includes('https://open.feishu.cn/app'), '第三步必须直达飞书开放平台');
assert(html.includes('Credentials &amp; Basic Info')
  && html.includes('Feishu App Secret')
  && html.includes('Enter Feishu App Secret')
  && html.includes('team owner'), '第三步必须说清 App Secret 从谁处获取、在哪里填写');
assert(!html.includes('Owner/Pilot only'), '同部门获准用户不应被 Owner/Pilot 文案阻挡');
assert(!html.includes('Configure secure token exchange'), '按钮必须使用用户能识别的 App Secret 动作名称');
assert(!html.includes('Do not send the App Secret to normal users.'), '不得展示与部门分发方式冲突的警告');
assert(!html.includes('Open the step-by-step installation and usage guide'), 'Settings 不再展示使用手册入口');
assert(!html.includes('Read the Inspire Prototype guide'), 'Settings 不再展示 Inspire Guide 入口');
assert(
  html.includes('Best TM Match, Orig Match %, Rewritten Segment, Post-TM %, Reached 85%?, and Final TM %.'),
  '动态列说明必须使用当前真实六列及其顺序',
);
assert(!html.includes('New Match %') && !html.includes('CD review valid?'), '设置页不得继续展示旧版列名');
assert(styles.includes('.setup-steps') && styles.includes('.setup-step-number'), '四步清单必须使用紧凑编号样式');
assert(styles.includes('.owner-secret-button'), 'App Secret 填写按钮必须使用明确的主操作样式');

console.log('options quick setup tests: passed');
