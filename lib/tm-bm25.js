/**
 * 本地 BM25-like TM 匹配 fallback（method = local_bm25_v1）
 * ============================================================
 * LOOP_SPEC §4.2：当 Starling 不可用时，用固定的 ES-like/BM25 方法做确定性兜底。
 *
 * 特点：
 *   - 纯 JS，无后端，无网络
 *   - 确定性：相同 query + 相同 corpus → 永远相同结果（无随机、无 LLM）
 *   - 固定 normalization + 固定 BM25 参数 + 确定性 re-rank（tie-break 按 corpus 顺序）
 *
 * 用法：
 *   const r = bm25Match('Send a gift', [
 *     { source: 'Send gifts', target: '送礼物' },
 *     { source: 'Cancel',     target: '取消' },
 *   ]);
 *   // → { best: {source,target}, score: <0-100>, method:'local_bm25_v1', candidate_count:2, tm_source, tm_match }
 *
 * 注：corpus 由调用方提供（如本地 TM 残留 / 用户导入）。无 corpus 时返回空。
 */

export const BM25_METHOD = 'local_bm25_v1';

// BM25 参数（固定，不可调以保确定性）
const K1 = 1.5;
const B = 0.75;

// 固定 normalization：小写 + 去标点 + 按非字母数字拆词
function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function docFreq(corpus) {
  const df = new Map();
  for (const doc of corpus) {
    const tokens = new Set(tokenize(doc.source));
    for (const t of tokens) df.set(t, (df.get(t) || 0) + 1);
  }
  return df;
}

function bm25Score(queryTokens, docTokens, docFreqMap, nDocs, avgDl) {
  // docTokens: 词频 map
  let score = 0;
  const dl = docTokens.__length || 0;
  for (const qt of queryTokens) {
    const f = docTokens[qt] || 0;
    if (f === 0) continue;
    const df = docFreqMap.get(qt) || 0;
    const idf = Math.log(1 + (nDocs - df + 0.5) / (df + 0.5));
    const denom = f * (K1 + 1);
    const num = f + K1 * (1 - B + B * (dl / (avgDl || 1)));
    score += idf * (denom / num);
  }
  return score;
}

function buildDocTokens(source) {
  const tokens = tokenize(source);
  const map = { __length: tokens.length };
  for (const t of tokens) map[t] = (map[t] || 0) + 1;
  return map;
}

/**
 * 对 query 在 corpus 上做 BM25 检索，返回最匹配的一条。
 * @param {string} query
 * @param {Array<{source:string,target:string}>} corpus
 * @returns {{best:object|null, score:number, method:string, candidate_count:number, tm_source:string, tm_match:string}}
 *   score 0-100（归一化到百分制）。candidate_count = corpus 长度。
 */
export function bm25Match(query, corpus = []) {
  if (!Array.isArray(corpus) || corpus.length === 0) {
    return { best: null, score: 0, method: BM25_METHOD, candidate_count: 0, tm_source: '', tm_match: '' };
  }
  if (!query) {
    return { best: null, score: 0, method: BM25_METHOD, candidate_count: corpus.length, tm_source: '', tm_match: '' };
  }

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return { best: null, score: 0, method: BM25_METHOD, candidate_count: corpus.length, tm_source: '', tm_match: '' };
  }

  const docFreqMap = docFreq(corpus);
  const nDocs = corpus.length;
  const avgDl = corpus.reduce((s, d) => s + tokenize(d.source).length, 0) / nDocs;
  const builtDocs = corpus.map((d) => buildDocTokens(d.source));

  let bestIdx = -1;
  let bestRaw = -Infinity;
  // 确定性 re-rank：遍历按 corpus 顺序，相等分数取先出现的（tie-break 稳定）
  for (let i = 0; i < corpus.length; i++) {
    const raw = bm25Score(queryTokens, builtDocs[i], docFreqMap, nDocs, avgDl);
    if (raw > bestRaw) {
      bestRaw = raw;
      bestIdx = i;
    }
  }

  if (bestIdx < 0 || bestRaw <= 0) {
    return { best: null, score: 0, method: BM25_METHOD, candidate_count: corpus.length, tm_source: '', tm_match: '' };
  }

  // 归一化到 0-100：用 query 与 best doc 的 token 重叠度做粗略上限校准。
  // BM25 raw 无固定上限，这里用 max(raw, tokenOverlap*100) 取一个稳定百分制：
  // 重叠度 = |query∩doc| / max(|query|,|doc|)，确定性。
  const bestDocTokens = tokenize(corpus[bestIdx].source);
  const qSet = new Set(queryTokens);
  const dSet = new Set(bestDocTokens);
  const overlap = [...qSet].filter((t) => dSet.has(t)).length;
  const union = new Set([...qSet, ...dSet]).size || 1;
  const overlapPct = (overlap / union) * 100;
  const score = Math.round(Math.max(Math.min(bestRaw * 25, 100), overlapPct));

  const best = corpus[bestIdx];
  return {
    best,
    score,
    method: BM25_METHOD,
    candidate_count: corpus.length,
    tm_source: best.source,
    tm_match: best.target,
  };
}
