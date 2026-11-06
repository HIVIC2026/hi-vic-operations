# Task 6 — no spot messages on firm-quote jobs

Task 6 only; stopped before Task 7.

## Result
- Shared `skipSpotMessage` exclusion uses the existing firm-quote eligibility reader. Null activation retains the normal path.
- Excludes day 2/7/21 follow-ups and auto-close, saved confirmations and recovery, 24-hour reminders, release/“It's your turn” and reminders, quick taps and reminders. Sender results retain their existing contract with `firm_quote_job` as the skip reason/detail; skipped outbox texts never retry or report success.
- Calculator: removed only the requested sentence; button unchanged. Verified at 390 and 1280, screenshots in `/tmp/browser/firm-task6/`.

## Files
Added:
- `tests/firm-quote-spot-guard.test.ts`
- `tests/firm-quote-spot-senders.test.ts`
- `tests/firm-quote-calculator.test.tsx`
- This report.

Changed:
- `src/lib/firm-quote.server.ts`
- `src/lib/estimate-followup.server.ts`
- `src/lib/spot-saved-send.server.ts`
- `src/lib/email-preliminary-offer.server.ts`
- `src/lib/launch-campaign.server.ts`
- `src/lib/spot-saved-recovery.server.ts`
- `src/lib/area-batch.server.ts`
- `src/lib/spot-release.server.ts`
- `src/lib/save-spot-reminder-blast.server.ts`
- `src/lib/owner-email-send.server.ts`
- `src/lib/sms.server.ts`
- `src/lib/external-action-dispatcher.server.ts`
- `src/components/portal/register-interest.tsx`
- `tests/firm-quote-spot-confirmation.test.ts`
- `tests/save-spot-reminder-blast-handler-isolated.test.ts`
- `tests/spot-saved-recovery-isolated.test.ts`
- `roadmap.md`

## Checks
Each test file ran separately. Final results:

| Test file | Pass | Fail |
|---|---:|---:|
| firm-quote-spot-guard | 4 | 0 |
| firm-quote-spot-senders | 43 | 0 |
| firm-quote-calculator | 1 | 0 |
| firm-quote-spot-confirmation | 1 | 0 |
| save-spot-reminder-blast-handler-isolated | 7 | 0 |
| spot-saved-recovery-isolated | 16 | 0 |
| estimate-followup | 32 | 0 |
| spot-saved-send | 18 | 0 |
| spot-release.server | 19 | 0 |
| spot-release.core | 33 | 0 |
| save-spot-reminder-blast | 30 | 0 |
| a48-b2-area-batch-core | 27 | 0 |
| a48-b2-quick-taps | 118 | 0 |
| external-action-wiring | 3 | 0 |
| firm-quote-request | 14 | 0 |
| firm-quote-server | 12 | 0 |
| firm-quote-automatic | 8 | 0 |
| email-preliminary-save-spot | 13 | 0 |
| **Total** | **399** | **0** |

The existing `email-preliminary-save-spot-db.test.ts` standalone practice proof also exited successfully; it registers no counted test cases and is excluded from the total.

New guard/sender tests failed before the changes. Added normal-job controls, exact skip reasons, no delivery/claims, and a genuinely auto-close-due legacy history excluded by the firm guard. All sender checks use local mocked providers: no actual messages sent. The active firm-quote journey remains unverified against live data because activation and atomic SQL remain pending.

`bun scripts/scan-retired-terms.ts`: exit 0; 978 advisory matches, 0 customer-visible failures. Preview build OK; diff whitespace check clear.

No new or pending migration executed, no live SQL/data changes, no sends, no switches changed, nothing published.