/**
 * AI 翻译推荐模块
 * ================
 * 调用 LLM API，基于原文案 + TM 上下文生成翻译建议。
 * 兼容 Claude (Anthropic) 与 OpenAI 两种 API 格式。
 *
 * 单条返回结构：
 *   { ...item, ai_translation, reasoning, reuse_tm }
 */

import { TM_MATCH_THRESHOLD } from './tm-threshold.js';
import { createInspireRewrite } from './inspire-writer.js';

const LANG_MAP = { ja: '日本語', ko: '한국어', zh: '中文', 'zh-CN': '简体中文', en: 'English' };

/**
 * @param {Array}  items  已含 TM 结果的文案数组
 * @param {object} config { llmEndpoint, llmApiKey, llmModel, targetLang, provider }
 * @returns {Promise<Array>}
 */
export async function translateWithAI(items, config) {
  const { llmEndpoint, llmApiKey, llmModel, targetLang, provider } = config;

  if (!llmEndpoint || !llmApiKey || !llmModel) {
    return items.map((item) => ({
      ...item,
      ai_translation: '',
      reasoning: 'AI is not configured. Enter the LLM endpoint, API key, and model in Settings.',
      reuse_tm: false,
    }));
  }

  const results = [];
  for (const item of items) {
    try {
      const prompt = buildPrompt(item, targetLang);
      const responseText = await callLLM(llmEndpoint, llmApiKey, llmModel, prompt, provider);
      results.push(parseAIResponse(responseText, item));
    } catch (e) {
      results.push({
        ...item,
        ai_translation: '',
        reasoning: `AI Error: ${e.message}`,
        reuse_tm: false,
      });
    }
  }
  return results;
}

/**
 * 构建 LIVE 术语感知的翻译 prompt，要求结构化 JSON 返回。
 */
export function buildPrompt(item, targetLang) {
  const langName = LANG_MAP[targetLang] || targetLang;

  let prompt = `You are a TikTok LIVE localization translation expert.\n\n`;
  prompt += `Source text: ${item.source_text}\n`;

  if (item.tm_match && item.similarity > 0) {
    prompt += `\nClosest TM match (similarity ${Math.round(item.similarity)}%): ${item.tm_match}\n`;
    prompt += `TM origin: ${item.origin || 'Unknown'}\n\n`;

    if (item.similarity >= 0.95) {
      prompt += `The TM match is very high (>= 95%). Recommend reusing the TM translation unless there's a strong reason to change.\n`;
    }
  }

  prompt += `\nGenerate a ${langName} translation recommendation.\n`;
  prompt += `If you recommend a different translation than the TM match, explain why.\n\n`;
  prompt += `Respond in this exact JSON format (no markdown fences):\n`;
  prompt += `{"ai_translation": "...", "reasoning": "...", "reuse_tm": true/false}\n`;

  return prompt;
}

/**
 * 调用 LLM。provider 可显式指定，否则按 endpoint 猜测。
 *
 * 扩展环境（chrome.runtime.sendMessage 可用）：把 LLM 请求经 background SW
 * 转发到 native host（starling-bridge.py 的 llm_call action），由 Python 直连
 * LLM 网关，绕过浏览器 CORS——LLMBox/Anthropic 网关对 chrome-extension origin
 * 不发 CORS 头，扩展页（popup/content）直连 fetch 必被拦。
 *   popup → chrome.runtime.sendMessage({action:'native_llm_call'})
 *        → background SW → chrome.runtime.sendNativeMessage → starling-bridge.py
 * ⚠️ sendNativeMessage 只在 SW 可用，所以必须由 SW 中转，不能在 popup 里直调。
 * node 测试环境（无 chrome）：直接 fetch，便于单测 mock。
 */
export async function callLLM(endpoint, apiKey, model, prompt, provider) {
  // 扩展环境：经 SW 转发到 native host 绕过 CORS
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    return callLLMViaBackground(endpoint, apiKey, model, prompt, provider);
  }
  // custom 不带 provider，按 endpoint 猜；claude 明确走 Claude，其余（deepseek 等）走 OpenAI。
  const effProvider = provider === 'custom' ? '' : provider;
  const useClaude = effProvider === 'claude' ||
    (!effProvider && endpoint.includes('anthropic'));
  if (useClaude) {
    return callClaude(endpoint, apiKey, model, prompt);
  }
  return callOpenAI(endpoint, apiKey, model, prompt);
}

