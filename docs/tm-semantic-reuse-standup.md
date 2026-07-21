# Daily Standup — TM Semantic Reuse and AI Rewrite

Estimated speaking time: about 1.5–2 minutes.

## Review

The structure is strong: Why → How → Status → Next. The A → B → C flow is also correct.

The main changes are:

- Say “configured source column” instead of “column A.” The extension now supports different columns, start rows, spreadsheets, and sheets.
- Say “CD review column” instead of “column G.” The review column depends on the selected output layout.
- Say “shared target languages” instead of “project × locale matrix.” One selected language creates one scope with all selected project IDs.
- Say “estimated savings” instead of “real savings.” The calculation uses real TM scores and vendor rate snapshots, but the localization team still needs to confirm the final measurement method.
- Keep the two pilot rates separate: 23/137 is about 17% of low-match segments, while 23/97 is about 24% of generated AI suggestions.
- Use `$400` and `$3,200`, with one dollar sign.

## Main script

Quick update on L10n TM Companion, a Chrome extension that helps reduce translation cost.

### Why

- Earlier analysis found that about 38% of consumer-facing LIVE English copy was duplicated after basic text cleanup.
- Some low-match lines have the same meaning as existing TM, but use different words and cost more to translate.
- We help ops and CDs reuse good TM wording for stable UI, revenue, and compliance copy. Creative copy stays flexible.

### How

- A is the original English copy. Starling gives us Score A.
- For items below 85%, Inspire Writer suggests B. Starling then gives us Score B.
- The CD edits or accepts B. This final version is C, and Starling gives us Score C.
- Estimated savings are `TM cost(A) − TM cost(C)` for the selected shared target languages. Missing data stays incomplete; it never becomes zero.

### Status

- The full flow is implemented and passed our tests, from TM lookup to CD review, multi-language ROI, and Bitable archive.
- In one Mira pilot of 3,733 segments, 137 were below 85%. Inspire produced 97 suggestions, and 23 were usable or likely usable.
- That is 17% of low-match segments, or 24% of the suggestions produced.
- The working estimate is about `$400 per batch`, `$3,200 per month`, or `$38K per year`.

### Next

- Let a small group of CDs test real batches, improve the 24% suggestion usability rate, and confirm the savings method with the localization team.

I am happy to share a short demo or the ROI Bitable. That is all from me.

## 45-second version

- Earlier analysis found 38% duplicate LIVE English copy after basic text cleanup. Some low-match lines also mean the same as existing TM.
- The tool follows A → B → C: original, Inspire rewrite, and CD-final copy. Starling checks each step.
- Savings are `TM cost(A) − TM cost(C)` for the selected shared languages. Missing data stays incomplete.
- In one 3,733-segment pilot, 23 suggestions were usable: 17% of low-match items and 24% of generated suggestions.
- Next, a small CD group will test real batches. We will improve quality and confirm the savings method.

## Presenter notes

- Pause after A, B, and C. This is the main idea people need to remember.
- Treat `$400 per batch`, `$3,200 per month`, and `$38K per year` as working estimates until the localization team confirms the method.
- The pilot figures in this draft came from the provided speaking notes. Verify them against the original analysis or ROI Bitable before presenting.
- If someone asks why 137 items produced only 97 suggestions, be ready to explain the 40-item gap. The current draft does not provide that reason.
