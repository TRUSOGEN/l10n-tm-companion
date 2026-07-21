/**
 * New Match % 确定性打分模块（method = new_match_v1）
 * ====================================================
 * LOOP_SPEC §5.2：New Match % 必须确定性、可复现、无 LLM。
 *
 * 定义：比较
 *   Rewritten Segment（AI 改写后的英文原文）
 *   vs
 *   Matched TM source segment（TM 库里匹配到的原文）
 *
 * 固定算法（权重固定，不可调以保确定性）：
 *   New Match % = 0.5 * token_set_similarity
 *               + 0.3 * char_levenshtein_similarity
 *               + 0.2 * ngram_similarity
 *
 * 三项均为 0-1，加权后 ×100 取整，范围固定 0-100。
 *
 * normalization 固定：trim + lowercase + 去标点（保留 CJK）+ 按非字母数字拆词。
 * 无空格语言（中/日/韩）按字符处理 token。
 */

export const NEW_MATCH_METHOD = 'new_match_v1';

// 固定权重（LOOP_SPEC §5.2）—— 冻结，禁止运行期修改以保确定性。
const WEIGHTS = Object.freeze({ tokenSet: 0.5, levenshtein: 0.3, ngram: 0.2 });
const W_TOKEN_SET = WEIGHTS.tokenSet;
const W_LEVENSHTEIN = WEIGHTS.levenshtein;
const W_NGRAM = WEIGHTS.ngram;

/** 固定权重（只读导出，供可解释性/测试断言）。 */
export const NEW_MATCH_WEIGHTS = WEIGHTS;

// 固定 normalization
function normalize(text) {
  if (!text) return '';
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, ' ')
    .trim();
}

/** 导出 normalize 供测试断言固定性（不用于外部调用）。 */
export const _normalize = normalize;

function tokenize(text) {
  const n = normalize(text);
  if (!n) return [];
  // 有空格按词分，无空格按字符（CJK）
  return /\s/.test(n) ? n.split(/\s+/).filter(Boolean) : [...n];
}

// 1) token set similarity（Jaccard over token sets）
function tokenSetSim(tokensA, tokensB) {
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  setA.forEach((t) => { if (setB.has(t)) inter++; });
  const union = setA.size + setB.size - inter;
  return union > 0 ? inter / union : 0;
}

// 2) char-level Levenshtein similarity (0-1)
function levenshteinSim(a, b) {
  if (a === b) return 1;
  const m = a.length, n = b.length;
  if (m === 0 || n === 0) return 0;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return 1 - prev[n] / Math.max(m, n);
}

// 3) n-gram similarity（bigram Jaccard，字符级，兼容 CJK）
function ngramSim(a, b, n = 2) {
  if (!a || !b) return 0;
  const gramsA = new Set();
  const gramsB = new Set();
  for (let i = 0; i + n <= a.length; i++) gramsA.add(a.slice(i, i + n));
  for (let i = 0; i + n <= b.length; i++) gramsB.add(b.slice(i, i + n));
  if (gramsA.size === 0 || gramsB.size === 0) {
    // 过短无法成 bigram，退化用字符集相似
    const setA = new Set([...a]);
    const setB = new Set([...b]);
    let inter = 0;
    setA.forEach((c) => { if (setB.has(c)) inter++; });
    const union = setA.size + setB.size - inter;
    return union > 0 ? inter / union : 0;
  }
  let inter = 0;
  gramsA.forEach((g) => { if (gramsB.has(g)) inter++; });
  const union = gramsA.size + gramsB.size - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * New Match % 打分（0-100）。
 * @param {string} rewrittenSegment  AI 改写后的英文原文
 * @param {string} tmSourceSegment  TM 库里匹配到的原文
 * @returns {{score:number, method:string, weights:object}}
 */
export function newMatchPercent(rewrittenSegment, tmSourceSegment) {
  const a = normalize(rewrittenSegment);
  const b = normalize(tmSourceSegment);
  if (!a || !b) return { score: 0, method: NEW_MATCH_METHOD, weights: WEIGHTS };
  if (a === b) return { score: 100, method: NEW_MATCH_METHOD, weights: WEIGHTS };

  const tokensA = tokenize(rewrittenSegment);
  const tokensB = tokenize(tmSourceSegment);

  const s1 = tokenSetSim(tokensA, tokensB);
  const s2 = levenshteinSim(a, b);
  const s3 = ngramSim(a, b);

  const raw = W_TOKEN_SET * s1 + W_LEVENSHTEIN * s2 + W_NGRAM * s3;
  const score = Math.round(Math.max(0, Math.min(1, raw)) * 100);
  return { score, method: NEW_MATCH_METHOD, weights: WEIGHTS };
}
