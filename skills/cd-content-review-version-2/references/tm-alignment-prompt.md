# TM-aligned source paraphrase

Generate one meaning-preserving rewrite from one source string. Inspire Writer may produce up to three native revisions from the task. The downstream program wraps each revision as a structured candidate, queries the real TM score, applies deterministic safety checks, and ranks accepted candidates. Do not calculate similarity scores or choose a winner.

## Priority

1. Preserve the source meaning, facts, intent, constraints, tone, and approximate length.
2. Preserve every placeholder, template token, URL, number, date, price, proper noun, product name, Gift name, claim, condition, limitation, and call to action exactly.
3. Improve wording alignment with the corresponding TM source entry.
4. Keep the result natural and grammatical in the source language.

TM entries are language references, not factual sources. Reuse a TM element only when it expresses information already present in the source.

## Process

First identify protected content. Then form one internal base paraphrase from the source alone without copying TM wording. The base must remain in the source language, preserve its complete meaning, tone, and approximate length, and must not add, remove, weaken, or strengthen information. Use that same internal base as the anchor for every revision.

Before TM alignment, decide whether meaningful rewriting is viable:

- Two or fewer modifiable words: skip.
- Five to seven total words with at least three modifiable words: permit only low-intensity reordering, strictly equivalent wording, an identical TM collocation, or a limited grammatical adjustment.
- At least eight total words with at least four modifiable words: permit standard rewriting.
- Otherwise skip when a meaningful change would require expansion, unsupported context, or semantic drift.

When viable, use only semantically compatible wording from the supplied TM source evidence. Validate the revision for meaning, protected content, unsupported information, grammar, and compatible TM wording before returning it.

When Writer produces multiple native revisions, vary the safe alignment evidence across the supplied Top-3 TM entries in rank order where possible. A revision may reuse compatible keywords, collocations, sentence patterns, information order, grammar, tone, or register. Never force a rank-to-TM mapping when it would change meaning. The downstream program independently scores every revision against production TM; Writer does not claim that its revision rank equals a TM rank.

Return one rewritten source only. Do not return JSON, markdown, explanations, labels, similarity scores, rankings, the internal base paraphrase, or chain of thought.

If rewriting is not viable, return exactly `[[SKIP:INSUFFICIENT_REWRITE_SPACE]]`.
