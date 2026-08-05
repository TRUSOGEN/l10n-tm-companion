/** Result card batching must preserve order, reject stale work, and restore focus. */
import assert from 'node:assert/strict';
import { appendResultCardsInBatches } from '../lib/result-batch-renderer.js';

function createHarness() {
  const frames = [];
  const focused = [];
  const container = {
    children: [],
    attrs: {},
    setAttribute(name, value) { this.attrs[name] = value; },
    appendChild(node) {
      const nodes = node.children || [node];
      this.children.push(...nodes);
    },
    querySelector(selector) {
      const id = selector.match(/data-id="([^"]+)"/)?.[1];
      if (!this.children.some((card) => card.id === id)) return null;
      return { focus() { focused.push(id); } };
    },
  };
  const documentRef = { createDocumentFragment: () => ({ children: [], appendChild(node) { this.children.push(node); } }) };
  return { container, documentRef, frames, focused, raf(callback) { frames.push(callback); } };
}

{
  const h = createHarness();
  const cards = Array.from({ length: 53 }, (_, id) => ({ id: String(id) }));
  appendResultCardsInBatches({ container: h.container, cards, generation: 4, isCurrent: (value) => value === 4, activeCardId: '51', raf: h.raf, documentRef: h.documentRef, escapeId: (value) => value });
  assert.equal(h.container.attrs['aria-busy'], 'true');
  while (h.frames.length) h.frames.shift()();
  assert.deepEqual(h.container.children.map((card) => card.id), cards.map((card) => card.id), '批次不得改变过滤后的顺序');
  assert.equal(h.container.attrs['aria-busy'], 'false');
  assert.deepEqual(h.focused, ['51'], '重渲染后恢复同一卡片 action 焦点');
}

{
  const h = createHarness();
  let current = 8;
  const cards = Array.from({ length: 60 }, (_, id) => ({ id: String(id) }));
  appendResultCardsInBatches({ container: h.container, cards, generation: 8, isCurrent: (value) => value === current, activeCardId: '2', raf: h.raf, documentRef: h.documentRef, escapeId: (value) => value });
  h.frames.shift()();
  assert.equal(h.container.children.length, 25);
  current = 9;
  h.frames.shift()();
  assert.equal(h.container.children.length, 25, 'generation 变化后旧批次必须停止');
  assert.deepEqual(h.focused, [], 'stale generation 不得移动焦点');
}

console.log('result batch renderer behavior tests: passed');
