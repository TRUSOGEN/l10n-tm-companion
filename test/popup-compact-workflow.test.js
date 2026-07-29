/** Side Panel 紧凑认证卡、单开步骤与有限高度滚动契约测试。 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'popup.css'), 'utf8');

assert.match(
  source,
  /function bindWorkflowAccordion\(\)/,
  'Projects 与 Spreadsheet 必须使用单开 accordion',
);
assert.match(
  source,
  /other\.open = false/,
  '展开一个工作流步骤时必须关闭另一个步骤',
);
assert.doesNotMatch(
  styles,
  /\.workflow-step-section\s*\{[^}]*overflow:\s*hidden/s,
  '折叠步骤不能用 overflow hidden 裁掉 summary',
);
assert.match(
  styles,
  /\.run-config-body[\s\S]*max-height:[^;]+;[\s\S]*overflow-y:\s*auto/,
  '项目配置展开区必须限制高度并允许内部滚动',
);
assert.match(
  styles,
  /\.working-sheet-details\s*>\s*\.step-panel[\s\S]*overflow-y:\s*auto/,
  '工作表配置展开区必须允许内部滚动',
);
assert.match(
  styles,
  /\.feishu-auth-card\.connected[\s\S]*grid-template-columns:\s*auto minmax\(0,\s*1fr\)/,
  '授权成功后的认证卡必须缩为头像与姓名两列',
);
assert.match(
  styles,
  /\.feishu-auth-card\.connected\s+\.btn[\s\S]*display:\s*none/,
  '授权成功后必须隐藏重新授权按钮',
);
assert.match(
  styles,
  /\.feishu-auth-card\.connected\s+\.feishu-auth-kicker[\s\S]*display:\s*none/,
  '授权成功后必须隐藏认证说明标签',
);

const resultsViewIndex = html.indexOf('id="view-results"');
const destinationPreviewIndex = html.indexOf('id="dest-preview"');
assert.ok(
  resultsViewIndex >= 0 && destinationPreviewIndex > resultsViewIndex,
  '运行写入目标预览必须放在 Review，不得占用 Workflow',
);
assert.doesNotMatch(html, /id="selected-count"/, 'Workflow 不再重复展示确认数量');

const restoreStart = source.indexOf('async function restoreWorkflowSnapshot()');
const restoreEnd = source.indexOf('/** 加载费率快照', restoreStart);
const restoreFlow = source.slice(restoreStart, restoreEnd);
assert.doesNotMatch(
  restoreFlow,
  /showStatus\(/,
  '恢复历史运行后不应在 Workflow 留下重复状态提示',
);

console.log('popup compact workflow tests: passed');
