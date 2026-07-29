/** Side Panel 项目列表 UI 分页与跨页选择契约测试。 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as runConfig from '../lib/run-config.js';

const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'popup.css'), 'utf8');

assert.equal(
  typeof runConfig.paginateProjects,
  'function',
  '运行配置模块必须提供可单测的项目分页函数',
);

if (typeof runConfig.paginateProjects === 'function') {
  const projects = Array.from({ length: 30 }, (_, index) => ({ id: index + 1 }));
  const firstPage = runConfig.paginateProjects(projects, 0, 8);
  const lastPage = runConfig.paginateProjects(projects, 99, 8);

  assert.equal(firstPage.pageCount, 4, '30 个项目按每页 8 个必须生成 4 页');
  assert.deepEqual(
    firstPage.items.map((project) => project.id),
    [1, 2, 3, 4, 5, 6, 7, 8],
    '第一页必须只返回前 8 个项目',
  );
  assert.equal(lastPage.pageIndex, 3, '越界页码必须校正到最后一页');
  assert.deepEqual(
    lastPage.items.map((project) => project.id),
    [25, 26, 27, 28, 29, 30],
    '最后一页必须返回剩余 6 个项目',
  );
}

assert.match(html, /id="project-page-previous"/, '项目区必须提供上一页按钮');
assert.match(html, /id="project-page-next"/, '项目区必须提供下一页按钮');
assert.match(html, /id="project-page-status"/, '项目区必须展示当前页码');
assert.match(source, /const PROJECTS_PER_PAGE = 8;/, '项目 UI 每页数量必须固定为 8');
assert.match(source, /let projectPageIndex = 0;/, '项目当前页必须是独立 UI 状态');
assert.match(
  source,
  /projectPagination\.classList\.toggle\('hidden', projectPage\.pageCount === 0\)/,
  '只要存在项目，单页列表也必须显示第 1 页',
);
assert.match(
  source,
  /selectedProjectIds/,
  '项目选择必须继续使用跨页共享的 selectedProjectIds',
);
assert.match(styles, /\.run-project-pagination/, '项目翻页控件必须有明确布局');

console.log('project pagination tests: passed');
