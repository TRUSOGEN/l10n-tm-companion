/**
 * content.js — Content Script
 *
 * 注入飞书文档页面 (feishu.cn/docx/*, larksuite.com/docx/*, larkoffice.com/wiki/*)，
 * 负责抓取原文案。支持两种模式：
 *   - extract_all      批量抓取全文段落
 *   - extract_selection 抓取用户当前选中的文本
 *
 * 输出统一数据结构：
 *   { id, source_text, context, location, char_count }
 *
 * 兼容性说明（BX1 修复）：
 *   - docx 页面块选择器为 div[data-block-id]，文本节点用 [data-string="true"] 等。
 *   - wiki 页面（/wiki/*）DOM 结构不同：内容容器为 .wiki-content / [role="main"]，
 *     块可能用 [data-record-id] / .wiki-block / .suite-markdown，无 data-block-id。
 *   - 因此抓取逻辑需多套选择器 + 内容容器兜底，并对文本去重去噪，
 *     否则 wiki 页面 querySelectorAll('div[data-block-id]') 返回空 → 弹窗「未抓取到文案」。
 */

// content.js 诊断日志：确认脚本已执行（若看不到此日志，说明注入失败或加载报错）
console.log('[content] content.js 已加载，开始注册');

// 导出纯函数供单测使用（content script 环境无 module，故挂到 self）
if (typeof self !== 'undefined') {
  self.__l10n_extract = { extractAllFromRoot, extractFromBodyFallback, collectTextBlocks, extractTextFromEl, isUIElement, isHeadingEl, _extractFromRows, _extractFromBlocks, _isRealSegment };
}

const FEISHU_BLOCK_SELECTOR = 'div[data-block-id]';
// wiki 页面内容容器与块选择器（BX1：wiki DOM 与 docx 不同）
const WIKI_ROOT_SELECTORS = [
  '.wiki-content',
  '.wiki-body',
  '[role="main"]',
  '.suite-markdown',
  'article',
  '.docx-content',
  'main',
];
const WIKI_BLOCK_SELECTORS = [
  '[data-record-id]',
  '.wiki-block',
  '.suite-markdown-block',
  'div[data-block-id]',
  'p',
  'li',
  'h1', 'h2', 'h3',
];
// 段落块常见的文本容器，用于提取纯文本（docx 专属 + 通用兜底）
const TEXT_NODE_SELECTORS = [
  '[data-string="true"]',
  '.docx-text-block',
  '.block-title-content',
  '.docx-content',
  '.wiki-block-content',
  '.suite-markdown-text',
  'p',
];

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.action) return false;

  try {
    if (msg.action === 'extract_all') {
      const data = extractAllText();
      sendResponse({ items: data, docTitle: getDocTitle(), diag: collectDiag() });
    } else if (msg.action === 'extract_selection') {
      const data = extractSelectedText();
      sendResponse({ items: data, docTitle: getDocTitle(), diag: collectDiag() });
    } else {
      sendResponse({ error: `Unknown action: ${msg.action}` });
    }
  } catch (e) {
    sendResponse({ error: `Extract failed: ${e.message}` });
  }
  return true; // 异步响应
});

/**
 * DOM 诊断（无需用户开 DevTools）：探测正文样本所在容器 + iframe 同源情况。
 * 返回字符串，popup 直接显示在弹窗状态区，供定位「抓不到正文」根因。
 * Round16：同时探测同源 iframe 内部的正文样本 + 抓取到的 items 数，判断懒加载。
 */
