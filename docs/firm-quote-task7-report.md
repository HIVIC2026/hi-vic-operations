# Task 7 — Choose installer

Task 7 source changes implemented and isolated checks passed. Stopped before Task 8.

## Result
- Area-grouped saved spots carry the `firm_quote_requested.details.due_by` date and show “Asked for firm quote · due {date}” through `formatDueDate`.
- Covering photos installers remain available; Ready Check installers are greyed with “Firm quote jobs go to installers who quote from photos.” The server independently refuses that method before allocation or records.
- Firm ticks use the existing direct Give instead of entering an owner-message batch. Existing area suggestions and office confirmation remain; normal Send remains on its original path.
- No owner notice scheduled after firm Give; the owner will-call and no-visit-needed sender also independently skips firm jobs, including retries. Existing From photos installer email and its approval/delivery checks are unchanged.
- Mixed firm/ordinary ticks are refused rather than changing ordinary owner messaging or manufacturing consent.

## Important limitation
**Active end-to-end Give is blocked, not verified.** The existing atomic allocation function still requires a `quick_taps_answered` pass for website leads (`0181`, retained by `0182`/`0189`). A new firm request has no such pass. The application now recognizes the firm request, but that existing database gate may refuse it. No consent was fabricated, no gate bypassed, no SQL written or executed for this task. Before activation, Jo must authorize a separate narrowly scoped database change that recognizes the recorded firm request under the existing job lock. The activation and request SQL also remain pending.

Tests use local fixture data and mocked allocation/providers; they do not prove a live transaction or message delivery. Screen tests exercise the real components, including disabled Ready Check controls and office Give confirmation with its result shown in place. No active authenticated browser journey was run.

## Files added
- `tests/firm-quote-installer.core.test.ts`
- This report.

## Files changed
- `src/lib/firm-quote.core.ts`
- `src/lib/in-house-batch.core.ts`
- `src/lib/in-house-batch.server.ts`
- `src/lib/in-house-batch-email.server.ts`
- `src/lib/area-batch.server.ts`
- `src/lib/area-batch.functions.ts`
- `src/lib/installer-waiting.server.ts`
- `src/lib/installer-waiting-columns.core.ts`
- `src/components/portal/InstallerWaitingScreen.tsx`
- `src/components/portal/saved-spots-by-area.tsx`
- `src/components/portal/in-house-handoff.tsx`
- `src/lib/AGENTS.md`
- `tests/in-house-batch-server.test.ts`
- `tests/in-house-batch-email.test.ts`
- `tests/a48-b2-send.test.ts`
- `tests/saved-spots-by-area.test.tsx`
- `tests/photo-quote-handoff-ui.test.tsx`
- `tests/installer-waiting-rank.test.ts`
- `roadmap.md`

## Tests
Each file ran separately; no full-suite claim.

| File | Passed | Failed |
|---|---:|---:|
| firm-quote-installer.core | 3 | 0 |
| in-house-batch-server | 26 | 0 |
| in-house-batch-email | 12 | 0 |
| saved-spots-by-area | 10 | 0 |
| photo-quote-handoff-ui | 2 | 0 |
| a48-b2-send | 58 | 0 |
| in-house-batch.core | 22 | 0 |
| installer-waiting-rank | 9 | 0 |
| firm-quote.core | 22 | 0 |
| firm-quote-server | 12 | 0 |
| choose-installer-single-batch | 3 | 0 |
| in-house-handoff-ui-task1 | 10 | 0 |
| owner-photo-quote-notice | 5 | 0 |
| installer-waiting-columns | 16 | 0 |
| firm-quote-emails.core | 19 | 0 |
| **Total** | **229** | **0** |

Test-first: three new actual-server fixture checks failed before implementation; the new pure test failed on missing exports. Existing server tests passed before and after.

`bun scripts/scan-retired-terms.ts`: exit 0, 978 advisory matches, 0 customer-visible failures. Latest preview build OK; whitespace check clear. Choose installer route already has its own app-specific head metadata, unchanged.

No SQL run, live records changed, sends, switch changes or publication.