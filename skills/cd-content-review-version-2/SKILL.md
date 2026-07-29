---
name: cd-content-review-version-2
description: Answer live content-design reference questions and extract, review, or improve visible product copy from screenshots, images, Figma page links, Feishu documents, Feishu spreadsheets, or inline text. Use for terminology approval, capitalization, Glossary status, Style Guide or Legal Guideline questions, microcopy reviews, interface text, onboarding, empty states, errors, guidance, and other product content. Ask about optional PRD context only for explicit concrete content-review requests, not reference Q&A. Select Game Legal Guidelines only for game-related legal needs or Revenue Legal Guidelines for other legal needs.
---

# Content design review

Review product content systematically. Keep judgments concrete, evidence-based, and rewrite-oriented.

> **Prerequisites:** Read `../lark-shared/SKILL.md` and the relevant `../lark-doc/SKILL.md`, `../lark-base/SKILL.md`, or `../lark-sheets/SKILL.md` before using Feishu CLI. Use `--as user` for user-owned resources. Reading a Figma link requires an installed Figma connector with access to that file.

## Stable live reference sources

For concrete content reviews, load the Style Guide, Glossary, and exactly one selected legal source at runtime. For reference Q&A, load only the live source or sources relevant to the question. Do not rely on remembered or cached copies.

| Resource | Loading rule | Live source |
|---|---|---|
| TikTok Content Design Style Guide | Every content review; relevant style Q&A | `https://bytedance.larkoffice.com/wiki/wikcn8W8yNULxunar4iR4Q505w4` |
| TikTok Content Design Glossary | Every content review; relevant terminology Q&A | `https://bytedance.larkoffice.com/wiki/ZC1Iw9xUHivDMIk9JbgckeRHnce?table=tbl7WMgkHfeI5BuN&view=vewo6hDt6d` |
| Game Legal Guidelines | Game-related reviews or legal Q&A only | `https://bytedance.sg.larkoffice.com/docx/SIUvdY2Nio3ufWx8CeBlDwtGgpe` |
| Revenue Legal Guidelines | Non-game reviews or legal Q&A only | `https://bytedance.sg.larkoffice.com/docx/QRPCd70wFowH72xiksmlpcNzgFb` |

Treat only the live Style Guide, Glossary, and selected Legal Guidelines as normative review evidence. Never load or cite both legal sources in one review. Do not use web standards, general UX conventions, remembered rules, the PRD, or invented requirements as writing or legal standards.

## Step 0 — Classify the request intent

Classify the user's request before asking about PRD.

### `content-review`

Use `content-review` only when the user explicitly asks to review, check, critique, improve, rewrite, optimize, audit, or correct concrete content such as copy, UI strings, a screenshot, a Figma page, a Feishu document, a spreadsheet, a screen, or a flow.

For `content-review`, offer optional PRD context before reviewing unless a PRD was already supplied. Ask in the main language of the user's current request:

- Chinese: `你是否愿意提供 PRD？这可以帮助我理解业务场景并给出更准确的评审建议。`
- English: `Would you like to share the PRD? It can help me understand the business context and provide more accurate review recommendations.`
- Other languages: express the same meaning naturally in the user's current language.

Follow the user's choice:

- If the user chooses to provide a PRD, wait for the uploaded file or accessible link. Read it with the appropriate file or Feishu skill before continuing.
- If the user declines, do not ask again. Continue with the review content and live references.
- If the user already supplied a PRD, do not ask the question. Read the supplied PRD directly.
- If the PRD cannot be read, explain the access or format issue and ask whether to retry or continue without it.

Extract only business context from the PRD: business goal, user scenario, intended behavior, constraints, audience, and product-specific terminology. Use these facts to interpret the copy. Do not treat PRD wording as a Style Guide, glossary rule, or legal standard, and do not cite it as normative rationale unless it directly quotes one of this skill's live references.

### `reference-qa`

Use `reference-qa` when the user asks whether a term may be used, asks about capitalization or preferred terminology, requests a Glossary status, asks what the Style Guide or a Legal Guideline says, or asks another question that can be answered directly from the live references without reviewing a supplied body of content.

Examples:

- `能否使用 LIVE room 这个词？`
- `Is this term approved in the glossary?`
- `What does the Style Guide say about button labels?`

For `reference-qa`, never ask about PRD. Load the relevant live reference and answer the question directly from fetched evidence. Do not force the content-review table when there are no content items to review.

### Ambiguous intent

