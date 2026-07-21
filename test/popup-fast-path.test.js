// 默认处理链路回归：只查询 Batch TM，不查询 Source String Key 或项目归属。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let passed = 0;
let failed = 0;

function assert(name, condition) {
  if (condition) {
    passed += 1;
    console.log(`  PASS ${name}`);
    return;
  }
  failed += 1;
  console.log(`  FAIL ${name}`);
}

const testDir = path.dirname(fileURLToPath(import.meta.url));
const popupSource = fs.readFileSync(path.join(testDir, '..', 'popup.js'), 'utf8');
const runnerSource = fs.readFileSync(path.join(testDir, '..', 'lib', 'multilingual-runner.js'), 'utf8');
const start = popupSource.indexOf('async function processItems(items)');
const end = popupSource.indexOf('// ===== 渲染结果卡片 =====');
const processItemsSource = popupSource.slice(start, end);

console.log('\n=== popup: fast TM-only pipeline ===');
assert('processItems 已定位', start >= 0 && end > start);
assert('默认流程不查询 Source String Key', !processItemsSource.includes('searchKeys('));
assert('默认流程不写入项目归属', !processItemsSource.includes('item.project ='));
assert('默认流程查询改写后的真实 TM 快照', processItemsSource.includes('queryPostRewriteTmSnapshots('));
assert('最终确认流程查询 C 的第三次真实 TM 快照', popupSource.includes('queryFinalTmSnapshots('));
assert('结果页提供最终 C 验证按钮', popupSource.includes('btn-validate-final'));
assert('改写后快照保存到运行条目', runnerSource.includes('item.post_rewrite_tm = snapshots[index]'));
assert('默认流程调用可测试的 scope 执行器', processItemsSource.includes('runLocaleScopes({'));
assert('快速与 ROI scope 都通过统一入口携带全部项目 ID', popupSource.includes('function projectIdsForScope(scope)') && processItemsSource.includes('projectIdsForScope(scope)'));
assert('默认流程不把 B 汇总为正式 ROI', !processItemsSource.includes('summarizeMultilingualRoi(scopeRuns)'));
assert('Sheet display scope 不依赖 ROI 完整性', processItemsSource.includes("activeDisplayScopeKey = scopeRuns[0]?.scope.key || ''"));
assert('Sheet 的 Score B 使用真实改写后 TM 快照', processItemsSource.includes('item.post_rewrite_tm.score'));
assert('A/B/C 运行快照有专用本地存储键', popupSource.includes("const ROI_WORKFLOW_SNAPSHOT_KEY = 'roiWorkflowSnapshot'"));
assert('Popup 初始化会恢复未完成运行', popupSource.includes('await restoreWorkflowSnapshot();'));
assert('首轮 A/B 完成后持久化运行快照', popupSource.includes('await persistWorkflowSnapshot();'));
assert('运行快照恢复后重建结果卡片', popupSource.includes('processedItems = buildProcessedDisplayItems(multilingualScopeRuns);'));
assert('新运行开始前清除旧运行快照', popupSource.includes('await clearWorkflowSnapshot();'));
assert('运行快照记录写回时的 Spreadsheet token', popupSource.includes('spreadsheetToken: config.spreadsheetToken || \'\''));
assert('恢复快照前校验当前 Spreadsheet token', popupSource.includes('snapshot.workflowContext?.spreadsheetToken !== config.spreadsheetToken'));
assert('结果按当前可用 TM 分数升序排序', popupSource.includes('}).sort(compareItemsByCurrentTmScore);'));
assert('0 条最终 C 时停止归档流程', popupSource.includes('confirmedCount === 0'));
assert('排序优先使用最终 C 的真实 Score C', popupSource.includes("item?.final_tm?.status === 'complete' ? item.final_tm.score : null"));
assert('排序其次使用候选 B 的真实 Score B', popupSource.includes("item?.post_rewrite_tm?.status === 'complete' ? item.post_rewrite_tm.score : null"));
assert('缺失 TM 分数固定排在最后', popupSource.includes('?? Infinity'));
assert('结果卡片不展示未查询的 Key', !popupSource.includes('${keyRow(item)}'));
assert('工作表优先从当前标签页自动识别', popupSource.includes('async function detectCurrentWorkingSheet()'));
assert('自动识别使用 active tab URL', popupSource.includes('chrome.tabs.query({ active: true, currentWindow: true }'));
assert('手动工作表作为明确 override 保存', popupSource.includes("saveWorkingSheet(raw, parsed, 'manual')"));
assert('工作表帮助引导确认动态范围', popupSource.includes('confirm its source and output ranges below'));
assert('Popup 不再渲染 ROI 金额', !popupSource.includes('Estimated vehicle TM savings'));

console.log(`\npopup fast-path 测试: ${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