/**
 * 经 background Service Worker 转发到 native host（Python 直连网关，无 CORS）。
 * popup/content 不能直接 sendNativeMessage，统一走 background 中转。
 */
async function callLLMViaBackground(endpoint, apiKey, model, prompt, provider) {
  const payload = {
    action: 'llm_call',
    endpoint,
    api_key: apiKey,
    model,
    prompt,
  };
  if (provider && provider !== 'custom') payload.provider = provider;

  const response = await chrome.runtime.sendMessage({
    action: 'native_llm_call',
    payload,
  }).catch((e) => {
    // SW 不可用 / native host 缺失 / 端口关闭 等，promise 形式以 reject 抛出
    throw new Error(`Background service worker or Native Host unavailable: ${e?.message || e}`);
  });

  if (response?.error) {
    throw new Error(`Native host error: ${response.error}`);
  }
  if (!response?.ok) {
    throw new Error(`LLM via native host failed: ${response?.error || 'unknown'} (status ${response?.status ?? 'n/a'})`);
  }
  return response.text || '';
}

async function callClaude(endpoint, apiKey, model, prompt) {
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Claude API ${resp.status}: ${errText.slice(0, 200)}`);
  }
  const data = await resp.json();
  return data.content?.[0]?.text || '';
}

async function callOpenAI(endpoint, apiKey, model, prompt) {
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`LLM API ${resp.status}: ${errText.slice(0, 200)}`);
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * 解析 AI 的 JSON 响应；失败时退回原始文本。
 */
export function parseAIResponse(responseText, item) {
  const fallback = {
    ...item,
    ai_translation: responseText,
    reasoning: 'Raw AI response (JSON parse failed)',
    reuse_tm: false,
  };

  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      ...item,
      ai_translation: parsed.ai_translation || '',
      reasoning: parsed.reasoning || '',
      reuse_tm: Boolean(parsed.reuse_tm),
    };
  } catch (e) {
    return fallback;
  }
}

/**
 * TM 优化流程：用 AI 改写原文，使其更接近 TM 已有原文表达（提升 TM 命中率）。
 * 不做翻译。仅对 Orig Match % < 阈值（默认 85）的条目调用。
 *
 * @param {Array}  items  已含 TM 结果（source_text / tm_match / similarity）的文案数组
 * @param {object} config { llmEndpoint, llmApiKey, llmModel, provider }
 * @param {number} [threshold=85] Orig Match % 低于此值才改写
 * @returns {Promise<Array>} 每条带 ai_translation（改写后原文）/ reasoning / reached_threshold
 */
export async function rewriteSourceWithAI(items, config, threshold = TM_MATCH_THRESHOLD) {
  const {
    llmEndpoint,
    llmApiKey,
    llmModel,
    inspireTeamId,
    llmThinkingLevel,
  } = config;
  const provider = config.llmProvider || config.provider || '';
  const concurrency = Math.min(5, Math.max(1, Number(config.aiConcurrency) || 3));

  // 保序的有界并发让低分文案并行等待 LLM，同时把内部 API 峰值限制在可审计范围。
  return mapWithConcurrency(items, concurrency, async (item) => {
    const reached = (item.similarity || 0) >= threshold;
    const base = { ...item, reached_threshold: reached };

    if (reached) {
      // 已达标：原文本身足够接近 TM，不需要改写
      return {
        ...base,
        ai_translation: item.source_text || '',
        reasoning: `Orig Match % (${Math.round(item.similarity || 0)}) >= ${threshold}, no rewrite needed.`,
        reuse_tm: true,
      };
    }

    const inspireReady = provider === 'inspire' && Boolean(llmApiKey && llmModel && inspireTeamId);
    const compatibleReady = provider !== 'inspire' && Boolean(llmEndpoint && llmApiKey && llmModel);
    if (!inspireReady && !compatibleReady) {
      return {
        ...base,
        ai_translation: '',
        reasoning: provider === 'inspire'
          ? 'Inspire is not configured. Enter the Access Key, teamId, and model in Settings.'
          : 'AI is not configured. Enter the LLM endpoint, API key, and model in Settings.',
        reuse_tm: false,
      };
    }

    try {
      config.onAiProgress?.({ item, provider, total: items.length });
      const prompt = buildRewritePrompt(item);
      if (provider === 'inspire') {
        const result = await createInspireRewrite({
          prompt,
          config: {
            endpoint: llmEndpoint,
            accessKey: llmApiKey,
            teamId: inspireTeamId,
            model: llmModel,
            thinkingLevel: llmThinkingLevel || 'low',
          },
        });
        return {
          ...base,
          ai_translation: result.revision,
          reasoning: [result.title, `Inspire score ${result.score.toFixed(2)}`].filter(Boolean).join(' · '),
          reuse_tm: false,
          ai_candidates: result.candidates,
          ai_task_id: result.taskId,
          ai_duration_ms: result.durationMs,
        };
      }

      // 兼容接口只对超时、限流和 5xx 进行一次重试，参数与鉴权错误直接暴露。
      let responseText = '';
      try {
        responseText = await callLLM(llmEndpoint, llmApiKey, llmModel, prompt, provider);
      } catch (e1) {
        if (!isRetryableLlmError(e1)) throw e1;
        responseText = await callLLM(llmEndpoint, llmApiKey, llmModel, prompt, provider);
      }
      const parsed = parseRewriteResponse(responseText, item);
      return { ...base, ...parsed };
    } catch (e) {
      return {
        ...base,
        ai_translation: '',
        reasoning: `AI Error: ${e.message}`,
        reuse_tm: false,
      };
    }
  });
}

/**
 * 构建「改写原文以提升 TM 命中率」的 prompt。
 * 关键：改写的是源语言原文，保持语义不变，只调整表达更贴近 TM 库已有原文风格。
 */
export function buildRewritePrompt(item) {
  let prompt = `You are a TikTok LIVE localization TM optimization expert.\n\n`;
  prompt += `Your job: rewrite the SOURCE text so it more closely matches existing TM source-text expressions, WITHOUT changing its meaning. You are rewriting the source language, not translating.\n\n`;
  prompt += `Source text (to rewrite): ${item.source_text}\n`;

  if (item.tm_source && item.similarity > 0) {
    prompt += `\nClosest TM source match (similarity ${Math.round(item.similarity)}%): ${item.tm_source}\n`;
    prompt += `TM origin: ${item.origin || 'Unknown'}\n`;
  }

  prompt += `\nRules:\n`;
  prompt += `- Keep the same language as the source (do NOT translate).\n`;
  prompt += `- Preserve meaning and any placeholders/variables exactly.\n`;
  prompt += `- Align wording, casing, and phrasing toward the TM match style to raise TM match score.\n`;
  prompt += `- Do not add or remove information.\n\n`;
  prompt += `Respond in this exact JSON format (no markdown fences):\n`;
  prompt += `{"ai_translation": "<rewritten source text>", "reasoning": "<brief why>", "reuse_tm": true/false}\n`;

  return prompt;
}

/** 对数组执行保序的有界并发映射。 */
async function mapWithConcurrency(items, concurrency, mapper) {
  const input = Array.isArray(items) ? items : [];
  const output = new Array(input.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < input.length) {
      const index = nextIndex;
      nextIndex += 1;
      output[index] = await mapper(input[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, input.length) }, worker));
  return output;
}

/** 判断兼容 LLM 请求是否属于允许重试一次的临时 API 错误。 */
function isRetryableLlmError(error) {
  const message = String(error?.message || error);
  return /timeout|timed out|network|429|5\d\d|temporar|connection|ECONN/i.test(message);
}

function parseRewriteResponse(responseText, item) {
  const fallback = {
    ...item,
    ai_translation: responseText,
    reasoning: 'Raw AI response (JSON parse failed)',
    reuse_tm: false,
  };
  try {
    const m = responseText.match(/\{[\s\S]*\}/);
    if (!m) return fallback;
    const parsed = JSON.parse(m[0]);
    return {
      ...item,
      ai_translation: parsed.ai_translation || '',
      reasoning: parsed.reasoning || '',
      reuse_tm: Boolean(parsed.reuse_tm),
    };
  } catch (e) {
    return fallback;
  }
}