If the user does not clearly request review or revision of concrete content, default to `reference-qa` and do not ask about PRD. Ask about PRD later only if the conversation becomes a concrete content review. Do not use a fixed keyword list as the sole classifier; interpret the requested action and whether concrete review content is in scope.

## Step 1 — Extract visible copy for `content-review`

Skip this step for `reference-qa`. For `content-review`, route each input through the matching procedure. Extract only text that is visible to the product user or explicitly identified as reviewable content. Preserve reading order and useful location context.

### Screenshot or image

Inspect every supplied image at sufficient detail and transcribe all readable visible copy verbatim. Process screens and regions in natural reading order. Preserve a concise internal location such as `Screen 2 · modal · primary button` so repeated strings remain distinguishable.

- Include headings, body copy, labels, buttons, tabs, tooltips, banners, toasts, errors, empty states, legal text, and visible placeholder text.
- Do not infer cropped, blurred, obscured, or illegible text. Mark the region as unreadable and ask for a clearer image if it blocks review.
- Exclude device chrome, debugging overlays, and unrelated surrounding application text.

### Figma page link

Use the installed Figma connector to open the exact linked file, page, or node. Extract visible text layers frame by frame in canvas reading order and retain frame/component context internally.

- Include text rendered in the target page's visible product frames.
- Exclude hidden layers, internal layer names, component metadata, design annotations, and off-canvas alternatives unless explicitly requested.
- Respect the exact page or node encoded in the URL. Do not silently expand to the whole file.
- If the Figma connector is unavailable or lacks access, ask for screenshots or an export. Do not substitute web search or cached previews.

### Feishu document or Wiki document

Fetch the document at runtime:

```bash
lark-cli docs +fetch \
  --doc "<CONTENT_DOC_URL>" \
  --as user --scope full --detail simple
```

Extract copy in document order, including headings, paragraphs, lists, tables, buttons, tooltips, callouts, errors, empty states, notifications, and other UI strings.

### Feishu spreadsheet or Wiki-backed spreadsheet

Read workbook metadata first. Never guess a sheet name:

```bash
lark-cli sheets +workbook-info \
  --url "<SPREADSHEET_URL>" \
  --as user --format json
```

If the link or user names a sheet, read that sheet. Otherwise, read every visible sheet that can contain reviewable product copy. Use real `sheet_id` values returned by `+workbook-info`:

```bash
lark-cli sheets +csv-get \
  --url "<SPREADSHEET_URL>" \
  --sheet-id "<REAL_SHEET_ID>" \
  --as user --format json
```

Use workbook dimensions to read large sheets in explicit A1 chunks when the response is truncated or indicates more data. Continue until all relevant populated ranges have been read.

- Preserve sheet and cell/row context internally.
- Include UI strings, messages, content variants, labels, descriptions, and other user-facing copy.
- Exclude formulas, IDs, raw metrics, dates, owner/status columns, and operational data unless the displayed value is product copy.
- Use context, locale, platform, component, and copy-type columns to interpret the copy without adding output columns.
- If it is unclear which cells contain copy, ask which sheet or column to review rather than guessing.

### Inline text

Review inline text directly and preserve the order and labels supplied by the user.

### Normalize extracted copy

Build an ordered list of copy items. Each item must contain verbatim original text and any available screen, frame, region, sheet, row, or cell context. Keep identical strings separate when they appear in materially different contexts. Group only true duplicates from the same context when grouping does not hide coverage.

## Step 2 — Classify the legal context when needed

For every `content-review`, classify the request as `game-related` or `non-game`. For `reference-qa`, perform this classification only when legal guidance is needed. Use the user's prompt, extracted copy when present, surrounding context, and PRD when provided.

Classify as game-related when the feature or copy materially concerns game mechanics or a gaming experience, including:

- LIVE games or gameplay
- game rounds, matches, or player participation
- game tasks, scores, rankings, or gaming outcomes
- game rewards or game-specific virtual items

Do not classify content as game-related merely because it contains generic words such as `play`, `match`, `level`, `score`, or `reward` in a non-gaming meaning.

If the available context does not support a reliable classification, ask once:

> 这次评审内容是否属于游戏场景？

Use the answer to select one legal source. Do not guess, and never load both legal sources.

## Step 3 — Load the relevant live references

For `content-review`, start three branches in parallel: Style Guide, Glossary, and the one selected Legal Guidelines branch. For `reference-qa`, execute only the source branches needed to answer the question; terminology questions normally use the Glossary, style questions use the Style Guide, and legal questions use exactly one selected Legal Guidelines branch. The Glossary branch resolves the Wiki URL and then reads every record in the specified view.

