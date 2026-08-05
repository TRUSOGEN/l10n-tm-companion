/**
 * popup.js — Chrome Side Panel 工作台逻辑
 *
 * TM 优化流程：抓取 → Starling Top-3 TM → 对 50 ≤ Score A < 85 的 source 生成 AI 候选
 *           → 逐候选查询真实 Post-TM 并执行安全门禁 → Focus 人工确认
 *           → 查询 Final TM → 单条或批量写回飞书表格 → 按需归档整车 ROI
 */

import {
  listProjects,
  pingNativeHost,
  queryFinalTmSnapshots,
  queryRewriteCandidateTmSnapshots,
  searchTM,
} from './lib/starling-tm.js';
import { rewriteSourceWithAI } from './lib/ai-translate.js';
import { compareAIvsTM } from './lib/diff.js';
import { TM_MATCH_THRESHOLD } from './lib/tm-threshold.js';
import {
  writeConfirmedReviewItems,
  writeConfirmedReviewItem,
  listSourceSegments,
  listSpreadsheetSheets,
  inspectSheetLayout,
  testSheetsConnection,
  parseSheetsUrl,
  parseFeishuUrl,
  resolveSpreadsheetReference,
} from './lib/feishu-sheets.js';
import { friendlyError } from './lib/errors.js';
import {
  buildFastTmScope,
  buildLocaleScopes,
  normalizeProject,
  paginateProjects,
  ROI_VENDORS,
  targetLocaleIntersection,
  toggleProjectSelection,
  validateAutomaticRoiRunConfig,
  validateRunConfig,
} from './lib/run-config.js';
import { resolveWordRate } from './lib/pricing-rules.js';
import { calculateRoiForItem } from './lib/roi-calculation.js';
import { deriveVendorRoiResults, summarizeMultilingualRoi } from './lib/multilingual-roi.js';
import {
  completeDeferredLocaleScopes,
  partitionPriorityScope,
  runLocaleScopes,
} from './lib/multilingual-runner.js';
import {
  FIXED_ROI_ARCHIVE_URL,
  buildRoiArchivePayload,
  writeRoiArchive,
} from './lib/roi-bitable-archive.js';
import { applyI18n, normalizeUiLanguage, t } from './lib/i18n.js';
import {
  authorizeFeishuUser,
  authorizeFeishuUserViaBroker,
  getFeishuCredentialStatus,
  getFeishuUserAuthorizationStatus,
  openFeishuSettingsPage,
  preflightFeishuAuthorization,
} from './lib/feishu-auth.js';
import { summarizeArchive } from './lib/archive-summary.js';
import { createFeishuPopupController } from './lib/feishu-popup-controller.js';
import { sha256Text } from './lib/hash-utils.js';
import {
  BROKER_WORKFLOW_SNAPSHOT_KEY,
  buildBrokerRunPayload,
  buildSheetReceipt,
  canArchiveBrokerRun,
  clearBrokerRunSnapshot,
  countPendingBrokerFinalSubmissions,
  createBrokerRun,
  enqueueBrokerFinalSubmission,
  fetchBrokerRun,
  isBrokerAsyncRoiEnabled,
  loadBrokerRunSnapshot,
  persistBrokerRunSnapshot,
  pollBrokerRunUntil,
  replayPendingBrokerFinals,
  requestBrokerArchive,
  setBrokerAsyncRoiEnabled,
} from './lib/broker-async-roi.js';
import {
  evaluateRewriteCandidate,
  evaluateRewriteCandidates,
  formatTmSourceForDisplay,
} from './lib/source-rewrite-policy.js';
import {
  buildSourcePreview,
  getOutputColumns,
  sheetLayoutStorageKey,
  validateSheetLayout,
} from './lib/sheet-layout.js';
import {
  beginConfirmation,
  buildFocusTmState,
  completeConfirmation,
  createReviewState,
  dedupeAiCandidates,
  editFinalText,
  explainFocusAiAbsence,
  failConfirmation,
  filterReviewItems,
  getReviewableAiCandidates,
  isAiCandidateSelected,
  prepareBulkConfirmations,
} from './lib/review-workflow.js';

let extractedItems = [];
let processedItems = [];
let userChoices = {}; // itemId → 'ai' | 'source' | 'manual'
let accessibleProjects = [];
let selectedProjectIds = [];
let projectPageIndex = 0;
let selectedRoiLocales = null;
let runVendor = 'RWS';
let vendorRoiResults = {};
let rateCatalog = null;
let activeRunConfig = null;
let multilingualRoiSummary = null;
let multilingualScopeRuns = [];
let activeDisplayScopeKey = '';
let finalValidationAttempted = false;
let activeWorkflowContext = null;
let localeFilterQuery = '';
let reviewFilter = 'all';
let roiEnabled = false;
let uiLanguage = 'en';
let workingSheets = [];
let activeSheetLayout = null;
let activeSheetInspectionRows = [];
let brokerAsyncRoi = false;
let activeBrokerRun = null;
let brokerRunCreateError = null;
let brokerPollTimer = null;
const ROI_WORKFLOW_SNAPSHOT_KEY = 'roiWorkflowSnapshot';
const ROI_WORKFLOW_SNAPSHOT_VERSION = 2;
const ROI_WORKFLOW_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PROJECTS_PER_PAGE = 8;

// ===== 配置加载 =====
async function loadConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      [
        'sheetsUrl', 'spreadsheetToken', 'sheetId', 'workingSheetMode', 'fieldMapping', 'sheetLayouts',
        'llmProvider', 'llmEndpoint', 'llmApiKey', 'llmModel',
        'starlingCliPath', 'starlingProjectId', 'starlingProjectIds',
        'starlingTmMode',
        'starlingAccessKey', 'starlingSecretKey', 'starlingCredentialState',
        'starlingProjectsCache', 'roiTargetLocales', 'roiLocalesByProject',
        'enableAI',
        'enableROI', 'uiLanguage',
        'llmThinkingLevel',
        'inspireAgentMode', 'inspireCustomAgentId', 'inspireCustomAgentName', 'inspireAgentVersionPolicy', 'inspireAgentVersion',
        'vendor',
      ],
      (result) => {
        const layoutKey = sheetLayoutStorageKey(result.spreadsheetToken, result.sheetId);
        resolve({
        ...result,
        sheetLayout: result.sheetLayouts?.[layoutKey] || null,
        // LLM 默认值兜底与 Settings 保持一致；已保存的其他 Provider 配置会覆盖这里。
        llmProvider: result.llmProvider || 'inspire',
        llmEndpoint: result.llmEndpoint || 'https://inspire.bytedance.net/writer/api',
        llmModel: result.llmModel || 'gemini_3f',
      });
      }
    );
  });
}

// ===== 事件绑定 =====
document.getElementById('settings-btn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});
document.getElementById('setup-open-settings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});
document.getElementById('refresh-projects').addEventListener('click', loadAccessibleProjects);
document.getElementById('project-page-previous').addEventListener('click', () => {
  projectPageIndex -= 1;
  renderRunConfiguration();
});
document.getElementById('project-page-next').addEventListener('click', () => {
  projectPageIndex += 1;
  renderRunConfiguration();
});
document.getElementById('enable-roi').addEventListener('change', async (event) => {
  roiEnabled = event.target.checked;
  activeRunConfig = null;
  if (roiEnabled) {
    await loadRateCatalog();
    reconcileRoiLocaleSelections();
  }
  await persistRunConfiguration();
  renderRunConfiguration();
});
document.getElementById('ui-language').addEventListener('change', async (event) => {
  uiLanguage = applyI18n(document, event.target.value);
  await chrome.storage.local.set({ uiLanguage });
  await renderPopupFeishuAuthorizationStatus();
  renderRunConfiguration();
  if (processedItems.length) renderResults(processedItems);
});
document.getElementById('run-vendor').addEventListener('change', async (event) => {
  runVendor = event.target.value;
  reconcileRoiLocaleSelections({ resetToEligible: true });
  activeRunConfig = null;
  await persistRunConfiguration();
  renderRunConfiguration();
});
document.getElementById('roi-select-all').addEventListener('click', () => setAllRoiLocales(true));
document.getElementById('roi-clear-all').addEventListener('click', () => setAllRoiLocales(false));
document.getElementById('roi-locale-filter').addEventListener('input', (event) => {
  localeFilterQuery = event.target.value.trim().toLowerCase();
  renderLanguageCoverage();
});
document.getElementById('btn-extract-all').addEventListener('click', () =>
  triggerExtract('extract_all')
);
document.getElementById('btn-extract-sel').addEventListener('click', () =>
  triggerExtract('extract_selection')
);

// 从当前电子表格读 A 列原文（表格驱动入口，零噪声，比 DOM 抓取准）。
document.getElementById('btn-read-sheet').addEventListener('click', readFromSheet);

document.getElementById('btn-write-roi-archive').addEventListener('click', writeCurrentRoiArchive);
document.getElementById('review-filter-all').addEventListener('click', () => {
  reviewFilter = 'all';
  renderResults(processedItems);
});
document.getElementById('review-filter-improved').addEventListener('click', () => {
  reviewFilter = 'improved';
  renderResults(processedItems);
});
document.getElementById('btn-confirm-remaining').addEventListener('click', async () => {
  try {
    await confirmRemainingReviewItems();
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  } finally {
    renderResults(processedItems);
  }
});

// BX5：tab 切换（主流程 / 结果）
function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === name);
  });
  document.getElementById('view-main').classList.toggle('hidden', name !== 'main');
  document.getElementById('view-results').classList.toggle('hidden', name !== 'results');
}
document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => switchTab(t.dataset.tab));
});
document.getElementById('btn-back-main').addEventListener('click', () => switchTab('main'));

// BX3：工作表确认。未填写时禁止读写。
document.getElementById('btn-set-dest').addEventListener('click', confirmDestination);
document.getElementById('btn-use-current-sheet').addEventListener('click', useCurrentPageAsWorkingSheet);
document.getElementById('working-sheet-select').addEventListener('change', changeWorkingSheet);
['sheet-source-column', 'sheet-data-start-row', 'sheet-output-start-column'].forEach((id) => {
  document.getElementById(id).addEventListener('change', updateActiveSheetLayoutFromControls);
});
document.getElementById('btn-confirm-sheet-layout').addEventListener('click', confirmActiveSheetLayout);
document.getElementById('dest-url').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); confirmDestination(); }
});

// BX4：聚焦大图视图事件
document.getElementById('focus-close').addEventListener('click', closeFocusView);
document.getElementById('focus-prev').addEventListener('click', () => focusStep(-1));
document.getElementById('focus-next').addEventListener('click', () => focusStep(1));
document.getElementById('focus-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'focus-overlay') closeFocusView();
});
document.addEventListener('keydown', (e) => {
  const overlay = document.getElementById('focus-overlay');
  if (overlay.classList.contains('hidden')) return;
  if (e.key === 'Escape') closeFocusView();
  else if (e.key === 'ArrowLeft') focusStep(-1);
  else if (e.key === 'ArrowRight') focusStep(1);
});

// 打开 Popup 时先建立单开步骤，再检测运行配置与当前飞书电子表格。
bindWorkflowAccordion();
initializePopup();

/**
 * A4: dev-only opt-in flag.
 *
 * Production builds MUST leave this off. When true (explicitly set by a
 * developer in chrome.storage.local under key l10nLegacyLocalSecretDevOnly),
 * the popup still uses the legacy local-secret OAuth / local Bitable archive
 * paths even while the broker feature flag is turned on. Otherwise, broker-on
 * means broker-authoritative: any broker failure surfaces as an error instead
 * of silently falling through to legacy.
 */
const LEGACY_LOCAL_SECRET_DEV_ONLY_STORAGE_KEY = 'l10nLegacyLocalSecretDevOnly';
async function isLegacyLocalSecretDevOnlyEnabled() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local?.get) return false;
  try {
    const stored = await chrome.storage.local.get(LEGACY_LOCAL_SECRET_DEV_ONLY_STORAGE_KEY);
    return stored[LEGACY_LOCAL_SECRET_DEV_ONLY_STORAGE_KEY] === true;
  } catch (error) {
    return false;
  }
}

/** Shared guard: broker is authoritative unless developer explicitly opted in legacy fallback. */
async function shouldUseLegacyFallback() {
  if (await isLegacyLocalSecretDevOnlyEnabled()) return true;
  return !(await isBrokerAsyncRoiEnabled());
}

const feishuPopupController = createFeishuPopupController({
  documentRef: document,
  windowRef: window,
  chromeApi: chrome,
  shouldUseLegacy: shouldUseLegacyFallback,
  getAuthorizationStatus: getFeishuUserAuthorizationStatus,
  getCredentialStatus: getFeishuCredentialStatus,
  authorizeLegacy: authorizeFeishuUser,
  authorizeBroker: authorizeFeishuUserViaBroker,
  getReturnUrl: getActiveReturnUrl,
  openSettingsPage: openFeishuSettingsPage,
  formatError: (error) => {
    const model = friendlyError(error);
    return { title: model.title || 'Could not open Settings', message: model.action || model.raw || error.message };
  },
});
feishuPopupController.bind();

// 暴露给 node 测试 sandbox 使用，无需经过 DOM 事件即可覆盖单条/批量确认的 Broker 同步分支。
if (typeof globalThis !== 'undefined') {
  globalThis.__popupBrokerTestHooks = {
    getBrokerState: () => ({ brokerAsyncRoi, activeBrokerRun, brokerRunCreateError }),
    setBrokerState: ({ brokerAsyncRoi: enabled, activeBrokerRun: run, brokerRunCreateError: createErr }) => {
      if (typeof enabled === 'boolean') brokerAsyncRoi = enabled;
      if (run !==  undefined) activeBrokerRun = run;
      if (createErr !== undefined) brokerRunCreateError = createErr || null;
    },
    setActiveWorkflowContext: (ctx) => { activeWorkflowContext = ctx; },
    getActiveWorkflowContext: () => activeWorkflowContext,
    syncConfirmedItemsToBroker: (...args) => syncConfirmedItemsToBroker(...args),
    countPendingBrokerFinalSubmissions: (snapshot) => countPendingBrokerFinalSubmissions(snapshot || activeBrokerRun),
    canArchiveBrokerRun: (snapshot) => canArchiveBrokerRun(snapshot || activeBrokerRun),
    replayPendingBrokerFinals: (...args) => replayPendingBrokerFinals(...args),
    writeCurrentRoiArchive: () => writeCurrentRoiArchive({ skipConfirmation: true }),
    isLegacyLocalSecretDevOnlyEnabled: () => isLegacyLocalSecretDevOnlyEnabled(),
    shouldUseLegacyFallback: () => shouldUseLegacyFallback(),
    markBrokerCreateRunError: (error) => {
      brokerRunCreateError = error instanceof Error ? error : (error ? new Error(String(error)) : null);
      activeBrokerRun = null;
    },
    setLegacyDevOnly: async (value) => {
      if (typeof chrome !== 'undefined' && chrome.storage?.local?.set) {
        if (value) {
          await chrome.storage.local.set({ [LEGACY_LOCAL_SECRET_DEV_ONLY_STORAGE_KEY]: true });
        } else {
          await chrome.storage.local.remove(LEGACY_LOCAL_SECRET_DEV_ONLY_STORAGE_KEY);
        }
      }
    },
    // expose the processed/summary state so tests can assert the "ready-to-archive" precondition is satisfied
    setArchiveReadyState: (items = [], summary = {}) => {
      processedItems = items;
      multilingualScopeRuns = items.length ? [{ scope: { key: 'en-zh', sourceLocale: 'en', targetLocale: 'zh' }, items }] : [];
      const archiveVendors = Array.isArray(ROI_VENDORS) ? ROI_VENDORS : ['RWS', 'Pactera'];
      vendorRoiResults = Object.fromEntries(archiveVendors.map((vendor) => [vendor, {
        vendor,
        summary,
        scopeRuns: multilingualScopeRuns,
      }]));
      multilingualRoiSummary = vendorRoiResults.RWS?.summary || summary;
      finalValidationAttempted = true;
      roiEnabled = true;
    },
  };
}

/** 让 Projects 与 Spreadsheet 保持单开，避免两个长配置区同时占满 Side Panel。 */
function bindWorkflowAccordion() {
  const sections = [
    document.getElementById('run-config-details'),
    document.getElementById('working-sheet-details'),
  ];
  sections.forEach((section) => {
    section.addEventListener('toggle', () => {
      if (!section.open) return;
      sections.forEach((other) => {
        if (other !== section) other.open = false;
      });
    });
  });
}

/** 初始化 Popup 的运行配置与工作表。 */
async function initializePopup() {
  brokerAsyncRoi = await isBrokerAsyncRoiEnabled();
  const brokerSnapshot = await loadBrokerRunSnapshot();
  if (brokerSnapshot?.run_id) {
    activeBrokerRun = brokerSnapshot;
  }
  await Promise.all([
    initializeRunConfiguration(),
    initializeWorkingSheet(),
    renderPopupFeishuAuthorizationStatus(),
  ]);
  await runHealthCheck();
  await restoreWorkflowSnapshot();
  if (activeBrokerRun?.run_id) {
    try {
      if (countPendingBrokerFinalSubmissions(activeBrokerRun) > 0) {
        const replay = await replayPendingBrokerFinals({ runId: activeBrokerRun.run_id });
        const refreshed = await loadBrokerRunSnapshot();
        if (refreshed?.run_id === activeBrokerRun.run_id) activeBrokerRun = refreshed;
        if (replay?.remaining === 0) {
          showStatus('Pending broker final submissions have been replayed.', 'info');
        } else {
          showStatus(`${replay?.remaining || 0} broker final submission(s) still pending; will retry on next reopen.`, 'error');
        }
      }
      const latest = await fetchBrokerRun(activeBrokerRun.run_id);
      await syncBrokerRunStatus(latest);
    } catch (error) {
      console.warn('Could not restore async broker run status.', error);
    }
    void pollActiveBrokerRun();
  }
}

