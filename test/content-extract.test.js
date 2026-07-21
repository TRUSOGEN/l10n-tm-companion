// BX1：验证 content.js 的 wiki/doc 抓取可靠性。
// content.js 依赖浏览器 DOM（document/window）。这里用最小 DOM shim 注入，
// 验证纯函数：extractAllFromRoot / collectTextBlocks / extractTextFromEl / isHeadingEl / findWikiContainers / cleanText。
// 关键回归：wiki 页面（无 data-block-id）不再返回空数组。

// ---- 极简 DOM shim ----
// 构造一棵伪 DOM 树：每个节点 {tagName, attrs, text, children, parent}，
// 提供 querySelectorAll / matches / closest / textContent / previousElementSibling。
class El {
  constructor(tag, opts = {}) {
    this.tagName = (tag || 'div').toUpperCase();
    this.attrs = opts.attrs || {};
    this.text = opts.text || '';
    this.children = opts.children || [];
    this.parent = null;
    this.children.forEach((c) => (c.parent = this));
    this.previousElementSibling = null;
  }
  querySelectorAll(sel) {
    return queryAll(this, sel);
  }
  matches(sel) {
    return matchSel(this, sel);
  }
  closest(sel) {
    let n = this;
    while (n) {
      if (matchSel(n, sel)) return n;
      n = n.parent;
    }
    return null;
  }
  get textContent() {
    if (this.children.length === 0) return this.text;
    return this.text + this.children.map((c) => c.textContent).join('');
  }
  get nodeType() {
    return 1; // ELEMENT_NODE
  }
  querySelector(sel) {
    const all = queryAll(this, sel);
    return all[0] || null;
  }
}