function collectDiag() {
  try {
    const samples = [];
    const all = document.querySelectorAll('td, div, p, li, span');
    for (const el of all) {
      if (el.children.length > 3) continue;
      const t = (el.textContent || '').trim();
      // 像「真原文」的：长度 30-300、含空格、非快捷键
      if (t.length >= 30 && t.length <= 300 && /\s/.test(t) && !/[⌘⇧]/.test(t)) {
        samples.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 60), text: t.slice(0, 50) });
      }
      if (samples.length >= 6) break;
    }
    // 探测同源 iframe 内部的正文样本 + 文本量
    const iframeSamples = [];
    const iframes = [...document.querySelectorAll('iframe')].map((f) => {
      let len = 0, same = false, innerSamples = [];
      try {
        same = !!f.contentDocument;
        len = f.contentDocument?.body?.innerText?.length || 0;
        // 找 iframe 内的真原文样本（判断正文是否在此 iframe + 在什么标签）
        const innerAll = f.contentDocument?.querySelectorAll('td, div, p, li, span') || [];
        for (const el of innerAll) {
          if (el.children.length > 3) continue;
          const t = (el.textContent || '').trim();
          if (t.length >= 30 && t.length <= 300 && /\s/.test(t) && !/[⌘⇧]/.test(t)) {
            innerSamples.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 50), text: t.slice(0, 40) });
          }
          if (innerSamples.length >= 3) break;
        }
        iframeSamples.push(...innerSamples);
      } catch (e) {}
      return { src: (f.src || '').slice(0, 50), sameOrigin: same, textLen: len, innerSampleCount: innerSamples.length };
    });
    return JSON.stringify({
      bodyTextLen: document.body?.innerText?.length || 0,
      iframeCount: iframes.length,
      iframes,
      topFrameSamples: samples,
      iframeTextSamples: iframeSamples,
    });
  } catch (e) {
    return 'diag error: ' + e.message;
  }
}

// ===== 文档标题 =====
function getDocTitle() {
  const raw = document.querySelector('meta[name="description"]')?.getAttribute('content') ||
         document.title ||
         'Feishu doc';
  return cleanText(raw); // 去零宽字符（飞书文档标题常含大量 U+200B 等）
}

// ===== 批量模式：抓取全文 =====
function extractAllText() {
  // 真机根因（Round15）：飞书 wiki 正文在同源 iframe 里，顶层 body 只有侧栏菜单。
  // 必须遍历所有同源 iframe，合并各 frame 抓取结果。
  const allItems = [];
  const allRoots = _collectRoots(document); // [top document, ...同源 iframe contentDocument]

  for (const root of allRoots) {
    const items = _extractFromOneRoot(root);
    if (items.length > 0) allItems.push(...items);
  }
  return _diag(allItems, allRoots.length > 1 ? 'multi-frame' : 'single');
}

/**
 * 收集所有抓取根：顶层 document + 所有同源 iframe 的 contentDocument（递归）。
 * 跨域 iframe 访问 contentDocument 会抛异常，try/catch 跳过。
 */
function _collectRoots(doc, depth = 0) {
  const roots = [doc];
  if (depth > 3) return roots; // 防递归过深
  try {
    const iframes = doc.querySelectorAll('iframe');
    for (const f of iframes) {
      try {
        const inner = f.contentDocument;
        if (inner && inner.body) roots.push(..._collectRoots(inner, depth + 1));
      } catch (e) { /* 跨域 iframe，跳过 */ }
    }
  } catch (e) { /* 忽略 */ }
  return roots;
}

/**
 * 从单个 root（document）抓取段落。优先 docx 块 → wiki 容器 → body 兜底。
 */
function _extractFromOneRoot(rootDoc) {
  const docBlocks = rootDoc.querySelectorAll(FEISHU_BLOCK_SELECTOR);
  if (docBlocks.length > 0) {
    const fromDocx = extractAllFromRoot(rootDoc, false);
    if (fromDocx.length > 0) return fromDocx;
  }
  const fromWiki = extractAllFromRoot(rootDoc, true);
  if (fromWiki.length > 0) return fromWiki;
  return extractFromBodyFallback(rootDoc);
}

/**
 * 抓取诊断：打印总数、来源、前 5 条 source_text、文本长度分布。
 * 用于排查「39 行变 636 条」这类粒度问题——必须看清抓到的内容才能精确修。
 */
