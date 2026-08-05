import assert from 'node:assert/strict';
import { confirmThenRunArchive } from '../lib/archive-confirmation.js';

for (const [action, accepted, expectedCalls] of [
  ['Cancel', false, 0],
  ['Escape', false, 0],
  ['Start', true, 1],
]) {
  let runtimeCalls = 0;
  const result = await confirmThenRunArchive({
    controller: { open: async () => accepted },
    summary: { sourceRowCount: 100, languageCount: 56 },
    runtime: async () => { runtimeCalls += 1; },
  });
  assert.equal(runtimeCalls, expectedCalls, `${action} runtime call count`);
  assert.equal(result, accepted, `${action} orchestration result`);
}

console.log('popup archive confirmation orchestration tests passed');
