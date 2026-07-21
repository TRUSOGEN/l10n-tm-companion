/**
 * popup.js — Chrome Side Panel 工作台逻辑
 *
 * TM 优化流程：抓取 → Starling TM 查询(Orig Match %) → 判断是否达标(Reached 85%?)
 *           → 未达标则 AI 改写原文(Rewritten Segment) → 本地计算 New Match %
 *           → AI vs TM 对比(Comment) → 渲染卡片 → 写入飞书表格
 */

import {
  listProjects,
  pingNativeHost,
  queryFinalTmSnapshots,
  queryPostRewriteTmSnapshots,
  searchTM,
} from './lib/starling-tm.js';
import { rewriteSourceWithAI } from './lib/ai-translate.js';
import { compareAIvsTM } from './lib/diff.js';
import { TM_MATCH_THRESHOLD } from './lib/tm-threshold.js';
import {
  writeToSheet,
  listSourceSegments,
  listFinalSourceSegments,
  listSpreadsheetSheets,
  inspectSheetLayout,
  testSheetsConnection,
  parseSheetsUrl,
  parseFeishuUrl,
} from './lib/feishu-sheets.js';
import { friendlyError } from './lib/errors.js';
import {
  buildFastTmScope,
  buildLocaleScopes,
  normalizeProject,
  targetLocaleIntersection,
  toggleProjectSelection,
  validateRunConfig,
} from './lib/run-config.js';
import { resolveWordRate } from './lib/pricing-rules.js';
import { calculateRoiForItem } from './lib/roi-calculation.js';
import { summarizeMultilingualRoi } from './lib/multilingual-roi.js';
import { runFinalLocaleScopes, runLocaleScopes } from './lib/multilingual-runner.js';
import { buildRoiArchivePayload, writeRoiArchive } from './lib/roi-bitable-archive.js';
import { applyI18n, normalizeUiLanguage, t } from './lib/i18n.js';
import {
  buildSourcePreview,
  getOutputColumns,
  sheetLayoutStorageKey,
  validateSheetLayout,
} from './lib/sheet-layout.js';

