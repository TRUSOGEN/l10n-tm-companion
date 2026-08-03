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
const archiveSource = fs.readFileSync(path.join(testDir, '..', 'lib', 'roi-bitable-archive.js'), 'utf8');
const start = popupSource.indexOf('async function processItems(items)');
const end = popupSource.indexOf('// ===== 渲染结果卡片 =====');
const processItemsSource = popupSource.slice(start, end);

console.log('\n=== popup: fast TM-only pipeline ===');
assert('processItems 已定位', start >= 0 && end > start);
assert('默认流程不查询 Source String Key', !processItemsSource.includes('searchKeys('));
assert('默认流程不写入项目归属', !processItemsSource.includes('item.project ='));
assert('默认流程批量查询全部候选的真实 TM 快照', processItemsSource.includes('queryRewriteCandidateTmSnapshots('));
assert('最终确认流程查询 C 的第三次真实 TM 快照', popupSource.includes('queryFinalTmSnapshots('));
assert('结果页删除全局最终 C 验证按钮', !popupSource.includes("getElementById('btn-validate-final').addEventListener"));
assert('改写后快照保存到运行条目', runnerSource.includes('item.post_rewrite_tm = snapshots[index]'));
assert('默认流程调用可测试的 scope 执行器', processItemsSource.includes('runLocaleScopes({'));
assert(
  'ROI 首屏只执行一个优先展示 scope',
  processItemsSource.includes('partitionPriorityScope(runConfig.scopes')
    && processItemsSource.includes('scopes: scopePartition.priority'),
);
assert(
  '完整 ROI scope 定义保存在运行快照中供归档补算',
  processItemsSource.includes('roiScopes: runConfig.scopes.map('),
);
assert(
  'ROI 归档前补算延后的语言 scope',
  popupSource.includes('await completeDeferredRoiScopesForArchive('),
);
const deferredRoiStart = popupSource.indexOf('async function completeDeferredRoiScopesForArchive');
const deferredRoiEnd = popupSource.indexOf('/** 将当前整车 ROI 结果追加写入', deferredRoiStart);
const deferredRoiSource = popupSource.slice(deferredRoiStart, deferredRoiEnd);
assert('延后语言 ROI 不重复查询 AI 候选 B', !deferredRoiSource.includes('queryRewriteCandidateTmSnapshots('));
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
assert('结果保持 Sheet 原始行号顺序', !popupSource.includes('}).sort(compareItemsByCurrentTmScore);'));
assert('Focus 提供逐条确认入口', popupSource.includes('data-confirm-review'));
assert('Focus 使用兼容 TM 展示状态，避免有分数却误报无 TM', popupSource.includes('buildFocusTmState(item)'));
assert('Focus 直接展示 AI 候选缺失原因', popupSource.includes('explainFocusAiAbsence(item)'));
assert('逐条确认调用真实 Final TM', popupSource.includes('async function confirmReviewItem'));
assert('逐条确认成功后写单条 Sheet', popupSource.includes('writeConfirmedReviewItem('));
assert('批量确认剩余项调用批量 Final TM', popupSource.includes('async function confirmRemainingReviewItems')
  && popupSource.includes('queryFinalTmSnapshots('));
assert('批量确认剩余项使用连续区间 Sheet writer', popupSource.includes('writeConfirmedReviewItems('));
assert(
  '0 条 confirmed 时停止归档流程',
  popupSource.includes('reviewItems: processedItems')
    && archiveSource.includes('funnel.cdReviewedSegments === 0')
    && archiveSource.includes('roi_archive_requires_confirmed_review'),
);
assert('结果代码不再保留 TM 分数排序器', !popupSource.includes('compareItemsByCurrentTmScore'));
assert('结果卡片不展示未查询的 Key', !popupSource.includes('${keyRow(item)}'));
assert('工作表优先从当前标签页自动识别', popupSource.includes('async function detectCurrentWorkingSheet()'));
assert('自动识别使用 active tab URL', popupSource.includes('chrome.tabs.query({ active: true, currentWindow: true }'));
assert('手动工作表作为明确 override 保存', popupSource.includes("saveWorkingSheet(raw, parsed, 'manual')"));
assert('工作表帮助引导确认动态范围', popupSource.includes('confirm its source and output ranges below'));
assert('Popup 不再渲染 ROI 金额', !popupSource.includes('Estimated vehicle TM savings'));
assert('主流程不再绑定批量写回按钮', !popupSource.includes("getElementById('btn-write-bitable').addEventListener"));
assert('结果页不再绑定批量写回按钮', !popupSource.includes("getElementById('btn-write-results').addEventListener"));

console.log(`\npopup fast-path 测试: ${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
