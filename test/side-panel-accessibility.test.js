/** Task 6 visual token, motion, responsive and batched-rendering contracts. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const css = fs.readFileSync(path.join(root, 'popup.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const batchSource = fs.readFileSync(path.join(root, 'lib/result-batch-renderer.js'), 'utf8');

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
assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.01ms/);
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
const resultCardTransition = css.match(/\.result-card\s*\{[^}]*transition:\s*([^;]+);/s)?.[1] || '';
const transitionedProperties = [...resultCardTransition.matchAll(/(?:^|,)\s*([\w-]+)/g)].map((match) => match[1]);
assert.deepEqual(transitionedProperties, ['opacity', 'transform'], 'result-card motion property 只允许 opacity/transform');
assert.doesNotMatch(css, /\.result-card\s*\{[^}]*transition:[^;}]*border-color/s);
assert.doesNotMatch(css, /animation[^;]*(?:infinite|blink)/i, '状态高亮不得持续闪烁');
assert.match(css, /@media\s*\(max-width:\s*375px\)[\s\S]*grid-template-columns:\s*1fr/, '375px 必须降为单列契约');

assert.match(html, /id="results"[^>]*aria-live="polite"[^>]*aria-busy="false"/);
assert.match(html, /id="focus-overlay"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="focus-title"/);
assert.match(html, /id="focus-title"/);
assert.match(html, /id="focus-close"[^>]*aria-label="Close"/);
assert.match(html, /id="archive-progress-live"[^>]*aria-live="polite"/);
assert.match(html, /role="progressbar"[^>]*aria-valuenow="0"/);

const batchSize = Number(source.match(/const RESULT_RENDER_BATCH_SIZE = (\d+)/)?.[1]);
assert.ok(batchSize > 0 && batchSize <= 25, '每帧最多渲染 25 张卡');
assert.match(batchSource, /export function appendResultCardsInBatches/);
assert.match(batchSource, /raf\(appendBatch\)/, '大列表必须把批次排入 animation frame');
assert.match(batchSource, /container\.setAttribute\('aria-busy', 'true'\)/);
assert.match(batchSource, /container\.setAttribute\('aria-busy', 'false'\)/);
assert.match(source, /const activeCardId = [^;]+;[\s\S]*container\.innerHTML = '';/, '必须在清空 DOM 前捕获 active card');
assert.match(source, /visibleItems\.map\(\(item\) => renderCard\(item\)\)/, '渲染前必须按过滤结果建立有序卡片序列');

console.log('side panel accessibility tests: passed');
