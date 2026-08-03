/**
 * options.js — 插件设置页逻辑。
 *
 * 该页面负责 Starling AK/SK 双份持久化、Native Host 健康检查、LLM 与飞书配置。
 * Vendor、项目和 target locale 属于单次运行配置，统一在 Popup 中选择。
 */

import {
  getStarlingCredentials,
  listProjects,
  pingNativeHost,
  saveStarlingCredentials,
} from './lib/starling-tm.js';
import { parseSheetsUrl } from './lib/feishu-sheets.js';
import {
  configureFeishuApplication,
  getFeishuCredentialStatus,
  getFeishuUserAuthorizationStatus,
} from './lib/feishu-auth.js';
import {
  INSPIRE_MODEL_OPTIONS,
  normalizeInspireModelId,
} from './lib/inspire-models.js';

const GENERAL_KEYS = [
  'starlingCliPath',
  'starlingTmMode',
  'llmProvider',
  'llmEndpoint',
  'llmApiKey',
  'llmModel',
  'llmCustomModel',
  'llmThinkingLevel',
  'enableAI',
];

const CREDENTIAL_KEYS = [
  'starlingAccessKey',
  'starlingSecretKey',
  'starlingCredentialsUpdatedAt',
  'starlingCredentialState',
];

const READ_KEYS = [
  ...GENERAL_KEYS,
  ...CREDENTIAL_KEYS,
  'sheetsUrl',
  'spreadsheetToken',
  'sheetId',
];

const LLM_PRESETS = {
  inspire: {
    llmEndpoint: 'https://inspire.bytedance.net/writer/api',
    llmModel: 'gemini_3f',
    llmThinkingLevel: 'low',
  },
  claude: {
    llmEndpoint: 'https://api.anthropic.com/v1/messages',
    llmModel: 'claude-sonnet-4-6',
  },
  deepseek: {
    llmEndpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    llmModel: 'deepseek-v4-flash-260425',
  },
  custom: {},
};
const LLM_DEFAULT_PROVIDER = 'inspire';
const LLM_MODELS = Object.freeze({
  inspire: INSPIRE_MODEL_OPTIONS,
  claude: [
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  ],
  deepseek: [
    { value: 'deepseek-v4-flash-260425', label: 'DeepSeek V4 Flash' },
  ],
});

/**
 * 从 Chrome storage 数据中读取可用的完整 Starling 凭证对。
 *
 * @param {object} data storage 查询结果。
 * @returns {{accessKey:string, secretKey:string}|null} 完整凭证或 null。
 */
export function credentialsFromStorage(data) {
  const accessKey = typeof data?.starlingAccessKey === 'string'
    ? data.starlingAccessKey
    : '';
  const secretKey = typeof data?.starlingSecretKey === 'string'
    ? data.starlingSecretKey
    : '';
  return accessKey && secretKey ? { accessKey, secretKey } : null;
}

/** 加载设置并按“Chrome 优先、Host 补全”规则回填完整 AK/SK。 */
async function load() {
  await chrome.storage.local.remove(['inspireTeamId', 'roiArchiveUrl']);
  const data = await chrome.storage.local.get(READ_KEYS);
  await chrome.storage.local.remove(['feishuAppId', 'feishuAppSecret']);
  const defaults = {
    starlingTmMode: 'batch_ppe',
    llmProvider: LLM_DEFAULT_PROVIDER,
    ...LLM_PRESETS[LLM_DEFAULT_PROVIDER],
  };
  const provider = data.llmProvider || LLM_DEFAULT_PROVIDER;
  if (provider === 'inspire' && data.llmModel) {
    const migratedModel = normalizeInspireModelId(data.llmModel);
    if (migratedModel !== data.llmModel) {
      data.llmModel = migratedModel;
      await chrome.storage.local.set({ llmModel: migratedModel });
    }
  }

  GENERAL_KEYS.forEach((key) => {
    const element = document.getElementById(key);
    if (!element) return;
    if (element.type === 'checkbox') {
      element.checked = data[key] === true;
    } else {
      element.value = data[key] || defaults[key] || '';
    }
  });

  renderProviderFields(data.llmModel || defaults.llmModel);
  applyProviderDefaults();
  renderWorkingSheetStatus(data);
  await renderFeishuUserStatus();
  await renderFeishuApplicationStatus();
  await loadCredentials(data);
}

