/** Content Review 规则资产与确定性检索测试。 */
import assert from 'node:assert/strict';
import { buildContentReviewContext, parseGlossaryRows, selectLegalGuideline } from '../lib/content-review-rules.js';

const glossary = `# Glossary
| # | Term | Status | Part of Speech | Noun Type | Vertical | Definition | Usage Notes |
|---|---|---|---|---|---|---|---|
| 1 | host | Do not use | noun | common | LIVE | A creator | Use LIVE creator |
| 2 | Coin | OK | noun | proper | LIVE | Virtual item | Always capitalize |`;
assert.equal(parseGlossaryRows(glossary).length, 2);
assert.equal(selectLegalGuideline('Complete this gameplay mission').kind, 'game');
assert.equal(selectLegalGuideline('Send a Gift in a LIVE').kind, 'revenue');
const context = buildContentReviewContext({
  sourceText: 'The host gets 1 Coin',
  tmSource: 'The LIVE creator gets 1 Coin',
  context: 'LIVE result card',
  assets: {
    skill: '# Content Review Skill\n## Review rules\nUse the references as authoritative evidence.',
    tmAlignment: '# TM alignment\nReturn JSON only.',
    principles: '# Principles\nPreserve meaning.',
    styleGuide: '# Writing principles\nKeep it short.\n## Passwords\nReset your password.',
    glossary,
    gameLegal: '# Game legal\nDo not promise game rewards.',
    revenueLegal: '# Revenue legal\nDo not say creators earn Gifts.',
  },
});
assert.equal(context.legalKind, 'revenue');
assert.match(context.skillExcerpt, /authoritative evidence/);
assert.match(context.glossaryExcerpt, /host/);
assert.match(context.glossaryExcerpt, /Coin/);
assert.doesNotMatch(context.legalExcerpt, /game rewards/i);
assert.match(context.principles, /Preserve meaning/);

const bounded = buildContentReviewContext({
  sourceText: 'Special Fly Love lock',
  tmSource: 'Special LIVE Love Lock',
  assets: {
    skill: `# Skill\n## Review rules\n${'skill evidence '.repeat(3000)}`,
    tmAlignment: '# TM alignment\nReturn JSON only.',
    principles: `# Principles\n## Meaning\n${'principle evidence '.repeat(3000)}`,
    styleGuide: `# Style\n## LIVE\n${'style evidence '.repeat(3000)}`,
    glossary,
    gameLegal: `# Game legal\n## Gifts\n${'game evidence '.repeat(3000)}`,
    revenueLegal: `# Revenue legal\n## Gifts\n${'revenue evidence '.repeat(3000)}`,
  },
});
const boundedChars = [
  bounded.skillExcerpt,
  bounded.principles,
  bounded.styleExcerpt,
  bounded.glossaryExcerpt,
  bounded.legalExcerpt,
].reduce((total, value) => total + value.length, 0);
assert.ok(boundedChars <= 8000, `规则上下文必须有硬上限，实际 ${boundedChars}`);
console.log('content review rules: passed');
