/**
 * Content Review skill 静态规则加载与确定性相关片段检索。
 *
 * 原始 Markdown 是唯一规则源；本模块只加载 TM alignment、Skill、Principles
 * 与唯一一份 Legal Guidelines，并按当前 source/TM 文本选择相关内容。
 */

const ROOT = 'skills/cd-content-review-version-2';
const ASSET_PATHS = Object.freeze({
  skill: `${ROOT}/SKILL.md`,
  tmAlignment: `${ROOT}/references/tm-alignment-prompt.md`,
  principles: `${ROOT}/references/content-review-principles.md`,
  gameLegal: `${ROOT}/references/game-legal-guidelines.md`,
  revenueLegal: `${ROOT}/references/revenue-legal-guidelines.md`,
});

let assetPromise;
const CONTEXT_CHAR_LIMITS = Object.freeze({
  skillExcerpt: 800,
  principles: 1200,
  legalExcerpt: 1200,
});

/** 从扩展包读取完整规则资产；任一文件缺失时正确失败。 */
export async function loadContentReviewAssets() {
  if (!assetPromise) {
    assetPromise = Promise.all(Object.entries(ASSET_PATHS).map(async ([key, path]) => {
      if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) {
        throw new Error('Content Review assets require the Chrome extension runtime.');
      }
      const response = await fetch(chrome.runtime.getURL(path));
      if (!response.ok) throw new Error(`Content Review asset unavailable: ${path} (${response.status})`);
      const text = await response.text();
      if (!text.trim()) throw new Error(`Content Review asset is empty: ${path}`);
      return [key, text];
    })).then(Object.fromEntries).catch((error) => {
      assetPromise = null;
      throw error;
    });
  }
  return assetPromise;
}

/** 使用明确的 gaming 语义选择唯一 Legal Guidelines。 */
export function selectLegalGuideline(text) {
  const normalized = String(text || '').toLowerCase();
  const gameRelated = /\b(gameplay|gaming|game round|game task|game mission|game reward|player participation|in-game|video game)\b/.test(normalized);
  return { kind: gameRelated ? 'game' : 'revenue' };
}

/** 将 Markdown 拆成可检索的小节。 */
function markdownSections(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const sections = [];
  let current = { title: 'Introduction', lines: [] };
  for (const line of lines) {
    if (/^#{2,4}\s+/.test(line)) {
      if (current.lines.some((value) => value.trim())) sections.push(current);
      current = { title: line.replace(/^#+\s*/, '').trim(), lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.some((value) => value.trim())) sections.push(current);
  return sections;
}

function keywords(text) {
  return [...new Set(String(text || '').toLowerCase().match(/[a-z][a-z'-]{2,}/g) || [])]
    .filter((word) => !['the', 'and', 'with', 'from', 'this', 'that', 'your', 'you', 'for'].includes(word));
}

function relevantSections(markdown, query, limit = 3) {
  const terms = keywords(query);
  return markdownSections(markdown).map((section, index) => {
    const haystack = `${section.title}\n${section.lines.join('\n')}`.toLowerCase();
    const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
    return { section, score, index };
  }).filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(({ section }) => section.lines.join('\n').trim())
    .join('\n\n');
}

/** 按换行边界裁剪规则证据，保证完整 prompt 不会淹没任务与输出协议。 */
function boundedExcerpt(value, maxChars) {
  const text = String(value || '').trim();
  if (text.length <= maxChars) return text;
  const marker = '\n[Evidence excerpt truncated]';
  const available = Math.max(0, maxChars - marker.length);
  const prefix = text.slice(0, available);
  const boundary = prefix.lastIndexOf('\n');
  const body = boundary >= Math.floor(available * 0.6)
    ? prefix.slice(0, boundary)
    : prefix;
  return `${body.trimEnd()}${marker}`.slice(0, maxChars);
}

/** 为一条 source 构建可审计且只含一份 Legal Guidelines 的规则上下文。 */
export function buildContentReviewContext({ sourceText, tmSource, context = '', assets }) {
  if (!assets?.skill || !assets?.tmAlignment || !assets?.principles
      || !assets?.gameLegal || !assets?.revenueLegal) {
    throw new Error('Content Review rule assets are incomplete.');
  }
  const query = [sourceText, tmSource, context].filter(Boolean).join('\n');
  const legal = selectLegalGuideline(query);
  const legalDocument = legal.kind === 'game' ? assets.gameLegal : assets.revenueLegal;
  const principles = relevantSections(
    assets.principles,
    `${query}\nmeaning accuracy preserve concise grammar terminology localization safety`,
    4,
  ) || assets.principles;
  return {
    promptTemplate: boundedExcerpt(assets.tmAlignment, 3000),
    skillExcerpt: boundedExcerpt(relevantSections(
      assets.skill,
      'review rules references authoritative review principles legal',
      4,
    ) || 'No Content Review Skill instruction was selected.', CONTEXT_CHAR_LIMITS.skillExcerpt),
    principles: boundedExcerpt(principles, CONTEXT_CHAR_LIMITS.principles),
    legalExcerpt: boundedExcerpt(
      relevantSections(legalDocument, query) || `No directly matching ${legal.kind} legal section.`,
      CONTEXT_CHAR_LIMITS.legalExcerpt,
    ),
    legalKind: legal.kind,
  };
}
