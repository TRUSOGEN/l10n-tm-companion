/**
 * Inspire Writer 模型契约。
 *
 * 本模块集中维护 OpenAPI 允许的模型枚举，并把已发布插件保存过的历史 ID 迁移到
 * 当前正式 ID。未知值保持原样，由服务端忠实校验，避免静默改成其他模型。
 */

export const INSPIRE_MODEL_OPTIONS = Object.freeze([
  Object.freeze({ value: 'gemini_3f', label: 'Gemini 3 Flash — fastest' }),
  Object.freeze({ value: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro — balanced quality' }),
  Object.freeze({ value: 'gpt-5.4-mini', label: 'GPT 5.4 mini — balanced OpenAI model' }),
  Object.freeze({ value: 'gpt-5.4', label: 'GPT 5.4 — highest quality, slowest' }),
]);

/** 当前托管的 TM_AI_Revision Agent。默认使用其最新的非废弃发布版本。 */
export const INSPIRE_DEFAULT_AGENT = Object.freeze({
  id: '6a7046ed7eb6d102364e292e',
  name: 'TM_AI_Revision',
});

/** 保留旧导出，供已有调用方与历史审计记录识别默认 Agent。 */
export const INSPIRE_TM_AGENT_ID = INSPIRE_DEFAULT_AGENT.id;

/**
 * 最后一次在 Inspire 页面确认可见的发布版本，仅作设置页审计参考。
 * 默认请求始终省略 version，由 OpenAPI 选择最新的非废弃发布版本。
 */
export const INSPIRE_DEFAULT_AGENT_LAST_OBSERVED_VERSION = 5;

const LEGACY_INSPIRE_MODEL_IDS = Object.freeze({
  'gemini-3.1-p-priority': 'gemini-3.1-pro',
  'gpt-5.4-mini-2026-03-17': 'gpt-5.4-mini',
  'gpt-5.4-2026-03-05': 'gpt-5.4',
});

/** 将历史模型 ID 迁移为 Inspire OpenAPI 当前允许的正式枚举。 */
export function normalizeInspireModelId(value) {
  const modelId = String(value || '').trim();
  return LEGACY_INSPIRE_MODEL_IDS[modelId] || modelId;
}

/**
 * 解析 Settings 中的 Inspire Agent 选择。
 *
 * 默认 Agent 省略 version，交由 OpenAPI 选择最新的非废弃发布版本；用户只有在
 * 排障或回滚时才显式选择 pinned 版本。Team 始终由 Agent ID 在 Inspire 侧归属，
 * 因而不进入本机配置或请求体。
 *
 * @param {object} config Chrome storage 中的 LLM 配置。
 * @returns {{agentId:string,agentVersion:number|null,agentMode:'default'|'custom',versionPolicy:'latest'|'pinned'}}
 */
export function resolveInspireAgentConfig(config = {}) {
  const agentMode = config.inspireAgentMode === 'custom' ? 'custom' : 'default';
  const versionPolicy = config.inspireAgentVersionPolicy === 'pinned' ? 'pinned' : 'latest';
  const agentId = agentMode === 'custom'
    ? String(config.inspireCustomAgentId || '').trim()
    : INSPIRE_DEFAULT_AGENT.id;
  if (!agentId) {
    throw new Error('Custom Inspire Agent ID is required. Choose Default Agent or enter a published Agent ID in Settings.');
  }

  if (versionPolicy === 'latest') {
    return { agentId, agentVersion: null, agentMode, versionPolicy };
  }

  const agentVersion = Number(config.inspireAgentVersion);
  if (!Number.isSafeInteger(agentVersion) || agentVersion <= 0) {
    throw new Error('Pinned Inspire Agent version must be a positive integer. Choose Latest published or enter a valid version in Settings.');
  }
  return { agentId, agentVersion, agentMode, versionPolicy };
}

/**
 * 生成结果审计所用的 Agent 名称。
 *
 * 自定义 Agent 的名称是本机可选标注，实际调用仍只信任 Agent ID；名称留空时保留
 * ID，避免用户在结果中无法定位实际使用的 Agent。
 */
export function getInspireAgentDisplayName(config = {}, agent = {}) {
  if (agent.agentMode !== 'custom') return INSPIRE_DEFAULT_AGENT.name;
  const customName = String(config.inspireCustomAgentName || '').trim();
  if (customName) return customName;
  const agentId = String(agent.agentId || '').trim();
  return agentId ? `Custom Agent · ${agentId}` : 'Custom Agent';
}
