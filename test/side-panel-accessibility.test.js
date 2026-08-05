/** Task 6 visual token, motion, responsive and batched-rendering contracts. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { appendResultCardsInBatches, captureActiveResultCardId } from '../lib/result-batch-renderer.js';

const root = path.resolve(import.meta.dirname, '..');
const css = fs.readFileSync(path.join(root, 'popup.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');

const rootBlock = css.match(/:root\s*\{([^}]*)\}/)?.[1] || '';
const tokens = Object.fromEntries([...rootBlock.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim().toUpperCase()]));
assert.deepEqual(
  Object.fromEntries(['color-canvas', 'color-surface', 'color-text-primary', 'color-text-secondary', 'color-primary', 'color-ai', 'color-confirmed', 'color-warning', 'color-error'].map((key) => [key, tokens[key]])),
  {
    'color-canvas': '#F6F7F9', 'color-surface': '#FFFFFF', 'color-text-primary': '#172033',
    'color-text-secondary': '#667085', 'color-primary': '#3366FF', 'color-ai': '#6558D9',
    'color-confirmed': '#14805E', 'color-warning': '#A15C00', 'color-error': '#C9362B',
  },
  '批准的 semantic color tokens 必须是视觉系统的 source of truth',
);
assert.match(css, /:where\([^)]*(?:button|select|input|summary)[^)]*\):focus-visible\s*\{[^}]*--focus-ring/s, '交互控件必须共享 focus-visible ring');
assert.match(css, /--target-min:\s*44px/, '触控目标必须至少 44px');
assert.match(css, /\.container\s*\{[^}]*min-width:\s*0[^}]*overflow-x:\s*hidden/s, 'Side Panel 容器必须阻止横向滚动');
assert.match(css, /--motion-step:\s*150ms/);
assert.match(css, /--motion-card:\s*180ms/);
assert.match(css, /--motion-focus:\s*200ms/);

/** 解析出所有 (selector, body) 规则，并记录是否位于 @media 内。 */
function parseRules(text) {
  const rules = [];
  const atRuleStack = [];
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf('{', index);
    if (open === -1) break;
    const prelude = text.slice(index, open).replace(/\/\*[\s\S]*?\*\//g, '').trim().split(/\}/).pop().trim();
    if (prelude.startsWith('@')) {
      atRuleStack.push(prelude);
      index = open + 1;
      continue;
    }
    const close = text.indexOf('}', open);
    if (close === -1) break;
    rules.push({ selector: prelude, body: text.slice(open + 1, close), at: [...atRuleStack] });
    index = close + 1;
    const nextClose = text.indexOf('}', index);
    const nextOpen = text.indexOf('{', index);
    if (atRuleStack.length && nextClose !== -1 && (nextOpen === -1 || nextClose < nextOpen)) {
      atRuleStack.pop();
      index = nextClose + 1;
    }
  }
  return rules;
}

function declarations(body) {
  return body.split(';').map((entry) => entry.trim()).filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(':');
      return { property: entry.slice(0, separator).trim().toLowerCase(), value: entry.slice(separator + 1).trim() };
    })
    .filter((declaration) => declaration.property && !declaration.property.startsWith('--'));
}

const rules = parseRules(css);
const keyframeBodies = [...css.matchAll(/@keyframes\s+[\w-]+\s*\{([\s\S]*?)\n\}/g)].map((match) => match[1]);
const keyframeSelectorBodies = keyframeBodies.flatMap((block) => [...block.matchAll(/\{([^}]*)\}/g)].map((match) => match[1]));

