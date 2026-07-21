/**
 * AI 改写 vs TM 对比模块
 * =========================
 * TM 优化流程：ai_translation = AI 改写后的源语言原文，tm_match = TM 最相似匹配译文。
 * 两者语言不同，不做逐词文本对比；改为基于 Orig/New Match % 的语义对比。
 *
 * similarity = Orig Match % (0-100 百分制，来自 starling-cli score)。
 *
 * Status 含义：
 *   no_tm      TM 无匹配              原文改写无参照，默认采纳改写
 *   same       改写后与 TM 达成高匹配  沿用 TM
 *   improved   改写后 New Match % 高于 Orig Match %  改写有效，采纳改写
 *   different  改写未明显提升匹配度   需人工确认
 */

import { newMatchPercent } from './new-match-scoring.js';
import { TM_MATCH_THRESHOLD } from './tm-threshold.js';

/**
 * @param {object} item 已含 ai_translation(改写原文) / tm_match / similarity(Orig,0-100) / new_match(New,0-100)
 * @returns {object}    附加 ai_vs_tm 字段
 */
export function compareAIvsTM(item) {
  const { ai_translation: aiText, tm_match: tmText, similarity = 0, new_match: newMatch } = item;

  // 无 TM 匹配
  if (!tmText || similarity === 0) {
    return {
      ...item,
      ai_vs_tm: {
        status: 'no_tm',
        changes: 'No TM match found. AI rewrite has no TM reference.',
        key_differences: [],
      },
    };
  }

  const origPct = Math.round(similarity);
  const newPct = newMatch != null ? Math.round(newMatch) : null;

  // 已达标（原文本身够接近 TM）或改写后与 TM 文本一致
  if (item.reuse_tm || (aiText && tmText && aiText.trim() === tmText.trim())) {
    return {
      ...item,
      ai_vs_tm: {
        status: 'same',
        changes: `Orig ${origPct}% already high. No rewrite needed; recommend reusing TM.`,
        key_differences: [],
      },
    };
  }

  // 基于匹配度变化判断
  // ⚠️ New Match 是文本相似度算法（Jaccard+Levenshtein），与 starling 真实 TM 命中率是两套度量，
  // 小幅波动（如 +1）是噪声。只有 New≥85（达标）或 delta≥5（明显提升）才判 improved，
  // 否则判 different（需人工 review），避免噪声误判。
  if (newPct != null) {
    const delta = newPct - origPct;
    if (newPct >= TM_MATCH_THRESHOLD || delta >= 5) {
      return {
        ...item,
        ai_vs_tm: {
          status: 'improved',
          changes: `Rewrite raised TM match: Orig ${origPct}% → New ${newPct}% (+${delta}).`,
          key_differences: [{ position: 0, tm: `Orig ${origPct}%`, ai: `New ${newPct}%`, reason: `delta ${delta >= 0 ? '+' : ''}${delta}` }],
        },
      };
    }
    return {
      ...item,
      ai_vs_tm: {
        status: 'different',
        changes: `Rewrite did not improve TM match: Orig ${origPct}% → New ${newPct}% (delta ${delta}). Needs CD review.`,
        key_differences: [{ position: 0, tm: `Orig ${origPct}%`, ai: `New ${newPct}%`, reason: `delta ${delta}` }],
      },
    };
  }

  // 无 New Match 数据（改写后未再查 TM）
  return {
    ...item,
    ai_vs_tm: {
      status: similarity >= TM_MATCH_THRESHOLD ? 'same' : 'different',
      changes: item.reasoning || `Orig ${origPct}%. No New Match % available.`,
      key_differences: [],
    },
  };
}

/**
 * 文本相似度（0-100 百分制）。
 * 用于 New Match%：Rewritten Segment（改写后原文）vs TM 库里那条匹配的原文（同语言）。
 *
 * 委托给确定性打分模块 lib/new-match-scoring.js（method = new_match_v1）：
 *   New Match % = 0.5 * token_set_similarity + 0.3 * char_levenshtein_similarity + 0.2 * ngram_similarity
 * 固定 normalization + 固定权重 + 无 LLM（LOOP_SPEC §5.2）。
 */
export function textSimilarity(textA, textB) {
  return newMatchPercent(textA, textB).score;
}