/** 在首页展示当前飞书用户，并为普通使用者提供唯一授权入口。 */
async function renderPopupFeishuAuthorizationStatus() {
  const card = document.getElementById('feishu-auth-card');
  const avatar = document.getElementById('feishu-auth-avatar');
  const title = document.getElementById('feishu-auth-title');
  const statusText = document.getElementById('feishu-auth-status');
  const button = document.getElementById('connect-feishu-user');
  const diagnostic = document.getElementById('feishu-secret-diagnostic');
  const secretAction = document.getElementById('feishu-secret-action');
  const status = await getFeishuUserAuthorizationStatus();
  const useLegacy = await shouldUseLegacyFallback();
  const credential = useLegacy && typeof getFeishuCredentialStatus === 'function'
    ? await getFeishuCredentialStatus()
    : { configured: true };
  const preflight = typeof preflightFeishuAuthorization === 'function'
    ? preflightFeishuAuthorization({
        connected: status.connected,
        displayName: status.profile?.name || status.profile?.enName,
        secretConfigured: credential.configured,
      })
    : { state: status.connected ? 'connected' : 'ready' };
  diagnostic.classList.add('hidden');
  secretAction.classList.add('hidden');
  button.classList.remove('hidden');
  if (preflight.state === 'secret-required') {
    card.classList.add('error');
    title.textContent = preflight.title;
    statusText.textContent = preflight.message;
    diagnostic.textContent = preflight.message;
    diagnostic.classList.remove('hidden');
    secretAction.classList.remove('hidden');
    button.classList.add('hidden');
    return;
  }
  card.classList.toggle('connected', status.connected);
  card.classList.remove('error');
  if (!status.connected) {
    const missingScopes = Array.isArray(status.missingScopes) ? status.missingScopes : [];
    avatar.classList.add('hidden');
    title.textContent = t('feishuAuthorizationRequired', uiLanguage);
    statusText.textContent = status.scopeVerified === false && status.profile
      ? t('feishuReconnectScopeVerification', uiLanguage)
      : (
        missingScopes.length > 0 && status.profile
          ? `${t('feishuReconnectMissingScope', uiLanguage)} ${missingScopes.join(', ')}`
          : t('feishuAuthorizeHint', uiLanguage)
      );
    button.textContent = status.profile
      ? t('reconnectFeishu', uiLanguage)
      : t('authorizeFeishu', uiLanguage);
    return;
  }
  const profile = status.profile || {};
  title.textContent = profile.name || profile.enName || t('feishuConnected', uiLanguage);
  statusText.textContent = [profile.enName, profile.userId || profile.openId]
    .filter(Boolean)
    .join(' · ') || t('feishuAuthorizationActive', uiLanguage);
  button.textContent = t('reconnectFeishu', uiLanguage);
  if (profile.avatarUrl) {
    avatar.src = profile.avatarUrl;
    avatar.alt = `${title.textContent} avatar`;
    avatar.classList.remove('hidden');
  } else {
    avatar.classList.add('hidden');
  }
}

/** 返回授权开始前的活动 HTTP(S) 页面，供 callback 关闭受限时回到原页面。 */
async function getActiveReturnUrl() {
  const tabs = await new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, resolve);
  });
  const url = tabs[0]?.url || '';
  return /^https?:\/\//i.test(url) ? url : '';
}

function canonicalizeText(text) {
  return String(text || '').replace(/\r\n?/g, '\n').normalize('NFC');
}

async function canonicalHash(text) {
  return sha256Text(canonicalizeText(text));
}

function offsetColumn(column, offset) {
  const base = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let index = 0;
  for (const ch of String(column || '').toUpperCase()) {
    if (!base.includes(ch)) return column;
    index = index * 26 + base.indexOf(ch) + 1;
  }
  index += offset;
  let result = '';
  while (index > 0) {
    const remainder = (index - 1) % 26;
    result = base[remainder] + result;
    index = Math.floor((index - 1) / 26);
  }
  return result;
}

/**
 * 单条 / 批量确认共用的 Broker 同步入口。
 *
 * 约定：调用方必须在 Sheet 写入成功、本地 review 已标记为 confirmed 之后才调用本函数。
 *   1. 为每个 writable 条目构建 receipt 并入队 pending_final_submissions；
 *   2. 持久化 snapshot（保证 Sheet 成功、Broker 失败时本地 confirmed 仍成立，outbox 已保存）；
 *   3. 调用 replayPendingBrokerFinals 顺序提交，成功自动推进 revision，失败保留 pending。
 *
 * 返回 { revision, pendingCount }：revision 仅在 activeBrokerRun 存在且 broker 返回
 * nextRevision 非空时更新，禁止在 broker 关闭或 run 不存在时访问 null.revision。
 */
async function syncConfirmedItemsToBroker({ writable, outputStartColumn }) {
  if (!brokerAsyncRoi || !activeBrokerRun?.run_id || !Array.isArray(writable) || writable.length === 0) {
    return {
      revision: activeBrokerRun?.revision || null,
      pendingCount: countPendingBrokerFinalSubmissions(activeBrokerRun),
    };
  }
  const workflowConfig = activeWorkflowContext?.config || activeWorkflowContext || null;
  for (const { planned, displayItem } of writable) {
    const finalText = String(planned?.review?.finalText || displayItem?.final_source_text || '').trim();
    if (!finalText) continue;
    const itemId = String(displayItem?.id || displayItem?.item_id || (displayItem?.row != null ? `row-${displayItem.row}` : ''));
    if (!itemId) continue;
    const receipt = await buildSheetReceipt({
      config: workflowConfig,
      item: displayItem,
      finalText,
      outputStartColumn,
    });
    const displayFinalTm = displayItem?.final_tm?.status === 'complete' && Number.isFinite(Number(displayItem?.final_tm?.score))
      ? { score: Number(displayItem.final_tm.score), match_category: displayItem.final_tm.match_category || '' }
      : null;
    const afterEnqueue = await enqueueBrokerFinalSubmission({
      runId: activeBrokerRun.run_id,
      itemId,
      finalText,
      confirmedAt: new Date().toISOString(),
      sheetWriteReceipt: receipt,
      displayFinalTm,
      sheetRow: displayItem?.row,
    });
    if (afterEnqueue) activeBrokerRun = afterEnqueue;
  }
  const replay = await replayPendingBrokerFinals({ runId: activeBrokerRun.run_id });
  const refreshed = await loadBrokerRunSnapshot();
  if (refreshed?.run_id === activeBrokerRun.run_id) activeBrokerRun = refreshed;
  const nextRevision = Number(activeBrokerRun?.revision);
  return {
    revision: Number.isFinite(nextRevision) && nextRevision > 0 ? nextRevision : null,
    pendingCount: replay?.remaining ?? countPendingBrokerFinalSubmissions(activeBrokerRun),
    replayError: replay?.error || null,
  };
}

async function submitBrokerFinalsAfterSheetWrite({ writable, revision, outputStartColumn }) {
  const result = await syncConfirmedItemsToBroker({ writable, outputStartColumn });
  const nextRevision = result.revision;
  if (activeBrokerRun && Number.isFinite(nextRevision) && nextRevision > 0) {
    activeBrokerRun = { ...(activeBrokerRun || {}), revision: nextRevision };
    await persistBrokerRunSnapshot(activeBrokerRun);
    return nextRevision;
  }
  // Broker 关闭 / run 不存在 / 未产生新 revision 时不要无条件写 activeBrokerRun.revision，
  // 直接返回传入的 revision（如果没有 run，就返回 null，避免 null TypeError）。
  return activeBrokerRun ? Number(revision || activeBrokerRun.revision || 1) : null;
}

function stopBrokerPolling() {
  if (brokerPollTimer) {
    clearTimeout(brokerPollTimer);
    brokerPollTimer = null;
  }
}

async function syncBrokerRunStatus(status) {
  if (!status?.run_id) return;
  activeBrokerRun = {
    ...(activeBrokerRun || {}),
    ...status,
    last_polled_at: new Date().toISOString(),
  };
  await persistBrokerRunSnapshot(activeBrokerRun);
}

async function pollActiveBrokerRun({ intervalMs = 2500 } = {}) {
  stopBrokerPolling();
  if (!brokerAsyncRoi || !activeBrokerRun?.run_id) return;
  const tick = async () => {
    try {
      const status = await fetchBrokerRun(activeBrokerRun.run_id);
      await syncBrokerRunStatus(status);
      const archiveDone = ['complete', 'incomplete', 'failed'].includes(String(status.archive_state));
      const aDone = ['complete', 'incomplete', 'failed'].includes(String(status.a_state));
      const cDone = !status.items || status.items.every((item) => ['confirmed', 'open', 'failed', 'skipped'].includes(item.review_state));
      if (archiveDone || (aDone && cDone && status.archive_state === 'not_requested')) {
        return;
      }
      brokerPollTimer = setTimeout(() => void tick(), intervalMs);
    } catch (error) {
      brokerPollTimer = setTimeout(() => void tick(), Math.max(intervalMs, 5000));
    }
  };
  brokerPollTimer = setTimeout(() => void tick(), intervalMs);
}

/**
 * 将当前 A/B/C 运行结果保存到扩展本机存储。
 *
 * Popup 关闭会销毁内存，快照使 CD 写回 Sheet 后可以重新打开 Popup 继续确认 C 或
 * 归档 ROI。快照不包含 Starling、飞书或 LLM 凭证，七天后失效；启动新运行时会删除。
 */
function sanitizeArchivePlanForSnapshot(plan) {
  if (!plan || plan.version !== 1 || !Array.isArray(plan.vendors)) return plan;
  return {
    version: plan.version,
    baseRunId: plan.baseRunId,
    startedAt: plan.startedAt,
    vendors: plan.vendors.map((entry) => ({
      vendor: entry.vendor,
      runId: entry.runId,
      status: entry.status,
      result: entry.result || null,
      lastError: entry.lastError || '',
    })),
  };
}

function workflowContextForSnapshot(context) {
  if (!context?.roiArchivePlan) return context;
  return {
    ...context,
    roiArchivePlan: sanitizeArchivePlanForSnapshot(context.roiArchivePlan),
  };
}

async function persistWorkflowSnapshot() {
  if (multilingualScopeRuns.length === 0) {
    await clearWorkflowSnapshot();
    return;
  }
  const config = await loadConfig();
  const workflowContext = workflowContextForSnapshot(activeWorkflowContext || {
    spreadsheetToken: config.spreadsheetToken || '',
    sheetId: config.sheetId || '',
    vendor: runVendor,
    projectIds: [...selectedProjectIds],
  });
  await chrome.storage.local.set({
    [ROI_WORKFLOW_SNAPSHOT_KEY]: {
      version: ROI_WORKFLOW_SNAPSHOT_VERSION,
      savedAt: Date.now(),
      extractedItems,
      multilingualScopeRuns,
      multilingualRoiSummary,
      activeDisplayScopeKey,
      finalValidationAttempted,
      userChoices,
      workflowContext,
    },
  });
}

/** 删除旧运行快照，避免新一轮 TM 操作混入历史 A/B/C 数据。 */
async function clearWorkflowSnapshot() {
  await chrome.storage.local.remove(ROI_WORKFLOW_SNAPSHOT_KEY);
}

/**
 * 在 Popup 再次打开时恢复最近未过期的 A/B/C 运行结果。
 *
 * 无效、过期或不完整快照直接删除并保持空状态，不能将不可验证的历史数据伪装为当前
 * 运行结果。
 */
async function restoreWorkflowSnapshot() {
  const stored = await chrome.storage.local.get(ROI_WORKFLOW_SNAPSHOT_KEY);
  const snapshot = stored?.[ROI_WORKFLOW_SNAPSHOT_KEY];
  const config = await loadConfig();
  const age = Date.now() - Number(snapshot?.savedAt);
  if (!snapshot
    || snapshot.version !== ROI_WORKFLOW_SNAPSHOT_VERSION
    || !Number.isFinite(age)
    || age < 0
    || age > ROI_WORKFLOW_SNAPSHOT_MAX_AGE_MS
    || !Array.isArray(snapshot.multilingualScopeRuns)
    || snapshot.multilingualScopeRuns.length === 0
    || !Array.isArray(snapshot.extractedItems)
    || !snapshot.workflowContext?.spreadsheetToken
    || Boolean(snapshot.workflowContext?.roiEnabled) !== roiEnabled
    || snapshot.workflowContext?.spreadsheetToken !== config.spreadsheetToken
    || snapshot.workflowContext?.sheetId !== (config.sheetId || '')) {
    if (snapshot) await clearWorkflowSnapshot();
    return;
  }

  extractedItems = snapshot.extractedItems;
  multilingualScopeRuns = snapshot.multilingualScopeRuns;
  multilingualRoiSummary = snapshot.multilingualRoiSummary || null;
  activeDisplayScopeKey = typeof snapshot.activeDisplayScopeKey === 'string'
    ? snapshot.activeDisplayScopeKey
    : '';
  finalValidationAttempted = snapshot.finalValidationAttempted === true;
  activeWorkflowContext = snapshot.workflowContext;
  userChoices = snapshot.userChoices && typeof snapshot.userChoices === 'object'
    ? snapshot.userChoices
    : {};
  processedItems = buildProcessedDisplayItems(multilingualScopeRuns);
  renderResults(processedItems);
  renderDestPreview(processedItems, config);
  setStep(4);
  switchTab('results');
}

/** 加载费率快照、已保存选择和当前凭证可访问项目。 */
async function initializeRunConfiguration() {
  const config = await loadConfig();
  roiEnabled = config.enableROI === true;
  uiLanguage = applyI18n(document, normalizeUiLanguage(config.uiLanguage));
  document.getElementById('ui-language').value = uiLanguage;
  // ROI 只保留一个开关，RWS/Pactera 均从同一份 TM 快照派生。
  runVendor = 'RWS';
  selectedProjectIds = Array.isArray(config.starlingProjectIds)
    ? config.starlingProjectIds.map(Number).filter(Number.isInteger)
    : [];
  selectedRoiLocales = Array.isArray(config.roiTargetLocales)
    ? config.roiTargetLocales
    : sharedLocalesFromLegacySelection(config.roiLocalesByProject, selectedProjectIds);
  if (roiEnabled) await loadRateCatalog();

  const hasCredentials = Boolean(config.starlingAccessKey && config.starlingSecretKey);
  document.getElementById('setup-required').classList.toggle('hidden', hasCredentials);
  if (!hasCredentials) {
    accessibleProjects = [];
    setWorkflowActionsDisabled(true);
    renderRunConfiguration();
    document.getElementById('run-config-details').open = true;
    return;
  }
  await loadAccessibleProjects();
}

/** ROI 开启后才加载本地费率目录，普通 TM 路径不承担计价初始化成本。 */
async function loadRateCatalog() {
  if (rateCatalog) return rateCatalog;
  try {
    const response = await fetch(chrome.runtime.getURL('data/local-rates.json'));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    rateCatalog = await response.json();
    return rateCatalog;
  } catch (error) {
    document.getElementById('run-pricing-status').textContent =
      `Pricing catalog unavailable: ${error.message}`;
    document.getElementById('run-pricing-status').className = 'run-status error';
    return null;
  }
}

/** 用当前完整 AK/SK 自动拉取账号可访问项目并清理失效选择。 */
async function loadAccessibleProjects() {
  const status = document.getElementById('run-project-status');
  const refresh = document.getElementById('refresh-projects');
  const config = await loadConfig();
  if (!config.starlingAccessKey || !config.starlingSecretKey) {
    document.getElementById('setup-required').classList.remove('hidden');
    document.getElementById('run-config-details').open = true;
    status.textContent = 'Configure AK/SK in Settings before loading projects.';
    status.className = 'run-status error';
    setWorkflowActionsDisabled(true);
    return;
  }
  refresh.disabled = true;
  status.textContent = 'Loading accessible projects…';
  status.className = 'run-status';
  try {
    const response = await listProjects({
      cliPath: config.starlingCliPath,
      accessKey: config.starlingAccessKey,
      secretKey: config.starlingSecretKey,
    });
    if (!response.ok || !Array.isArray(response.projects)) {
      throw new Error(response.error || 'Project query failed');
    }
    accessibleProjects = response.projects.map(normalizeProject).filter(Boolean);
    projectPageIndex = 0;
    const availableIds = new Set(accessibleProjects.map((project) => project.id));
    selectedProjectIds = selectedProjectIds.filter((id) => availableIds.has(id));
    reconcileRoiLocaleSelections();
    activeRunConfig = null;
    await chrome.storage.local.set({
      starlingProjectsCache: accessibleProjects,
      starlingProjectIds: [...selectedProjectIds],
      ...(Array.isArray(selectedRoiLocales) ? { roiTargetLocales: selectedRoiLocales } : {}),
    });
    status.textContent = accessibleProjects.length
      ? `${accessibleProjects.length} accessible project(s). Select 1–10.`
      : 'No accessible Starling projects.';
    status.className = accessibleProjects.length ? 'run-status ok' : 'run-status error';
    setWorkflowActionsDisabled(accessibleProjects.length === 0);
  } catch (error) {
    accessibleProjects = [];
    selectedProjectIds = [];
    projectPageIndex = 0;
    activeRunConfig = null;
    status.textContent = `Cannot load accessible projects: ${error.message}`;
    status.className = 'run-status error';
    document.getElementById('run-config-details').open = true;
    setWorkflowActionsDisabled(true);
  } finally {
    refresh.disabled = false;
    renderRunConfiguration();
  }
}

/** 返回当前用户选中的项目对象。 */
function selectedProjects() {
  return selectedProjectIds
    .map((id) => accessibleProjects.find((project) => project.id === id))
    .filter(Boolean);
}

