# L10n TM Companion Loop Spec

## Product Goal

Refactor L10n TM Companion into a simple, reliable Chrome MV3 extension for English source segment TM similarity optimization.

The plugin should be easy to start, require minimal manual setup, support Feishu Sheet and Bitable destination links, and always make the writeback target clear to the user.

## Core Features Only

Keep the Spreadsheet path as the primary source and two low-frequency DOM extraction actions:

1. Read column A from the working Spreadsheet
2. Capture full text inside collapsed Other sources
3. Capture selected text inside collapsed Other sources

Remove, hide, or move all non-essential flows into advanced settings.

## Language Scope

The user-facing workflow uses project-defined locales:

- Source locale comes from the selected Starling projects and must be identical across a multi-selection
- Target locale is selected from the intersection of all selected projects' `targetLocales`
- AI task rewrites the source segment in its source language; it does not translate the source
- Vendor, projects, and target locale live in the Popup Run configuration

## Input and Output UX

The user can use the current Feishu Spreadsheet automatically or paste another Spreadsheet URL. Bitable writeback is not supported and must fail visibly.

The plugin must:

1. Detect Sheet vs Bitable automatically
2. Parse available identifiers automatically
3. Show the parsed destination
4. Preview writeback destination before writing
5. Show final writeback destination after success
6. Never write to an unknown or invisible target

## Required Output Columns

Use these headers exactly and in this order:

1. Row
2. Original Source Segment
3. Best TM Match
4. Orig Match %
5. Rewritten Segment
6. New Match %
7. Reached 85%?
8. CD review valid?
9. Comment
10. Source String Key
11. Project

CD review valid? is for human review and should remain blank unless explicitly configured otherwise.

## TM Reliability

TM matching must be deterministic and reproducible.

Do not use LLM judgment for TM match scores.

Preferred path:

1. Require a verified Starling Native Host and at least one explicit project
2. Query Starling with one canonical source/target locale pair
3. Expose Starling or protocol failures directly; do not fall back to a local match and report success
4. Return method/version information
5. Add tests for stable behavior

## New Match % Reliability

New Match % must be deterministic.

It compares:

- Rewritten Segment
- Matched TM source segment

Recommended default:

New Match % = 0.5 * token_set_similarity + 0.3 * char_levenshtein_similarity + 0.2 * ngram_similarity

Requirements:

1. Fixed normalization
2. Fixed weights
3. Score range 0–100
4. No LLM-based scoring
5. Unit tests

## UI Requirements

The UI should be professional and guided.

Required improvements:

1. Remove excessive emoji
2. Use a step-based workflow
3. Show setup health checks automatically
4. Show missing permissions clearly
5. Show output destination before and after writeback
6. Provide actionable error recovery messages

## Technical Constraints

Respect the current architecture unless there is a clear reason to change:

- Chrome MV3
- Native Messaging
- Background service worker routing
- Feishu Sheet support
- Bitable support if feasible
- No backend unless explicitly approved
- Keep sensitive TM data local

## Acceptance Criteria

The loop is complete only when:

1. Spreadsheet column A remains the single visible primary source action; DOM actions stay collapsed
2. User can auto-detect the current Spreadsheet or paste a different Spreadsheet URL
3. Output destination is shown before writeback
4. Output destination is shown after writeback
5. Results use the exact required headers
6. TM matching method is deterministic and tested
7. New Match % method is deterministic and tested
8. Existing row alignment bug remains fixed
9. Native messaging flow remains correct
10. Unit tests pass
11. Manual E2E checklist exists
12. LOOP_PROGRESS.md says all tasks are complete
13. Settings stores and fully refills AK/SK with masked defaults and explicit reveal controls
14. Popup requires vendor, one to ten compatible projects, and a shared target locale before TM