// 极简选择器引擎：支持 "tag" / ".cls" / "[attr]" / "[attr=val]" / 复合（逗号分隔，空格后代）
function matchSel(el, sel) {
  return sel.split(',').some((s) => matchOne(el, s.trim()));
}
function matchOne(el, s) {
  // 拆成 tag + .cls* + [attr]* 复合
  const parts = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === '.') {
      let j = i + 1;
      while (j < s.length && /[\w-]/.test(s[j])) j++;
      parts.push({ t: 'cls', v: s.slice(i + 1, j) });
      i = j;
    } else if (s[i] === '[') {
      let j = s.indexOf(']', i);
      parts.push({ t: 'attr', v: s.slice(i + 1, j) });
      i = j + 1;
    } else if (/\w/.test(s[i])) {
      let j = i;
      while (j < s.length && /[\w-]/.test(s[j])) j++;
      parts.push({ t: 'tag', v: s.slice(i, j) });
      i = j;
    } else {
      i++;
    }
  }
  return parts.every((p) => {
    if (p.t === 'tag') return el.tagName === p.v.toUpperCase();
    if (p.t === 'cls') return (el.attrs.class || '').split(/\s+/).includes(p.v);
    if (p.t === 'attr') {
      const [k, v] = p.v.split('=');
      if (v == null) return k in el.attrs;
      return el.attrs[k] === v.replace(/["']/g, '');
    }
    return false;
  });
}
// 后代选择器：sel 形如 "a b c"（空格分隔后代）
function queryAll(root, sel) {
  const out = [];
  const groups = sel.split(',');
  const walk = (node) => {
    if (node !== root) {
      for (const g of groups) {
        const seq = g.trim().split(/\s+/);
        if (seq.length === 1) {
          if (matchOne(node, seq[0])) out.push(node);
        } else {
          // 后代链：最后一节匹配 node，且前面各节有祖先依次匹配
          if (matchOne(node, seq[seq.length - 1]) && hasAncestorChain(node, seq.slice(0, -1))) {
            out.push(node);
          }
        }
      }
    }
    node.children.forEach(walk);
  };
  walk(root);
  return out;
}
function hasAncestorChain(node, chain) {
  // chain: [最内层祖先, ..., 最外层祖先]，从 node 向上依次匹配
  let n = node.parent;
  for (let i = chain.length - 1; i >= 0; i--) {
    let matched = false;
    while (n) {
      if (matchOne(n, chain[i])) { matched = true; n = n.parent; break; }
      n = n.parent;
    }
    if (!matched) return false;
  }
  return true;
}

// ---- 装载 content.js ----
// content.js 顶部引用 document / self / chrome / window。注入 shim。
const fakeElements = [];
globalThis.document = {
  body: new El('body'),
  querySelector: (sel) => queryAll(globalThis.document.body, sel)[0] || null,
  querySelectorAll: (sel) => queryAll(globalThis.document.body, sel),
};
globalThis.window = { getSelection: () => null };
globalThis.chrome = { runtime: { onMessage: { addListener: () => {} } } };

// 通过 eval 把 content.js 源码在当前作用域加载（它用 self 挂载导出）
import { readFileSync } from 'fs';
const src = readFileSync(new URL('../content.js', import.meta.url), 'utf-8');
globalThis.self = globalThis;
// content.js 用 const 声明顶层常量；包一层函数作用域避免污染，但需把 __l10n_extract 挂到 self
// 已用 self.__l10n_extract = {...}，self===globalThis，可直接读取
eval(src);
const {
  extractAllFromRoot,
  extractFromBodyFallback,
  collectTextBlocks,
  extractTextFromEl,
  isHeadingEl,
  _extractFromRows,
  _isRealSegment,
} = globalThis.__l10n_extract;

let pass = 0, fail = 0;
const assert = (n, c, e = '') => c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${e}`));

// ---- 场景 1：docx 页面（有 data-block-id）----
console.log('\n=== BX1: docx 页面抓取（data-block-id）===');
{
  const p1 = new El('div', { attrs: { 'data-block-id': 'b1', class: 'docx-text-block' }, text: 'Send a gift' });
  const h = new El('div', { attrs: { 'data-block-id': 'b0', 'data-block-type': 'heading' }, text: 'Gifts' });
  const p2 = new El('div', { attrs: { 'data-block-id': 'b2', class: 'docx-text-block' }, text: 'Diamond balance' });
  h.previousElementSibling = null;
  p1.previousElementSibling = h;
  p2.previousElementSibling = p1;
  const root = new El('div', { children: [h, p1, p2] });
  const items = extractAllFromRoot(root, false);
  assert('docx 抓到 2 段（标题块被跳过）', items.length === 2, `got ${items.length}`);
  assert('第一段正文', items[0]?.source_text === 'Send a gift', items[0]?.source_text);
  assert('上下文为最近标题', items[0]?.context === 'Gifts', items[0]?.context);
}

// ---- 场景 2：wiki 页面（无 data-block-id，用 .wiki-content + p）— BX1 关键回归 ----
console.log('\n=== BX1: wiki 页面抓取（无 data-block-id，回退容器）===');
{
  const wiki = new El('div', { attrs: { class: 'wiki-content' } });
  const h2 = new El('h2', { text: 'Overview' });
  const para1 = new El('p', { text: 'This is the first wiki paragraph.' });
  const para2 = new El('p', { text: 'Second wiki paragraph with   extra spaces.' });
  const li = new El('li', { text: 'List item one' });
  wiki.children = [h2, para1, para2, li];
  [h2, para1, para2, li].forEach((c, i, arr) => {
    c.parent = wiki;
    c.previousElementSibling = i > 0 ? arr[i - 1] : null;
  });
  const root = new El('div', { children: [wiki] });

  const items = extractAllFromRoot(root, true);
  assert('wiki 回退抓到段落（不再返回空）', items.length >= 2, `got ${items.length}`);
  assert('抓到第一段正文', items.some((i) => i.source_text.includes('first wiki paragraph')), JSON.stringify(items.map((i) => i.source_text)));
  assert('合并多余空白', items.some((i) => i.source_text === 'Second wiki paragraph with extra spaces.'), '');
  assert('上下文为最近 h2 标题', items[0]?.context === 'Overview', items[0]?.context);
}

// ---- 场景 3：wiki 用 [data-record-id] 块 ----
console.log('\n=== BX1: wiki 用 data-record-id 块 ===');
{
  const main = new El('div', { attrs: { role: 'main' } });
  const r1 = new El('div', { attrs: { 'data-record-id': 'r1', class: 'wiki-block' }, text: 'Record text A' });
  const r2 = new El('div', { attrs: { 'data-record-id': 'r2', class: 'wiki-block' }, text: 'Record text B' });
  main.children = [r1, r2];
  [r1, r2].forEach((c) => (c.parent = main));
  r2.previousElementSibling = r1; r1.previousElementSibling = null;
  const root = new El('div', { children: [main] });
  const items = extractAllFromRoot(root, true);
  assert('data-record-id 块被抓取', items.length === 2, `got ${items.length}`);
  assert('内容正确', items[0]?.source_text === 'Record text A', items[0]?.source_text);
}

// ---- 场景 4：多选择器命中同一节点去重 ----
console.log('\n=== BX1: 多选择器去重 ===');
{
  const main = new El('div', { attrs: { role: 'main' } });
  // 一个 p 同时被 'p' 和 'li' 选择器... 用 wiki-block + data-record-id 双命中
  const dup = new El('div', { attrs: { 'data-record-id': 'd1', class: 'wiki-block' }, text: 'Duplicated node' });
  main.children = [dup];
  dup.parent = main;
  const root = new El('div', { children: [main] });
  const blocks = collectTextBlocks([main], ['[data-record-id]', '.wiki-block']);
  assert('去重后仅 1 个块', blocks.length === 1, `got ${blocks.length}`);
}

// ---- 场景 5：空页面 / 纯 UI 页面 ----
console.log('\n=== BX1: 空页面返回空数组 ===');
{
  const root = new El('div', { children: [] });
  const items = extractAllFromRoot(root, true);
  assert('空 wiki 页面返回 []', items.length === 0, `got ${items.length}`);
  assert('返回的是数组', Array.isArray(items));
}

// ---- 场景 6：cleanText 行为（经 extractTextFromEl）----
console.log('\n=== BX1: 文本清洗 ===');
{
  const el = new El('p', { text: '  Hello​‍   world\t\n  ' });
  assert('去零宽字符 + 合并空白', extractTextFromEl(el) === 'Hello world', `"${extractTextFromEl(el)}"`);
  const empty = new El('p', { text: '   ' });
  assert('纯空白返回空串', extractTextFromEl(empty) === '', extractTextFromEl(empty));
}

// ---- 场景 7：isHeadingEl 兼容 ----
console.log('\n=== BX1: 标题识别兼容 ===');
{
  assert('h2 是标题', isHeadingEl(new El('h2')));
  assert('data-block-type=heading 是标题', isHeadingEl(new El('div', { attrs: { 'data-block-type': 'heading' } })));
  assert('普通 p 不是标题', !isHeadingEl(new El('p')));
}

// ---- 场景 8：UI 元素被过滤（isUIElement 经 collectTextBlocks 间接验证）----
console.log('\n=== BX1: UI 元素过滤 ===');
{
  const main = new El('div', { attrs: { role: 'main' } });
  const toolbar = new El('div', { attrs: { role: 'toolbar' } });
  const tbBtn = new El('p', { text: 'toolbar noise' });
  const real = new El('p', { text: 'real content' });
  toolbar.children = [tbBtn]; tbBtn.parent = toolbar;
  main.children = [toolbar, real]; toolbar.parent = main; real.parent = main;
  real.previousElementSibling = toolbar; toolbar.previousElementSibling = null;
  const root = new El('div', { children: [main] });
  const items = extractAllFromRoot(root, true);
  assert('toolbar 内噪声被过滤', !items.some((i) => i.source_text === 'toolbar noise'), JSON.stringify(items.map((i) => i.source_text)));
  assert('真实内容保留', items.some((i) => i.source_text === 'real content'));
}

// ---- 场景 9：全文兜底——选择器全部落空（真实 wiki DOM 与推断不符）----
// 模拟：一个 wiki 页 body 里只有普通块级元素，不命中任何飞书专属选择器。
// 这是 BX1 在真机未验证通过的关键回归：兜底必须抓到内容，不能返回空数组。
console.log('\n=== BX1: 全文兜底（选择器全落空）===');
{
  // 构造一棵无 data-block-id / 无 wiki-content / 无 role=main 的纯文本 body
  const body = new El('body');
  const h2 = new El('h2', { text: 'Gift Feature Spec' });
  const p1 = new El('p', { text: 'Send a gift to the host.' });
  const p2 = new El('p', { text: 'Diamonds are the virtual currency.' });
  const li = new El('li', { text: 'Gift list item' });
  body.children = [h2, p1, p2, li];
  [h2, p1, p2, li].forEach((c, i, arr) => {
    c.parent = body;
    c.previousElementSibling = i > 0 ? arr[i - 1] : null;
  });
  // shim 的 document.body 就是这棵树；extractFromBodyFallback 直接读 document.body
  globalThis.document.body = body;

  const items = extractFromBodyFallback();
  assert('兜底抓到段落（不返回空数组）', items.length >= 3, `got ${items.length}`);
  assert('抓到正文内容', items.some((i) => i.source_text.includes('Send a gift to the host')), JSON.stringify(items.map((i) => i.source_text)));
  assert('标题作为上下文', items[0]?.context === 'Gift Feature Spec', items[0]?.context);
  assert('列表项也被抓取', items.some((i) => i.source_text === 'Gift list item'), '');
  // 嵌套块级去重：外层 div 包 p，只抓叶子 p，不重复抓 div
  const outer = new El('div');
  const inner = new El('p', { text: 'nested paragraph text' });
  outer.children = [inner]; inner.parent = outer;
  globalThis.document.body = new El('body');
  globalThis.document.body.children = [outer]; outer.parent = globalThis.document.body;
  const nested = extractFromBodyFallback();
  assert('嵌套块级只抓叶子段（不重复）', nested.filter((i) => i.source_text === 'nested paragraph text').length === 1, JSON.stringify(nested.map((i) => i.source_text)));
}

// ---- 场景 10：li 内嵌 p 文本去重（避免同段被抓两次）----
console.log('\n=== BX1: 嵌套文本去重（li>p）===');
{
  const body = new El('body');
  const li = new El('li');
  const p = new El('p', { text: 'shared paragraph text' });
  li.children = [p]; p.parent = li;
  body.children = [li]; li.parent = body;
  globalThis.document.body = body;
  // shim queryAll('p, li') 会同时命中 li 和其内部 p，textContent 都是同一段
  const items = extractFromBodyFallback();
  assert('li 与内嵌 p 同文本只出现一次', items.filter((i) => i.source_text === 'shared paragraph text').length === 1, JSON.stringify(items.map((i) => i.source_text)));
}

// ---- 场景 11：函数名噪声过滤（真机根因：614 条 ABS/ACOS）----
console.log('\n=== Round12: 函数名/UI 噪声过滤 ===');
{
  assert('单 token 短函数名 ABS 被判噪声', _isRealSegment('ABS') === false, 'ABS');
  assert('单 token 短函数名 ACOSH 被判噪声', _isRealSegment('ACOSH') === false, 'ACOSH');
  assert('快捷键提示 查看全部函数Shift+F3 被判噪声', _isRealSegment('查看全部函数Shift + Fn + F3') === false);
  assert('快捷键 ⌘+[ 被判噪声', _isRealSegment('查找公式引用的单元格⌘ + [') === false);
  assert('完整句子保留', _isRealSegment('Send a gift to your favorite streamer.') === true);
  assert('中文段落保留', _isRealSegment('请输入您的用户名和密码进行登录。') === true);
}

// ---- 场景 12：表格按行抓取（真机根因：39 行原文在表格里，旧逻辑抓 td 碎片）----
console.log('\n=== Round12: 表格按行抓取（一行一段）===');
{
  // 构造真机场景：表格首行标题，后 3 行每行一个单元格含完整句子
  const makeTr = (cells) => {
    const tr = new El('tr');
    tr.children = cells;
    cells.forEach((c) => (c.parent = tr));
    return tr;
  };
  const rows = [
    makeTr([new El('th', { text: 'Original Source Segment' })]),
    makeTr([new El('td', { text: 'Send a gift to your favorite streamer.' })]),
    makeTr([new El('td', { text: 'Diamond balance is updated after the gift.' })]),
    makeTr([new El('td', { text: 'Tap the gift icon to open the panel.' })]),
  ];
  const items = _extractFromRows(rows);
  assert('表格 4 行（含标题）产出 3 条数据行', items.length === 3, 'got ' + items.length + ': ' + JSON.stringify(items.map((i) => i.source_text)));
  assert('首行标题被当 heading 不产出', !items.some((i) => i.source_text === 'Original Source Segment'));
  assert('location 标记为 Row', items[0].location === 'Row 1', items[0].location);
}

// ---- 场景 13：函数名表格被整体过滤（行内只有短函数名）----
console.log('\n=== Round12: 函数名参考表行被过滤 ===');
{
  const makeTr = (cells) => {
    const tr = new El('tr');
    tr.children = cells; cells.forEach((c) => (c.parent = tr)); return tr;
  };
  const rows = [
    makeTr([new El('td', { text: 'ABS' }), new El('td', { text: 'Returns the absolute value' })]),
    makeTr([new El('td', { text: 'ACOS' }), new El('td', { text: 'Returns arccosine' })]),
  ];
  const items = _extractFromRows(rows);
  // 多列取最长列：'Returns the absolute value' 是真实段保留，'ABS' 被当噪声跳过整行只有 ABS 时
  // 这里每行最长列是描述句，应保留
  assert('函数名表里描述列被保留', items.length === 2, 'got ' + items.length);
  assert('不抓函数名本身', !items.some((i) => i.source_text === 'ABS'), JSON.stringify(items.map((i)=>i.source_text)));
}

// ---- 场景 14：extractFromBodyFallback 走表格行路径 ----
console.log('\n=== Round12: body-fallback 优先表格行 ===');
{
  const body = new El('body');
  const table = new El('table');
  const rows = [];
  for (let i = 0; i < 5; i++) {
    const tr = new El('tr');
    const td = new El('td', { text: `Sentence number ${i} for testing the row extraction logic here.` });
    tr.children = [td]; td.parent = tr;
    rows.push(tr);
  }
  table.children = rows; rows.forEach((r) => (r.parent = table));
  body.children = [table]; table.parent = body;
  globalThis.document.body = body;
  const items = extractFromBodyFallback();
  assert('body 含 table 走行抓取产出 5 条', items.length === 5, 'got ' + items.length + ': ' + JSON.stringify(items.map((i)=>i.source_text)));
  assert('每条是完整句非单词', items.every((i) => i.source_text.length > 20), JSON.stringify(items.map((i)=>i.source_text)));
}

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`);
if (fail > 0) process.exit(1);