/** 将旧版按项目保存的语言配置迁移为所有项目共同选择的语言集合。 */
function sharedLocalesFromLegacySelection(legacy, projectIds) {
  if (!legacy || typeof legacy !== 'object') return null;
  const selections = projectIds.map((projectId) => legacy[projectId]).filter(Array.isArray);
  if (!selections.length) return null;
  return selections.slice(1).reduce(
    (common, locales) => common.filter((locale) => locales.includes(locale)),
    [...new Set(selections[0])],
  ).sort((left, right) => left.localeCompare(right));
}

/** 返回全部所选项目共同支持且当前 vendor 有精确按字费率的目标语言。 */
function eligibleSharedTargetLocales() {
  const projects = selectedProjects();
  const commonLocales = targetLocaleIntersection(projects);
  return commonLocales.filter((targetLocale) => !/^en(?:-|$)/i.test(targetLocale));
}

/** 清理过期语言，并在首次进入或切换 vendor 时默认勾选全部共同可计费语言。 */
function reconcileRoiLocaleSelections({ resetToEligible = false } = {}) {
  if (!selectedProjectIds.length) return;
  const eligibleLocales = eligibleSharedTargetLocales();
  selectedRoiLocales = eligibleLocales;
}

/** 全选或清空所有项目共享的 ROI coverage languages，并保留用户选择。 */
async function setAllRoiLocales(selected) {
  selectedRoiLocales = selected ? eligibleSharedTargetLocales() : [];
  activeRunConfig = null;
  await persistRunConfiguration();
  renderRunConfiguration();
}

/** 切换项目选择并立即持久化，非法组合保持原选择。 */
async function selectProject(projectId) {
  const result = toggleProjectSelection({
    projects: accessibleProjects,
    selectedIds: selectedProjectIds,
    projectId,
  });
  const status = document.getElementById('run-project-status');
  if (!result.ok) {
    const messages = {
      max_projects: 'Select at most 10 projects.',
      source_locale_mismatch: 'Selected projects must use the same source locale.',
      no_common_target_locale: 'Selected projects must share at least one target locale.',
      invalid_project: 'This project is no longer available.',
    };
    status.textContent = messages[result.reason] || result.reason;
    status.className = 'run-status error';
    return;
  }
  selectedProjectIds = result.selectedIds;
  reconcileRoiLocaleSelections();
  activeRunConfig = null;
  await persistRunConfiguration();
  renderRunConfiguration();
}

/** 将 Popup 的 vendor、项目和语言覆盖范围作为单次运行配置即时保存。 */
async function persistRunConfiguration() {
  await chrome.storage.local.set({
    vendor: runVendor,
    enableROI: roiEnabled,
    starlingProjectIds: [...selectedProjectIds],
    starlingProjectId: selectedProjectIds[0] || '',
    roiTargetLocales: selectedRoiLocales || [],
  });
}

/** 渲染项目卡、共享语言覆盖、费率状态与折叠摘要。 */
function renderRunConfiguration() {
  document.getElementById('enable-roi').checked = roiEnabled;
  document.getElementById('roi-config').classList.add('hidden');
  document.getElementById('roi-language-details').classList.add('hidden');
  document.getElementById('btn-write-roi-archive').classList.toggle('hidden', !roiEnabled);
  document.getElementById('run-vendor').value = runVendor;
  const cards = document.getElementById('run-project-cards');
  cards.innerHTML = '';
  const projectPage = paginateProjects(
    accessibleProjects,
    projectPageIndex,
    PROJECTS_PER_PAGE,
  );
  projectPageIndex = projectPage.pageIndex;
  projectPage.items.forEach((project) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'run-project-card';
    button.classList.toggle('selected', selectedProjectIds.includes(project.id));
    button.disabled = selectedProjectIds.length >= 10 && !selectedProjectIds.includes(project.id);
    button.innerHTML = `<span class="run-project-name">${escapeHtml(project.name)}</span>`
      + `<span class="run-project-meta">ID ${project.id} · ${escapeHtml(project.sourceLocale)} · ${project.targetLocales.length} targets</span>`;
    button.addEventListener('click', () => selectProject(project.id));
    cards.appendChild(button);
  });
  const projectPagination = document.getElementById('run-project-pagination');
  projectPagination.classList.toggle('hidden', projectPage.pageCount === 0);
  document.getElementById('project-page-previous').disabled = !projectPage.hasPrevious;
  document.getElementById('project-page-next').disabled = !projectPage.hasNext;
  document.getElementById('project-page-status').textContent = t(
    'projectPageStatus',
    uiLanguage,
    {
      current: projectPage.pageNumber,
      total: projectPage.pageCount,
      count: projectPage.totalItems,
    },
  );
  document.getElementById('run-project-count').textContent = `${selectedProjectIds.length}/10`;

  if (roiEnabled) reconcileRoiLocaleSelections();

  const localeConfig = roiEnabled
    ? buildLocaleScopes({ projects: accessibleProjects, projectIds: selectedProjectIds, selectedLocales: selectedRoiLocales || [] })
    : buildFastTmScope({ projects: accessibleProjects, projectIds: selectedProjectIds });
  const ready = localeConfig.status === 'ready';
  document.getElementById('run-config-summary').textContent = ready
    ? roiEnabled
      ? `1. Projects · RWS + Pactera · ${localeConfig.sourceLocale} · ${localeConfig.scopes.length} non-English ROI scopes · ${selectedProjectIds.length} selected`
      : `1. Projects · ${localeConfig.sourceLocale} · ${selectedProjectIds.length} selected`
    : '1. Projects · setup required';
  syncWorkflowSteps();
}

/** 渲染一次选择、应用于全部项目的 ROI 覆盖语言，并立即持久化用户的勾选。 */
function renderLanguageCoverage() {
  const container = document.getElementById('roi-language-coverage');
  container.innerHTML = '';
  const eligibleLocales = eligibleSharedTargetLocales();
  const selectedLocales = new Set((selectedRoiLocales || [])
    .filter((locale) => eligibleLocales.includes(locale)));
  const visibleLocales = eligibleLocales.filter((locale) => locale.toLowerCase().includes(localeFilterQuery));
  const options = document.createElement('div');
  options.className = 'roi-language-options shared';
  if (!selectedProjectIds.length) {
    options.innerHTML = `<p class="roi-language-empty">${escapeHtml(t('selectProjectsFirst', uiLanguage))}</p>`;
  } else if (!eligibleLocales.length) {
    options.innerHTML = `<p class="roi-language-empty">${escapeHtml(runVendor || t('vendor', uiLanguage))} ${escapeHtml(t('noCommonPriced', uiLanguage))}</p>`;
  } else if (!visibleLocales.length) {
    options.innerHTML = `<p class="roi-language-empty">${escapeHtml(t('noLocaleMatches', uiLanguage))} “${escapeHtml(localeFilterQuery)}”.</p>`;
  }
  visibleLocales.forEach((locale) => {
    const label = document.createElement('label');
    label.className = 'roi-language-option';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedLocales.has(locale);
    checkbox.addEventListener('change', async () => {
      const selected = new Set(selectedRoiLocales || []);
      if (checkbox.checked) selected.add(locale);
      else selected.delete(locale);
      selectedRoiLocales = [...selected].sort((left, right) => left.localeCompare(right));
      activeRunConfig = null;
      await persistRunConfiguration();
      renderRunConfiguration();
    });
    label.append(checkbox, document.createTextNode(locale));
    options.appendChild(label);
  });
  container.appendChild(options);
  const scopeCount = buildLocaleScopes({ projects: accessibleProjects, projectIds: selectedProjectIds, selectedLocales: selectedRoiLocales || [] });
  const availableScopeCount = eligibleLocales.length;
  document.getElementById('roi-scope-count').textContent = scopeCount.status === 'ready'
    ? `${scopeCount.scopes.length} ${t('selectedScopes', uiLanguage)} / ${availableScopeCount} ${t('availableScopes', uiLanguage)}`
    : `0 ${t('selectedScopes', uiLanguage)} / ${availableScopeCount} ${t('availableScopes', uiLanguage)}`;
}

/** 禁用或启用所有会进入 TM 流程的来源按钮。 */
function setWorkflowActionsDisabled(disabled) {
  ['btn-read-sheet', 'btn-extract-all', 'btn-extract-sel'].forEach((id) => {
    document.getElementById(id).disabled = disabled;
  });
}

/** 根据所有已选 scope 的严格 local rate 结果展示整车计价覆盖状态。 */
function renderPricingStatus() {
  const status = document.getElementById('run-pricing-status');
  const scopeConfig = buildLocaleScopes({
    projects: accessibleProjects,
    projectIds: selectedProjectIds,
    selectedLocales: selectedRoiLocales || [],
  });
  if (!rateCatalog || !runVendor || scopeConfig.status !== 'ready') {
    if (rateCatalog) {
      status.textContent = 'Select vendor, project(s), and at least one ROI coverage language to check local rates.';
      status.className = 'run-status';
    }
    return;
  }
  const missing = scopeConfig.scopes.map((scope) => ({
    scope,
    rate: resolveWordRate(rateCatalog, {
      vendor: runVendor,
      sourceLang: scope.sourceLocale,
      targetLang: scope.targetLocale,
    }),
  })).filter(({ rate }) => rate.status !== 'ready');
  const complete = scopeConfig.scopes.length - missing.length;
  if (!missing.length) {
    status.textContent = `${runVendor} has exact word rates for all ${complete} selected ROI scope(s).`;
    status.className = 'run-status ok';
    return;
  }
  const missingLabels = missing.map(({ scope, rate }) => `${scope.projectName} ${scope.sourceLocale}→${scope.targetLocale} (${rate.reason})`);
  status.textContent = `${complete}/${scopeConfig.scopes.length} ROI scope(s) have exact word rates. Missing: ${missingLabels.join('; ')}. TM optimization can run; ROI subtotal excludes those scopes.`;
  status.className = 'run-status error';
}

/** 运行前验证凭证和快速 TM scope；ROI 开启时再追加 vendor 与多语言门禁。 */
async function ensureWorkflowReady() {
  const config = await loadConfig();
  const details = document.getElementById('run-config-details');
  if (!config.starlingAccessKey || !config.starlingSecretKey) {
    document.getElementById('setup-required').classList.remove('hidden');
    details.open = true;
    showStatus('Setup required: configure and verify Starling AK/SK in Settings.', 'error');
    return null;
  }
  const result = roiEnabled
    ? validateAutomaticRoiRunConfig({
      projects: accessibleProjects,
      projectIds: selectedProjectIds,
    })
    : buildFastTmScope({
      projects: accessibleProjects,
      projectIds: selectedProjectIds,
    });
  if (result.status !== 'ready') {
    const messages = {
      project_required: 'Select at least one project.',
      non_english_locale_required: 'ROI needs at least one shared non-English target language.',
      locale_scope_required: 'ROI needs at least one shared non-English target language.',
      no_common_target_locale: 'All selected projects must share at least one target language for ROI.',
      target_locale_unavailable: 'Selected projects do not support the same internal reference locale.',
      source_locale_mismatch: 'Selected projects must share one source locale.',
      project_unavailable: 'Refresh projects and reselect accessible projects.',
      max_projects: 'Select at most 10 projects.',
    };
    if (result.reason === 'project_required') {
      document.getElementById('run-project-status').textContent = messages.project_required;
      document.getElementById('run-project-status').className = 'run-status error';
    }
    details.open = true;
    showStatus(messages[result.reason] || `Run configuration incomplete: ${result.reason}`, 'error');
    return null;
  }
  activeRunConfig = {
    ...result,
    roiEnabled,
    vendors: roiEnabled ? [...ROI_VENDORS] : [],
    accessKey: config.starlingAccessKey,
    secretKey: config.starlingSecretKey,
  };
  return activeRunConfig;
}

/**
 * 初始化工作表选择。
 *
 * 自动模式优先使用当前标签页的 Sheet/wiki 表；手动模式保留用户明确选择的表。
 */
async function initializeWorkingSheet() {
  const config = await loadConfig();
  const detection = await detectCurrentWorkingSheet();
  if (config.workingSheetMode !== 'manual') {
    if (detection.type === 'sheet') {
      try {
        const resolved = await resolveSpreadsheetReference(detection.url, config);
        await saveWorkingSheet(detection.url, resolved, 'auto');
      } catch (error) {
        showStatus(`Cannot use the current spreadsheet: ${error.message}`, 'error');
      }
    }
  }
  await loadDestIntoInput();
  await renderWorkingSheetGuidance(detection);
  await refreshWorkingSheetContext();
}

/**
 * 读取当前标签页并判断它是否为可写的飞书 Spreadsheet 或 wiki 挂载表。
 *
 * @returns {Promise<{type: 'sheet'|'bitable'|'other', url: string, parsed?: object}>} 检测结果。
 */
async function detectCurrentWorkingSheet() {
  const tabs = await new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, resolve);
  });
  const url = tabs?.[0]?.url || '';
  const parsed = parseFeishuUrl(url);
  if (parsed?.type === 'sheet') {
    return { type: 'sheet', url, parsed };
  }
  if (parsed?.type === 'bitable') return { type: 'bitable', url, parsed };
  return { type: 'other', url };
}

/**
 * 保存单一工作表配置。
 *
 * @param {string} raw 表格链接。
 * @param {{spreadsheetToken: string, sheetId?: string}} parsed 已解析表格标识。
 * @param {'auto'|'manual'} mode 选择来源。
 */
async function saveWorkingSheet(raw, parsed, mode) {
  const previous = await loadConfig();
  const preservedSheetId = previous.spreadsheetToken === parsed.spreadsheetToken
    ? previous.sheetId
    : '';
  await new Promise((resolve) => {
    chrome.storage.local.set({
      sheetsUrl: raw,
      spreadsheetToken: parsed.spreadsheetToken,
      sheetId: parsed.sheetId || preservedSheetId || '',
      workingSheetMode: mode,
    }, resolve);
  });
}

/** 向列选择器填充 A-AZ，覆盖检测范围并为输出区域预留足够空间。 */
function populateSheetColumnSelectors() {
  ['sheet-source-column', 'sheet-output-start-column'].forEach((id) => {
    const select = document.getElementById(id);
    if (select.options.length) return;
    for (let index = 1; index <= 52; index += 1) {
      let remaining = index;
      let column = '';
      while (remaining > 0) {
        column = String.fromCharCode(65 + ((remaining - 1) % 26)) + column;
        remaining = Math.floor((remaining - 1) / 26);
      }
      select.append(new Option(column, column));
    }
  });
}

/** 将当前 Spreadsheet 的 Sheet 列表、检测结果与已保存布局载入 Side Panel。 */
async function refreshWorkingSheetContext() {
  populateSheetColumnSelectors();
  const container = document.getElementById('sheet-context-config');
  let config = await loadConfig();
  if (!config.spreadsheetToken) {
    container.classList.add('hidden');
    activeSheetLayout = null;
    activeSheetInspectionRows = [];
    return;
  }
  try {
    workingSheets = await listSpreadsheetSheets(config);
    if (!workingSheets.length) throw new Error('This spreadsheet has no visible sheets.');
    const selectedSheet = workingSheets.find((sheet) => sheet.sheetId === config.sheetId) || workingSheets[0];
    if (selectedSheet.sheetId !== config.sheetId) {
      await chrome.storage.local.set({ sheetId: selectedSheet.sheetId });
      config = await loadConfig();
    }
    const select = document.getElementById('working-sheet-select');
    select.innerHTML = '';
    workingSheets.forEach((sheet) => select.append(new Option(sheet.title, sheet.sheetId)));
    select.value = selectedSheet.sheetId;

    const inspection = await inspectSheetLayout({ ...config, sheetId: selectedSheet.sheetId });
    activeSheetInspectionRows = inspection.rows || [];
    if (config.sheetLayout?.confirmed === true) {
      activeSheetLayout = config.sheetLayout;
    } else if (inspection.status === 'ready') {
      activeSheetLayout = inspection.layout;
      await persistSheetLayout(config.spreadsheetToken, selectedSheet.sheetId, activeSheetLayout);
    } else {
      activeSheetLayout = inspection.layout;
    }
    container.classList.remove('hidden');
    renderSheetLayoutControls(config.spreadsheetToken, selectedSheet);
  } catch (error) {
    container.classList.remove('hidden');
    activeSheetLayout = null;
    activeSheetInspectionRows = [];
    const status = document.getElementById('sheet-layout-status');
    status.textContent = `Cannot load spreadsheet sheets or layout: ${error.message}`;
    status.className = 'run-status error';
    document.getElementById('working-sheet-details').open = true;
  }
}

/** 将已确认布局写入按 Spreadsheet 与 Sheet 隔离的 storage map。 */
async function persistSheetLayout(spreadsheetToken, sheetId, layout) {
  const stored = await chrome.storage.local.get('sheetLayouts');
  const sheetLayouts = stored.sheetLayouts && typeof stored.sheetLayouts === 'object'
    ? { ...stored.sheetLayouts }
    : {};
  sheetLayouts[sheetLayoutStorageKey(spreadsheetToken, sheetId)] = { ...layout };
  await chrome.storage.local.set({ sheetLayouts });
}

