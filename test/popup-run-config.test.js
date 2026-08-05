/** Popup 主运行配置、门禁与折叠结构回归测试。 */

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'popup.css'), 'utf8');

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
assert('主流程展示四步导航', html.includes('id="workflow-steps"')
  && [1, 2, 3, 4].every((step) => html.includes(`data-step="${step}"`)));
const projectsStep = html.indexOf('id="run-config-details"');
const spreadsheetStep = html.indexOf('id="working-sheet-details"');
const runStep = html.indexOf('id="panel-3"');
assert('主流程按项目、工作表、运行顺序排列',
  projectsStep >= 0 && projectsStep < spreadsheetStep && spreadsheetStep < runStep);
assert('结果 Tab 明确标记为第 4 步', html.includes('class="tab-step-number">4</span>'));
assert('ROI 主 UI 不展示 vendor 选择', html.includes('id="roi-config" class="roi-config hidden" aria-hidden="true"'));
assert('ROI 主 UI 不展示语言选择', html.includes('id="roi-language-details" class="run-subsection roi-only hidden" aria-hidden="true"'));
assert('项目选择器可独立折叠', html.includes('id="run-project-details"'));
assert('CD 主界面不展示 Fast TM target language', !html.includes('id="run-target-locale"')
  && !html.includes('Fast TM target language'));
assert('CD 的 Top-3 TM 只展示英文 source，不展示 target translation',
  !source.includes("${escapeHtml(candidate.target || '')}"));
assert('主 UI 有 ROI 开关', html.includes('id="enable-roi"'));
assert('ROI 配置可整体隐藏', html.includes('id="roi-config"'));
assert('ROI 文案说明自动全语言计价', html.includes('all-language pricing and archive'));
assert('说明 source rewrite 固定为英文', html.includes('AI rewrites the English source in English'));
assert('主 UI 有项目卡片', html.includes('id="run-project-cards"'));
assert('存在 Setup required', html.includes('id="setup-required"'));
assert('存在打开 Settings 按钮', html.includes('id="setup-open-settings"'));
assert('项目至少一个门禁', source.includes("reason === 'project_required'"));
assert('缺凭证可打开 Settings', source.includes('chrome.runtime.openOptionsPage'));
assert('自动加载权限项目', source.includes('async function loadAccessibleProjects'));
assert('运行前统一门禁', source.includes('async function ensureWorkflowReady'));
assert('ROI 关闭时构建单一快速 scope', source.includes('buildFastTmScope('));
assert('CD 快速路径自动选择内部参考 locale', !source.includes('fastTargetLocale')
  && !source.includes('tmTargetLocale'));
assert('ROI 关闭时不解析费率', source.includes('if (!roiEnabled) return null'));
assert('即时保存项目选择', source.includes('starlingProjectIds: [...selectedProjectIds]'));
assert('ROI 自动构建非英文语言 scope', source.includes('validateAutomaticRoiRunConfig('));
assert('ROI 同时计算 RWS 与 Pactera', source.includes('ROI_VENDORS'));
assert('运行配置不会在就绪时自动收起', !source.includes("if (ready) document.getElementById('run-config-details').open = false"));
assert('自动语言范围基于共同 target locale', source.includes('eligibleSharedTargetLocales'));
assert('可用 ROI scope 数不乘项目数', !source.includes('eligibleLocales.length * selectedProjectIds.length'));
assert('缺费率不阻塞 TM', source.includes('TM optimization can run; ROI subtotal excludes those scopes'));
assert('运行配置构建共享语言 scope', source.includes('buildLocaleScopes('));
assert('从共享 TM 快照派生双 vendor ROI', source.includes('deriveVendorRoiResults('));
assert('结果页存在 ROI archive 按钮', html.includes('id="btn-write-roi-archive"'));
assert('存在 ROI archive 预览区域', html.includes('id="roi-archive-preview"'));
assert('Popup 使用固定 ROI archive 常量', source.includes('FIXED_ROI_ARCHIVE_URL'));
assert('Popup 不从 storage 读取 ROI archive URL', !source.includes("'roiArchiveUrl'"));
assert('归档按钮不依赖用户配置 URL', !source.includes('Boolean(config.roiArchiveUrl)')
  && !source.includes('Boolean(cfg.roiArchiveUrl)'));
assert('归档调用 ROI writer', source.includes('writeRoiArchive('));
assert('归档确认说明 Runs、Scopes 与 Items 三张表', html.includes('L10n ROI Runs, Scopes, and Items'));
assert('Items payload 标记当前 CD 展示 scope', source.includes('displayScopeKey: activeDisplayScopeKey'));
assert('归档成功摘要展示 Scope 与 Item 数量', source.includes('detail.itemRecordCount'));
assert('逐条确认写回调用单条 adapter', source.includes('await writeConfirmedReviewItem('));
assert('AI 候选渲染前去重', source.includes('dedupeAiCandidates('));
assert('AI 候选具有可访问的选择状态', source.includes('aria-pressed='));
assert('AI 候选显示明确的 Selected 状态', source.includes('candidate-select-indicator'));
assert('AI 候选根据 Final copy 标记选中', source.includes('isAiCandidateSelected('));
assert('AI 候选使用现代卡片样式', styles.includes('.ai-candidate-choice')
  && styles.includes('.ai-candidate-choice.is-selected'));
assert('AI 候选键盘焦点清晰可见', styles.includes('.ai-candidate-choice:focus-visible'));
assert('ROI 归档前获取用户身份', source.includes('authorizeFeishuUser('));
assert('ROI payload 写入当前 Operator', source.includes('operator: feishuUser.profile'));

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
assert('Wiki 自动解析真实 Spreadsheet obj_token', source.includes('resolveSpreadsheetReference'));
assert('不再把历史用户强制迁移到固定 Wiki', !source.includes('migrateWrongSheetToken') && !source.includes('CORRECT_URL'));
assert('当前页面自动选择前先解析 Wiki', /resolveSpreadsheetReference\(detection\.url/.test(source));
assert('手动粘贴目标前先解析 Wiki', /resolveSpreadsheetReference\(raw/.test(source));
assert('切换 Sheet 会刷新对应布局', source.includes('async function changeWorkingSheet'));
assert('结果卡片删除详情展开按钮', !source.includes('class="btn-sm btn-detail"'));
assert('结果页删除两个全局写回按钮', !html.includes('id="btn-write-bitable"') && !html.includes('id="btn-write-results"'));
assert('结果页删除全局 Final C 按钮', !html.includes('id="btn-validate-final"'));
assert('Side Panel 顶部提供中英文切换', html.includes('id="ui-language"'));
const restoreStart = source.indexOf('async function restoreWorkflowSnapshot()');
const restoreEnd = source.indexOf('/** 加载费率快照', restoreStart);
const restoreFlow = source.slice(restoreStart, restoreEnd);
assert('恢复历史运行后直接进入第 4 步审阅结果', restoreFlow.includes("switchTab('results')"));

console.log(`\npopup run-config 测试: ${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