// --- Semantic token migration for the remaining stateful component families ---
const TOKEN_FAMILIES = /\.score-stage|\.review-status-tag|\.status-|\.archive-progress|\.multilingual-roi-summary|\.dest-/;
const COLOR_PROPERTIES = /^(?:color|background|background-color|border|border-color|border-top-color|border-bottom-color|outline|outline-color|fill|stroke)$/;
const rawHexViolations = [];
const declaredPairs = new Map();
for (const rule of rules) {
  if (!TOKEN_FAMILIES.test(rule.selector)) continue;
  for (const { property, value } of declarations(rule.body)) {
    if (!COLOR_PROPERTIES.test(property)) continue;
    if (/#[0-9a-fA-F]{3,8}\b/.test(value)) rawHexViolations.push(`${rule.selector} { ${property}: ${value} }`);
    if (rule.at.length) continue;
    const key = `${rule.selector.replace(/\s+/g, ' ')}|${property}`;
    declaredPairs.set(key, (declaredPairs.get(key) || 0) + 1);
  }
}
assert.deepEqual(rawHexViolations, [], `状态组件必须使用 semantic token，不得保留 raw hex: ${rawHexViolations.join(' | ')}`);
const overridden = [...declaredPairs.entries()].filter(([, count]) => count > 1).map(([key]) => key);
assert.deepEqual(overridden, [], `token 迁移必须改原规则，不得靠后置覆盖: ${overridden.join(' | ')}`);

// --- Motion may only animate opacity/transform ---
const ALLOWED_MOTION_PROPERTIES = new Set(['opacity', 'transform', 'all-disallowed-placeholder']);
const motionViolations = [];
for (const rule of rules) {
  for (const { property, value } of declarations(rule.body)) {
    if (property === 'transition' || property === 'transition-property') {
      const animated = value.split(',').map((part) => part.trim().split(/\s+/)[0]).filter(Boolean);
      animated.filter((name) => !ALLOWED_MOTION_PROPERTIES.has(name))
        .forEach((name) => motionViolations.push(`${rule.selector} transition ${name}`));
    }
    if (property === 'animation' || property === 'animation-name') {
      if (/\b(?:infinite|blink)\b/i.test(value)) motionViolations.push(`${rule.selector} animation ${value}`);
    }
  }
}
for (const body of keyframeSelectorBodies) {
  declarations(body).filter(({ property }) => !ALLOWED_MOTION_PROPERTIES.has(property))
    .forEach(({ property }) => motionViolations.push(`@keyframes ${property}`));
}
assert.deepEqual(motionViolations, [], `动效只允许 opacity/transform: ${motionViolations.join(' | ')}`);
assert.doesNotMatch(css, /transition:[^;]*\bwidth\b/, '进度条不得对 width 做 transition');
const progressRules = rules.filter((rule) => /\.archive-progress-bar|\.progress-fill/.test(rule.selector));
assert.ok(progressRules.length > 0);
for (const rule of progressRules.filter((rule) => !rule.at.length)) {
  assert.match(rule.body, /transform:\s*scaleX|transform-origin|transition:/, `${rule.selector} 必须靠 transform 表达进度`);
}
assert.match(css, /\.archive-progress-bar[^{]*\{[^}]*transform:\s*scaleX\(0\)/s, '进度条初始状态使用 scaleX(0)');

assert.doesNotMatch(source, /progress-fill'\)\.style\.width/, '进度条不得再通过 width 表达进度');
assert.match(source, /progress-fill'\)\.style\.transform = `scaleX/, '进度条必须使用 compositor-only 的 scaleX');
const unusedKeyframes = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((match) => match[1])
  .filter((name) => !new RegExp(`animation[^;]*\\b${name}\\b`).test(css));
assert.deepEqual(unusedKeyframes, [], `死掉的 keyframes 必须删除: ${unusedKeyframes.join(', ')}`);

// --- reduced-motion must really disable motion (no specificity trap, no dead states) ---
const reducedBlocks = [...css.matchAll(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/g)].map((match) => match[1]).join('\n');
for (const selector of ['.step', '.result-card', '.focus-overlay', '.focus-box', '.archive-progress-bar']) {
  const escaped = selector.replace('.', '\\.');
  assert.match(reducedBlocks, new RegExp(`${escaped}\\s*\\{[^}]*transition-duration:\\s*\\.01ms`, 's'), `${selector} 必须显式关闭 transition`);
  assert.match(reducedBlocks, new RegExp(`${escaped}\\s*\\{[^}]*animation-duration:\\s*\\.01ms`, 's'), `${selector} 必须显式关闭 animation`);
}
for (const selector of ['.step', '.result-card', '.focus-overlay', '.focus-box']) {
  const escaped = selector.replace('.', '\\.');
  assert.match(reducedBlocks, new RegExp(`${escaped}\\s*\\{[^}]*transform:\\s*none`, 's'), `${selector} reduced-motion 不保留非必要 transform`);
}
const cardAnimationRules = rules.filter((rule) => /\.result-card/.test(rule.selector) && !rule.at.length
  && declarations(rule.body).some(({ property }) => property === 'animation' || property === 'animation-name'));
for (const rule of cardAnimationRules) {
  assert.doesNotMatch(rule.selector, /:nth-child/, `${rule.selector} 的 animation 会覆盖 .result-card { animation: none }，特异度冲突必须移除`);
}
const deadStates = ['is-entering', 'is-complete', 'is-confirmed']
  .filter((state) => css.includes(`.result-card.${state}`) && !source.includes(state));
assert.deepEqual(deadStates, [], `CSS 状态必须由 JS 真实设置，否则删除: ${deadStates.join(', ')}`);
assert.doesNotMatch(css, /animation[^;]*(?:infinite|blink)/i, '状态高亮不得持续闪烁');
assert.match(css, /@media\s*\(max-width:\s*375px\)[\s\S]*grid-template-columns:\s*1fr/, '375px 必须降为单列契约');

// --- HTML accessibility contracts ---
assert.match(html, /id="results"[^>]*aria-live="polite"[^>]*aria-busy="false"/);
assert.match(html, /id="focus-overlay"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="focus-title"/);
assert.match(html, /id="focus-title"/);
assert.match(html, /id="focus-close"[^>]*aria-label="Close"/);
assert.match(html, /id="archive-progress-live"[^>]*aria-live="polite"/);
assert.match(html, /role="progressbar"[^>]*aria-valuenow="0"/);
assert.match(html, /id="status"[^>]*aria-live="polite"/, '状态与错误区必须 polite 播报');

// --- Batched rendering behaviour (no source-string assertions) ---
function harness() {
  const frames = [];
  const focused = [];
  const container = {
    children: [], attrs: {},
    setAttribute(name, value) { this.attrs[name] = value; },
    appendChild(node) { this.children.push(...(node.children || [node])); },
    querySelector(selector) {
      const id = selector.match(/data-id="([^"]+)"/)?.[1];
      return this.children.some((card) => card.id === id) ? { focus() { focused.push(id); } } : null;
    },
  };
  return {
    container, frames, focused,
    documentRef: { createDocumentFragment: () => ({ children: [], appendChild(node) { this.children.push(node); } }) },
    raf(callback) { frames.push(callback); },
  };
}

const h = harness();
const cards = Array.from({ length: 60 }, (_, id) => ({ id: String(id) }));
appendResultCardsInBatches({
  container: h.container, cards, generation: 1, isCurrent: () => true, activeCardId: '7',
  raf: h.raf, documentRef: h.documentRef, escapeId: (value) => value,
});
h.frames.shift()();
assert.ok(h.container.children.length <= 25, '每帧最多渲染 25 张卡');
while (h.frames.length) h.frames.shift()();
assert.deepEqual(h.container.children.map((card) => card.id), cards.map((card) => card.id), '批次必须保持过滤后的顺序');
assert.deepEqual(h.focused, ['7'], '重渲染后恢复原 action 焦点');
assert.equal(h.container.attrs['aria-busy'], 'false');

// Active card capture is a behaviour of the renderer helper, not a popup source pattern.
const focusedCard = { dataset: { id: 'card-42' } };
assert.equal(
  captureActiveResultCardId({ activeElement: { closest: (selector) => (selector === '.result-card' ? focusedCard : null) } }),
  'card-42',
  '清空 DOM 前必须能捕获当前 active card',
);
assert.equal(captureActiveResultCardId({ activeElement: { closest: () => null } }), null);
assert.equal(captureActiveResultCardId({}), null, '没有焦点时不得抛错');

// Minimal integration guard: popup captures the active card before it clears the container.
const captureIndex = source.indexOf('captureActiveResultCardId');
const clearIndex = source.indexOf("container.innerHTML = ''");
assert.ok(captureIndex > -1 && clearIndex > -1 && captureIndex < clearIndex, 'popup 必须先捕获 active card 再清空容器');

console.log('side panel accessibility tests: passed');