/** 渲染当前 Sheet 的列、范围与真实 source 预览。 */
function renderSheetLayoutControls(spreadsheetToken, selectedSheet) {
  const sourceSelect = document.getElementById('sheet-source-column');
  const startInput = document.getElementById('sheet-data-start-row');
  const outputSelect = document.getElementById('sheet-output-start-column');
  const status = document.getElementById('sheet-layout-status');
  const confirmButton = document.getElementById('btn-confirm-sheet-layout');
  const preview = document.getElementById('sheet-source-preview');
  const summary = document.getElementById('sheet-range-summary');
  if (!activeSheetLayout) {
    status.textContent = 'No source layout could be detected. Choose the source and output columns.';
    status.className = 'run-status error';
    confirmButton.disabled = false;
    return;
  }
  sourceSelect.value = activeSheetLayout.sourceColumn;
  startInput.value = activeSheetLayout.dataStartRow;
  outputSelect.value = activeSheetLayout.outputStartColumn;
  const validation = validateSheetLayout(activeSheetLayout);
  const ready = validation.status === 'ready';
  const confirmed = ready && activeSheetLayout.confirmed === true;
  status.textContent = confirmed
    ? 'Layout confirmed for this sheet.'
    : (ready ? 'Review the detected layout and confirm it before running.' : `Layout needs attention: ${validation.reason}`);
  status.className = confirmed ? 'run-status ok' : 'run-status error';
  confirmButton.disabled = confirmed || !ready;
  confirmButton.textContent = confirmed ? 'Layout confirmed' : 'Confirm this layout';
  preview.innerHTML = '';
  buildSourcePreview(activeSheetInspectionRows, activeSheetLayout, 5).forEach((item) => {
    const row = document.createElement('li');
    row.value = item.row;
    row.textContent = item.text;
    preview.appendChild(row);
  });
  if (!preview.children.length) {
    const row = document.createElement('li');
    row.textContent = 'No non-empty source cells found in the preview range.';
    preview.appendChild(row);
  }
  if (ready) {
    const layout = validation.layout;
    const output = getOutputColumns(layout.outputStartColumn);
    summary.innerHTML = `<span>Spreadsheet: ${escapeHtml(spreadsheetToken.slice(0, 12))}…</span>`
      + `<span>Sheet: ${escapeHtml(selectedSheet.title)} (${escapeHtml(selectedSheet.sheetId)})</span>`
      + `<span>Read: ${escapeHtml(layout.sourceColumn)}${layout.dataStartRow}:${escapeHtml(layout.sourceColumn)}</span>`
      + `<span>Write: ${escapeHtml(layout.outputStartColumn)}${layout.headerRow}:${escapeHtml(output.cdReview)}</span>`;
  } else {
    summary.textContent = `Cannot build ranges: ${validation.reason}`;
  }
  const mainSummary = document.getElementById('working-sheet-summary');
  mainSummary.textContent = confirmed
    ? `2. Spreadsheet · ✓ ${selectedSheet.title} ready`
    : `2. Spreadsheet · ${selectedSheet.title} layout confirmation required`;
  document.getElementById('working-sheet-details').open = !confirmed;
  syncWorkflowSteps();
}

/** 切换同一 Spreadsheet 内的 Sheet，并载入该 Sheet 自己的布局。 */
async function changeWorkingSheet(event) {
  const sheetId = event.target.value;
  await chrome.storage.local.set({ sheetId });
  activeSheetLayout = null;
  activeSheetInspectionRows = [];
  await refreshWorkingSheetContext();
  runHealthCheck();
}

/** 用户调整任一布局字段后立即刷新预览，并将状态退回待确认。 */
function updateActiveSheetLayoutFromControls() {
  activeSheetLayout = {
    sourceColumn: document.getElementById('sheet-source-column').value,
    dataStartRow: Number(document.getElementById('sheet-data-start-row').value),
    outputStartColumn: document.getElementById('sheet-output-start-column').value,
    confirmed: false,
    detection: 'manual',
  };
  const selectedSheet = workingSheets.find(
    (sheet) => sheet.sheetId === document.getElementById('working-sheet-select').value,
  );
  loadConfig().then((config) => renderSheetLayoutControls(config.spreadsheetToken, selectedSheet));
}

/** 校验并保存当前 Sheet 的布局；冲突布局保持未确认并展示真实原因。 */
async function confirmActiveSheetLayout() {
  updateActiveSheetLayoutFromControls();
  const validation = validateSheetLayout(activeSheetLayout);
  if (validation.status !== 'ready') {
    document.getElementById('sheet-layout-status').textContent = `Cannot confirm layout: ${validation.reason}`;
    return;
  }
  const config = await loadConfig();
  activeSheetLayout = { ...validation.layout, confirmed: true, detection: 'manual' };
  await persistSheetLayout(config.spreadsheetToken, config.sheetId, activeSheetLayout);
  const selectedSheet = workingSheets.find((sheet) => sheet.sheetId === config.sheetId);
  renderSheetLayoutControls(config.spreadsheetToken, selectedSheet);
  showStatus('✓ Sheet layout confirmed. Reads and writes will use the displayed ranges.', 'info');
  runHealthCheck();
}

/**
 * 根据自动检测、手动 override 与已保存配置渲染工作表操作提示。
 *
 * @param {{type: string, url: string}} detection 当前标签页检测结果。
 */
async function renderWorkingSheetGuidance(detection) {
  const help = document.getElementById('working-sheet-help');
  const override = document.getElementById('working-sheet-override');
  const useCurrentButton = document.getElementById('btn-use-current-sheet');
  const details = document.getElementById('working-sheet-details');
  const summary = document.getElementById('working-sheet-summary');
  const config = await loadConfig();
  const configured = parseFeishuUrl(config.sheetsUrl || config.spreadsheetToken || '');
  const shortSheet = config.sheetId
    || configured?.sheetId
    || configured?.spreadsheetToken?.slice(0, 8)
    || 'first';

  useCurrentButton.classList.toggle('hidden', detection.type !== 'sheet' || config.workingSheetMode !== 'manual');
  if (config.workingSheetMode === 'manual' && configured?.type === 'sheet') {
    help.textContent = 'Using your selected spreadsheet. Select a Sheet and confirm its source and output ranges below.';
    summary.textContent = `2. Spreadsheet · ✓ Sheet ${shortSheet} ready`;
    details.open = false;
    return;
  }
  if (detection.type === 'sheet') {
    help.textContent = 'Using the current Feishu spreadsheet automatically. Select a Sheet and confirm its source and output ranges below.';
    override.open = false;
    summary.textContent = `2. Spreadsheet · ✓ Sheet ${shortSheet} ready`;
    details.open = false;
    return;
  }
  if (detection.type === 'bitable') {
    help.textContent = 'The current page is a Bitable. This workflow needs a Spreadsheet or wiki-backed sheet, so choose one below.';
    override.open = true;
    summary.textContent = '2. Spreadsheet · Spreadsheet required';
    details.open = true;
    return;
  }
  if (configured?.type === 'sheet' || config.spreadsheetToken) {
    help.textContent = 'The current page is not a spreadsheet. Using the saved working spreadsheet; open a Spreadsheet page to switch automatically.';
    summary.textContent = `2. Spreadsheet · ✓ Sheet ${shortSheet} ready`;
    details.open = false;
    return;
  }
  help.textContent = 'No spreadsheet detected on this page. Choose a Spreadsheet below, then confirm its Sheet and ranges.';
  override.open = true;
  summary.textContent = '2. Spreadsheet · setup required';
  details.open = true;
}

/**
 * 清除手动 override，并立即将当前 Spreadsheet 页面设为自动工作表。
 */
async function useCurrentPageAsWorkingSheet() {
  const detection = await detectCurrentWorkingSheet();
  if (detection.type !== 'sheet') {
    showStatus('Open a Feishu Spreadsheet or wiki-backed sheet page before using automatic detection.', 'error');
    return;
  }
  const config = await loadConfig();
  const resolved = await resolveSpreadsheetReference(detection.url, config);
  await saveWorkingSheet(detection.url, resolved, 'auto');
  await loadDestIntoInput();
  await renderWorkingSheetGuidance(detection);
  await refreshWorkingSheetContext();
  showStatus('✓ Current page selected as the working spreadsheet.', 'info');
  runHealthCheck();
}

// BX3：把已保存的工作表回填到手动 override 输入框并渲染摘要。
async function loadDestIntoInput() {
  const cfg = await loadConfig();
  const url = cfg.sheetsUrl || cfg.spreadsheetToken || '';
  const input = document.getElementById('dest-url');
  if (url) input.value = url;
  renderDestSummary(cfg);
}

// BX3：保存用户明确选择的手动工作表 override。
async function confirmDestination() {
  const input = document.getElementById('dest-url');
  const raw = (input.value || '').trim();
  const summaryEl = document.getElementById('dest-summary');
  if (!raw) {
    summaryEl.classList.remove('hidden');
    summaryEl.className = 'dest-summary dest-missing';
    summaryEl.textContent = 'Paste a Feishu Spreadsheet link, or open the source spreadsheet page and use automatic detection.';
    updateWriteButtonsEnabled(false);
    return;
  }
  let parsed;
  try {
    const config = await loadConfig();
    parsed = await resolveSpreadsheetReference(raw, config);
  } catch (error) {
    summaryEl.classList.remove('hidden');
    summaryEl.className = 'dest-summary dest-missing';
    summaryEl.textContent = error.message;
    updateWriteButtonsEnabled(false);
    return;
  }
  await saveWorkingSheet(raw, parsed, 'manual');
  const cfg = await loadConfig();
  renderDestSummary(cfg);
  await renderWorkingSheetGuidance({ type: 'other', url: '' });
  await refreshWorkingSheetContext();
  showStatus(`✓ Using the selected spreadsheet: token=${cfg.spreadsheetToken ? cfg.spreadsheetToken.slice(0,12)+'…' : '(empty)'}.`, 'info');
  // 工作表变更后重跑 health check，避免状态显示过时。
  runHealthCheck();
  // BX5：目标变更后同步写回按钮（有结果且目标可写才启用）
  updateWriteButtonsEnabled(processedItems.length > 0 && destWritable(parsed));
}

// BX3：判断目标是否可写回。当前仅电子表格(Sheet)支持写回；Bitable 暂不支持。
function destWritable(parsed) {
  return parsed?.type === 'sheet';
}

// BX3：渲染目标摘要——类型 / 名称(token) / 链接。Bitable 明确标注暂不支持写回。
function renderDestSummary(config) {
  const summaryEl = document.getElementById('dest-summary');
  const raw = config.sheetsUrl || config.spreadsheetToken || '';
  const parsed = parseFeishuUrl(raw);
  if (!raw || !parsed) {
    summaryEl.classList.remove('hidden');
    summaryEl.className = 'dest-summary dest-missing';
    summaryEl.innerHTML = '<span>Open the source Spreadsheet page for automatic detection, or choose a different spreadsheet below.</span>';
    document.getElementById('working-sheet-details').open = true;
    return;
  }
  const token = config.spreadsheetToken || parsed.spreadsheetToken || parsed.appToken || '';
  const selectedSheetId = config.sheetId || parsed.sheetId || '';
  const sheetInfo = selectedSheetId ? ` · Sheet ${selectedSheetId}` : '';
  if (parsed.type === 'bitable') {
    // BX3b：Bitable 暂不支持写回——明确标注，避免用户点写回后失败。
    summaryEl.classList.remove('hidden');
    summaryEl.className = 'dest-summary dest-missing';
    summaryEl.innerHTML =
      `<strong>Bitable${sheetInfo} · write-back not supported</strong>` +
      `<span class="dest-link">Working sheet: ${escapeHtml(raw)}</span>` +
      `<span class="dest-link">Only Spreadsheet (Sheet) is supported. Please use a /sheets/ link.</span>`;
    document.getElementById('working-sheet-details').open = true;
    return;
  }
  summaryEl.classList.remove('hidden');
  summaryEl.className = 'dest-summary';
  summaryEl.innerHTML =
    `<strong>Working spreadsheet${sheetInfo} ready</strong>` +
    `<span class="dest-link">Source and output ranges are configured per Sheet below: ${escapeHtml(raw)}</span>` +
    `<span class="dest-link">Token: ${escapeHtml(token)}</span>`;
}


/**
 * 从当前电子表格的已确认 source 列读取原文（表格驱动入口）。
 * 用 Sheets API 直接读单元格，零 DOM 噪声——原文在单元格里时这是正确路径。
 * 读到后走 processItems（Top-3 TM → AI 候选 → Post-TM → Focus 审阅）。
 */
async function readFromSheet() {
  if (!await ensureWorkflowReady()) return;
  await resetState();
  setStep(3);
  // 表格读路径不依赖页面 DOM 标题，明确告诉用户数据来源，避免「未检测到飞书文档」误导
  setDocTitle('Data source: configured Spreadsheet source column (independent of current page DOM)');
  showProgress('Reading source from the configured spreadsheet range...', 10);
  try {
    let config = await loadConfig();
    // 兜底：用户正在手动 override 时，允许直接用输入框里的 URL 解析。
    if (!config.spreadsheetToken) {
      const inputUrl = (document.getElementById('dest-url').value || '').trim();
      const parsed = await resolveSpreadsheetReference(inputUrl, config).catch(() => null);
      if (parsed?.spreadsheetToken) {
        config.spreadsheetToken = parsed.spreadsheetToken;
        config.sheetId = config.sheetId || parsed.sheetId || '';
        // 顺手存进 storage，后续写回也用得上
        await new Promise((r) => {
          chrome.storage.local.set({
            sheetsUrl: inputUrl,
            spreadsheetToken: parsed.spreadsheetToken,
            sheetId: parsed.sheetId || '',
          }, r);
        });
        showStatus('Auto-parsed the spreadsheet link and saved it. Detecting its Sheet layout...', 'info');
        await refreshWorkingSheetContext();
        config = await loadConfig();
      } else {
        throw new Error(
          `No working sheet configured. Open the source Spreadsheet page to detect it automatically, or choose a different spreadsheet in Step 2.` +
          ` (diag: storage has no token, input box parse also failed. Stored keys: ${Object.keys(config).filter(k=>config[k]).join(',') || 'none'})`
        );
      }
    }
    if (!config.sheetId || config.sheetLayout?.confirmed !== true) {
      document.getElementById('working-sheet-details').open = true;
      throw new Error('Confirm the Sheet, source column, data start row, and output start column before reading.');
    }
    const segments = await listSourceSegments(config);
    if (segments.length === 0) {
      throw new Error(
        'No source text was found in the displayed read range. Check the selected Sheet, source column, and data start row.'
      );
    }
    // listSourceSegments 返回 { source_text, row }；转成 processItems 期望的 item 结构
    const items = segments.map((s, i) => ({
      id: `sheet-${i}`,
      source_text: s.source_text,
      row: s.row,
      context: `Spreadsheet ${config.sheetLayout.sourceColumn} column`,
      location: `Row ${s.row}`,
      char_count: s.source_text.length,
    }));
    extractedItems = items;
    showStatus(`Read ${items.length} source segment(s) from sheet, starting TM query...`, 'info');
    await processItems(items);
  } catch (e) {
    showError(e);
    hideProgress();
  }
}

async function triggerExtract(action) {
  if (!await ensureWorkflowReady()) return;
  await resetState();
  setStep(3);
  showProgress('Extracting text...', 10);
  try {
    // 抓取加 15 秒超时：巨型 DOM 上若 content.js 卡死，避免 popup 永久挂起。
    const response = await Promise.race([
      chrome.runtime.sendMessage({ action }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Extraction timeout: page DOM too large or unresponsive. Try "Extract selection", select part of the content first, then query.')), 15000)
      ),
    ]);
    if (chrome.runtime.lastError) throw new Error(chrome.runtime.lastError.message);
    if (response?.error) throw new Error(response.error);

    // 诊断信息（无需用户开 DevTools）：直接显示在弹窗，定位「抓不到正文」根因
    if (response?.diag) {
      console.log('[content diag]', response.diag);
      showStatus('Extraction diag: ' + response.diag.slice(0, 1200), 'info');
    }

    const items = response?.items || [];
    if (items.length === 0) {
      showStatus('No text extracted. Please check the page content or selection.', 'error');
      hideProgress();
      return;
    }
    extractedItems = items;
    setDocTitle(response.docTitle);
    await processItems(items);
  } catch (e) {
    showError(e);
    hideProgress();
  }
}

/** 返回 scope 的全部项目 ID，并为旧版单项目快照保留唯一兼容入口。 */
function projectIdsForScope(scope) {
  if (Array.isArray(scope?.projectIds) && scope.projectIds.length) return scope.projectIds;
  if (scope?.projectId !== undefined && scope?.projectId !== null) return [scope.projectId];
  throw new Error('Scope has no project IDs.');
}

/**
 * 从已完成的 A/B/C TM 快照派生 RWS 与 Pactera 金额。
 *
 * 此函数只做本地费率计算，绝不触发新的 Starling 请求；RWS 结果继续作为既有
 * Summary/UI 的兼容视图，两个 vendor 的完整结果用于归档。
 */
function refreshVendorRoiResults() {
  if (!roiEnabled || !rateCatalog) {
    vendorRoiResults = {};
    multilingualRoiSummary = null;
    return;
  }
  vendorRoiResults = deriveVendorRoiResults(multilingualScopeRuns, rateCatalog, ROI_VENDORS);
  // RWS 覆盖不到的语言（例如全亚洲语言运行）时退回第一个真正有可计费 scope 的 vendor，
  // 避免 Summary 因为 vendor 语言覆盖互斥而变成空视图。
  multilingualRoiSummary = archivableRoiVendors()
    .map((vendor) => vendorRoiResults[vendor]?.summary)
    .find(Boolean) || null;
}

/** 返回本次运行中真正拥有可计费语言 scope 的 vendor，顺序固定为 ROI_VENDORS。 */
function archivableRoiVendors() {
  const vendors = ROI_VENDORS.filter(
    (vendor) => (vendorRoiResults[vendor]?.scopeRuns?.length || 0) > 0,
  );
  // RWS 继续优先，保持既有 Summary/UI 与 Items 归属的兼容行为。
  return vendors;
}

// ===== 处理流程：每个共享语言的多项目 scope 执行 A TM → AI 候选 B → B TM =====

