/** 已验证 Inspire Agent Prompt 的 native copy 契约回归测试。 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const prompt = readFileSync(
  new URL('../agents/inspire-tm-source-optimizer/PROMPT.md', import.meta.url),
  'utf8',
);

assert.match(prompt, /zero to three TM entries/i);
assert.match(prompt, /one internal source-faithful base paraphrase/i);
assert.match(prompt, /Do not force one candidate per TM entry/i);
assert.match(prompt, /Use Inspire Writer's native Chat copy output/i);
assert.match(prompt, /Do not return JSON/i);
assert.match(prompt, /original source unchanged as the sole copy result/i);
assert.doesNotMatch(prompt, /Return valid JSON only/i);
assert.doesNotMatch(prompt, /Candidate 1 aligned only with TM 1/i);

console.log('inspire agent prompt: passed');
