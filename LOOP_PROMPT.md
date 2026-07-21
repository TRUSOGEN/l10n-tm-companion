# Loop Prompt for Claude Code

You are working on the Chrome MV3 extension project L10n TM Companion.

## Always Read First

Before making changes, read:

1. LOOP_SPEC.md
2. LOOP_TASKS.md
3. LOOP_PROGRESS.md
4. Existing handoff files if present
5. Relevant source files for the current task only

## Loop Rule

Work on exactly one unchecked task from LOOP_TASKS.md per loop iteration, unless a task is too small and directly coupled to the next one.

Prefer the lowest-numbered unchecked task.

## Required Workflow Per Iteration

1. Identify the next unchecked task.
2. Inspect only the relevant files.
3. Make the smallest safe code change.
4. Add or update tests when behavior changes.
5. Run relevant tests.
6. Update LOOP_PROGRESS.md with:
   - task completed
   - files changed
   - tests run
   - result
   - risks or follow-up tasks
7. Mark the task as complete in LOOP_TASKS.md only if tests pass or the change is documentation-only and verified.

## Product Requirements

The plugin must be simplified to only two main user-facing source extraction features:

1. Capture full text
2. Capture selected text

The plugin must be easy to use:

- Auto-configure what can be auto-configured
- Hide unnecessary language configuration from the main UI
- English-only user-facing workflow
- Allow the user to paste a Feishu Sheet or Bitable URL
- Auto-detect the destination type
- Show the exact writeback destination before writing
- Show the exact writeback destination after success

## Required Output Format

All generated output must use these columns exactly and in this order:

1. Row
2. Original Source Segment
3. Best TM Match
4. Orig Match %
5. Rewritten Segment
6. New Match %
7. Reached 75%?
8. CD review valid?
9. Comment

Do not rename these headers.

Leave CD review valid? blank for human review.

## TM and Match Scoring Requirements

TM matching must be deterministic and reliable.

Do not use the LLM to determine TM match scores.

If Starling API is unavailable, implement or use a fixed ES-like/BM25 method with deterministic re-ranking.

New Match % must be deterministic:

- Compare Rewritten Segment with matched TM source segment
- Use fixed normalization
- Use fixed scoring weights
- Add tests
- Do not use random or LLM-based scoring

## Safety Rules

Do not start network servers.

Do not introduce a backend unless explicitly requested.

Do not bypass permissions.

Do not remove existing bug fixes around row alignment, native host PATH, CORS, or MV3 native messaging routing.

Do not write to a Sheet or Bitable unless the destination is known and previewed.

## Stop Condition

If all tasks are complete and tests pass, update LOOP_PROGRESS.md and output:

<promise>COMPLETE</promise>

Otherwise output:

<promise>CONTINUE</promise>

and briefly state the next task.
