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
import { createInspireRewrite, createRequestRateLimiter } from './inspire-writer.js';
import {
  INSPIRE_TM_AGENT_ID,
  INSPIRE_TM_AGENT_VERSION,
} from './inspire-models.js';
import { buildContentReviewContext, loadContentReviewAssets } from './content-review-rules.js';

export const INSPIRE_PILOT_LIMITS = Object.freeze({
  maxConcurrency: 50,
  maxQps: 100,
});

export const AI_REWRITE_MIN_SCORE = 50;

const LANG_MAP = { ja: '日本語', ko: '한국어', zh: '中文', 'zh-CN': '简体中文', en: 'English' };

/** 判断原始 Starling 分数是否进入自动英语改写区间。 */
export function shouldRewriteSource(score, threshold = TM_MATCH_THRESHOLD) {
  const normalized = Number(score);
  return Number.isFinite(normalized)
    && normalized >= AI_REWRITE_MIN_SCORE
    && normalized < threshold;
}

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
    llmThinkingLevel,
  } = config;
  const provider = config.llmProvider || config.provider || '';
  const reviewAssets = config.contentReviewAssets
    || (typeof chrome !== 'undefined' && chrome.runtime?.getURL
      ? await loadContentReviewAssets()
      : null);
  const concurrency = provider === 'inspire'
    ? Math.min(
      INSPIRE_PILOT_LIMITS.maxConcurrency,
      Math.max(1, Number(config.aiConcurrency) || INSPIRE_PILOT_LIMITS.maxConcurrency),
    )
    : Math.min(5, Math.max(1, Number(config.aiConcurrency) || 3));
  const inspireRequestGate = provider === 'inspire'
    ? (config.inspireRequestGate || createRequestRateLimiter({ maxQps: INSPIRE_PILOT_LIMITS.maxQps }))
    : null;
  const inspireBatchUsage = { taskAttemptCount: 0, requestCount: 0, pollCount: 0 };
  const inspireProgress = {
    total: provider === 'inspire'
      ? items.filter((item) => shouldRewriteSource(item.similarity, threshold)).length
      : 0,
    started: 0,
    finished: 0,
    failed: 0,
  };
  const emitInspireProgress = (item, phase) => config.onAiProgress?.({
    item,
    provider,
    phase,
    total: inspireProgress.total,
    started: inspireProgress.started,
    finished: inspireProgress.finished,
    failed: inspireProgress.failed,
    active: inspireProgress.started - inspireProgress.finished,
    requestCount: inspireBatchUsage.requestCount,
    pollCount: inspireBatchUsage.pollCount,
  });

  // 保序的有界并发让低分文案并行等待 LLM，同时把内部 API 峰值限制在可审计范围。
  const rewritten = await mapWithConcurrency(items, concurrency, async (item) => {
    const originalScore = Number(item.similarity);
    const reached = Number.isFinite(originalScore) && originalScore >= threshold;
    const rewriteEligible = shouldRewriteSource(originalScore, threshold);
    const base = {
      ...item,
      reached_threshold: reached,
      rewrite_eligible: rewriteEligible,
    };

    if (reached) {
      // 已达标：原文本身足够接近 TM，不需要改写
      return {
        ...base,
        ai_translation: item.source_text || '',
        reasoning: `Orig Match % (${Math.round(item.similarity || 0)}) >= ${threshold}, no rewrite needed.`,
        reuse_tm: true,
      };
    }

    if (!rewriteEligible) {
      return {
        ...base,
        ai_translation: '',
        reasoning: `Orig Match % (${originalScore}) is below ${AI_REWRITE_MIN_SCORE}; show Top-3 TM without AI rewrite.`,
        reuse_tm: false,
        ai_candidates: [],
      };
    }

    const inspireReady = provider === 'inspire' && Boolean(llmApiKey && llmModel);
    const compatibleReady = provider !== 'inspire' && Boolean(llmEndpoint && llmApiKey && llmModel);
    if (!inspireReady && !compatibleReady) {
      return {
        ...base,
        ai_translation: '',
        reasoning: provider === 'inspire'
          ? 'Inspire is not configured. Enter the Access Key and model in Settings.'
          : 'AI is not configured. Enter the LLM endpoint, API key, and model in Settings.',
        reuse_tm: false,
      };
    }

    try {
      if (provider === 'inspire') {
        inspireProgress.started += 1;
        emitInspireProgress(item, 'started');
      } else {
        config.onAiProgress?.({ item, provider, total: items.length });
      }
      const reviewContext = reviewAssets ? buildContentReviewContext({
        sourceText: item.source_text,
        tmSource: item.tm_source,
        context: [item.context, item.location].filter(Boolean).join(' · '),
        assets: reviewAssets,
      }) : null;
      const prompt = buildRewritePrompt(item, reviewContext);
      if (provider === 'inspire') {
        const result = await createInspireRewrite({
          prompt,
          config: {
            endpoint: llmEndpoint,
            accessKey: llmApiKey,
            agentId: INSPIRE_TM_AGENT_ID,
            agentVersion: INSPIRE_TM_AGENT_VERSION,
            model: llmModel,
            thinkingLevel: llmThinkingLevel || 'low',
            requestGate: inspireRequestGate,
            onRequest: ({ kind }) => {
              inspireBatchUsage.requestCount += 1;
              if (kind === 'create') inspireBatchUsage.taskAttemptCount += 1;
              if (kind === 'status') inspireBatchUsage.pollCount += 1;
              emitInspireProgress(item, kind);
            },
          },
        });
        inspireProgress.finished += 1;
        emitInspireProgress(item, 'completed');
        const parsedRevisions = result.candidates.map((revision, index) => (
          parseInspireWriterRevision(revision, index)
        ));
        const structuredRevision = parsedRevisions.find(
          ({ contract_source: contractSource }) => contractSource === 'json_envelope',
        );
        const parsedCandidates = (structuredRevision
          ? structuredRevision.candidates
          : parsedRevisions.flatMap(({ candidates: revisionCandidates }) => revisionCandidates))
          .slice(0, 3);
        const sourceKey = normalizeCandidateText(item.source_text);
        const candidates = parsedCandidates.filter(
          (candidate) => normalizeCandidateText(candidate.ai_translation) !== sourceKey,
        );
        const selectedCandidate = candidates.find((candidate) => candidate.structure_valid);
        const structuredReasoning = selectedCandidate?.reasoning || '';
        const skippedReasonCode = parsedRevisions
          .map(({ reason_code: reasonCode }) => reasonCode)
          .find(Boolean);
        const skippedReason = candidates.length === 0 && skippedReasonCode
          ? `Inspire skipped rewrite: ${skippedReasonCode}`
          : '';
        const unchangedReason = candidates.length === 0 && parsedCandidates.length > 0
          ? 'Inspire returned the original source unchanged; no safe rewrite was available.'
          : '';
        const scoreReason = Number.isFinite(result.score)
          ? `Inspire score ${result.score.toFixed(2)}`
          : '';
        return {
          ...base,
          ai_translation: selectedCandidate?.ai_translation || '',
          reasoning: [
            structuredReasoning,
            skippedReason,
            unchangedReason,
            result.title,
            scoreReason,
          ].filter(Boolean).join(' · '),
          reuse_tm: Boolean(selectedCandidate?.reuse_tm),
          ai_candidates: candidates,
          ai_task_id: result.taskId,
          ai_agent_version: result.agentVersionNumber,
          ai_duration_ms: result.durationMs,
          ai_http_request_count: result.requestCount,
          ai_poll_count: result.pollCount,
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
      if (provider === 'inspire') {
        inspireProgress.finished += 1;
        inspireProgress.failed += 1;
        emitInspireProgress(item, 'failed');
      }
      return {
        ...base,
        ai_translation: '',
        reasoning: `AI Error: ${e.message}`,
        reuse_tm: false,
      };
    }
  });
  if (provider === 'inspire') {
    config.onAiBatchComplete?.({
      taskCount: rewritten.filter((item) => item.ai_task_id).length,
      ...inspireBatchUsage,
    });
  }
  return rewritten;
}

const WRITER_REVISION_CONTRACT = `WRITER NATIVE COPY CONTRACT
Return one to three separate source-language copy results when safe, materially different rewrites exist.
Each copy result must contain only one rewritten source string, with no JSON, Markdown, labels, scores, reasoning, or surrounding text.
If no safe meaning-preserving rewrite is viable, return the original source unchanged as the sole copy result.
Every changed copy is treated as your assertion that the rewrite preserves the complete source meaning.
The downstream program validates protected content and queries real Post-TM for every changed copy.`;

const DEFAULT_TM_ALIGNMENT_INSTRUCTIONS = `Rewrite the source in the same language without translating it.
Preserve meaning, facts, intent, tone, length, placeholders, template syntax, URLs, numbers, dates, prices, proper nouns, product names, Gift names, claims, conditions, limitations, and calls to action.
Use TM entries only as wording and structure evidence. Never import facts from TM.
Use one internal source-only base paraphrase for every candidate. Do not add, remove, weaken, or strengthen information.
Across multiple Writer revisions, vary safe alignment evidence across Top-3 TM entries where possible, but never force a TM-rank mapping that changes meaning.
Skip when the copy has insufficient safe rewrite space.
The downstream program calculates real TM scores, applies deterministic safety checks, and selects the winner.`;

/** 为 prompt 中的证据设置硬上限，避免输出协议被大段参考资料淹没。 */
function boundedPromptEvidence(value, maxChars) {
  const text = String(value || '').trim();
  if (text.length <= maxChars) return text;
  const marker = '\n[Evidence excerpt truncated]';
  return `${text.slice(0, Math.max(0, maxChars - marker.length)).trimEnd()}${marker}`;
}

/**
 * 构建「改写原文以提升 TM 命中率」的 prompt。
 * 关键：改写源语言原文，并把 Writer 原生 copy 输出协议同时放在首尾。
 */
export function buildRewritePrompt(item, reviewContext = null) {
  const tmEvidence = [];
  const topCandidates = Array.isArray(item.tm_candidates)
    ? item.tm_candidates.slice(0, 3)
    : [];
  if (topCandidates.length) {
    topCandidates.forEach((candidate, index) => {
      tmEvidence.push(
        `${index + 1}. ${boundedPromptEvidence(candidate.source || '', 800)} (${Number(candidate.score)}%)`,
      );
    });
  } else if (item.tm_source && item.similarity > 0) {
    tmEvidence.push(
      `1. ${boundedPromptEvidence(item.tm_source, 800)} (${Math.round(item.similarity)}%)`,
    );
  }

  const prompt = `${WRITER_REVISION_CONTRACT}

ROLE
You are a TikTok LIVE localization TM optimization expert.

TASK
Rewrite the SOURCE text in its current language. Do NOT translate it.
${boundedPromptEvidence(
    reviewContext?.promptTemplate || DEFAULT_TM_ALIGNMENT_INSTRUCTIONS,
    3000,
  )}

SOURCE
Source text: ${item.source_text}

TM SOURCE EVIDENCE
${tmEvidence.join('\n') || 'No TM source evidence was supplied.'}
TM origin: ${item.origin || 'Unknown'}

CONTEXT
${boundedPromptEvidence([item.context, item.location].filter(Boolean).join(' · '), 800) || 'No additional UI context was supplied.'}

AUTHORITATIVE REVIEW EVIDENCE
Content Review Skill:
${boundedPromptEvidence(reviewContext?.skillExcerpt, 800) || 'No matching Skill excerpt.'}

Baseline quality check:
${boundedPromptEvidence(reviewContext?.principles, 1200) || 'Preserve meaning and product intent.'}

Selected ${reviewContext?.legalKind === 'game' ? 'Game' : 'Revenue'} Legal Guidelines:
${boundedPromptEvidence(reviewContext?.legalExcerpt, 1200) || 'No directly matching Legal section.'}

Apply Legal Guidelines before baseline quality rules. Use only the selected legal source above.

FINAL RESPONSE
${WRITER_REVISION_CONTRACT}`;
  if (prompt.length > 12000) {
    throw new Error(`rewrite_prompt_too_large: ${prompt.length} characters`);
  }
  return prompt;
}

/**
 * 将 Inspire Writer 原生 revision 包装为内部结构化候选。
 *
 * Writer `/copies` 的稳定契约是普通 revision 文本；旧版 JSON envelope 仍保留兼容，
 * 但疑似 JSON 的损坏文本必须正确失败，不能作为普通候选放行。
 */
function parseInspireWriterRevision(revision, revisionIndex) {
  const raw = String(revision?.revision || '').trim();
  const skipMatch = raw.match(/^\[\[SKIP:(INSUFFICIENT_REWRITE_SPACE|NEEDS_CONTEXT|MEANING_RISK)\]\]$/);
  if (skipMatch) {
    return {
      candidates: [],
      reason_code: skipMatch[1],
      contract_source: 'inspire_writer_revision',
    };
  }

  const envelope = parseStructuredRewriteEnvelope(raw);
  if (envelope.structure_valid) {
    if (!envelope.rewrite_viable) {
      return {
        candidates: [],
        reason_code: envelope.reason_code,
        contract_source: 'json_envelope',
      };
    }
    return {
      candidates: envelope.candidates.map((candidate) => ({
        ...revision,
        ...candidate,
        revision: candidate.ai_translation,
        raw_revision: raw,
        contract_source: 'json_envelope',
      })),
      reason_code: '',
      contract_source: 'json_envelope',
    };
  }

  const looksLikeBrokenStructure = /```(?:json)?|"(?:rewrite_viable|reason_code|candidates|ai_translation)"\s*:/i.test(raw);
  if (!raw || looksLikeBrokenStructure) {
    return {
      candidates: [{
        ...revision,
        decision: '',
        semantic_status: '',
        ai_translation: '',
        reasoning: '',
        changes: [],
        risks: [],
        reuse_tm: false,
        structure_valid: false,
        structure_error: envelope.structure_error,
        raw_revision: raw,
        contract_source: 'invalid_structured_revision',
      }],
      reason_code: '',
      contract_source: 'invalid_structured_revision',
    };
  }

  const rank = revisionIndex + 1;
  return {
    candidates: [{
      ...revision,
      tm_rank: rank,
      decision: 'rewrite',
      semantic_status: 'same_meaning',
      ai_translation: raw,
      reasoning: 'Inspire Writer native revision; protected-content and production TM checks run downstream.',
      changes: [],
      risks: [],
      reuse_tm: false,
      structure_valid: true,
      structure_error: '',
      raw_revision: raw,
      contract_source: 'inspire_writer_revision',
    }],
    reason_code: '',
    contract_source: 'inspire_writer_revision',
  };
}

/** 将候选文本转换为稳定比较键，用于过滤 Agent 原样返回的 source。 */
function normalizeCandidateText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
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

/** 严格解析 envelope 内的一条候选，并兼容设计稿中的 `candidate` 字段。 */
function parseStructuredRewriteCandidate(candidate, fallbackRank = 1) {
  const invalid = (error, raw = candidate) => ({
    tm_rank: Number(raw?.tm_rank || fallbackRank),
    decision: '',
    semantic_status: '',
    ai_translation: '',
    reasoning: '',
    changes: [],
    risks: [],
    reuse_tm: false,
    structure_valid: false,
    structure_error: error,
  });
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return invalid('candidate_required_field_invalid');
  }
  const tmRank = Number(candidate.tm_rank || fallbackRank);
  const minimalCandidate = typeof candidate.candidate === 'string'
    ? candidate.candidate
    : '';
  const aiTranslation = typeof candidate.ai_translation === 'string'
    ? candidate.ai_translation
    : minimalCandidate;
  if (!Number.isInteger(tmRank) || tmRank < 1 || tmRank > 3 || !aiTranslation.trim()) {
    return invalid('candidate_required_field_invalid');
  }
  const usesMinimalContract = Boolean(minimalCandidate)
    && typeof candidate.ai_translation !== 'string';
  const decision = usesMinimalContract ? 'rewrite' : candidate.decision;
  const semanticStatus = usesMinimalContract ? 'same_meaning' : candidate.semantic_status;
  const reasoning = usesMinimalContract
    ? `Model-validated candidate aligned with TM ${tmRank}.`
    : candidate.reasoning;
  const changes = usesMinimalContract ? [] : candidate.changes;
  const risks = usesMinimalContract ? [] : candidate.risks;
  if ([decision, semanticStatus, reasoning].some((field) => typeof field !== 'string')) {
    return invalid('candidate_required_field_invalid');
  }
  if (!Array.isArray(changes) || !Array.isArray(risks)) {
    return invalid('candidate_array_field_invalid');
  }
  return {
    tm_rank: tmRank,
    decision,
    semantic_status: semanticStatus,
    ai_translation: aiTranslation.trim(),
    reasoning,
    changes,
    risks,
    reuse_tm: Boolean(candidate.reuse_tm),
    structure_valid: true,
    structure_error: '',
  };
}

/**
 * 解析 Inspire 单个 revision 的候选 envelope。
 *
 * 支持新版 `{rewrite_viable, reason_code, candidates}`，并兼容旧版单候选对象。
 */
export function parseStructuredRewriteEnvelope(responseText) {
  const invalid = (error) => ({
    rewrite_viable: false,
    reason_code: '',
    candidates: [],
    structure_valid: false,
    structure_error: error,
  });
  try {
    const match = String(responseText || '').match(/\{[\s\S]*\}/);
    if (!match) return invalid('candidate_json_missing');
    const parsed = JSON.parse(match[0]);
    if (typeof parsed?.ai_translation === 'string') {
      const candidate = parseStructuredRewriteCandidate({ ...parsed, tm_rank: 1 }, 1);
      return {
        rewrite_viable: candidate.structure_valid,
        reason_code: null,
        candidates: [candidate],
        structure_valid: candidate.structure_valid,
        structure_error: candidate.structure_error,
      };
    }
    if (typeof parsed?.rewrite_viable !== 'boolean' || !Array.isArray(parsed?.candidates)) {
      return invalid('candidate_envelope_invalid');
    }
    if (parsed.rewrite_viable === false) {
      if (parsed.candidates.length !== 0 || typeof parsed.reason_code !== 'string'
          || !parsed.reason_code.trim()) {
        return invalid('candidate_skip_contract_invalid');
      }
      return {
        rewrite_viable: false,
        reason_code: parsed.reason_code.trim(),
        candidates: [],
        structure_valid: true,
        structure_error: '',
      };
    }
    if (parsed.candidates.length < 1 || parsed.candidates.length > 3) {
      return invalid('candidate_count_invalid');
    }
    const candidates = parsed.candidates.map((candidate, index) => (
      parseStructuredRewriteCandidate(candidate, index + 1)
    ));
    const ranks = candidates.filter((candidate) => candidate.structure_valid)
      .map((candidate) => candidate.tm_rank);
    if (new Set(ranks).size !== ranks.length) {
      return invalid('candidate_tm_rank_duplicate');
    }
    return {
      rewrite_viable: true,
      reason_code: null,
      candidates,
      structure_valid: candidates.some((candidate) => candidate.structure_valid),
      structure_error: candidates.every((candidate) => !candidate.structure_valid)
        ? 'candidate_required_field_invalid'
        : '',
    };
  } catch (error) {
    return invalid(`candidate_json_invalid: ${error.message}`);
  }
}