function _diag(items, source) {
  try {
    const lens = items.map((i) => (i.source_text || '').length).sort((a, b) => a - b);
    const buckets = { '<10': 0, '10-30': 0, '30-80': 0, '80-200': 0, '>200': 0 };
    for (const n of lens) {
      if (n < 10) buckets['<10']++;
      else if (n < 30) buckets['10-30']++;
      else if (n < 80) buckets['30-80']++;
      else if (n < 200) buckets['80-200']++;
      else buckets['>200']++;
    }
    console.log('[content] 抓取诊断 source=' + source + ' count=' + items.length);
    console.log('[content] 长度分布:', JSON.stringify(buckets));
    console.log('[content] 前5条 source_text:');
    items.slice(0, 5).forEach((it, i) =>
      console.log('  [' + i + '] (len=' + (it.source_text || '').length + ') ' + (it.source_text || '').slice(0, 120))
    );
    console.log('[content] 最后2条 source_text:');
    items.slice(-2).forEach((it, i) =>
      console.log('  [尾' + i + '] (len=' + (it.source_text || '').length + ') ' + (it.source_text || '').slice(0, 120))
    );
  } catch (e) { /* 诊断不影响抓取 */ }
  return items;
}

/**
 * 全文段落兜底：不依赖任何飞书专属选择器，一次性按块级元素抓取可见文本段落。
 * 这是「真机 DOM 真相未知」时的保底方案。
 *
 * 性能（关键）：飞书 wiki 真实页面 DOM 极其庞大（数万节点），必须 O(n)：
 *   - 只发一次 querySelectorAll（O(n)），不嵌套 querySelectorAll（会变 O(n²)）
 *   - 不向前遍历兄弟找 heading（O(n²)），改为顺序遍历时记录最近标题
 *   - extractTextFromEl 只取叶子文本，不再对子树跑多 selector
 */
function extractFromBodyFallback(rootDoc) {
  const root = (rootDoc && rootDoc.body) ? rootDoc.body : (rootDoc || document.body);
  if (!root) return [];

  // === 表格行优先（2026-06-26 真机根因修复）===
  // 真机诊断：wiki 页实际嵌入了电子表格/公式参考表，旧选择器 'p,li,...,td'
  // 把每个 td 单元格（函数名 ABS/ACOS 等单词）都抓成一条 → 614 条噪声，
  // 真正的 39 行原文被淹没。用户需求是「一行一段话」→ 表格按 <tr> 抓才对。
  const rows = root.querySelectorAll('tr');
  if (rows.length >= 3) {
    const rowResults = _extractFromRows(rows);
    if (rowResults.length > 0) return rowResults;
  }

  // === 退回块级段落（无表格时）===
  // 注意：不再抓 td（单元格单词噪声）。只抓整段容器。
  const blockEls = root.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote');
  if (!blockEls || blockEls.length === 0) return [];
  return _extractFromBlocks(blockEls);
}

/**
 * 从表格行抓取：一行 <tr> = 一条 source_text。
 * 把整行所有单元格文本按列顺序拼接，适合「一行一段话」的表格式文档。
 */
function _extractFromRows(rows) {
  const results = [];
  const seenText = new Set();
  let lastHeading = 'Document root';
  let idx = 0;
  for (const tr of rows) {
    if (isUIElement(tr)) continue;
    // 整行文本：拼接所有 td/th，按制表符或空格分隔
    const cells = tr.querySelectorAll('td, th');
    if (!cells.length) continue;
    const parts = [];
    cells.forEach((c) => {
      if (isUIElement(c)) return;
      const t = cleanText(c.textContent || '');
      if (t) parts.push(t);
    });
    if (!parts.length) continue;
    // 多列：取最长的那列作为正文（其余可能是序号/标签）
    // 单列：直接用。这样过滤掉「序号列」噪声。
    let text;
    if (parts.length === 1) {
      text = parts[0];
    } else {
      text = parts.reduce((a, b) => (b.length > a.length ? b : a), '');
      // 若最长列仍是短单词（函数名），整行拼接兜底
      if (text.length < 8) text = parts.join(' ');
    }
    if (!_isRealSegment(text)) continue;
    if (seenText.has(text)) continue;
    seenText.add(text);
    // 标题行（th 单元格）记为 heading 不产出；不靠「短无标点」启发式（会误吞正文）
    const isHeaderRow = tr.querySelector('th') && !tr.querySelector('td');
    if (isHeaderRow) {
      lastHeading = text;
      continue;
    }
    results.push({
      id: `tr-${idx}`,
      source_text: text,
      context: lastHeading,
      location: `Row ${idx + 1}`,
      char_count: text.length,
    });
    idx++;
  }
  return results;
}