### 1. Style Guide — always load

```bash
lark-cli docs +fetch \
  --doc "https://bytedance.larkoffice.com/wiki/wikcn8W8yNULxunar4iR4Q505w4" \
  --as user --scope full --detail simple
```

Use only rules actually present in the fetched guide for voice and tone, grammar and mechanics, capitalization, accessibility, inclusion, localization, component patterns, notifications, terminology, naming, and AI content.

### 2. Glossary LIVE Sheet — always load

Resolve the Wiki URL instead of treating its Wiki token as a Base token:

```bash
lark-cli base +url-resolve \
  --url "https://bytedance.larkoffice.com/wiki/ZC1Iw9xUHivDMIk9JbgckeRHnce?table=tbl7WMgkHfeI5BuN&view=vewo6hDt6d" \
  --as user --format json
```

Take `base_token`, `table_id`, and `view_id` from the response. Confirm the table and view match `tbl7WMgkHfeI5BuN` and `vewo6hDt6d`, then read the LIVE view:

```bash
lark-cli base +record-list \
  --base-token "<RESOLVED_BASE_TOKEN>" \
  --table-id "tbl7WMgkHfeI5BuN" \
  --view-id "vewo6hDt6d" \
  --as user --limit 200 --offset 0 --format json
```

If the response indicates more records, increment `--offset` until all records in the view have loaded. Do not review from only the first page. Preserve the view's filtering and use the current field names returned by Feishu.

For each record, prioritize fields expressing the term, status, definition, usage notes, approved alternative, examples, and related terms:

- Match terms case-insensitively, but use exact approved capitalization in rewrites.
- Treat `OK` or the current equivalent as approved.
- Replace `Do not use` terms with the preferred alternative supplied by the live record.
- If no approved replacement is provided, flag an open terminology question rather than inventing one.

### 3A. Game Legal Guidelines — game-related reviews only

Execute this branch only when Step 2 classified the review as game-related:

```bash
lark-cli docs +fetch \
  --doc "https://bytedance.sg.larkoffice.com/docx/SIUvdY2Nio3ufWx8CeBlDwtGgpe" \
  --as user --scope full --detail simple
```

Use relevant fetched sections as `Game Legal Guidelines`. Do not load Revenue Legal Guidelines for this review.

### 3B. Revenue Legal Guidelines — non-game reviews only

Execute this branch only when Step 2 classified the review as non-game:

```bash
lark-cli docs +fetch \
  --doc "https://bytedance.sg.larkoffice.com/docx/QRPCd70wFowH72xiksmlpcNzgFb" \
  --as user --scope full --detail simple
```

Use relevant fetched sections as `Revenue Legal Guidelines`. Do not load Game Legal Guidelines for this review.

### Reference-loading gate

For `content-review`, do not start the review until the Style Guide, complete Glossary view, and selected Legal Guidelines have loaded successfully. For `reference-qa`, do not answer until every live source relevant to the question has loaded successfully. Never load both legal documents. If a command fails:

1. Diagnose missing CLI setup, login, scope, or resource-level access.
2. Follow `lark-shared` for authentication and permission recovery; never expose secrets.
3. Identify the live source that failed and pause instead of using stale knowledge or the unselected legal source.

## Step 4 — `content-review` workflow

Before evaluating any copy, read [`references/content-review-principles.md`](references/content-review-principles.md) completely. This is mandatory for every `content-review`; do not review from a partial excerpt or memory.

Then apply the two-layer framework to every normalized copy item:

1. Use PRD context, when provided, to understand intended behavior, audience, constraints, scenario, and product-specific terminology.
2. Apply **Layer 1 — Reference-based Review**: check the live Glossary, fetched Style Guide, and selected Game Legal Guidelines or Revenue Legal Guidelines.
3. Apply **Layer 2 — Baseline Quality Check**: evaluate every relevant dimension defined in the bundled principles reference, even when no live reference explicitly covers the issue.
4. Resolve conflicts using this priority: `Legal Guidelines > Glossary > Style Guide > Baseline quality check`.
5. Label Layer 2 evidence as `Baseline quality check`. Do not attribute a Layer 2 finding to a live source unless that source actually supports it.
6. Consolidate overlapping Layer 1 and Layer 2 findings into one row, using available Layer 1 evidence as the primary rationale.
7. For each issue, quote the original, describe the concrete conflict, and propose the smallest effective rewrite that preserves product intent.
8. Distinguish mandatory source-backed corrections from optional baseline improvements in the problem or rationale.
9. Review every extracted item, including copy with no identified issue. Preserve the original when neither layer identifies a concrete issue.

