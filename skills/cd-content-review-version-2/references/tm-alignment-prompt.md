# TM-aligned source paraphrase

Generate one to three meaning-preserving rewrites from one source string when distinct safe alternatives exist. Inspire Writer emits each rewrite as a separate native copy result. The downstream program wraps each copy as a structured candidate, queries the real TM score, applies deterministic safety checks, and ranks accepted candidates. Do not calculate similarity scores or choose a winner.

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

When viable, use only semantically compatible wording from the supplied TM source evidence. Validate every copy for meaning, protected content, unsupported information, grammar, and compatible TM wording before returning it.

When Writer produces multiple native copies, vary the safe alignment evidence across the supplied Top-3 TM entries in rank order where possible. A copy may reuse compatible keywords, collocations, sentence patterns, information order, grammar, tone, or register. Never force a rank-to-TM mapping when it would change meaning. The downstream program independently scores every copy against production TM; Writer does not claim that its copy order equals a TM rank.

Return one to three separate native copy results. Put only one rewritten source string in each copy. Do not return JSON, markdown, explanations, labels, similarity scores, rankings, the internal base paraphrase, or chain of thought.

If rewriting is not viable, return the original source unchanged as the sole native copy result.