async function processItems(items) {
  const config = await loadConfig();
  const runConfig = activeRunConfig || await ensureWorkflowReady();
  if (!runConfig) throw new Error('run_configuration_incomplete');
  setStep(3);
  const tmOpts = {
    cliPath: config.starlingCliPath,
    tmMode: config.starlingTmMode === 'legacy_cli' ? 'legacy' : 'batch',
    usePpe: config.starlingTmMode !== 'legacy_cli',
    accessKey: runConfig.accessKey,
    secretKey: runConfig.secretKey,
  };
  let sharedRewriteDecisions = null;
  const resolveRateForScope = (scope) => {
    if (!roiEnabled) return null;
    return resolveWordRate(rateCatalog, {
      vendor: runVendor,
      sourceLang: scope.sourceLocale,
      targetLang: scope.targetLocale,
    });
  };
  const scopePartition = partitionPriorityScope(runConfig.scopes, activeDisplayScopeKey);
  const scopeRuns = await runLocaleScopes({
    scopes: scopePartition.priority,
    items,
    onProgress: (scope, scopeIndex, total) => showProgress(
      `Querying ${scope.projectName} · ${scope.targetLocale} (${scopeIndex + 1}/${total})...`,
      25 + Math.round((scopeIndex / total) * 65),
    ),
    queryOriginalTm: (texts, scope) => searchTM(texts, scope.sourceLocale, scope.targetLocale, {
      ...tmOpts, projectIds: projectIdsForScope(scope),
    }),
    rewriteItems: async (scopeItems) => {
      if (!sharedRewriteDecisions) {
        sharedRewriteDecisions = config.enableAI === true
          ? await rewriteSourceWithAI(scopeItems, {
            ...config,
            onAiProgress: ({ item, provider, finished, total, active, pollCount, phase }) => showProgress(
              provider === 'inspire'
                ? `Inspire Writer ${finished}/${total} finished · ${active} active · ${pollCount} poll(s)${phase === 'failed' ? ' · error recorded' : ''}…`
                : `AI rewriting ${item.location || item.id || 'source'}…`,
              55,
            ),
            onAiBatchComplete: ({ taskCount, taskAttemptCount, requestCount, pollCount }) => {
              console.info('[Inspire Pilot usage]', {
                taskCount, taskAttemptCount, requestCount, pollCount,
              });
              showStatus(
                `Inspire completed ${taskCount}/${taskAttemptCount} task(s) with ${requestCount} HTTP request(s) and ${pollCount} status poll(s).`,
                'info',
              );
            },
          }, TM_MATCH_THRESHOLD)
          : scopeItems.map((item) => ({ ...item, reached_threshold: (item.similarity || 0) >= TM_MATCH_THRESHOLD,
            ai_translation: '', reasoning: 'AI disabled (enableAI=off in settings).', reuse_tm: false }));
      }
      return scopeItems.map((item, index) => ({
        ...item,
        reached_threshold: sharedRewriteDecisions[index]?.reached_threshold,
        ai_translation: sharedRewriteDecisions[index]?.ai_translation || '',
        reasoning: sharedRewriteDecisions[index]?.reasoning || '',
        reuse_tm: sharedRewriteDecisions[index]?.reuse_tm === true,
        ai_candidates: sharedRewriteDecisions[index]?.ai_candidates,
        rewrite_eligible: sharedRewriteDecisions[index]?.rewrite_eligible === true,
        ai_task_id: sharedRewriteDecisions[index]?.ai_task_id,
        ai_agent_id: sharedRewriteDecisions[index]?.ai_agent_id,
        ai_agent_name: sharedRewriteDecisions[index]?.ai_agent_name,
        ai_agent_mode: sharedRewriteDecisions[index]?.ai_agent_mode,
        ai_agent_version_policy: sharedRewriteDecisions[index]?.ai_agent_version_policy,
        ai_agent_version: sharedRewriteDecisions[index]?.ai_agent_version,
        ai_duration_ms: sharedRewriteDecisions[index]?.ai_duration_ms,
        ai_http_request_count: sharedRewriteDecisions[index]?.ai_http_request_count,
        ai_poll_count: sharedRewriteDecisions[index]?.ai_poll_count,
      }));
    },
    queryPostRewriteTm: async (scopeItems, scope) => {
      const nestedSnapshots = await queryRewriteCandidateTmSnapshots(
        scopeItems,
        scope.sourceLocale,
        scope.targetLocale,
        { ...tmOpts, projectIds: projectIdsForScope(scope) },
      );
      return scopeItems.map((item, index) => {
        if (!Array.isArray(item.ai_candidates) || item.ai_candidates.length === 0) {
          return { status: 'not_required' };
        }
        const evaluated = evaluateRewriteCandidates(item, nestedSnapshots[index]);
        item.ai_candidates = evaluated.candidates;
        item.ai_translation = evaluated.displayText;
        item.ai_quality = evaluated;
        return evaluated.representativePostTm;
      });
    },
    resolveRate: resolveRateForScope,
    calculateRoi: (item, rate) => roiEnabled
      ? calculateRoiForItem(item, rate)
      : { status: 'not_requested', reason: 'roi_disabled' },
    // E 列展示真实的 B TM score，不能用本地文本相似度冒充 Starling score。
    decorateItem: (item) => {
      item.new_match = item.post_rewrite_tm?.status === 'complete'
        ? item.post_rewrite_tm.score
        : (item.reached_threshold ? item.similarity : 0);
    },
  });

  // B 只用于辅助人工生成最终 C，不能在 UI 或归档中作为正式 ROI。
  multilingualRoiSummary = null;
  multilingualScopeRuns = scopeRuns;
  finalValidationAttempted = false;
  activeDisplayScopeKey = scopeRuns[0]?.scope.key || '';
  activeWorkflowContext = {
    spreadsheetToken: config.spreadsheetToken || '',
    sheetId: config.sheetId || '',
    sheetLayout: config.sheetLayout || activeSheetLayout || null,
    vendors: roiEnabled ? [...ROI_VENDORS] : [],
    roiEnabled,
    projectIds: [...selectedProjectIds],
    roiScopes: runConfig.scopes.map((scope) => ({
      ...scope,
      projectIds: Array.isArray(scope.projectIds) ? [...scope.projectIds] : undefined,
      projectNames: Array.isArray(scope.projectNames) ? [...scope.projectNames] : undefined,
    })),
  };
  processedItems = buildProcessedDisplayItems(scopeRuns);

  if (brokerAsyncRoi && roiEnabled && runConfig.scopes.length > 0) {
    brokerRunCreateError = null;
    try {
      const displayScope = runConfig.scopes.find((scope) => scope.key === activeDisplayScopeKey) || runConfig.scopes[0];
      const sourceRange = activeWorkflowContext.sheetLayout
        ? `${activeWorkflowContext.sheetLayout.sourceColumn}${Math.min(...items.map((entry) => Number(entry.row) || 0))}:${activeWorkflowContext.sheetLayout.sourceColumn}${Math.max(...items.map((entry) => Number(entry.row) || 0))}`
        : '';
      const brokerItems = await Promise.all(items.map(async (entry) => {
        const sourceText = entry.source_text || entry.text || '';
        return {
          item_id: String(entry.id || `row-${entry.row}`),
          source_key: String(entry.source_key || entry.id || `row-${entry.row}`),
          sheet_row: Number(entry.row) || 0,
          source_text: sourceText,
          source_hash: entry.source_hash || await sha256Text(canonicalizeText(sourceText)),
        };
      }));
      const brokerPayload = await buildBrokerRunPayload({
        clientRunId: `popup-${Date.now()}`,
        startedAt: new Date().toISOString(),
        sourceLocale: displayScope?.sourceLocale || 'en',
        targetLocale: displayScope?.targetLocale || runConfig.scopes[0]?.targetLocale || '',
        projectIds: displayScope?.projectIds || selectedProjectIds,
        projects: (displayScope?.projectNames || []).map((name, index) => ({
          project_id: String((displayScope?.projectIds || selectedProjectIds)[index] || selectedProjectIds[0] || ''),
          name,
        })),
        sheet: activeWorkflowContext.spreadsheetToken && activeWorkflowContext.sheetId
          ? { document_token: activeWorkflowContext.spreadsheetToken, sheet_id: activeWorkflowContext.sheetId, source_range: sourceRange }
          : null,
        items: brokerItems,
      });
      const createdRun = await createBrokerRun(brokerPayload);
      brokerRunCreateError = null;
      activeBrokerRun = {
        run_id: createdRun.run_id,
        revision: createdRun.revision || 1,
        a_state: createdRun.a_state || 'queued',
        review_state: createdRun.review_state || 'open',
        c_state: createdRun.c_state || 'idle',
        archive_state: createdRun.archive_state || 'not_requested',
      };
      await syncBrokerRunStatus(activeBrokerRun);
      void pollActiveBrokerRun();
      showStatus('Async ROI run created. Worker is processing TM scores in the background.', 'info');
    } catch (error) {
      // A4：Broker 开启且 createBrokerRun 失败时，必须显式记录错误并阻止后续本地
      // archive fallback。Broker 是权威路径，不能在 create 失败后静默清空 activeBrokerRun
      // 再继续走本地 ROI 归档，否则 archive 时会因为 activeBrokerRun 为 null 而绕过 broker
      // 分支直接 writeRoiArchive 到本地 Bitable。
      console.warn('Broker ROI run creation failed; broker-authoritative workflow is unavailable for this run.', error);
      brokerRunCreateError = error instanceof Error ? error : new Error(String(error || 'createBrokerRun failed'));
      activeBrokerRun = null;
      showError(brokerRunCreateError);
      showStatus(
        `Broker failed to create the async ROI run: ${brokerRunCreateError.message}. `
        + 'Archive is blocked; retry the run or set l10nLegacyLocalSecretDevOnly=true (dev only) to fall back.',
        'error',
      );
    }
  }

  hideProgress();
  setStep(4);
  renderResults(processedItems);
  renderDestPreview(processedItems, config);
  await persistWorkflowSnapshot();
  switchTab('results');
}

/** 将当前展示 scope 的 A/B/C TM 快照与全部语言 scope 审计信息合成为结果卡片数据。 */
function buildProcessedDisplayItems(scopeRuns) {
  const displayRun = scopeRuns.find((run) => run.scope.key === activeDisplayScopeKey) || scopeRuns[0];
  activeDisplayScopeKey = displayRun?.scope.key || '';
  return (displayRun?.items || []).map((item, itemIndex) => {
    const scopeResults = Object.fromEntries(scopeRuns.map(({ scope, items: scopeItems }) => [
      scope.key,
      { scope, rate: scopeRuns.find((run) => run.scope.key === scope.key)?.rate,
        originalTm: { score: scopeItems[itemIndex]?.similarity, tmMatch: scopeItems[itemIndex]?.tm_match,
          tmSource: scopeItems[itemIndex]?.tm_source, origin: scopeItems[itemIndex]?.origin,
          matchCategory: scopeItems[itemIndex]?.match_category },
        postRewriteTm: scopeItems[itemIndex]?.post_rewrite_tm,
        finalTm: scopeItems[itemIndex]?.final_tm,
        rewrittenSegment: scopeItems[itemIndex]?.ai_translation, roi: scopeItems[itemIndex]?.roi },
    ]));
    const displayItem = compareAIvsTM({
      ...item,
      new_match: item.post_rewrite_tm?.status === 'complete'
        ? item.post_rewrite_tm.score
        : (item.reached_threshold ? item.similarity : 0),
      scopeResults,
    });
    return {
      ...displayItem,
      ai_quality: item.ai_quality || evaluateRewriteCandidate(displayItem),
    };
  });
}

// ===== 渲染结果卡片 =====
function renderResults(items) {
  const container = document.getElementById('results');
  container.innerHTML = '';
  renderMultilingualRoiSummary(multilingualRoiSummary);
  renderReviewFilter(items);
  if (items.length === 0) {
    container.innerHTML = '<div class="empty-hint">No results</div>';
    return;
  }

  items.forEach((item) => {
    if (item.review) return;
    item.review = createReviewState({
      sourceText: item.source_text,
      initialText: item.ai_quality?.displayText || item.ai_translation || item.source_text,
    });
    item.review_status = item.review.status;
  });

  const visibleItems = filterReviewItems(items, reviewFilter);
  if (visibleItems.length === 0) {
    container.innerHTML = `<div class="empty-hint">${escapeHtml(t('noImprovedResults', uiLanguage))}</div>`;
  } else {
    visibleItems.forEach((item) => container.appendChild(renderCard(item)));
  }
  applyI18n(document, uiLanguage);
  updateSelectedCount();
  // BX5：更新结果 tab 角标 + 自动切到结果 tab（处理完成后）
  updateResultsBadge(items.length);
  switchTab('results');
  // BX3/BX5：写回按钮启用 = 有结果 且 目标可写（两个 tab 的按钮都同步）
  (async () => {
    const cfg = await loadConfig();
    const parsed = parseFeishuUrl(cfg.sheetsUrl || cfg.spreadsheetToken);
    updateRoiArchiveButtonEnabled(
      processedItems.some((item) => item.review_status === 'confirmed')
        && Boolean(multilingualRoiSummary)
        && multilingualScopeRuns.length > 0,
    );
    renderDestSummary(cfg);
  })();
}

/** 同步 All / AI rewritten 数量和可访问的选中状态。 */
function renderReviewFilter(items = []) {
  const container = document.getElementById('review-filter');
  const allItems = Array.isArray(items) ? items : [];
  const improvedItems = filterReviewItems(allItems, 'improved');
  container.classList.toggle('hidden', allItems.length === 0);
  document.getElementById('review-filter-all-count').textContent = allItems.length;
  document.getElementById('review-filter-improved-count').textContent = improvedItems.length;
  ['all', 'improved'].forEach((filter) => {
    document.getElementById(`review-filter-${filter}`)
      .setAttribute('aria-pressed', String(reviewFilter === filter));
  });
}

/** ROI 金额只在 Bitable 公式字段中呈现，Popup 不显示金额或小计。 */
function renderMultilingualRoiSummary(_summary) {
  const container = document.getElementById('multilingual-roi-summary');
  container.classList.add('hidden');
  container.innerHTML = '';
}