/**
 * 从块级段落抓取（无表格场景）。复用旧逻辑 + 真实段落过滤。
 */
function _extractFromBlocks(blockEls) {
  const results = [];
  const seen = new Set();
  const seenText = new Set();
  let lastHeading = 'Document root';
  let idx = 0;
  for (const el of blockEls) {
    if (seen.has(el)) continue;
    if (isUIElement(el)) continue;
    const text = cleanText(el.textContent || '');
    if (!_isRealSegment(text)) continue;
    seen.add(el);
    if (isHeadingEl(el)) {
      lastHeading = text;
      continue;
    }
    if (text === lastHeading) continue;
    if (seenText.has(text)) continue;
    seenText.add(text);
    results.push({
      id: `fb-${idx}`,
      source_text: text,
      context: lastHeading,
      location: `Paragraph ${idx + 1}`,
      char_count: text.length,
    });
    idx++;
  }
  return results;
}

/**
 * 判断是否「真实待翻段落」，过滤函数名/UI 噪声。
 * 真机根因：614 条里 462 条是 <10 字符的函数名（ABS/ACOS）+ 快捷键提示。
 * 规则：长度≥8 且（含空格=多词句 或 含标点=完整句）；纯单词且<12 字符视为噪声。
 */
function _isRealSegment(text) {
  if (!text || text.length < 2) return false;
  // 快捷键/UI 噪声：含 ⌘/Fn/Ctrl/Shift 组合或方括号快捷键
  if (/[⌘⇧⌥⌃]|Fn\s*\+|Ctrl\+|Shift\+|Alt\+|\[\s*$/m.test(text)) return false;
  // 纯单个 token 且短（函数名 ABS/ACOSH 等）
  const isSingleToken = !/\s/.test(text);
  if (isSingleToken && text.length < 12) return false;
  // 极短无标点的多词（如 "View all"）
  if (text.length < 8 && !/[.,;:!?。，；：！？]/.test(text)) return false;
  return true;
}

/**
 * 从给定 root（document 或容器元素）抓取段落。
 * isWiki=true 时走 wiki 选择器集合 + 内容容器兜底。
 */
function extractAllFromRoot(rootDoc, isWiki) {
  const root = rootDoc.body ? rootDoc : rootDoc;
  const containers = isWiki ? findWikiContainers(root) : [root];

  let blockEls;
  if (isWiki) {
    blockEls = collectTextBlocks(containers, WIKI_BLOCK_SELECTORS);
  } else {
    blockEls = Array.from(root.querySelectorAll(FEISHU_BLOCK_SELECTOR));
  }

  const results = [];
  const seen = new Set(); // 去重：wiki 多选择器可能命中同一节点
  let lastHeading = 'Document root';
  let idx = 0;

  for (const block of blockEls) {
    if (seen.has(block)) continue;
    seen.add(block);
    if (isUIElement(block)) continue;

    const headingText = findNearestHeading(block);
    if (headingText) lastHeading = headingText;

    const text = extractTextFromEl(block);
    if (!text) continue;

    if (isHeadingEl(block) && text === lastHeading) continue;

    results.push({
      id: `p-${idx}`,
      source_text: text,
      context: lastHeading,
      location: `Paragraph ${idx + 1}`,
      char_count: text.length,
    });
    idx++;
  }

  return results;
}

/**
 * 在多个候选容器里，按 selectors 收集文本块元素（去重、保留文档顺序）。
 */
function collectTextBlocks(containers, selectors) {
  const out = [];
  const seen = new Set();
  const push = (el) => {
    if (el && !seen.has(el)) { seen.add(el); out.push(el); }
  };
  for (const c of containers) {
    if (!c) continue;
    for (const sel of selectors) {
      if (c.matches && c.matches(sel)) push(c);
      c.querySelectorAll?.(sel).forEach(push);
    }
  }
  return out;
}

/** 定位 wiki 内容容器；找不到则回退到 root。 */
function findWikiContainers(root) {
  const found = [];
  for (const sel of WIKI_ROOT_SELECTORS) {
    const els = root.querySelectorAll?.(sel);
    if (els && els.length) els.forEach((e) => found.push(e));
    if (found.length) break;
  }
  return found.length ? found : [root];
}

/**
 * 从一个元素里提取干净文本。
 * 优先用飞书/wiki 文本节点拼接，回退到 textContent，并清理空白与噪声。
 */
function extractTextFromEl(el) {
  for (const sel of TEXT_NODE_SELECTORS) {
    const nodes = el.matches(sel) ? [el] : Array.from(el.querySelectorAll(sel));
    if (nodes.length > 0) {
      const text = nodes.map((n) => n.textContent).join('').trim();
      if (text) return cleanText(text);
    }
  }
  const raw = el.textContent?.trim();
  return raw ? cleanText(raw) : '';
}

/** 规范化文本：合并连续空白、去除零宽字符与首尾空白。 */
function cleanText(text) {
  // 去零宽字符 (U+200B-200D, U+2060, U+FEFF) + 合并连续空白
  return String(text)
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ===== 选中模式：抓取选中文本 =====
function extractSelectedText() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return [];

  const text = selection.toString().trim();
  if (text.length === 0) return [];

  return [{
    id: `sel-${Date.now()}`,
    source_text: text,
    context: getSelectionContext(selection),
    location: 'User selection',
    char_count: text.length
  }];
}

/**
 * 选取所在 section 标题作为上下文。
 * 向上查找最近的标题块（兼容 docx data-block-id 与 wiki 块）。
 */
function getSelectionContext(selection) {
  let node = selection.anchorNode;
  while (node && node.nodeType !== Node.ELEMENT_NODE) {
    node = node.parentElement;
  }
  while (node) {
    const block = node.closest?.('[data-block-id], [data-record-id], .wiki-block, p, h1, h2, h3');
    if (block) {
      const heading = findNearestHeading(block);
      if (heading) return heading;
    }
    node = node.parentElement;
  }
  return 'Document root';
}

// ===== UI 元素过滤 =====
function isUIElement(el) {
  return !!(
    el.closest('[role="toolbar"]') ||
    el.closest('[role="menu"]') ||
    el.closest('button') ||
    el.closest('.doc-toolbar') ||
    el.closest('.comment-card') ||
    el.closest('.docx-comment') ||
    el.closest('[data-block-type="callout"]')
  );
}

// ===== 标题块判断与查找 =====
// isHeadingBlock 保留为别名（向后兼容），逻辑委托给 isHeadingEl
function isHeadingBlock(block) {
  return isHeadingEl(block);
}

/** 判断元素是否为标题块（兼容 docx / wiki）。 */
function isHeadingEl(block) {
  if (!block) return false;
  return !!(
    block.matches?.('h1, h2, h3, h4, h5, h6') ||
    block.matches?.('[data-block-type="heading"]') ||
    block.matches?.('.wiki-heading') ||
    block.querySelector?.('h1, h2, h3, h4, [data-block-type="heading"]')
  );
}

/**
 * 向上/向前查找最近的标题文本，作为上下文。
 */
function findNearestHeading(block) {
  // 先看自身是否标题
  if (isHeadingEl(block)) {
    const t = extractTextFromEl(block);
    if (t) return t;
  }
  // 向前遍历兄弟块
  let node = block.previousElementSibling;
  while (node) {
    if (isHeadingEl(node)) {
      const t = extractTextFromEl(node);
      if (t) return t;
    }
    node = node.previousElementSibling;
  }
  return null;
}