/** 显示当前飞书 OAuth 用户资料和短期授权状态。 */
async function renderFeishuUserStatus() {
  const result = document.getElementById('feishu-test-result');
  const name = document.getElementById('feishu-user-name');
  const detail = document.getElementById('feishu-user-detail');
  const avatar = document.getElementById('feishu-user-avatar');
  try {
    const status = await getFeishuUserAuthorizationStatus();
    if (!status.connected) {
      name.textContent = status.profile?.name || status.profile?.enName || 'Not connected';
      detail.textContent = 'Authorize from the Workflow page to use Feishu access.';
      avatar.classList.add('hidden');
      result.textContent = 'Feishu authorization required.';
      result.className = 'test-result err';
      return;
    }
    name.textContent = status.profile?.name || status.profile?.enName || 'Connected Feishu user';
    detail.textContent = [status.profile?.enName, status.profile?.userId || status.profile?.openId]
      .filter(Boolean)
      .join(' · ');
    if (status.profile?.avatarUrl) {
      avatar.src = status.profile.avatarUrl;
      avatar.alt = `${name.textContent} avatar`;
      avatar.classList.remove('hidden');
    } else {
      avatar.classList.add('hidden');
    }
    result.textContent = `Authorized until ${new Date(status.expiresAt).toLocaleString()}.`;
    result.className = 'test-result ok';
  } catch (error) {
    result.textContent = error.message;
    result.className = 'test-result err';
  }
}

/** 显示本机 App Secret 的 Keychain 配置状态，并同步按钮动作名称。 */
async function renderFeishuApplicationStatus() {
  const result = document.getElementById('feishu-owner-result');
  const button = document.getElementById('configure-feishu-app');
  try {
    const status = await getFeishuCredentialStatus();
    result.textContent = status.configured
      ? 'Feishu App Secret is saved in macOS Keychain.'
      : 'Feishu App Secret has not been entered on this Mac.';
    result.className = status.configured ? 'test-result ok' : 'test-result err';
    button.textContent = status.configured ? 'Replace Feishu App Secret' : 'Enter Feishu App Secret';
  } catch (error) {
    result.textContent = error.message;
    result.className = 'test-result err';
  }
}

/** 按当前 provider 补齐未配置的 endpoint 与 model。 */
function applyProviderDefaults() {
  const provider = document.getElementById('llmProvider').value || LLM_DEFAULT_PROVIDER;
  const preset = LLM_PRESETS[provider] || {};
  const endpoint = document.getElementById('llmEndpoint');
  const thinking = document.getElementById('llmThinkingLevel');
  if (preset.llmEndpoint && !endpoint.value) endpoint.value = preset.llmEndpoint;
  if (preset.llmThinkingLevel && !thinking.value) thinking.value = preset.llmThinkingLevel;
}

/** 按 Provider 渲染受 OpenAPI 约束的模型列表，Custom Provider 保留高级手填入口。 */
function renderModelOptions(preferredValue = '') {
  const provider = document.getElementById('llmProvider').value || LLM_DEFAULT_PROVIDER;
  const selectField = document.getElementById('model-select-field');
  const customField = document.getElementById('custom-model-field');
  const select = document.getElementById('llmModel');
  const isCustom = provider === 'custom';
  selectField.classList.toggle('hidden', isCustom);
  customField.classList.toggle('hidden', !isCustom);
  if (isCustom) {
    const customInput = document.getElementById('llmCustomModel');
    if (!customInput.value && preferredValue) customInput.value = preferredValue;
    return;
  }
  const models = LLM_MODELS[provider] || [];
  select.innerHTML = '';
  models.forEach(({ value, label }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  });
  const fallback = LLM_PRESETS[provider]?.llmModel || models[0]?.value || '';
  select.value = models.some(({ value }) => value === preferredValue) ? preferredValue : fallback;
}

/** 将完整凭证写入两个 password input，默认仍保持遮挡。 */
function fillCredentialFields(credentials) {
  document.getElementById('starlingAccessKey').value = credentials?.accessKey || '';
  document.getElementById('starlingSecretKey').value = credentials?.secretKey || '';
}