// BX5：更新结果 tab 的数量角标
function updateResultsBadge(n) {
  const badge = document.getElementById('results-badge');
  if (!badge) return;
  if (n > 0) {
    badge.textContent = n;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function renderCard(item) {
  const card = document.createElement('div');
  card.className = 'result-card';
  card.dataset.id = item.id;

  const sim = item.similarity ? Math.round(item.similarity) : 0;
  const reviewStatus = item.review_status || item.review?.status || 'draft';

  card.innerHTML = `
    <div class="card-summary">
      <span class="source-text" data-focus="${item.id}">"${escapeHtml(truncate(item.source_text, 60))}"</span>
      <div class="score-rail" aria-label="TM score flow">
        <span class="score-stage tm">TM ${sim}%</span>
        <span class="score-arrow" aria-hidden="true">→</span>
        ${postRewriteTmBadge(item.post_rewrite_tm, item.similarity)}
        <span class="score-arrow" aria-hidden="true">→</span>
        ${finalTmBadge(item.final_tm, item.similarity)}
        ${reviewStatusTag(reviewStatus)}
      </div>
    </div>
    <div class="card-actions">
      <button class="btn-sm btn-focus">${t('focus', uiLanguage)}</button>
    </div>
    ${renderAiAgentAttribution(item)}
  `;

  const openFocus = () => openFocusView(item.id);
  card.querySelector('.btn-focus').addEventListener('click', openFocus);
  card.querySelector('[data-focus]').addEventListener('click', openFocus);

  return card;
}

/** 渲染实际完成 AI 改写的 Agent 审计信息，供用户定位版本和来源策略。 */
function renderAiAgentAttribution(item) {
  if (!item.ai_task_id || !item.ai_agent_name) return '';
  const version = Number(item.ai_agent_version);
  const versionLabel = Number.isSafeInteger(version) && version > 0
    ? `v${version}`
    : 'Version unavailable';
  const strategy = item.ai_agent_version_policy === 'pinned'
    ? 'Pinned version'
    : 'Latest published';
  const agentId = String(item.ai_agent_id || '').trim();
  const title = agentId ? ` title="Agent ID: ${escapeHtml(agentId)}"` : '';
  return `<div class="ai-agent-attribution"${title}>AI source optimization · ${escapeHtml(item.ai_agent_name)} · ${versionLabel} · ${strategy}</div>`;
}

/** 渲染 Inspire 返回的全部候选，默认采用项仍由 `ai_translation` 指定。 */
function renderAiCandidates(candidates) {
  if (!Array.isArray(candidates) || candidates.length < 2) return '';
  const rows = candidates.map((candidate, index) => {
    const score = Number.isFinite(Number(candidate.score)) ? ` · ${Number(candidate.score).toFixed(2)}` : '';
    const title = candidate.title ? ` · ${escapeHtml(candidate.title)}` : '';
    return `<li><strong>${index + 1}${score}${title}</strong><br>${escapeHtml(candidate.revision || '')}</li>`;
  }).join('');
  return detailSection(t('aiCandidates', uiLanguage), `<ol class="ai-candidate-list">${rows}</ol>`);
}

/**
 * 渲染结果卡片中的改写后真实 Starling TM 快照摘要。
 *
 * @param {object|undefined} snapshot 改写后二次 TM 查询快照。
 * @returns {string} 可安全插入卡片 badge 区域的 HTML。
 */
function postRewriteTmBadge(snapshot, baseline) {
  if (snapshot?.status === 'complete') {
    return `<span class="score-stage post">Post ${Math.round(snapshot.score)}% <small>${scoreDelta(snapshot.score, baseline)}</small></span>`;
  }
  if (snapshot?.status === 'incomplete') {
    return '<span class="score-stage post incomplete">Post incomplete</span>';
  }
  return '<span class="score-stage post pending">Post —</span>';
}

/** 渲染 CD 最终 C 的第三次真实 TM score。 */
function finalTmBadge(snapshot, baseline) {
  if (snapshot?.status === 'complete') {
    return `<span class="score-stage final">Final ${Math.round(snapshot.score)}% <small>${scoreDelta(snapshot.score, baseline)}</small></span>`;
  }
  if (snapshot?.status === 'incomplete') return '<span class="score-stage final incomplete">Final incomplete</span>';
  return '<span class="score-stage final pending">Final —</span>';
}

/** 将审阅状态显示为紧凑、可区分的标签。 */
function reviewStatusTag(status) {
  const normalized = ['draft', 'confirming', 'confirmed', 'dirty', 'error'].includes(status)
    ? status
    : 'draft';
  const statusKey = normalized.charAt(0).toUpperCase() + normalized.slice(1);
  const label = t(`reviewStatus${statusKey}`, uiLanguage);
  return `<span class="review-status-tag status-${normalized}">${escapeHtml(label)}</span>`;
}

/**
 * 渲染改写后真实 Starling TM 快照的审计信息。
 *
 * @param {object|undefined} snapshot 改写后二次 TM 查询快照。
 * @returns {string} 详情区域 HTML；不需要查询的条目不显示该区域。
 */
function renderPostRewriteTmSnapshot(snapshot) {
  if (snapshot?.status === 'complete') {
    const tmSource = snapshot.tmSource || snapshot.tmMatch || '';
    const meta = [
      snapshot.origin ? `Source: ${snapshot.origin}` : '',
      snapshot.method ? `Method: ${snapshot.method}` : '',
      Number.isInteger(snapshot.candidateCount) ? `Candidates: ${snapshot.candidateCount}` : '',
    ].filter(Boolean).join(' · ');
    return detailSection(
      `${t('postTm', uiLanguage)} (${Math.round(snapshot.score)}%)`,
      escapeHtml(tmSource || t('noTm', uiLanguage)),
      escapeHtml(meta)
    );
  }
  if (snapshot?.status === 'incomplete') {
    return detailSection(
      'Post-rewrite Starling TM (incomplete)',
      'No post-rewrite score is available for ROI.',
      escapeHtml(snapshot.error || snapshot.reason || 'Unknown query failure')
    );
  }
  return '';
}

/** 渲染最终 C 的 TM 审计信息，不在 Popup 输出金额。 */
function renderFinalTmSnapshot(snapshot) {
  if (snapshot?.status === 'complete') {
    return detailSection(
      `${t('finalTm', uiLanguage)} (${Math.round(snapshot.score)}%)`,
      escapeHtml(snapshot.tmSource || snapshot.tmMatch || t('noTm', uiLanguage)),
      escapeHtml(snapshot.origin || '')
    );
  }
  if (snapshot?.status === 'incomplete') {
    return detailSection('Final C TM (incomplete)', 'No final C score is available.', escapeHtml(snapshot.error || snapshot.reason || 'Unknown query failure'));
  }
  return '';
}

/** 渲染同一条文案在全部共享语言多项目 scope 的真实 A/B/C TM 审计明细。 */
function renderScopeResults(scopeResults = {}) {
  const rows = Object.values(scopeResults).map((entry) => {
    const original = Number.isFinite(entry.originalTm?.score) ? `${Math.round(entry.originalTm.score)}%` : 'incomplete';
    const post = entry.postRewriteTm?.status === 'complete' ? `${Math.round(entry.postRewriteTm.score)}%`
      : (entry.postRewriteTm?.status || 'not_available');
    const final = entry.finalTm?.status === 'complete' ? `${Math.round(entry.finalTm.score)}%`
      : (entry.finalTm?.status || 'pending CD confirmation');
    return `<li>${escapeHtml(entry.scope.projectName)} · ${escapeHtml(entry.scope.sourceLocale)}→${escapeHtml(entry.scope.targetLocale)}: Score A ${original}, Score B ${post}, Score C ${final}</li>`;
  }).join('');
  return rows ? detailSection(t('tmScores', uiLanguage), `<ul>${rows}</ul>`) : '';
}

// ===== BX4：聚焦大图视图 =====
let focusIndex = -1;

function openFocusView(itemId) {
  const visibleItems = filterReviewItems(processedItems, reviewFilter);
  focusIndex = visibleItems.findIndex((it) => it.id === itemId);
  if (focusIndex < 0) return;
  renderFocus();
  document.getElementById('focus-overlay').classList.remove('hidden');
}

function closeFocusView() {
  document.getElementById('focus-overlay').classList.add('hidden');
  focusIndex = -1;
}

function focusStep(delta) {
  const n = filterReviewItems(processedItems, reviewFilter).length;
  if (n === 0) return;
  focusIndex = (focusIndex + delta + n) % n;
  renderFocus();
}

function renderFocus() {
  const visibleItems = filterReviewItems(processedItems, reviewFilter);
  const item = visibleItems[focusIndex];
  if (!item) return;
  const body = document.getElementById('focus-body');
  if (!item.review) {
    item.review = createReviewState({
      sourceText: item.source_text,
      initialText: item.ai_quality?.displayText || item.ai_translation || item.source_text,
    });
  }
  const sim = item.similarity ? Math.round(item.similarity) : 0;
  const tmState = buildFocusTmState(item);
  const reviewableAiCandidates = dedupeAiCandidates(getReviewableAiCandidates(item));
  const tmRows = tmState.candidates.length
    ? tmState.candidates.map((candidate, index) => `
      <li><strong>${escapeHtml(candidate.source || '')} · ${Math.round(Number(candidate.score) || 0)}%</strong></li>`).join('')
    : `<li>${escapeHtml(tmState.message)}</li>`;
  const tmNotice = tmState.status === 'legacy_single'
    ? `<div class="focus-meta error">${escapeHtml(tmState.message)}</div>`
    : '';
  const aiAbsence = explainFocusAiAbsence(item);
  const bestPostScore = item.post_rewrite_tm?.status === 'complete'
    ? `${Math.round(item.post_rewrite_tm.score)}% ${scoreDelta(item.post_rewrite_tm.score, item.similarity)}`
    : '—';
  const aiRows = reviewableAiCandidates.length
    ? `<div class="ai-candidate-stack">${reviewableAiCandidates.map((candidate, index) => {
      const selected = isAiCandidateSelected(item.review, candidate);
      const postScore = Math.round(Number(candidate.post_rewrite_tm?.score) || 0);
      const candidateDelta = scoreDelta(candidate.post_rewrite_tm?.score, item.similarity);
      return `
      <button
        type="button"
        class="ai-candidate-choice${selected ? ' is-selected' : ''}"
        data-ai-candidate="${index}"
        aria-pressed="${selected}"
      >
        <span class="candidate-copy">${escapeHtml(candidate.ai_translation)}</span>
        <span class="candidate-meta">
          <span>Candidate ${index + 1}</span>
          <span class="candidate-score">Post-TM ${postScore}% ${candidateDelta}</span>
          <span class="candidate-select-indicator">${selected ? 'Selected' : 'Select'}</span>
        </span>
      </button>`;
    }).join('')}</div>`
    : `<div class="focus-text">None</div>
       <div class="focus-meta error">${escapeHtml(aiAbsence)}</div>`;
  const aiDisclosureOpen = reviewableAiCandidates.length <= 1 ? ' open' : '';

  document.getElementById('focus-pos').textContent = `${focusIndex + 1} / ${visibleItems.length}`;
  body.innerHTML = `
    <div class="focus-section focus-source">
      <div class="focus-label">${t('sourceDetail', uiLanguage)}</div>
      <div class="focus-text">${escapeHtml(item.source_text)}</div>
    </div>
    <div class="score-rail focus-score-rail" aria-label="TM score flow">
      <span class="score-stage tm">TM ${sim}%</span>
      <span class="score-arrow" aria-hidden="true">→</span>
      ${postRewriteTmBadge(item.post_rewrite_tm, item.similarity)}
      <span class="score-arrow" aria-hidden="true">→</span>
      ${finalTmBadge(item.final_tm, item.similarity)}
      ${reviewStatusTag(item.review.status)}
    </div>
    <details class="focus-disclosure focus-tm-disclosure">
      <summary>
        <span>Top-3 TM</span>
        <span class="disclosure-summary-meta">TM ${sim}% · ${tmState.candidates.length || 0} match(es)</span>
      </summary>
      <div class="focus-disclosure-body">
        <ol class="ai-candidate-list">${tmRows}</ol>
        ${tmNotice}
      </div>
    </details>
    <div class="focus-flow-arrow" aria-hidden="true">↓</div>
    <details class="focus-disclosure focus-ai-disclosure"${aiDisclosureOpen}>
      <summary>
        <span>${t('aiRewrite', uiLanguage)}</span>
        <span class="disclosure-summary-meta">${reviewableAiCandidates.length} candidate(s) · Best Post ${bestPostScore}</span>
      </summary>
      <div class="focus-disclosure-body">
        ${aiRows}
      </div>
    </details>
    <div class="focus-flow-arrow" aria-hidden="true">↓</div>
    <div class="focus-section focus-final">
      <div class="focus-label">
        <span>Final copy</span>
        ${reviewStatusTag(item.review.status)}
      </div>
      <textarea rows="6" class="manual-input focus-manual" placeholder="${escapeHtml(t('manualPlaceholder', uiLanguage))}">${escapeHtml(item.review.finalText)}</textarea>
      <div class="focus-meta">Final TM ${item.final_tm?.status === 'complete' ? `${Math.round(item.final_tm.score)}% ${scoreDelta(item.final_tm.score, item.similarity)}` : '—'}</div>
      ${renderAiAgentAttribution(item)}
      ${item.review.error ? `<div class="focus-meta error">${escapeHtml(item.review.error)}</div>` : ''}
    </div>
    <div class="focus-actions">
      <button class="btn btn-success" data-confirm-review>
        ${item.review.status === 'dirty'
    ? t('reconfirmReview', uiLanguage)
    : t('confirmReview', uiLanguage)}
      </button>
    </div>
  `;

  body.querySelectorAll('[data-ai-candidate]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const candidate = reviewableAiCandidates[Number(btn.dataset.aiCandidate)];
      item.review = editFinalText(item.review, candidate.ai_translation);
      item.review_status = item.review.status;
      void persistWorkflowSnapshot();
      renderFocus();
    });
  });

  const manual = body.querySelector('.focus-manual');
  autoSizeTextarea(manual);
  manual.addEventListener('input', () => {
    autoSizeTextarea(manual);
    item.review = editFinalText(item.review, manual.value);
    item.review_status = item.review.status;
    void persistWorkflowSnapshot();
  });
  body.querySelector('[data-confirm-review]').addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    try {
      await confirmReviewItem(item);
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
    renderResults(processedItems);
    const refreshed = processedItems.find((entry) => entry.id === item.id);
    if (refreshed) openFocusView(refreshed.id);
  });
}