let extractedItems = [];
let processedItems = [];
let userChoices = {}; // itemId → 'ai' | 'tm' | 'manual'
let accessibleProjects = [];
let selectedProjectIds = [];
let selectedRoiLocales = null;
let runVendor = '';
let rateCatalog = null;
let activeRunConfig = null;
let multilingualRoiSummary = null;
let multilingualScopeRuns = [];
let activeDisplayScopeKey = '';
let finalValidationAttempted = false;
let activeWorkflowContext = null;
let localeFilterQuery = '';
let roiEnabled = false;
let fastTargetLocale = '';
let uiLanguage = 'en';
let workingSheets = [];
let activeSheetLayout = null;
let activeSheetInspectionRows = [];
const ROI_WORKFLOW_SNAPSHOT_KEY = 'roiWorkflowSnapshot';
const ROI_WORKFLOW_SNAPSHOT_VERSION = 1;
const ROI_WORKFLOW_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// ===== 配置加载 =====
async function loadConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      [
        'sheetsUrl', 'spreadsheetToken', 'sheetId', 'workingSheetMode', 'fieldMapping', 'sheetLayouts',
        'roiArchiveUrl',
        'feishuAppId', 'feishuAppSecret',
        'llmProvider', 'llmEndpoint', 'llmApiKey', 'llmModel',
        'starlingCliPath', 'starlingProjectId', 'starlingProjectIds',
        'starlingTmMode',
        'starlingAccessKey', 'starlingSecretKey', 'starlingCredentialState',
        'starlingProjectsCache', 'roiTargetLocales', 'roiLocalesByProject',
        'enableAI',
        'enableROI', 'tmTargetLocale', 'uiLanguage',
        'inspireTeamId', 'llmThinkingLevel',
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
document.getElementById('run-target-locale').addEventListener('change', async (event) => {
  fastTargetLocale = event.target.value;
  activeRunConfig = null;
  await persistRunConfiguration();
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

document.getElementById('btn-write-bitable').addEventListener('click', writeToFeishu);
document.getElementById('btn-write-results').addEventListener('click', writeToFeishu);
document.getElementById('btn-validate-final').addEventListener('click', validateFinalFromSheet);
document.getElementById('btn-write-roi-archive').addEventListener('click', writeCurrentRoiArchive);

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

// 打开 Popup 时先建立运行配置，再检测当前飞书电子表格。
initializePopup();

/** 初始化 Popup 的运行配置与工作表。 */
async function initializePopup() {
  await Promise.all([
    initializeRunConfiguration(),
    initializeWorkingSheet(),
  ]);
  await runHealthCheck();
  await restoreWorkflowSnapshot();
}

/**
 * 将当前 A/B/C 运行结果保存到扩展本机存储。
 *
 * Popup 关闭会销毁内存，快照使 CD 写回 Sheet 后可以重新打开 Popup 继续确认 C 或
 * 归档 ROI。快照不包含 Starling、飞书或 LLM 凭证，七天后失效；启动新运行时会删除。
 */
async function persistWorkflowSnapshot() {
  if (multilingualScopeRuns.length === 0) {
    await clearWorkflowSnapshot();
    return;
  }
  const config = await loadConfig();
  const workflowContext = activeWorkflowContext || {
    spreadsheetToken: config.spreadsheetToken || '',
    sheetId: config.sheetId || '',
    vendor: runVendor,
    projectIds: [...selectedProjectIds],
  };
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
  showStatus(
    finalValidationAttempted
      ? t('restoredArchive', uiLanguage)
      : t('restoredFinal', uiLanguage),
    'info',
  );
}

/** 加载费率快照、已保存选择和当前凭证可访问项目。 */
async function initializeRunConfiguration() {
  const config = await loadConfig();
  roiEnabled = config.enableROI === true;
  fastTargetLocale = String(config.tmTargetLocale || '');
  uiLanguage = applyI18n(document, normalizeUiLanguage(config.uiLanguage));
  document.getElementById('ui-language').value = uiLanguage;
  runVendor = config.vendor || '';
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
    const availableIds = new Set(accessibleProjects.map((project) => project.id));
    selectedProjectIds = selectedProjectIds.filter((id) => availableIds.has(id));
    reconcileRoiLocaleSelections();
    reconcileFastTargetLocale();
    activeRunConfig = null;
    await chrome.storage.local.set({
      starlingProjectsCache: accessibleProjects,
      starlingProjectIds: [...selectedProjectIds],
      ...(Array.isArray(selectedRoiLocales) ? { roiTargetLocales: selectedRoiLocales } : {}),
      tmTargetLocale: fastTargetLocale,
    });
    status.textContent = accessibleProjects.length
      ? `${accessibleProjects.length} accessible project(s). Select 1–10.`
      : 'No accessible Starling projects.';
    status.className = accessibleProjects.length ? 'run-status ok' : 'run-status error';
    setWorkflowActionsDisabled(accessibleProjects.length === 0);
  } catch (error) {
    accessibleProjects = [];
    selectedProjectIds = [];
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

/** 保留仍被全部所选项目支持的快速目标语言，否则选择共同语言中的第一个。 */
function reconcileFastTargetLocale() {
  const commonLocales = targetLocaleIntersection(selectedProjects());
  if (!commonLocales.includes(fastTargetLocale)) fastTargetLocale = commonLocales[0] || '';
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
  if (!rateCatalog || !runVendor) return commonLocales;
  return commonLocales.filter((targetLocale) => projects.every((project) => resolveWordRate(rateCatalog, {
    vendor: runVendor,
    sourceLang: project.sourceLocale,
    targetLang: targetLocale,
  }).status === 'ready'));
}

/** 清理过期语言，并在首次进入或切换 vendor 时默认勾选全部共同可计费语言。 */
function reconcileRoiLocaleSelections({ resetToEligible = false } = {}) {
  if (!selectedProjectIds.length) return;
  const eligibleLocales = eligibleSharedTargetLocales();
  selectedRoiLocales = resetToEligible || !Array.isArray(selectedRoiLocales)
    ? eligibleLocales
    : [...new Set(selectedRoiLocales.filter((locale) => eligibleLocales.includes(locale)))];
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
  reconcileFastTargetLocale();
  activeRunConfig = null;
  await persistRunConfiguration();
  renderRunConfiguration();
}

/** 将 Popup 的 vendor、项目和语言覆盖范围作为单次运行配置即时保存。 */
async function persistRunConfiguration() {
  await chrome.storage.local.set({
    vendor: runVendor,
    enableROI: roiEnabled,
    tmTargetLocale: fastTargetLocale,
    starlingProjectIds: [...selectedProjectIds],
    starlingProjectId: selectedProjectIds[0] || '',
    targetLocale: fastTargetLocale,
    roiTargetLocales: selectedRoiLocales || [],
  });
}

/** 渲染项目卡、共享语言覆盖、费率状态与折叠摘要。 */
function renderRunConfiguration() {
  document.getElementById('enable-roi').checked = roiEnabled;
  document.getElementById('roi-config').classList.toggle('hidden', !roiEnabled);
  document.getElementById('roi-language-details').classList.toggle('hidden', !roiEnabled);
  ['btn-validate-final', 'btn-write-roi-archive'].forEach((id) => {
    document.getElementById(id).classList.toggle('hidden', !roiEnabled);
  });
  document.getElementById('run-vendor').value = runVendor;
  const cards = document.getElementById('run-project-cards');
  cards.innerHTML = '';
  accessibleProjects.forEach((project) => {
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
  document.getElementById('run-project-count').textContent = `${selectedProjectIds.length}/10`;

  renderFastTargetLocale();
  if (roiEnabled) {
    renderLanguageCoverage();
    renderPricingStatus();
  }

  const localeConfig = roiEnabled
    ? buildLocaleScopes({ projects: accessibleProjects, projectIds: selectedProjectIds, selectedLocales: selectedRoiLocales || [] })
    : buildFastTmScope({ projects: accessibleProjects, projectIds: selectedProjectIds, targetLocale: fastTargetLocale });
  const ready = localeConfig.status === 'ready' && (!roiEnabled || runVendor);
  document.getElementById('run-config-summary').textContent = ready
    ? roiEnabled
      ? `${runVendor} · ${localeConfig.sourceLocale} · ${localeConfig.scopes.length} ROI scopes · ${selectedProjectIds.length} ${selectedProjectIds.length === 1 ? 'project' : 'projects'}`
      : `Fast TM · ${localeConfig.sourceLocale}→${fastTargetLocale} · ${selectedProjectIds.length} ${selectedProjectIds.length === 1 ? 'project' : 'projects'}`
    : 'Run configuration · setup required';
}

/** 渲染全部所选项目共同支持的快速 TM 目标语言。 */
function renderFastTargetLocale() {
  const select = document.getElementById('run-target-locale');
  const commonLocales = targetLocaleIntersection(selectedProjects());
  select.innerHTML = '';
  if (!commonLocales.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = selectedProjectIds.length ? 'No common target language' : 'Select projects first';
    select.appendChild(option);
    select.disabled = true;
    fastTargetLocale = '';
    return;
  }
  select.disabled = false;
  commonLocales.forEach((locale) => {
    const option = document.createElement('option');
    option.value = locale;
    option.textContent = locale;
    select.appendChild(option);
  });
  if (!commonLocales.includes(fastTargetLocale)) fastTargetLocale = commonLocales[0];
  select.value = fastTargetLocale;
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
    ? validateRunConfig({
      vendor: runVendor,
      projects: accessibleProjects,
      projectIds: selectedProjectIds,
      selectedLocales: selectedRoiLocales || [],
    })
    : buildFastTmScope({
      projects: accessibleProjects,
      projectIds: selectedProjectIds,
      targetLocale: fastTargetLocale,
    });
  if (result.status !== 'ready') {
    const messages = {
      project_required: 'Select at least one project.',
      vendor_required: 'Select one of the four vendors.',
      locale_scope_required: 'Select at least one ROI coverage language.',
      no_common_target_locale: 'All selected projects must share at least one priced target language for ROI.',
      target_locale_required: 'Select one fast TM target language.',
      target_locale_unavailable: 'All selected projects must support the fast TM target language.',
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
  if (roiEnabled && fastTargetLocale) {
    result.scopes.sort((left, right) => {
      const leftPrimary = left.targetLocale === fastTargetLocale ? 0 : 1;
      const rightPrimary = right.targetLocale === fastTargetLocale ? 0 : 1;
      return leftPrimary - rightPrimary;
    });
  }
  activeRunConfig = {
    ...result,
    roiEnabled,
    vendor: roiEnabled ? runVendor : '',
    accessKey: config.starlingAccessKey,
    secretKey: config.starlingSecretKey,
  };
  return activeRunConfig;
}

// === 一次性配置迁移（2026-06-26 真机根因修复）===
// 实测发现用户 storage 里的 spreadsheetToken 曾指向空表 Tjyfs3...(615 行 A 列全空)，
// 导致 listSourceSegments 读 A2:A 全空 → 永远报「未读到原文」。
// 真正的原文表是 wiki 链接 QmG4w6... 背后的电子表格（A 列 39 条原文）。
// 这里仅在当前页无法自动识别工作表时执行旧配置修复。

async function migrateWrongSheetToken() {
  const cfg = await loadConfig();
  const current = cfg.spreadsheetToken || '';
  // 已知错误空表 token（A 列全空）：自动切到正确的原文表
  const WRONG_TOKEN = 'Tjyfs3Tg5hYG6btMTiom3UA3yYd';
  const CORRECT_URL = 'https://bytedance.larkoffice.com/wiki/QmG4w6EVIitUAlkT259clYFCndf';
  if (current !== WRONG_TOKEN) return null;
  const parsed = parseFeishuUrl(CORRECT_URL);
  await new Promise((r) => {
    chrome.storage.local.set({
      sheetsUrl: CORRECT_URL,
      spreadsheetToken: parsed.spreadsheetToken,
      sheetId: '',
      workingSheetMode: 'auto',
    }, r);
  });
  return parsed;
}

/**
 * 初始化工作表选择。
 *
 * 自动模式优先使用当前标签页的 Sheet/wiki 表；手动模式保留用户明确选择的表。
 */
async function initializeWorkingSheet() {
  const config = await loadConfig();
  const detection = await detectCurrentWorkingSheet();
  let migrated = null;
  if (config.workingSheetMode !== 'manual') {
    if (detection.type === 'sheet') {
      await saveWorkingSheet(detection.url, detection.parsed, 'auto');
    } else {
      migrated = await migrateWrongSheetToken();
    }
  }
  await loadDestIntoInput();
  await renderWorkingSheetGuidance(detection, migrated);
  await refreshWorkingSheetContext();
  if (migrated) {
    showStatus(
      '⚠️ Replaced a legacy empty sheet with the verified source sheet. Open that sheet page to use automatic detection.',
      'info'
    );
  }
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
  if (parsed?.type === 'sheet' && parsed.spreadsheetToken) {
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
    ? `② Working spreadsheet · ✓ ${selectedSheet.title} ready`
    : `② Working spreadsheet · ${selectedSheet.title} layout confirmation required`;
  document.getElementById('working-sheet-details').open = !confirmed;
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
 * @param {object|null} migrated 旧配置迁移结果。
 */
async function renderWorkingSheetGuidance(detection, migrated) {
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
    summary.textContent = `② Working spreadsheet · ✓ Sheet ${shortSheet} ready`;
    details.open = false;
    return;
  }
  if (detection.type === 'sheet') {
    help.textContent = 'Using the current Feishu spreadsheet automatically. Select a Sheet and confirm its source and output ranges below.';
    override.open = false;
    summary.textContent = `② Working spreadsheet · ✓ Sheet ${shortSheet} ready`;
    details.open = false;
    return;
  }
  if (detection.type === 'bitable') {
    help.textContent = 'The current page is a Bitable. This workflow needs a Spreadsheet or wiki-backed sheet, so choose one below.';
    override.open = true;
    summary.textContent = '② Working spreadsheet · Spreadsheet required';
    details.open = true;
    return;
  }
  if (migrated || configured?.type === 'sheet') {
    help.textContent = 'The current page is not a spreadsheet. Using the saved working spreadsheet; open a Spreadsheet page to switch automatically.';
    summary.textContent = `② Working spreadsheet · ✓ Sheet ${shortSheet} ready`;
    details.open = false;
    return;
  }
  help.textContent = 'No spreadsheet detected on this page. Choose a Spreadsheet below, then confirm its Sheet and ranges.';
  override.open = true;
  summary.textContent = '② Working spreadsheet · setup required';
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
  await saveWorkingSheet(detection.url, detection.parsed, 'auto');
  await loadDestIntoInput();
  await renderWorkingSheetGuidance(detection, null);
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
  const parsed = parseFeishuUrl(raw);
  if (!parsed) {
    summaryEl.classList.remove('hidden');
    summaryEl.className = 'dest-summary dest-missing';
    summaryEl.textContent = 'Cannot recognize this link. Paste a Feishu Spreadsheet or wiki-backed sheet link.';
    updateWriteButtonsEnabled(false);
    return;
  }
  if (parsed.type !== 'sheet') {
    summaryEl.classList.remove('hidden');
    summaryEl.className = 'dest-summary dest-missing';
    summaryEl.textContent = 'Bitable is not supported for this workflow. Paste a Spreadsheet or wiki-backed sheet link.';
    updateWriteButtonsEnabled(false);
    return;
  }
  await saveWorkingSheet(raw, parsed, 'manual');
  const cfg = await loadConfig();
  renderDestSummary(cfg);
  await renderWorkingSheetGuidance({ type: 'other', url: '' }, null);
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
  const token = parsed.spreadsheetToken || parsed.appToken || '';
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
 * 读到后走 processItems（TM → AI 改写 → New Match → 写回）。
 */
async function readFromSheet() {
  if (!await ensureWorkflowReady()) return;
  await resetState();
  setStep(1);
  // 表格读路径不依赖页面 DOM 标题，明确告诉用户数据来源，避免「未检测到飞书文档」误导
  setDocTitle('Data source: configured Spreadsheet source column (independent of current page DOM)');
  showProgress('Reading source from the configured spreadsheet range...', 10);
  try {
    let config = await loadConfig();
    // 兜底：用户正在手动 override 时，允许直接用输入框里的 URL 解析。
    if (!config.spreadsheetToken) {
      const inputUrl = (document.getElementById('dest-url').value || '').trim();
      const parsed = parseFeishuUrl(inputUrl);
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
  setStep(1);
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
  const scopeRuns = await runLocaleScopes({
    scopes: runConfig.scopes,
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
            onAiProgress: ({ item, provider }) => showProgress(
              `${provider === 'inspire' ? 'Inspire Writer' : 'AI'} rewriting ${item.location || item.id || 'source'}…`,
              55,
            ),
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
        ai_task_id: sharedRewriteDecisions[index]?.ai_task_id,
        ai_duration_ms: sharedRewriteDecisions[index]?.ai_duration_ms,
      }));
    },
    queryPostRewriteTm: (scopeItems, scope) => queryPostRewriteTmSnapshots(
      scopeItems, scope.sourceLocale, scope.targetLocale, { ...tmOpts, projectIds: projectIdsForScope(scope) },
    ),
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
    vendor: roiEnabled ? runVendor : '',
    roiEnabled,
    projectIds: [...selectedProjectIds],
  };
  processedItems = buildProcessedDisplayItems(scopeRuns);

  hideProgress();
  setStep(4);
  renderResults(processedItems);
  renderDestPreview(processedItems, config);
  await persistWorkflowSnapshot();
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
    return compareAIvsTM({
      ...item,
      new_match: item.post_rewrite_tm?.status === 'complete'
        ? item.post_rewrite_tm.score
        : (item.reached_threshold ? item.similarity : 0),
      scopeResults,
    });
  }).sort(compareItemsByCurrentTmScore);
}

/**
 * 结果优先按当前阶段可用的真实 TM 分数升序排列。
 *
 * C 是 CD 确认后的最终版本，因此优先使用 Score C；未确认 C 时使用候选 B 的真实
 * Score B；两者均不可用时回退到原文 Score A。查询未完成的条目保留在列表最后，
 * 不能被当作最低分处理。
 */
function compareItemsByCurrentTmScore(left, right) {
  const leftScore = currentTmScore(left);
  const rightScore = currentTmScore(right);
  if (leftScore !== rightScore) return leftScore - rightScore;
  return (left.row || Number.MAX_SAFE_INTEGER) - (right.row || Number.MAX_SAFE_INTEGER);
}

/** 返回结果卡片当前阶段最可信的真实 TM 分数，缺失时返回 Infinity。 */
function currentTmScore(item) {
  const finalScore = item?.final_tm?.status === 'complete' ? item.final_tm.score : null;
  const postRewriteScore = item?.post_rewrite_tm?.status === 'complete' ? item.post_rewrite_tm.score : null;
  const scores = [finalScore, postRewriteScore, item?.similarity];
  return scores.find(Number.isFinite) ?? Infinity;
}

// ===== 渲染结果卡片 =====
function renderResults(items) {
  const container = document.getElementById('results');
  container.innerHTML = '';
  renderMultilingualRoiSummary(multilingualRoiSummary);
  if (items.length === 0) {
    container.innerHTML = '<div class="empty-hint">No results</div>';
    return;
  }

  // 默认全部采纳 AI
  items.forEach((item) => {
    if (userChoices[item.id]) return;
    if (item.ai_vs_tm?.status === 'same') {
      userChoices[item.id] = 'tm';
    } else if (item.ai_translation) {
      userChoices[item.id] = 'ai';
    } else if (item.tm_match) {
      userChoices[item.id] = 'tm';
    }
  });

  items.forEach((item) => container.appendChild(renderCard(item)));
  applyI18n(document, uiLanguage);
  updateSelectedCount();
  // BX5：更新结果 tab 角标 + 自动切到结果 tab（处理完成后）
  updateResultsBadge(items.length);
  switchTab('results');
  // BX3/BX5：写回按钮启用 = 有结果 且 目标可写（两个 tab 的按钮都同步）
  (async () => {
    const cfg = await loadConfig();
    const parsed = parseFeishuUrl(cfg.sheetsUrl || cfg.spreadsheetToken);
    updateWriteButtonsEnabled(
      items.length > 0 && Boolean(activeDisplayScopeKey)
      && destWritable(parsed) && cfg.sheetLayout?.confirmed === true,
    );
    updateRoiArchiveButtonEnabled(
      finalValidationAttempted
        && Boolean(multilingualRoiSummary)
        && multilingualScopeRuns.length > 0
        && Boolean(cfg.roiArchiveUrl)
        && hasRoiArchiveAppCredentials(cfg),
    );
    const finalButton = document.getElementById('btn-validate-final');
    if (finalButton) finalButton.disabled = !destWritable(parsed) || multilingualScopeRuns.length === 0;
    renderDestSummary(cfg);
  })();
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

  const choice = userChoices[item.id] || 'ai';
  const tmSource = item.tm_source || item.tm_match || '';
  // similarity 已是 0-100 百分制（starling score），不要再 ×100
  const sim = item.similarity ? Math.round(item.similarity) : 0;

  card.innerHTML = `
    <div class="card-summary">
      <span class="source-text" data-focus="${item.id}">"${escapeHtml(truncate(item.source_text, 60))}"</span>
      <div class="badges">
        ${tmSource ? `<span class="badge tm-badge">TM ${sim}%</span>` : ''}
        ${item.ai_translation ? `<span class="badge ai-badge">${t('aiRewrite', uiLanguage)}</span>` : ''}
        ${postRewriteTmBadge(item.post_rewrite_tm)}
        ${finalTmBadge(item.final_tm)}
      </div>
    </div>
    <div class="card-actions">
      <button class="btn-sm btn-ai ${choice === 'ai' ? 'active' : ''}" data-choice="ai">${t('useAi', uiLanguage)}</button>
      <button class="btn-sm btn-tm ${choice === 'tm' ? 'active' : ''}" data-choice="tm">${t('useTm', uiLanguage)}</button>
      <button class="btn-sm btn-manual ${choice === 'manual' ? 'active' : ''}" data-choice="manual">${t('manual', uiLanguage)}</button>
      <button class="btn-sm btn-detail" aria-expanded="false">${t('detail', uiLanguage)}</button>
      <button class="btn-sm btn-focus">${t('focus', uiLanguage)}</button>
    </div>
    <div class="card-detail hidden">
      ${detailSection(t('sourceDetail', uiLanguage), escapeHtml(item.source_text))}
      ${tmSource ? detailSection(t('tmSource', uiLanguage), escapeHtml(tmSource), `Source: ${escapeHtml(item.origin || 'Unknown')}${item.tm_method ? ` · Method: ${escapeHtml(item.tm_method)}` : ''}`) : ''}
      ${item.tm_match && item.tm_match !== tmSource ? detailSection(t('tmTarget', uiLanguage), escapeHtml(item.tm_match)) : ''}
      ${item.ai_translation ? detailSection(t('aiRewrite', uiLanguage), escapeHtml(item.ai_translation), escapeHtml(item.reasoning || '')) : ''}
      ${renderAiCandidates(item.ai_candidates)}
      ${renderPostRewriteTmSnapshot(item.post_rewrite_tm)}
      ${renderFinalTmSnapshot(item.final_tm)}
      ${renderScopeResults(item.scopeResults)}
      ${renderComparison(item.ai_vs_tm)}
      ${choice === 'manual' ? `<textarea class="manual-input" placeholder="${escapeHtml(t('manualPlaceholder', uiLanguage))}">${escapeHtml(item.manual_translation || '')}</textarea>` : ''}
    </div>
  `;

  // 选项切换
  card.querySelectorAll('.btn-sm[data-choice]').forEach((btn) => {
    btn.addEventListener('click', () => setChoice(card, item, btn.dataset.choice));
  });

  // 放大查看（聚焦）+ 点原文也可进入
  const openFocus = () => openFocusView(item.id);
  card.querySelector('.btn-focus').addEventListener('click', openFocus);
  card.querySelector('[data-focus]').addEventListener('click', openFocus);

  // 详情展开
  card.querySelector('.btn-detail').addEventListener('click', (event) => {
    const detail = card.querySelector('.card-detail');
    const expanded = detail.classList.toggle('hidden') === false;
    event.currentTarget.setAttribute('aria-expanded', String(expanded));
    event.currentTarget.textContent = t(expanded ? 'hideDetail' : 'detail', uiLanguage);
  });

  // 手动输入
  const manualInput = card.querySelector('.manual-input');
  if (manualInput) {
    manualInput.addEventListener('input', () => {
      item.manual_translation = manualInput.value;
      void persistWorkflowSnapshot();
    });
  }

  return card;
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
function postRewriteTmBadge(snapshot) {
  if (snapshot?.status === 'complete') {
    return `<span class="badge tm-badge">Post-TM ${Math.round(snapshot.score)}%</span>`;
  }
  if (snapshot?.status === 'incomplete') {
    return '<span class="badge tm-badge">Post-TM incomplete</span>';
  }
  return '';
}

/** 渲染 CD 最终 C 的第三次真实 TM score。 */
function finalTmBadge(snapshot) {
  if (snapshot?.status === 'complete') return `<span class="badge tm-badge">Final TM ${Math.round(snapshot.score)}%</span>`;
  if (snapshot?.status === 'incomplete') return '<span class="badge tm-badge">Final TM incomplete</span>';
  return '';
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
  focusIndex = processedItems.findIndex((it) => it.id === itemId);
  if (focusIndex < 0) return;
  renderFocus();
  document.getElementById('focus-overlay').classList.remove('hidden');
}

function closeFocusView() {
  document.getElementById('focus-overlay').classList.add('hidden');
  focusIndex = -1;
}

function focusStep(delta) {
  const n = processedItems.length;
  if (n === 0) return;
  focusIndex = (focusIndex + delta + n) % n;
  renderFocus();
}

function renderFocus() {
  const item = processedItems[focusIndex];
  if (!item) return;
  const body = document.getElementById('focus-body');
  const choice = userChoices[item.id] || 'ai';
  const sim = item.similarity ? Math.round(item.similarity) : 0;
  const tmSource = item.tm_source || item.tm_match || '';
  const postRewriteTmDetail = renderPostRewriteTmSnapshot(item.post_rewrite_tm);

  document.getElementById('focus-pos').textContent = `${focusIndex + 1} / ${processedItems.length}`;
  body.innerHTML = `
    <div class="focus-section focus-source">
      <div class="focus-label">${t('sourceDetail', uiLanguage)}</div>
      <div class="focus-text">${escapeHtml(item.source_text)}</div>
    </div>
    <div class="focus-grid">
      <div class="focus-section focus-tm">
        <div class="focus-label">${t('tmSource', uiLanguage)} ${tmSource ? `<span class="focus-pct">Match ${sim}%</span>` : ''}</div>
        <div class="focus-text">${escapeHtml(tmSource || t('noTm', uiLanguage))}</div>
        ${item.origin ? `<div class="focus-meta">Source: ${escapeHtml(item.origin)}${item.tm_method ? ` · Method: ${escapeHtml(item.tm_method)}` : ''}</div>` : ''}
      </div>
      <div class="focus-section focus-ai">
        <div class="focus-label">${t('aiRewrite', uiLanguage)}</div>
        <div class="focus-text">${escapeHtml(item.ai_translation || '(No AI rewrite)')}</div>
        ${item.reasoning ? `<div class="focus-meta">${escapeHtml(item.reasoning)}</div>` : ''}
      </div>
    </div>
    ${item.tm_match && item.tm_match !== tmSource ? `<div class="focus-section"><div class="focus-label">${t('tmTarget', uiLanguage)}</div><div class="focus-text">${escapeHtml(item.tm_match)}</div></div>` : ''}
    ${item.ai_candidates?.length > 1 ? `<div class="focus-section">${renderAiCandidates(item.ai_candidates)}</div>` : ''}
    ${postRewriteTmDetail ? `<div class="focus-section">${postRewriteTmDetail}</div>` : ''}
    ${renderComparison(item.ai_vs_tm) ? `<div class="focus-section">${renderComparison(item.ai_vs_tm)}</div>` : ''}
    ${choice === 'manual' ? `<textarea class="manual-input focus-manual" placeholder="${escapeHtml(t('manualPlaceholder', uiLanguage))}">${escapeHtml(item.manual_translation || '')}</textarea>` : ''}
    <div class="focus-actions">
      <button class="btn-sm btn-ai ${choice === 'ai' ? 'active' : ''}" data-focus-choice="ai">${t('useAi', uiLanguage)}</button>
      <button class="btn-sm btn-tm ${choice === 'tm' ? 'active' : ''}" data-focus-choice="tm">${t('useTm', uiLanguage)}</button>
      <button class="btn-sm btn-manual ${choice === 'manual' ? 'active' : ''}" data-focus-choice="manual">${t('manual', uiLanguage)}</button>
    </div>
  `;

  // 聚焦视图内选择切换（同步回卡片状态）
  body.querySelectorAll('[data-focus-choice]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const c = btn.dataset.focusChoice;
      userChoices[item.id] = c;
      void persistWorkflowSnapshot();
      // 同步刷新对应卡片的 active 状态
      const cardEl = document.querySelector(`.result-card[data-id="${item.id}"]`);
      if (cardEl) {
        cardEl.querySelectorAll('.btn-sm[data-choice]').forEach((b) => {
          b.classList.toggle('active', b.dataset.choice === c);
        });
      }
      renderFocus();
    });
  });

  const manual = body.querySelector('.focus-manual');
  if (manual) {
    manual.addEventListener('input', () => {
      item.manual_translation = manual.value;
      void persistWorkflowSnapshot();
    });
  }
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

// ===== 写入飞书 =====
async function writeToFeishu() {
  const config = await loadConfig();
  if (!activeDisplayScopeKey) {
    showStatus('No complete language scope is available for Sheet write-back.', 'error');
    return;
  }
  // BX3：未填写输出目标时禁止写回
  const parsed = parseFeishuUrl(config.sheetsUrl || config.spreadsheetToken);
  if (!destWritable(parsed)) {
    renderDestSummary(config);
    const reason = parsed?.type === 'bitable'
      ? 'The current working sheet is a Bitable, which does not support write-back. Use a Spreadsheet (/sheets/) link.'
      : 'No working sheet set. Open the source Spreadsheet page, or choose a different spreadsheet in Step 2.';
    showStatus(reason, 'error');
    return;
  }
  if (!config.sheetId || config.sheetLayout?.confirmed !== true) {
    document.getElementById('working-sheet-details').open = true;
    showStatus('Confirm the active Sheet layout before writing results.', 'error');
    return;
  }

  const itemsToWrite = processedItems.map((item) => {
    const choice = userChoices[item.id] || 'ai';
    if (choice === 'tm') {
      item.final_translation = item.tm_match || '';
    } else if (choice === 'manual') {
      item.final_translation = item.manual_translation || '';
    } else {
      item.final_translation = item.ai_translation || '';
    }
    return item;
  });

  // BX5：写回是主流程动作，切回主流程 tab 看摘要
  switchTab('main');
  setStep(5);
  renderDestSummary(config); // 写回前展示目标摘要
  setWriteButtonsState(true, 'Writing...');
  try {
    await writeToSheet(itemsToWrite, config);
    showWriteResult(itemsToWrite, config, true);
  } catch (e) {
    showWriteResult(itemsToWrite, config, false, e.message);
  } finally {
    setWriteButtonsState(false, 'Write back to sheet');
  }
}

/**
 * 从 Spreadsheet 读取 CD 确认的 C，执行第三次 Starling TM，并生成正式 A−C ROI。
 *
 * D 列只有在同一行 G 列为 Yes 时才被视为最终 C；未确认行保留为 incomplete，
 * 以便 Bitable 清楚呈现缺口，而不是用 B 的结果替代。
 */
async function validateFinalFromSheet() {
  const config = await loadConfig();
  if (!roiEnabled) {
    showStatus('ROI mode is off. Turn it on before confirming final C for pricing.', 'error');
    return;
  }
  if (multilingualScopeRuns.length === 0) {
    showStatus(t('finalNeedsAb', uiLanguage), 'error');
    return;
  }
  const parsed = parseFeishuUrl(config.sheetsUrl || config.spreadsheetToken);
  if (!destWritable(parsed)) {
    showStatus(t('finalNeedsSheet', uiLanguage), 'error');
    return;
  }
  if (!config.sheetId || config.sheetLayout?.confirmed !== true) {
    document.getElementById('working-sheet-details').open = true;
    showStatus('Confirm the active Sheet layout before reading final C.', 'error');
    return;
  }
  const runConfig = activeRunConfig || await ensureWorkflowReady();
  if (!runConfig) return;

  const button = document.getElementById('btn-validate-final');
  button.disabled = true;
  button.textContent = t('finalReadingButton', uiLanguage);
  showProgress(t('finalReadingProgress', uiLanguage), 30);
  try {
    const finalRows = await listFinalSourceSegments(config);
    const confirmedCount = finalRows.filter((item) => item.final_source_text).length;
    if (confirmedCount === 0) {
      throw new Error(t('finalNone', uiLanguage));
    }
    const finalByRow = new Map(finalRows.map((item) => [item.row, item.final_source_text]));
    const tmOpts = {
      cliPath: config.starlingCliPath,
      tmMode: config.starlingTmMode === 'legacy_cli' ? 'legacy' : 'batch',
      usePpe: config.starlingTmMode !== 'legacy_cli',
      accessKey: runConfig.accessKey,
      secretKey: runConfig.secretKey,
    };
    const finalRuns = await runFinalLocaleScopes({
      scopeRuns: multilingualScopeRuns,
      finalSourceForItem: (item) => finalByRow.get(item.row) || '',
      queryFinalTm: (scopeItems, scope) => queryFinalTmSnapshots(
        scopeItems,
        scope.sourceLocale,
        scope.targetLocale,
        { ...tmOpts, projectIds: projectIdsForScope(scope) },
      ),
      calculateRoi: calculateRoiForItem,
      onProgress: (scope, scopeIndex, total) => showProgress(
        t('finalQueryProgress', uiLanguage, {
          projects: scope.projectName,
          locale: scope.targetLocale,
          current: scopeIndex + 1,
          total,
        }),
        35 + Math.round((scopeIndex / total) * 60),
      ),
    });
    multilingualScopeRuns = finalRuns;
    multilingualRoiSummary = summarizeMultilingualRoi(finalRuns);
    finalValidationAttempted = true;
    processedItems = buildProcessedDisplayItems(finalRuns);
    hideProgress();
    renderResults(processedItems);
    await persistWorkflowSnapshot();
    showStatus(
      t('finalComplete', uiLanguage, { count: confirmedCount }),
      '',
    );
  } catch (error) {
    hideProgress();
    finalValidationAttempted = false;
    showError(error instanceof Error ? error.message : String(error));
  } finally {
    button.textContent = t('finalButton', uiLanguage);
    const current = await loadConfig();
    const currentParsed = parseFeishuUrl(current.sheetsUrl || current.spreadsheetToken);
    button.disabled = !destWritable(currentParsed) || multilingualScopeRuns.length === 0;
  }
}

// BX5：同步两个写回按钮（主流程 tab + 结果 tab）的状态
function setWriteButtonsState(disabled, text) {
  ['btn-write-bitable', 'btn-write-results'].forEach((id) => {
    const b = document.getElementById(id);
    if (!b) return;
    b.disabled = disabled;
    b.textContent = text;
  });
}

/** 同步 ROI 归档按钮状态，归档不依赖当前单语言 Sheet 查看 scope。 */
function updateRoiArchiveButtonEnabled(enabled) {
  const button = document.getElementById('btn-write-roi-archive');
  if (button) button.disabled = !enabled;
}

/** 判断 Settings 是否已保存可用于 tenant token 的飞书应用凭证。 */
function hasFeishuAppCredentials(config) {
  return Boolean(
    typeof config?.feishuAppId === 'string' && config.feishuAppId.trim()
    && typeof config?.feishuAppSecret === 'string' && config.feishuAppSecret.trim(),
  );
}

/** ROI archive 与 Spreadsheet 共用同一对 App ID / App Secret。 */
function hasRoiArchiveAppCredentials(config) {
  return hasFeishuAppCredentials(config);
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
      <span class="dest-target">Run ${escapeHtml(detail.runId)} · ${detail.scopeRecordCount} scope(s) · ${escapeHtml(detail.status)}</span>`;
    showStatus(`ROI archive written: ${detail.status}`, '');
    return;
  }
  preview.className = 'dest-preview dest-error';
  preview.innerHTML = `<span class="dest-label">ROI archive failed:</span>
    <span class="dest-target">${escapeHtml(detail)}</span>`;
  showError(detail);
}

/** 将当前整车 ROI 结果追加写入用户确认的 Bitable Run/Scope 归档表。 */
async function writeCurrentRoiArchive() {
  const config = await loadConfig();
  if (!roiEnabled) {
    showStatus('ROI mode is off. Turn it on before writing an ROI archive.', 'error');
    return;
  }
  if (!finalValidationAttempted || !multilingualRoiSummary || multilingualScopeRuns.length === 0) {
    showStatus(t('archiveNeedsFinal', uiLanguage), 'error');
    return;
  }
  if (!config.roiArchiveUrl) {
    showStatus('Configure ROI archive Bitable in Settings before writing.', 'error');
    return;
  }
  if (!hasRoiArchiveAppCredentials(config)) {
    showStatus('Configure Feishu App ID and App Secret in Settings before writing ROI archive.', 'error');
    return;
  }
  const runId = createRoiArchiveRunId();
  const payload = buildRoiArchivePayload({
    runId,
    startedAt: new Date().toISOString(),
    vendor: activeWorkflowContext?.vendor || runVendor,
    sourceSegmentCount: extractedItems.length,
    projects: activeWorkflowContext?.projectIds || selectedProjectIds,
    summary: multilingualRoiSummary,
    scopeRuns: multilingualScopeRuns,
  });
  const confirmed = window.confirm(
    `Write ROI archive to:\n${config.roiArchiveUrl}\n\n`
    + 'Tables: L10n ROI Runs and L10n ROI Scopes\n'
    + `Records: 1 Run and ${payload.scopes.length} Scope(s)`,
  );
  if (!confirmed) return;

  const button = document.getElementById('btn-write-roi-archive');
  button.disabled = true;
  button.textContent = 'Writing ROI archive...';
  try {
    const result = await writeRoiArchive({ config, payload });
    showRoiArchiveResult(true, { runId, ...result });
  } catch (error) {
    showRoiArchiveResult(false, error instanceof Error ? error.message : String(error));
  } finally {
    button.textContent = 'Write ROI archive';
    updateRoiArchiveButtonEnabled(
      finalValidationAttempted
        && Boolean(multilingualRoiSummary)
        && Boolean(config.roiArchiveUrl)
        && hasRoiArchiveAppCredentials(config),
    );
  }
}

// BX5：同步两个写回按钮的启用状态（有结果且目标可写）
function updateWriteButtonsEnabled(enabled) {
  ['btn-write-bitable', 'btn-write-results'].forEach((id) => {
    const b = document.getElementById(id);
    if (b) b.disabled = !enabled;
  });
}

// ===== 写入后结果展示（告诉用户写到了哪里）=====
function showWriteResult(items, config, ok, errMsg) {
  const el = document.getElementById('dest-preview');
  const parsed = parseFeishuUrl(config.sheetsUrl || config.spreadsheetToken);
  const token = parsed?.spreadsheetToken || config.spreadsheetToken;
  const sheetId = config.sheetId || parsed?.sheetId || '(default first sheet)';
  const rows = items.map((i) => i.row).filter((r) => r != null);
  let loc = rows.length
    ? (rows.length > 1 ? `rows ${Math.min(...rows)}-${Math.max(...rows)}` : `row ${rows[0]}`)
    : `${items.length} item(s)`;
  const typeLabel = parsed?.type === 'bitable' ? 'Bitable' : 'Spreadsheet (Sheet)';

  el.classList.remove('hidden');
  if (ok) {
    el.className = 'dest-preview';
    el.innerHTML = `<span class="dest-label">Written (${items.length} item(s)) to:</span>
      <span class="dest-target">${typeLabel} / ${token} / ${sheetId} / ${loc}</span>`;
    showStatus(`Write succeeded, ${items.length} item(s)`, '');
  } else {
    el.className = 'dest-preview dest-error';
    const fe = friendlyError(errMsg || 'Unknown error', uiLanguage);
    el.innerHTML = `<span class="dest-label">Write failed:</span>
      <span class="dest-target">${escapeHtml(fe.title)}</span>
      <span class="status-action">${escapeHtml(fe.action)}</span>`;
    showError(errMsg || 'Write failed');
  }
}

// ===== UI 辅助 =====
async function resetState() {
  await clearWorkflowSnapshot();
  extractedItems = [];
  processedItems = [];
  userChoices = {};
  multilingualRoiSummary = null;
  multilingualScopeRuns = [];
  activeDisplayScopeKey = '';
  finalValidationAttempted = false;
  activeWorkflowContext = null;
  document.getElementById('results').innerHTML = '';
  renderMultilingualRoiSummary(null);
  document.getElementById('status').classList.add('hidden');
  document.getElementById('dest-preview').classList.add('hidden');
  updateWriteButtonsEnabled(false);
  updateRoiArchiveButtonEnabled(false);
  const finalButton = document.getElementById('btn-validate-final');
  if (finalButton) finalButton.disabled = true;
  // BX5：清结果角标、回到主流程 tab
  updateResultsBadge(0);
  switchTab('main');
}

function setDocTitle(title) {
  document.getElementById('doc-title').textContent = title || 'No Feishu doc detected';
}

// 步骤指示器：1 选择来源 → 2 确认目标 → 3 查询 TM → 4 查看结果 → 5 写回
function setStep(n) {
  document.querySelectorAll('#steps .step').forEach((el) => {
    const step = Number(el.dataset.step);
    el.classList.toggle('active', step === n);
    el.classList.toggle('done', step < n);
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

  // 2. 飞书应用凭证
  if (!hasFeishuAppCredentials(config)) {
    tally(rows.feishuToken, 'bad', 'Not configured — open Settings and enter Feishu App ID and App Secret');
  } else {
    tally(rows.feishuToken, 'ok', 'App credentials configured');
  }

  // 3. 电子表格 token + 可访问性
  const parsed = parseSheetsUrl(config.sheetsUrl || config.spreadsheetToken);
  const token = parsed?.spreadsheetToken || config.spreadsheetToken;
  if (!token) {
    tally(rows.sheetAccess, 'bad', 'No working spreadsheet — open the source Spreadsheet page for automatic detection');
    tally(rows.destination, 'bad', 'No working spreadsheet — choose a different spreadsheet in Step 2 if needed');
    summaryEl.textContent = `⚠️ ${badCount} item(s) not ready (click to expand)`;
    document.getElementById('health-details').open = true;
    document.getElementById('working-sheet-details').open = true;
    return;
  }
  if (hasFeishuAppCredentials(config)) {
    const res = workingSheets.length > 0
      ? { ok: true }
      : await testSheetsConnection(config, token);
    if (res.ok) {
      tally(rows.sheetAccess, 'ok', 'Accessible');
    } else {
      tally(rows.sheetAccess, 'bad', `No permission — ${res.error} (check your sheet access and the app's sheets:spreadsheet permission)`);
      document.getElementById('working-sheet-details').open = true;
      document.getElementById('working-sheet-summary').textContent =
        '② Working spreadsheet · no view permission';
    }
  } else {
    tally(rows.sheetAccess, 'bad', 'Enter Feishu App ID and App Secret before verifying Spreadsheet access');
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
  const txt = `${t('selected', uiLanguage)} ${processedItems.length}/${processedItems.length}`;
  const a = document.getElementById('selected-count');
  const b = document.getElementById('selected-count-results');
  if (a) a.textContent = txt;
  if (b) b.textContent = txt;
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
