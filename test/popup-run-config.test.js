/** Popup 主运行配置、门禁与折叠结构回归测试。 */

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');

let passed = 0;
let failed = 0;
function assert(name, condition) {
  if (condition) {
    passed += 1;
    console.log(`  PASS ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}`);
  }
}

console.log('\n=== popup: run configuration ===');
assert('主 UI 有 vendor', html.includes('id="run-vendor"'));
assert('主 UI 有 ROI 语言覆盖容器', html.includes('id="roi-language-coverage"'));
assert('ROI 语言支持一键全选', html.includes('id="roi-select-all"'));
assert('ROI 语言支持一键取消全部', html.includes('id="roi-clear-all"'));
assert('ROI 语言支持按 locale 搜索', html.includes('id="roi-locale-filter"'));
assert('项目选择器可独立折叠', html.includes('id="run-project-details"'));
assert('ROI 语言区可独立折叠', html.includes('id="roi-language-details"'));
assert('普通路径有快速 TM target locale', html.includes('id="run-target-locale"'));
assert('主 UI 有 ROI 开关', html.includes('id="enable-roi"'));
assert('ROI 配置可整体隐藏', html.includes('id="roi-config"'));
assert('vendor 可计费共同语言范围说明', html.includes('Only common languages with an exact vendor word rate are shown'));
assert('说明 source rewrite 固定为英文', html.includes('AI rewrites the English source in English'));
assert('主 UI 有项目卡片', html.includes('id="run-project-cards"'));
assert('存在 Setup required', html.includes('id="setup-required"'));
assert('存在打开 Settings 按钮', html.includes('id="setup-open-settings"'));
assert('项目至少一个门禁', source.includes("reason === 'project_required'"));
assert('缺凭证可打开 Settings', source.includes('chrome.runtime.openOptionsPage'));
assert('自动加载权限项目', source.includes('async function loadAccessibleProjects'));
assert('运行前统一门禁', source.includes('async function ensureWorkflowReady'));
assert('ROI 关闭时构建单一快速 scope', source.includes('buildFastTmScope('));
assert('ROI 关闭时不解析费率', source.includes('if (!roiEnabled) return null'));
assert('即时保存项目选择', source.includes('starlingProjectIds: [...selectedProjectIds]'));
assert('即时保存共享 ROI 语言选择', source.includes('roiTargetLocales'));
assert('全选和取消全部会持久化', source.includes('async function setAllRoiLocales'));
assert('不再提供按项目分别选择 ROI 语言', !source.includes('async function setProjectRoiLocales'));
assert('语言筛选在重新渲染后保留', source.includes('localeFilterQuery'));
assert('当前 vendor 会过滤共同语言中的不可计费项', source.includes('eligibleSharedTargetLocales'));
assert('vendor 切换会清理不可用语言选择', source.includes('reconcileRoiLocaleSelections();'));
assert('vendor 切换会重置为该 vendor 的可计费语言', source.includes('resetToEligible: true'));
assert('运行配置不会在就绪时自动收起', !source.includes("if (ready) document.getElementById('run-config-details').open = false"));
assert('显示已选与共同可用语言数', source.includes('availableScopeCount'));
assert('可用 ROI scope 数不乘项目数', !source.includes('eligibleLocales.length * selectedProjectIds.length'));
assert('缺费率不阻塞 TM', source.includes('TM optimization can run; ROI subtotal excludes those scopes'));
assert('运行配置构建共享语言 scope', source.includes('buildLocaleScopes('));
assert('汇总多语言 ROI', source.includes('summarizeMultilingualRoi('));
assert('结果页存在 ROI archive 按钮', html.includes('id="btn-write-roi-archive"'));
assert('存在 ROI archive 预览区域', html.includes('id="roi-archive-preview"'));
assert('归档读取独立配置', source.includes('roiArchiveUrl'));
assert('归档调用 ROI writer', source.includes('writeRoiArchive('));
assert('归档确认只说明 Runs 与 Scopes 两张表', !source.includes('L10n ROI Items'));
assert('原 Sheet 写回仍调用 writeToSheet', source.includes('await writeToSheet(itemsToWrite, config)'));

const otherStart = html.indexOf('Other sources (DOM extraction, may be noisy)');
const otherEnd = html.indexOf('</details>', otherStart);
const otherSourcesBlock = html.slice(otherStart, otherEnd);
assert('doc title 位于 Other sources 内', otherSourcesBlock.includes('id="doc-title"'));
assert('Working spreadsheet 整块为 details', html.includes('<details id="working-sheet-details"'));
assert('工作表有紧凑 summary', html.includes('id="working-sheet-summary"'));
assert('工作表支持切换同一 Spreadsheet 内的 Sheet', html.includes('id="working-sheet-select"'));
assert('工作表支持选择来源列', html.includes('id="sheet-source-column"'));
assert('工作表支持编辑数据起始行', html.includes('id="sheet-data-start-row"'));
assert('工作表支持选择输出起始列', html.includes('id="sheet-output-start-column"'));
assert('工作表显示真实读写范围', html.includes('id="sheet-range-summary"'));
assert('工作表预览前五条 source', html.includes('id="sheet-source-preview"'));
assert('不确定布局需要显式确认', html.includes('id="btn-confirm-sheet-layout"'));
assert('工作表布局按 token 和 sheetId 保存', source.includes('sheetLayoutStorageKey('));
assert('切换 Sheet 会刷新对应布局', source.includes('async function changeWorkingSheet'));
assert('结果卡片渲染详情展开按钮', source.includes('class="btn-sm btn-detail"'));
assert('Side Panel 顶部提供中英文切换', html.includes('id="ui-language"'));

console.log(`\npopup run-config 测试: ${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