/** 让 Final copy 保持可读，同时给超长文案保留内部滚动。 */
function autoSizeTextarea(textarea) {
  if (!textarea) return;
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 132), 320)}px`;
}

/** 格式化相对原始 Score A 的统一箭头与差值。 */
function scoreDelta(score, baseline) {
  const current = Number(score);
  const original = Number(baseline);
  if (!Number.isFinite(current) || !Number.isFinite(original)) return '';
  const delta = Math.round((current - original) * 100) / 100;
  if (delta > 0) return `↑${delta}`;
  if (delta < 0) return `↓${Math.abs(delta)}`;
  return '→0';
}

function setChoice(card, item, choice) {
  userChoices[item.id] = choice;
  void persistWorkflowSnapshot();
  card.querySelectorAll('.btn-sm[data-choice]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.choice === choice);
  });
  // 手动模式下显示输入框
  const detail = card.querySelector('.card-detail');
  let manualInput = detail.querySelector('.manual-input');
  if (choice === 'manual' && !manualInput) {
    manualInput = document.createElement('textarea');
    manualInput.className = 'manual-input';
    manualInput.placeholder = t('manualPlaceholder', uiLanguage);
    manualInput.value = item.manual_translation || '';
    manualInput.addEventListener('input', () => {
      item.manual_translation = manualInput.value;
      void persistWorkflowSnapshot();
    });
    detail.appendChild(manualInput);
    detail.classList.remove('hidden');
  }
  updateSelectedCount();
}

function renderComparison(aiVsTm) {
  if (!aiVsTm) return '';
  const diffs = aiVsTm.key_differences?.length
    ? `<ul>${aiVsTm.key_differences.map((d) => `<li>${escapeHtml(d.tm)} → ${escapeHtml(d.ai)}</li>`).join('')}</ul>`
    : '';
  return `
    <div class="detail-section">
      <h4>${t('comparison', uiLanguage)}
        <span class="status-tag status-${aiVsTm.status}">${aiVsTm.status}</span>
      </h4>
      <p>${escapeHtml(aiVsTm.changes || '')}</p>
      ${diffs}
    </div>`;
}

/**
 * 对 Focus 中的一条最终文案执行 Final TM、Sheet 同步和确认状态提交。
 *
 * 当前展示 scope 的 Final TM 与 Sheet 写入决定交互确认是否成功；ROI mode 的其他
 * scope 同步查询并保留真实 complete/incomplete 结果，用于正式 A-C 汇总。
 */
async function confirmReviewItem(item) {
  const config = await loadConfig();
  if (!config.spreadsheetToken || !config.sheetId || config.sheetLayout?.confirmed !== true) {
    throw new Error('Confirm a writable Spreadsheet layout before confirming this item.');
  }
  const runConfig = activeRunConfig || await ensureWorkflowReady();
  if (!runConfig) throw new Error('run_configuration_incomplete');
  item.review = beginConfirmation(item.review);
  item.review_status = item.review.status;
  const finalText = item.review.finalText;
  const tmOpts = {
    cliPath: config.starlingCliPath,
    tmMode: config.starlingTmMode === 'legacy_cli' ? 'legacy' : 'batch',
    usePpe: config.starlingTmMode !== 'legacy_cli',
    accessKey: runConfig.accessKey,
    secretKey: runConfig.secretKey,
  };

  let displayScopeItem = null;
  let brokerPendingAfterSingle = 0;
  try {
    showProgress('Querying Final TM for this source...', 55);
    for (const scopeRun of multilingualScopeRuns) {
      const scopeItem = scopeRun.items.find((entry) => (
        entry.id === item.id || (entry.row != null && entry.row === item.row)
      ));
      if (!scopeItem) continue;
      scopeItem.final_source_text = finalText;
      const [snapshot] = await queryFinalTmSnapshots(
        [{ ...scopeItem, final_source_text: finalText }],
        scopeRun.scope.sourceLocale,
        scopeRun.scope.targetLocale,
        { ...tmOpts, projectIds: projectIdsForScope(scopeRun.scope) },
      );
      scopeItem.final_tm = snapshot;
      scopeItem.review_status = 'confirming';
      scopeItem.review = item.review;
      scopeItem.roi = roiEnabled
        ? calculateRoiForItem(scopeItem, scopeRun.rate)
        : { status: 'not_requested', reason: 'roi_disabled' };
      if (scopeRun.scope.key === activeDisplayScopeKey) displayScopeItem = scopeItem;
    }
    if (displayScopeItem?.final_tm?.status !== 'complete') {
      throw new Error(
        displayScopeItem?.final_tm?.error
        || displayScopeItem?.final_tm?.reason
        || 'final_tm_incomplete',
      );
    }
    await writeConfirmedReviewItem({
      ...displayScopeItem,
      final_source_text: finalText,
    }, config);
    const outputStartColumn = activeWorkflowContext?.sheetLayout?.outputStartColumn || config.sheetLayout?.outputStartColumn || null;
    const confirmed = completeConfirmation(item.review, {
      finalTm: displayScopeItem.final_tm,
      sheetWriteSucceeded: true,
    });
    multilingualScopeRuns.forEach((scopeRun) => {
      const scopeItem = scopeRun.items.find((entry) => (
        entry.id === item.id || (entry.row != null && entry.row === item.row)
      ));
      if (!scopeItem) return;
      scopeItem.review = confirmed;
      scopeItem.review_status = 'confirmed';
    });
    // 单条确认必须走与批量确认同一个 Broker 同步函数；Sheet 失败已在上方抛出，不会走到这里。
    try {
      const syncResult = await syncConfirmedItemsToBroker({
        writable: [{ planned: { review: confirmed }, displayItem: displayScopeItem }],
        outputStartColumn,
      });
      if (syncResult?.pendingCount > 0) {
        brokerPendingAfterSingle = syncResult.pendingCount;
        showStatus('Final TM and Sheet sync completed; broker submission is queued and will retry automatically.', 'info');
      }
    } catch (brokerError) {
      // Sheet 已经成功，本地 confirmed 必须成立；pending outbox 已由 enqueue 持久化。
      console.warn('Broker final submission failed after successful sheet write; queued for replay.', brokerError);
      brokerPendingAfterSingle = countPendingBrokerFinalSubmissions(activeBrokerRun);
      showStatus('Final TM and Sheet sync completed; broker submission queued for retry.', 'info');
    }
    void pollActiveBrokerRun();
    refreshVendorRoiResults();
    finalValidationAttempted = true;
    processedItems = buildProcessedDisplayItems(multilingualScopeRuns);
    await persistWorkflowSnapshot();
    hideProgress();
    // P2：单条确认后如果仍有 pending broker final，最终状态必须保留 pending 提示，
    // 不能被通用的 "Final TM and Sheet sync completed for this source." 覆盖掉。
    if (brokerPendingAfterSingle > 0) {
      showStatus(
        `Final TM and Sheet sync completed for this source; ${brokerPendingAfterSingle} broker submission(s) queued for retry / pending broker sync.`,
        'info',
      );
    } else {
      showStatus('Final TM and Sheet sync completed for this source.', '');
    }
  } catch (error) {
    hideProgress();
    const failed = failConfirmation(item.review, error);
    item.review = failed;
    item.review_status = failed.status;
    multilingualScopeRuns.forEach((scopeRun) => {
      const scopeItem = scopeRun.items.find((entry) => (
        entry.id === item.id || (entry.row != null && entry.row === item.row)
      ));
      if (!scopeItem) return;
      scopeItem.review = failed;
      scopeItem.review_status = failed.status;
    });
    processedItems = buildProcessedDisplayItems(multilingualScopeRuns);
    await persistWorkflowSnapshot();
    throw error;
  }
}

/** 跨语言 scope 使用稳定行号或条目 ID 对齐同一条 source。 */
function reviewItemKey(item) {
  return item?.row != null ? `row:${item.row}` : `id:${item?.id}`;
}

/** 将一条审阅状态同步到全部语言 scope，防止恢复运行时状态分叉。 */
function syncReviewStateToScopes(item, review) {
  const key = reviewItemKey(item);
  multilingualScopeRuns.forEach((scopeRun) => {
    const scopeItem = scopeRun.items.find((entry) => reviewItemKey(entry) === key);
    if (!scopeItem) return;
    scopeItem.review = review;
    scopeItem.review_status = review.status;
  });
}

/**
 * 确认并写入全部尚未确认的默认结果。
 *
 * 本地门禁失败的条目进入 error，其余条目按 scope 批量查询真实 Final TM；展示 scope
 * 完成 Final TM 的条目再按连续 Sheet 行批量写入。任一步失败都不会伪造 confirmed。
 */
async function confirmRemainingReviewItems() {
  const config = await loadConfig();
  if (!config.spreadsheetToken || !config.sheetId || config.sheetLayout?.confirmed !== true) {
    throw new Error('Confirm a writable Spreadsheet layout before confirming remaining items.');
  }
  const runConfig = activeRunConfig || await ensureWorkflowReady();
  if (!runConfig) throw new Error('run_configuration_incomplete');

  const plan = prepareBulkConfirmations(processedItems);
  plan.failed.forEach(({ item, review }) => {
    item.review = review;
    item.review_status = review.status;
    syncReviewStateToScopes(item, review);
  });
  plan.ready.forEach(({ item, review }) => {
    item.review = review;
    item.review_status = review.status;
    syncReviewStateToScopes(item, review);
  });
  if (plan.ready.length === 0) {
    processedItems = buildProcessedDisplayItems(multilingualScopeRuns);
    await persistWorkflowSnapshot();
    const message = plan.failed.length
      ? `${plan.failed.length} item(s) need attention before confirmation.`
      : 'All items are already confirmed.';
    showStatus(message, plan.failed.length ? 'error' : '');
    return;
  }

  const button = document.getElementById('btn-confirm-remaining');
  button.disabled = true;
  const readyByKey = new Map(plan.ready.map((entry) => [reviewItemKey(entry.item), entry]));
  const tmOpts = {
    cliPath: config.starlingCliPath,
    tmMode: config.starlingTmMode === 'legacy_cli' ? 'legacy' : 'batch',
    usePpe: config.starlingTmMode !== 'legacy_cli',
    accessKey: runConfig.accessKey,
    secretKey: runConfig.secretKey,
  };

  try {
    for (let scopeIndex = 0; scopeIndex < multilingualScopeRuns.length; scopeIndex += 1) {
      const scopeRun = multilingualScopeRuns[scopeIndex];
      const pending = scopeRun.items.filter((entry) => readyByKey.has(reviewItemKey(entry)));
      if (pending.length === 0) continue;
      showProgress(
        `Querying Final TM · ${scopeIndex + 1}/${multilingualScopeRuns.length} scope(s) · ${pending.length} item(s)…`,
        45 + Math.round(((scopeIndex + 1) / multilingualScopeRuns.length) * 35),
      );
      const queryItems = pending.map((scopeItem) => {
        const planned = readyByKey.get(reviewItemKey(scopeItem));
        scopeItem.final_source_text = planned.review.finalText;
        scopeItem.review = planned.review;
        scopeItem.review_status = 'confirming';
        return { ...scopeItem, final_source_text: planned.review.finalText };
      });
      const snapshots = await queryFinalTmSnapshots(
        queryItems,
        scopeRun.scope.sourceLocale,
        scopeRun.scope.targetLocale,
        { ...tmOpts, projectIds: projectIdsForScope(scopeRun.scope) },
      );
      pending.forEach((scopeItem, index) => {
        scopeItem.final_tm = snapshots[index] || {
          status: 'incomplete',
          reason: 'final_tm_result_missing',
        };
        scopeItem.roi = roiEnabled
          ? calculateRoiForItem(scopeItem, scopeRun.rate)
          : { status: 'not_requested', reason: 'roi_disabled' };
      });
    }

    const displayRun = multilingualScopeRuns.find(
      (run) => run.scope.key === activeDisplayScopeKey,
    ) || multilingualScopeRuns[0];
    const writable = [];
    plan.ready.forEach((planned) => {
      const displayItem = displayRun?.items.find(
        (entry) => reviewItemKey(entry) === reviewItemKey(planned.item),
      );
      if (displayItem?.final_tm?.status === 'complete'
        && Number.isFinite(Number(displayItem.final_tm.score))) {
        writable.push({ planned, displayItem });
        return;
      }
      const error = new Error(
        displayItem?.final_tm?.error
        || displayItem?.final_tm?.reason
        || 'final_tm_incomplete',
      );
      const failed = failConfirmation(planned.review, error);
      syncReviewStateToScopes(planned.item, failed);
    });

    if (writable.length > 0) {
      showProgress(`Writing ${writable.length} confirmed item(s) to Spreadsheet…`, 90);
      const outputStartColumn = activeWorkflowContext?.sheetLayout?.outputStartColumn || config.sheetLayout?.outputStartColumn || null;
      await writeConfirmedReviewItems(
        writable.map(({ planned, displayItem }) => ({
          ...displayItem,
          final_source_text: planned.review.finalText,
        })),
        config,
      );
      // Sheet 写入成功后，先把所有条目标记 confirmed，再统一通过 Broker 同步入口 enqueue+replay。
      // Sheet 失败时已在上方抛出，绝对不会调用到 syncConfirmedItemsToBroker。
      writable.forEach(({ planned, displayItem }) => {
        const confirmed = completeConfirmation(planned.review, {
          finalTm: displayItem.final_tm,
          sheetWriteSucceeded: true,
        });
        syncReviewStateToScopes(planned.item, confirmed);
        // 将 planned.review 替换为 confirmed，让 syncConfirmedItemsToBroker 读到正确 finalText。
        planned.review = confirmed;
      });
      let pendingCount = 0;
      try {
        const brokerSync = await syncConfirmedItemsToBroker({ writable, outputStartColumn });
        pendingCount = brokerSync?.pendingCount || 0;
      } catch (brokerError) {
        console.warn('Broker final submission batch sync failed after successful sheet write; queued for replay.', brokerError);
        pendingCount = countPendingBrokerFinalSubmissions(activeBrokerRun);
      }
      void pollActiveBrokerRun();
      if (pendingCount > 0) {
        showStatus(
          `Confirmed and wrote ${writable.length} item(s); ${pendingCount} broker submission(s) queued for retry.`,
          'error',
        );
      }
    }

    refreshVendorRoiResults();
    finalValidationAttempted = true;
    processedItems = buildProcessedDisplayItems(multilingualScopeRuns);
    await persistWorkflowSnapshot();
    const confirmedCount = writable.length;
    const failedCount = plan.failed.length + plan.ready.length - writable.length;
    // P2：批量确认后若仍有 pending broker submissions，最终状态必须明确提示 pending，
    // 不能只剩 "Confirmed and wrote N item(s)." 这一通用成功提示。
    if (pendingCount > 0) {
      showStatus(
        failedCount > 0
          ? `Confirmed and wrote ${confirmedCount} item(s); ${pendingCount} broker submission(s) queued for retry / pending broker sync; ${failedCount} item(s) need attention.`
          : `Confirmed and wrote ${confirmedCount} item(s); ${pendingCount} broker submission(s) queued for retry / pending broker sync.`,
        failedCount > 0 ? 'error' : 'info',
      );
    } else {
      showStatus(
        failedCount > 0
          ? `Confirmed and wrote ${confirmedCount} item(s); ${failedCount} item(s) need attention.`
          : `Confirmed and wrote ${confirmedCount} remaining item(s).`,
        failedCount > 0 ? 'error' : '',
      );
    }
  } catch (error) {
    plan.ready.forEach(({ item, review }) => {
      const currentScopeItem = multilingualScopeRuns[0]?.items.find(
        (entry) => reviewItemKey(entry) === reviewItemKey(item),
      );
      if (currentScopeItem?.review_status !== 'confirming') return;
      syncReviewStateToScopes(item, failConfirmation(review, error));
    });
    processedItems = buildProcessedDisplayItems(multilingualScopeRuns);
    await persistWorkflowSnapshot();
    throw error;
  } finally {
    hideProgress();
    updateBulkReviewButton();
  }
}

/** 同步 ROI 归档按钮状态，归档不依赖当前单语言 Sheet 查看 scope。 */
function updateRoiArchiveButtonEnabled(enabled) {
  const button = document.getElementById('btn-write-roi-archive');
  if (button) button.disabled = !enabled;
}

/** 生成可读且全局唯一的 ROI 运行标识。 */
function createRoiArchiveRunId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
  return `roi-${stamp}-${crypto.randomUUID().slice(0, 8)}`;
}

/** 在结果页呈现 ROI 归档成功或失败的可审计摘要。 */
function showRoiArchiveResult(ok, detail) {
  const preview = document.getElementById('roi-archive-preview');
  preview.classList.remove('hidden');
  if (ok) {
    preview.className = 'dest-preview';
    preview.innerHTML = `<span class="dest-label">ROI archive written:</span>
      <span class="dest-target">Run ${escapeHtml(detail.runId)} · ${detail.scopeRecordCount} scope(s) · ${detail.itemRecordCount} item(s) · ${escapeHtml(detail.status)}</span>`;
    showStatus(`ROI archive written: ${detail.status}`, '');
    return;
  }
  preview.className = 'dest-preview dest-error';
  preview.innerHTML = `<span class="dest-label">ROI archive failed:</span>
    <span class="dest-target">${escapeHtml(detail)}</span>`;
  showError(detail);
}

/**
 * 在 ROI 归档前补齐首屏刻意延后的语言 scope。
 *
 * Review 只等待展示 scope；本函数复用同一次 Inspire 决策，对其余语言受控并发执行
 * A/B/C TM。失败结果保留为 incomplete，不能使用展示语言分数填充。
 */
async function completeDeferredRoiScopesForArchive(config) {
  const allScopes = Array.isArray(activeWorkflowContext?.roiScopes)
    ? activeWorkflowContext.roiScopes
    : multilingualScopeRuns.map((run) => run.scope);
  const completedKeys = new Set(multilingualScopeRuns.map((run) => run.scope?.key));
  const remainingCount = allScopes.filter((scope) => !completedKeys.has(scope?.key)).length;
  if (remainingCount === 0) return;
  if (!config.starlingAccessKey || !config.starlingSecretKey) {
    throw new Error('Starling credentials are required to complete deferred ROI scopes.');
  }
  const catalog = rateCatalog || await loadRateCatalog();
  if (!catalog) throw new Error('Pricing catalog is unavailable.');
  const tmOpts = {
    cliPath: config.starlingCliPath,
    tmMode: config.starlingTmMode === 'legacy_cli' ? 'legacy' : 'batch',
    usePpe: config.starlingTmMode !== 'legacy_cli',
    accessKey: config.starlingAccessKey,
    secretKey: config.starlingSecretKey,
    // 每个 scope 只保留一个 Batch 请求，配合下面的 requestConcurrency 控制全局在飞请求。
    batchConcurrency: 1,
  };
  const finalByKey = new Map(
    processedItems.map((item) => [reviewItemKey(item), item]),
  );
  const vendor = 'RWS';
  multilingualScopeRuns = await completeDeferredLocaleScopes({
    allScopes,
    existingScopeRuns: multilingualScopeRuns,
    sourceItems: extractedItems,
    // A 与 C 现在按 scope 流水线并发发出；2026-08-04 PPE 实测 12 个在飞请求稳定且无限流。
    requestConcurrency: 12,
    onProgress: (phase, scope, index, total) => showProgress(
      phase === 'initial'
        ? `Calculating ROI TM · ${scope.targetLocale} · ${index + 1}/${total} deferred scope(s)…`
        : `Calculating ROI Final TM · ${scope.targetLocale} · ${index + 1}/${total} deferred scope(s)…`,
      phase === 'initial'
        ? 30 + Math.round(((index + 1) / total) * 30)
        : 65 + Math.round(((index + 1) / total) * 20),
    ),
    queryOriginalTm: (texts, scope) => searchTM(
      texts,
      scope.sourceLocale,
      scope.targetLocale,
      { ...tmOpts, projectIds: projectIdsForScope(scope) },
    ),
    // B 仅服务首屏的候选审阅；延后语言的正式 ROI 只依赖 A 与确认后的 C。
    // 不按 56 个语言重复查询最多三个 AI 候选，避免无业务价值的请求放大。
    queryPostRewriteTm: (scopeItems) => scopeItems.map(() => ({ status: 'not_required' })),
    resolveRate: (scope) => resolveWordRate(catalog, {
      vendor,
      sourceLang: scope.sourceLocale,
      targetLang: scope.targetLocale,
    }),
    calculateRoi: (item, rate) => calculateRoiForItem(item, rate),
    decorateItem: (item) => {
      item.new_match = item.post_rewrite_tm?.status === 'complete'
        ? item.post_rewrite_tm.score
        : (item.reached_threshold ? item.similarity : 0);
    },
    finalSourceForItem: (item) => {
      const reviewItem = finalByKey.get(reviewItemKey(item));
      return reviewItem?.review_status === 'confirmed'
        ? String(reviewItem.review?.finalText || '').trim()
        : '';
    },
    queryFinalTm: (scopeItems, scope) => queryFinalTmSnapshots(
      scopeItems,
      scope.sourceLocale,
      scope.targetLocale,
      { ...tmOpts, projectIds: projectIdsForScope(scope) },
    ),
  });
  refreshVendorRoiResults();
  processedItems = buildProcessedDisplayItems(multilingualScopeRuns);
  finalValidationAttempted = true;
  await persistWorkflowSnapshot();
}

function closeArchiveConfirmation(reason = 'cancel') {
  const dialog = document.getElementById('roi-archive-confirmation');
  if (!dialog || dialog.classList.contains('hidden')) return;
  dialog.classList.add('hidden');
  dialog._archiveResolve?.(reason === 'start');
}

function openArchiveConfirmation(summary) {
  const dialog = document.getElementById('roi-archive-confirmation');
  const trigger = document.activeElement;
  const coverage = summary.vendorCoverage;
  document.getElementById('archive-summary-sources').textContent = String(summary.sourceRowCount);
  document.getElementById('archive-summary-confirmed').textContent = String(summary.confirmedRowCount);
  document.getElementById('archive-summary-languages').textContent = String(summary.languageCount);
  document.getElementById('archive-summary-coverage').textContent = `RWS ${coverage.RWS} · Pactera ${coverage.Pactera} · unpriced ${coverage.unpriced}`;
  document.getElementById('archive-summary-requests').textContent = `${summary.estimatedTmRequests.original} A + ${summary.estimatedTmRequests.final} C = ${summary.estimatedTmRequests.total}`;
  document.getElementById('archive-summary-duration').textContent = `${summary.estimatedDuration.minSeconds}–${summary.estimatedDuration.maxSeconds}s`;
  dialog.classList.remove('hidden');

  return new Promise((resolve) => {
    let settled = false;
    const finish = (started) => {
      if (settled) return;
      settled = true;
      dialog.classList.add('hidden');
      dialog.removeEventListener('keydown', onKeydown);
      cancel.removeEventListener('click', onCancel);
      start.removeEventListener('click', onStart);
      dialog._archiveResolve = null;
      if (trigger?.focus) trigger.focus();
      resolve(started);
    };
    const cancel = document.getElementById('archive-confirm-cancel');
    const start = document.getElementById('archive-confirm-start');
    const onCancel = () => finish(false);
    const onStart = () => finish(true);
    const onKeydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog._archiveResolve = finish;
    cancel.addEventListener('click', onCancel);
    start.addEventListener('click', onStart);
    dialog.addEventListener('keydown', onKeydown);
    start.focus();
  });
}

/** 将当前整车 ROI 结果追加写入产品固定的 Bitable Run/Scope/Item 归档表。 */
async function writeCurrentRoiArchive({ skipConfirmation = false } = {}) {
  const config = await loadConfig();
  if (!roiEnabled) {
    showStatus('ROI mode is off. Turn it on before writing an ROI archive.', 'error');
    return;
  }
  if (!finalValidationAttempted || !multilingualRoiSummary || multilingualScopeRuns.length === 0) {
    showStatus(t('archiveNeedsFinal', uiLanguage), 'error');
    return;
  }
  const confirmedCount = processedItems.filter((item) => item.review_status === 'confirmed').length;
  const plannedScopes = Array.isArray(activeWorkflowContext?.roiScopes)
    ? activeWorkflowContext.roiScopes
    : multilingualScopeRuns.map((run) => run.scope);
  const servedKeys = new Set();
  const vendorRoutes = [];
  const summaryVendors = Array.isArray(ROI_VENDORS) ? ROI_VENDORS : ['RWS', 'Pactera'];
  summaryVendors.forEach((vendor) => {
    (vendorRoiResults[vendor]?.scopeRuns || []).forEach((run) => {
      servedKeys.add(run.scope?.key);
      vendorRoutes.push({ vendor, served: true, completeRate: true });
    });
  });
  plannedScopes.forEach((scope) => {
    if (!servedKeys.has(scope?.key)) vendorRoutes.push({ vendor: null, served: false, completeRate: false });
  });
  const archiveSummary = summarizeArchive({
    sourceRowCount: processedItems.length,
    confirmedRowCount: confirmedCount,
    languageCount: plannedScopes.length,
    vendorRoutes,
    batchSize: 40,
  });
  if (!skipConfirmation && !(await openArchiveConfirmation(archiveSummary))) return;

  const button = document.getElementById('btn-write-roi-archive');
  button.disabled = true;
  button.textContent = 'Preparing ROI archive...';
  try {
    let feishuUser = await getFeishuUserAuthorizationStatus();
    if (!feishuUser.connected) {
      showStatus('Waiting for Feishu authorization...', '');
      const returnUrl = await getActiveReturnUrl();
      const useLegacy = await shouldUseLegacyFallback();
      if (useLegacy) {
        feishuUser = await authorizeFeishuUser({ returnUrl });
      } else {
        feishuUser = await authorizeFeishuUserViaBroker({ returnUrl });
      }
    }
    if (brokerAsyncRoi && !(await isLegacyLocalSecretDevOnlyEnabled())) {
      // A4：Broker 是权威路径。如果之前 createBrokerRun 失败（brokerRunCreateError 已记录），
      // 即使 activeBrokerRun 为 null 也必须显式阻止 archive，不能因为 activeBrokerRun?.run_id
      // 为假而掉进下面的 legacy writeRoiArchive 分支。
      if (brokerRunCreateError) {
        const reason = brokerRunCreateError?.message || String(brokerRunCreateError || 'unknown broker create error');
        showRoiArchiveResult(false, `Broker async ROI run is unavailable (create failed: ${reason}). Archive blocked; retry the run or set l10nLegacyLocalSecretDevOnly=true (dev only) to fall back.`);
        return;
      }
      if (!activeBrokerRun?.run_id) {
        showRoiArchiveResult(false, 'Broker async ROI run is not active yet. Wait for the run to be created before archiving, or turn the broker flag off.');
        return;
      }
      const archiveGuard = canArchiveBrokerRun(activeBrokerRun);
      if (archiveGuard.blocked) {
        showStatus(
          `Cannot archive: ${archiveGuard.count} pending broker final submission(s) must finish before archive. Re-open the Side Panel to replay them.`,
          'error',
        );
        return;
      }
      const statusBefore = await fetchBrokerRun(activeBrokerRun.run_id);
      await syncBrokerRunStatus(statusBefore);
      // A4: Broker 是权威路径，失败直接显示 Broker 错误，禁止静默回退到 legacy local archive 写 Bitable。
      const archive = await requestBrokerArchive({
        runId: activeBrokerRun.run_id,
        revision: statusBefore.revision || activeBrokerRun.revision || 1,
        requestedAt: new Date().toISOString(),
      });
      showStatus(
        `ROI archive accepted by the async worker${archive?.archive_state ? ` (state: ${archive.archive_state})` : ''}. You can close the Side Panel; re-open to resume status.`,
        'info',
      );
      void pollActiveBrokerRun();
      return;
    }
    await completeDeferredRoiScopesForArchive(config);
    let archivePlan = activeWorkflowContext?.roiArchivePlan;
    // 只归档真正拥有可计费语言的 vendor。费率目录中 vendor 语言覆盖互斥，若强行为
    // 不服务这些语言的 vendor 建 Run，只会产生一条必然 incomplete 的噪声记录。
    const archiveVendors = archivableRoiVendors();
    if (!archiveVendors.length) {
      throw new Error(
        'No vendor has exact word rates for any selected ROI locale; nothing can be archived.',
      );
    }
    const validPlan = archivePlan?.version === 1
      && Array.isArray(archivePlan.vendors)
      && archiveVendors.every((vendor) => archivePlan.vendors.some((entry) => (
        entry.vendor === vendor && entry.payload
      )));
    if (!validPlan) {
      const existingPlan = archivePlan?.version === 1 ? archivePlan : null;
      const baseRunId = existingPlan?.baseRunId || createRoiArchiveRunId();
      const startedAt = existingPlan?.startedAt || new Date().toISOString();
      const existingByVendor = new Map((existingPlan?.vendors || []).map((entry) => [entry.vendor, entry]));
      archivePlan = {
        version: 1,
        baseRunId,
        startedAt,
        vendors: archiveVendors.map((vendor, index) => {
          const vendorResult = vendorRoiResults[vendor];
          if (!vendorResult) throw new Error(`ROI result missing for ${vendor}`);
          const existingEntry = existingByVendor.get(vendor);
          const runId = existingEntry?.runId || `${baseRunId}-${vendor.toLowerCase()}`;
          return {
            vendor,
            runId,
            status: existingEntry?.status || 'pending',
            result: existingEntry?.result || null,
            lastError: existingEntry?.lastError || '',
            payload: buildRoiArchivePayload({
              runId,
              startedAt,
              vendor,
              sourceSegmentCount: extractedItems.length,
              projects: activeWorkflowContext?.projectIds || selectedProjectIds,
              summary: vendorResult.summary,
              scopeRuns: vendorResult.scopeRuns,
              reviewItems: processedItems,
              includeReviewItems: index === 0,
              operator: feishuUser.profile,
              displayScopeKey: activeDisplayScopeKey,
              requestedScopeCount: vendorResult.requestedScopeCount,
              unservedScopes: vendorResult.unservedScopes,
            }),
          };
        }),
      };
      activeWorkflowContext = { ...(activeWorkflowContext || {}), roiArchivePlan: archivePlan };
      // 必须在第一次外部写入前固定两个 Run ID 与 payload，失败重试才不会产生新 Run。
      await persistWorkflowSnapshot();
    }
    button.textContent = 'Writing ROI archive...';
    const archiveResults = [];
    for (const plan of archivePlan.vendors) {
      if (plan.status === 'complete' && plan.result) {
        archiveResults.push({ vendor: plan.vendor, runId: plan.runId, ...plan.result });
        continue;
      }
      let result;
      try {
        result = await writeRoiArchive({ config, payload: plan.payload });
      } catch (error) {
        plan.status = 'failed';
        plan.lastError = error instanceof Error ? error.message : String(error);
        await persistWorkflowSnapshot();
        const completed = archivePlan.vendors
          .filter((entry) => entry.status === 'complete')
          .map((entry) => entry.vendor);
        throw new Error(
          `ROI archive partial failure at ${plan.vendor}; completed vendors: ${completed.join(', ') || 'none'}. `
          + `Retry resumes the same Run IDs. ${plan.lastError}`,
        );
      }
      plan.status = 'complete';
      plan.result = result;
      plan.lastError = '';
      archiveResults.push({ vendor: plan.vendor, runId: plan.runId, ...result });
      await persistWorkflowSnapshot();
    }
    showRoiArchiveResult(true, {
      runId: archiveResults.map((result) => `${result.vendor}: ${result.runId}`).join(' · '),
      scopeRecordCount: archiveResults.reduce((total, result) => total + result.scopeRecordCount, 0),
      itemRecordCount: archiveResults.reduce((total, result) => total + result.itemRecordCount, 0),
      status: archiveResults.map((result) => `${result.vendor} ${result.status}`).join(', '),
    });
  } catch (error) {
    console.warn('ROI archive / Feishu authorization failed.', error);
    showRoiArchiveResult(false, error instanceof Error ? error.message : String(error));
  } finally {
    hideProgress();
    button.textContent = 'Write ROI archive';
    updateRoiArchiveButtonEnabled(
      processedItems.some((item) => item.review_status === 'confirmed')
        && Boolean(multilingualRoiSummary)
        && multilingualScopeRuns.length > 0,
    );
  }
}

// ===== UI 辅助 =====
async function resetState() {
  stopBrokerPolling();
  await clearWorkflowSnapshot();
  await clearBrokerRunSnapshot();
  extractedItems = [];
  processedItems = [];
  reviewFilter = 'all';
  userChoices = {};
  multilingualRoiSummary = null;
  multilingualScopeRuns = [];
  activeDisplayScopeKey = '';
  finalValidationAttempted = false;
  activeWorkflowContext = null;
  brokerRunCreateError = null;
  activeBrokerRun = null;
  document.getElementById('results').innerHTML = '';
  document.getElementById('review-filter').classList.add('hidden');
  renderMultilingualRoiSummary(null);
  document.getElementById('status').classList.add('hidden');
  document.getElementById('dest-preview').classList.add('hidden');
  updateRoiArchiveButtonEnabled(false);
  // BX5：清结果角标、回到主流程 tab
  updateResultsBadge(0);
  switchTab('main');
  syncWorkflowSteps();
}

function setDocTitle(title) {
  document.getElementById('doc-title').textContent = title || 'No Feishu doc detected';
}

/** 根据项目、工作表与运行结果同步四步工作流的当前步骤。 */
function syncWorkflowSteps() {
  const localeConfig = roiEnabled
    ? buildLocaleScopes({
      projects: accessibleProjects,
      projectIds: selectedProjectIds,
      selectedLocales: selectedRoiLocales || [],
    })
    : buildFastTmScope({ projects: accessibleProjects, projectIds: selectedProjectIds });
  const projectsReady = localeConfig.status === 'ready' && (!roiEnabled || Boolean(runVendor));
  let currentStep = projectsReady ? 2 : 1;
  if (projectsReady && activeSheetLayout?.confirmed === true) currentStep = 3;
  if (processedItems.length > 0) currentStep = 4;
  setStep(currentStep);
}

/** 渲染 1 项目、2 工作表、3 运行、4 审阅的真实步骤状态。 */
function setStep(n) {
  document.querySelectorAll('#workflow-steps .step').forEach((el) => {
    const step = Number(el.dataset.step);
    el.classList.toggle('active', step === n);
    el.classList.toggle('done', step < n);
    if (step === n) el.setAttribute('aria-current', 'step');
    else el.removeAttribute('aria-current');
  });
}

// ===== 打开时自动 health check =====
// 逐项探测：native host / 飞书 token / 电子表格可访问 / 目标可写（缺啥提示啥，可操作）
// 顶部摘要行（health-summary）默认收起，点开看每项详情。
async function runHealthCheck() {
  const el = document.getElementById('health');
  el.innerHTML = '';
  const summaryEl = document.getElementById('health-summary');
  summaryEl.textContent = 'Checking environment…';

  const rows = {
    nativeHost: row('Native Messaging Host', 'Checking...'),
    starlingCredentials: row('Starling credentials', 'Checking...'),
    feishuToken: row('Feishu user authorization', 'Checking...'),
    sheetAccess: row('Spreadsheet accessible', 'Checking...'),
    destination: row('Working spreadsheet', 'Checking...'),
  };
  Object.values(rows).forEach((r) => el.appendChild(r.el));

  const config = await loadConfig();
  let badCount = 0;
  const tally = (r, state, text) => { r.set(state, text); if (state === 'bad') badCount++; };

  // 1. native host
  const ping = await pingNativeHost({ cliPath: config.starlingCliPath });
  if (ping?.pong) {
    tally(rows.nativeHost, 'ok', 'Available');
  } else {
    tally(rows.nativeHost, 'bad', 'Unavailable — run the installer command (or native-host/install.sh) and reload the extension');
  }

  if (config.starlingAccessKey && config.starlingSecretKey) {
    tally(rows.starlingCredentials, 'ok', 'Configured in Settings');
  } else {
    tally(rows.starlingCredentials, 'bad', 'Not configured — open Settings and use Save & Verify');
    document.getElementById('run-config-details').open = true;
  }

  // 2. 飞书用户授权
  let feishuAuthorized = false;
  try {
    feishuAuthorized = (await getFeishuUserAuthorizationStatus()).connected;
  } catch (_error) {
    feishuAuthorized = false;
  }
  if (!feishuAuthorized) {
    tally(rows.feishuToken, 'bad', 'Not authorized — click Authorize above');
  } else {
    tally(rows.feishuToken, 'ok', 'Current Feishu user authorized');
  }

  // 3. 电子表格 token + 可访问性
  const parsed = parseSheetsUrl(config.sheetsUrl || config.spreadsheetToken);
  const token = config.spreadsheetToken || parsed?.spreadsheetToken;
  if (!token) {
    tally(rows.sheetAccess, 'bad', 'No working spreadsheet — open the source Spreadsheet page for automatic detection');
    tally(rows.destination, 'bad', 'No working spreadsheet — choose a different spreadsheet in Step 2 if needed');
    summaryEl.textContent = `⚠️ ${badCount} item(s) not ready (click to expand)`;
    document.getElementById('health-details').open = true;
    document.getElementById('working-sheet-details').open = true;
    return;
  }
  if (feishuAuthorized) {
    const res = workingSheets.length > 0
      ? { ok: true }
      : await testSheetsConnection(config, token);
    if (res.ok) {
      tally(rows.sheetAccess, 'ok', 'Accessible');
    } else {
      tally(rows.sheetAccess, 'bad', `No permission — ${res.error} (check your sheet access and the app's sheets:spreadsheet permission)`);
      document.getElementById('working-sheet-details').open = true;
      document.getElementById('working-sheet-summary').textContent =
        '2. Spreadsheet · no view permission';
    }
  } else {
    tally(rows.sheetAccess, 'bad', 'Authorize your Feishu account above before verifying access');
  }

  // 4. 当前 Sheet 与布局
  if (config.sheetId && config.sheetLayout?.confirmed === true) {
    const output = getOutputColumns(config.sheetLayout.outputStartColumn);
    tally(
      rows.destination,
      'ok',
      `Sheet ${config.sheetId}: reads ${config.sheetLayout.sourceColumn}${config.sheetLayout.dataStartRow}:${config.sheetLayout.sourceColumn}; writes ${config.sheetLayout.outputStartColumn}${config.sheetLayout.headerRow}:${output.cdReview}`,
    );
  } else {
    tally(rows.destination, 'bad', 'Select a Sheet and confirm its source/output layout');
    document.getElementById('working-sheet-details').open = true;
  }

  summaryEl.textContent = badCount === 0 ? '✅ Environment ready' : `⚠️ ${badCount} item(s) not ready (click to expand)`;
  document.getElementById('health-details').open = badCount > 0;
}

