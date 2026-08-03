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

/** 已完成真实 E2E 的 TM_inspire published Agent 契约。 */
export const INSPIRE_TM_AGENT_ID = '6a7036d4ef9ca901ee5c7a65';
export const INSPIRE_TM_AGENT_VERSION = 7;

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