/** 从 Chrome 副本加载；副本为空时从官方 Host 配置导入并补回 Chrome。 */
async function loadCredentials(data) {
  const result = document.getElementById('starling-credentials-result');
  const stored = credentialsFromStorage(data);
  if (stored) {
    fillCredentialFields(stored);
    result.textContent = data.starlingCredentialState === 'active'
      ? 'Credentials configured and verified.'
      : 'Credentials restored from Chrome. Click Save & Verify to activate them in the Native Host.';
    result.className = data.starlingCredentialState === 'active'
      ? 'test-result ok'
      : 'test-result err';
    return;
  }

  try {
    const cliPath = document.getElementById('starlingCliPath').value.trim();
    const host = await getStarlingCredentials(cliPath ? { cliPath } : {});
    if (!host.access_key || !host.secret_key) {
      result.textContent = 'No Starling credentials configured. Enter AK/SK and click Save & Verify.';
      result.className = 'test-result err';
      return;
    }
    const imported = { accessKey: host.access_key, secretKey: host.secret_key };
    fillCredentialFields(imported);
    await chrome.storage.local.set({
      starlingAccessKey: imported.accessKey,
      starlingSecretKey: imported.secretKey,
      starlingCredentialsUpdatedAt: new Date().toISOString(),
      starlingCredentialState: 'active',
    });
    result.textContent = 'Credentials imported from the Native Host and backed up in Chrome.';
    result.className = 'test-result ok';
  } catch (_error) {
    result.textContent = 'Setup required: enter AK/SK and click Save & Verify.';
    result.className = 'test-result err';
  }
}

/** 切换单个 AK/SK input 的 password/text 显示状态。 */
function toggleCredentialVisibility(button) {
  const input = document.getElementById(button.dataset.revealTarget);
  const revealing = input.type === 'password';
  input.type = revealing ? 'text' : 'password';
  button.querySelector('.reveal-label').textContent = revealing ? 'Hide' : 'Show';
  button.setAttribute('aria-label', `${revealing ? 'Hide' : 'Show'} ${input.id}`);
}

/**
 * 先写入官方 Host 配置并用项目接口验证，再保存 Chrome 完整副本。
 * Host 失败时仍保留 Chrome 恢复副本，但状态明确标为未激活。
 */
async function saveCredentials() {
  const result = document.getElementById('starling-credentials-result');
  const accessKey = document.getElementById('starlingAccessKey').value.trim();
  const secretKey = document.getElementById('starlingSecretKey').value.trim();
  const cliPath = document.getElementById('starlingCliPath').value.trim();
  if (!accessKey || !secretKey) {
    result.textContent = 'Both full AK and full SK are required.';
    result.className = 'test-result err';
    return;
  }

  result.textContent = 'Saving and verifying...';
  result.className = 'test-result';
  let hostSaved = false;
  try {
    await saveStarlingCredentials({ accessKey, secretKey, cliPath });
    hostSaved = true;
    const projects = await listProjects({ accessKey, secretKey, cliPath });
    if (!projects.ok || !Array.isArray(projects.projects)) {
      throw new Error(projects.error || 'Project permission verification failed');
    }
    await chrome.storage.local.set({
      starlingAccessKey: accessKey,
      starlingSecretKey: secretKey,
      starlingCredentialsUpdatedAt: new Date().toISOString(),
      starlingCredentialState: 'active',
      starlingProjectsCache: projects.projects,
    });
    result.textContent = `Saved and verified. ${projects.projects.length} accessible project(s) found.`;
    result.className = 'test-result ok';
  } catch (error) {
    await chrome.storage.local.set({
      starlingAccessKey: accessKey,
      starlingSecretKey: secretKey,
      starlingCredentialsUpdatedAt: new Date().toISOString(),
      starlingCredentialState: hostSaved
        ? 'saved_locally_verification_failed'
        : 'saved_locally_not_activated',
    });
    result.textContent = hostSaved
      ? `Saved to both locations, but project verification failed: ${error.message}`
      : `Saved in Chrome only; Native Host activation failed: ${error.message}`;
    result.className = 'test-result err';
  }
}

/** Provider 改变时填入对应的默认 endpoint/model。 */
function onProviderChange() {
  const provider = document.getElementById('llmProvider').value;
  const preset = LLM_PRESETS[provider] || {};
  renderProviderFields(preset.llmModel || '');
  if (provider === 'custom') return;
  if (preset.llmEndpoint) document.getElementById('llmEndpoint').value = preset.llmEndpoint;
  if (preset.llmThinkingLevel) document.getElementById('llmThinkingLevel').value = preset.llmThinkingLevel;
}