function row(label, detail) {
  const el = document.createElement('div');
  el.className = 'health-row checking';
  el.innerHTML = `<span class="health-dot"></span>
    <span class="health-label">${label}</span>
    <span class="health-detail"></span>`;
  const detailEl = el.querySelector('.health-detail');
  detailEl.textContent = detail;
  return {
    el,
    set(state, text) {
      el.classList.remove('checking');
      el.classList.add(state);
      detailEl.textContent = text;
    },
  };
}

// ===== 写入前目标预览 =====
// 展示「将写入到：表格 token / sheet / 行范围 或 N 条」，写入前让用户确认目标。
function renderDestPreview(items, config) {
  const el = document.getElementById('dest-preview');
  const parsed = parseFeishuUrl(config.sheetsUrl || config.spreadsheetToken);
  const token = parsed?.spreadsheetToken || config.spreadsheetToken;
  const sheetId = config.sheetId || parsed?.sheetId || '(default first sheet)';
  if (!token) {
    el.classList.add('hidden');
    return;
  }

  // 行范围：若 items 带 row 字段，显示 min-max；否则显示条数（doc 抓取来源无行号）
  const rows = items.map((i) => i.row).filter((r) => r != null);
  let loc;
  if (rows.length) {
    const min = Math.min(...rows), max = Math.max(...rows);
    loc = rows.length > 1 ? `rows ${min}-${max}` : `row ${min}`;
  } else {
    loc = `${items.length} item(s)`;
  }

  const typeLabel = parsed?.type === 'bitable' ? 'Bitable' : 'Spreadsheet (Sheet)';
  el.classList.remove('hidden');
  el.innerHTML = `<span class="dest-label">Will write to:</span>
    <span class="dest-target">${typeLabel} / ${token} / ${sheetId} / ${loc}</span>`;
}


function showProgress(text, percent = 0) {
  const el = document.getElementById('progress');
  el.classList.remove('hidden');
  document.getElementById('progress-text').textContent = text;
  document.getElementById('progress-fill').style.width = `${percent}%`;
}
function hideProgress() {
  document.getElementById('progress').classList.add('hidden');
}

function showStatus(text, type = '') {
  const el = document.getElementById('status');
  el.textContent = text;
  el.className = `status ${type}`;
}

// 可操作错误：把原始 error 映射成「问题 + 下一步」展示（LOOP_SPEC §6.3）
function showError(err) {
  const fe = friendlyError(err, uiLanguage);
  const el = document.getElementById('status');
  // 必须显示原始错误（fe.raw），否则 friendlyError 的宽匹配会吞掉诊断信息，
  // 用户只看到通用标题（如「未设置写入目标」），看不到真正的根因/诊断 JSON。
  el.innerHTML = `<strong>${escapeHtml(fe.title)}</strong><br>` +
    `<span class="status-action">${escapeHtml(fe.action)}</span>` +
    `<details><summary>Raw error</summary><pre style="white-space:pre-wrap;font-size:11px;">${escapeHtml(fe.raw)}</pre></details>`;
  el.className = 'status error';
}

function updateSelectedCount() {
  const confirmedCount = processedItems.filter(
    (item) => (item.review_status || item.review?.status) === 'confirmed',
  ).length;
  const txt = t('confirmedCount', uiLanguage, {
    confirmed: confirmedCount,
    total: processedItems.length,
  });
  const a = document.getElementById('selected-count');
  const b = document.getElementById('selected-count-results');
  if (a) a.textContent = txt;
  if (b) b.textContent = txt;
  updateBulkReviewButton();
}

/** 同步批量确认按钮的剩余数量与可用状态。 */
function updateBulkReviewButton() {
  const button = document.getElementById('btn-confirm-remaining');
  if (!button) return;
  const remaining = processedItems.filter(
    (item) => (item.review_status || item.review?.status) !== 'confirmed',
  ).length;
  button.disabled = remaining === 0;
  button.textContent = t('confirmRemaining', uiLanguage, { remaining });
}

function detailSection(title, body, small = '') {
  return `<div class="detail-section">
    <h4>${title}</h4>
    <p>${body || '—'}</p>
    ${small ? `<small>${small}</small>` : ''}
  </div>`;
}


function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function truncate(s, n) {
  return s && s.length > n ? s.slice(0, n) + '…' : s;
}