### Numeric placeholder rule

Keep numbers unchanged in `原始文案`. In `推荐改写`, replace variable or dynamic numeric content with a semantic placeholder using the exact `{s_xxx}` shape:

- Start with `s_` and use lowercase snake_case, such as `{s_count}`, `{s_amount}`, `{s_duration}`, `{s_rank}`, or `{s_percentage}`.
- Name the placeholder by meaning. Do not output the generic literal `{s_xxx}` when the semantic role is known.
- Preserve a fixed number when product context, legal text, or a live reference requires that exact value.
- Test placeholder copy with realistic `0`, `1`, and multiple-value states. Check noun/verb agreement, articles, units, word order, and localization readiness.

## Step 5 — `reference-qa` workflow

1. Do not ask about PRD.
2. Identify the live source or sources that can answer the question.
3. Fetch those sources at runtime; if legal guidance is relevant, use Step 2 to select exactly one legal source.
4. Answer the user's question directly and in the user's language.
5. Name the fetched source and summarize the specific term status, usage note, style rule, or legal principle supporting the answer.
6. If the live references do not answer the question, say so and identify the unresolved gap. Do not invent a standard or force a content-review table.

## Review rules

- Prioritize product truth, approved terminology, and legal safety over stylistic preference.
- Use PRD facts to avoid suggestions that contradict the business context, but do not use the PRD as normative rationale.
- Do not invent issues, rules, section names, glossary entries, or product requirements.
- Prefer minimal rewrites that preserve product intent.
- Do not add unverified qualifiers such as `eligible`, `instant`, `automatic`, `secure`, or `verified` unless product behavior supports them.
- Use the bundled Content Review Principles as the only source for `Baseline quality check` findings. Do not cite web standards, outside general UX advice, the model's unsupported preferences, or the unselected legal source.
- Do not claim legal advice, legal approval, or guaranteed compliance.

## Output format for `content-review`

Apply this section only to `content-review`. For `reference-qa`, use the direct-answer workflow in Step 5. For `content-review`, return one Markdown table and no separate summary, severity table, or consolidated-copy section. Include every normalized copy item, including items with no identified issue. Use exactly these five columns:

| 原始文案 | 问题 | 推荐改写 | 改写 rationale | 注意 |
|---|---|---|---|---|

For copy with an issue:

- `原始文案`: reproduce the source text verbatim without labels or annotations.
- `问题`: describe the concrete conflict or risk without a severity label.
- `推荐改写`: provide the smallest supported rewrite that preserves product intent.
- `改写 rationale`: name `Style Guide`, `Glossary`, `Game Legal Guidelines`, `Revenue Legal Guidelines`, or `Baseline quality check` and state the specific rule, term/status/usage note, legal principle, or built-in quality dimension. Cite only the legal source selected for this review.
- `注意`: give short implementation or language details such as exact capitalization, singular/plural handling, placeholder behavior, punctuation, spacing, or number/percentage/currency/date/time/range/unit formatting. Use the main language of the user's request.

When singular/plural handling is relevant, use a short direct reminder in the user's language:

- Chinese example: `注意 Coin 的单复数`
- English example: `Check the singular/plural form of Coin`
- Other languages: express the same reminder naturally in the user's current language.

Do not force a fixed Chinese phrase. If no additional attention item exists, write `—`.

For copy with no identified issue:

- `问题`: write `无明显风险`.
- `推荐改写`: repeat the original unchanged, except that a variable numeric value may be converted to a semantic `{s_xxx}` placeholder.
- `改写 rationale`: state that both Layer 1 and Layer 2 found no concrete issue. Name the selected legal source; do not call the copy legally approved or risk-free.
- `注意`: include any mechanical implementation note; otherwise write `—`.

If a blocking ambiguity prevents a supported review, include the original as a row, describe the missing context in `问题`, preserve the original in `推荐改写`, and explain in `改写 rationale` that the live references do not support a definitive change without that context.

## Permissions

The user identity needs read access to the live references, review input, and optional PRD. Typical scopes are:

- `docx:document:readonly` for the Style Guide, selected Legal Guidelines, Feishu review documents, and Feishu PRDs
- `bitable:app:readonly` for the Glossary LIVE Sheet
- the read-only Sheets scope reported by Feishu CLI when a spreadsheet cannot be accessed

When authorization is missing, follow the split-flow login procedure in `lark-shared` and request only the missing scopes.