/** 只在 Inspire Provider 下显示固定 Agent 与个人 Access Key 风险说明。 */
function renderProviderFields(preferredModel = '') {
  const provider = document.getElementById('llmProvider').value;
  document.getElementById('inspire-fields').classList.toggle('hidden', provider !== 'inspire');
  renderModelOptions(preferredModel);
}

/** 保存不含 Starling AK/SK 和单次运行配置的常规设置。 */
async function save() {
  const data = {};
  GENERAL_KEYS.forEach((key) => {
    const element = document.getElementById(key);
    if (!element) return;
    data[key] = element.type === 'checkbox' ? element.checked : element.value.trim();
  });
  if (data.llmProvider === 'custom') data.llmModel = data.llmCustomModel;
  const preset = LLM_PRESETS[data.llmProvider] || LLM_PRESETS[LLM_DEFAULT_PROVIDER];
  if (!data.llmEndpoint) data.llmEndpoint = preset.llmEndpoint || LLM_PRESETS.claude.llmEndpoint;
  if (!data.llmModel) data.llmModel = preset.llmModel || LLM_PRESETS.claude.llmModel;
  await chrome.storage.local.set(data);
  const result = document.getElementById('save-result');
  result.textContent = 'Saved';
  result.className = 'test-result ok';
  setTimeout(() => { result.textContent = ''; }, 2000);
}

/** 测试 Native Host 注册与 CLI 自动发现，不读取或输出 AK/SK。 */
async function testCli() {
  const result = document.getElementById('cli-test-result');
  result.textContent = 'Testing...';
  result.className = 'test-result';
  const cliPath = document.getElementById('starlingCliPath').value.trim();
  const response = await pingNativeHost({ cliPath });
  if (response?.pong) {
    result.textContent = `Native Host available, CLI: ${response.cli}`;
    result.className = 'test-result ok';
    return;
  }
  result.textContent = response?.error || 'No response';
  result.className = 'test-result err';
}

/** 通过 Native Host 系统隐藏输入框保存 App Secret，不让 Secret 经过 Chrome。 */
async function configureFeishuAppOwner() {
  const result = document.getElementById('feishu-owner-result');
  const button = document.getElementById('configure-feishu-app');
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = 'Waiting for macOS dialog…';
  result.textContent = 'Paste the Feishu App Secret in the macOS dialog.';
  result.className = 'test-result';
  try {
    const configured = await configureFeishuApplication();
    if (!configured.configured) throw new Error('Feishu App Secret was not saved.');
    result.textContent = 'Feishu App Secret is saved in macOS Keychain.';
    result.className = 'test-result ok';
    button.textContent = 'Replace Feishu App Secret';
  } catch (error) {
    result.textContent = error.message;
    result.className = 'test-result err';
    button.textContent = originalLabel;
  } finally {
    button.disabled = false;
  }
}

/** 渲染 Popup 中唯一工作表入口的只读摘要。 */
function renderWorkingSheetStatus(data) {
  const result = document.getElementById('working-sheet-status');
  const parsed = parseSheetsUrl(data.sheetsUrl || data.spreadsheetToken || '');
  if (!parsed?.spreadsheetToken) {
    result.textContent = 'Working spreadsheet: not set. Open the popup from a Spreadsheet page to detect it automatically.';
    result.className = 'test-result err';
    return;
  }
  const sheet = data.sheetId || parsed.sheetId || 'first sheet';
  result.textContent = `Working spreadsheet configured (${parsed.spreadsheetToken.slice(0, 12)}…, ${sheet}). Change it in the popup.`;
  result.className = 'test-result ok';
}

document.getElementById('btn-save').addEventListener('click', save);
document.getElementById('save-starling-credentials').addEventListener('click', saveCredentials);
document.getElementById('test-cli').addEventListener('click', testCli);
document.getElementById('configure-feishu-app').addEventListener('click', configureFeishuAppOwner);
document.getElementById('llmProvider').addEventListener('change', onProviderChange);
document.querySelectorAll('[data-reveal-target]').forEach((button) => {
  button.addEventListener('click', () => toggleCredentialVisibility(button));
});

load();
