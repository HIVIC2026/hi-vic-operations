# Task 6 restoration — 6 November 2026

Recovered the exact source/test changes from reachable commit `102dd1d12fecd4d3722f11f4f307ce505c59fded` through forward edits. Git patch application/cherry-pick was unavailable; no history was rewritten.

## Preservation
- All original Task 6 source/test files match that commit byte-for-byte, except `area-batch.server.ts`, which also retains the later Task 7 photos-only/direct-Give additions.
- Tasks 1–5 and 7 and merges #189, #190, #191 remain intact. No whole-file rollback.
- Task 7's existing pending allocation database blocker remains unchanged; this restoration does not activate the flow.

## Restored behaviour
- One `skipSpotMessage(jobId)` guard, using the existing fail-closed firm-job reader.
- Day 2/7/21 follow-ups and direct automatic closure skip firm jobs; the facts loader excludes them entirely.
- Saved text/email, preliminary saved confirmation, recovery, 24-hour reminder, release/“It's your turn”, release reminders, quick taps and quick-taps reminders skip with `firm_quote_job` through existing return contracts.
- Skipped outbox texts do not retry or report success.
- Calculator lost only the specified spot-release sentence; button and all other content unchanged.
- Null activation retains normal delivery paths.

## Files restored/changed
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
- `tests/firm-quote-calculator.test.tsx` (restored)
- `tests/firm-quote-spot-guard.test.ts` (restored)
- `tests/firm-quote-spot-senders.test.ts` (restored)
- `tests/firm-quote-spot-confirmation.test.ts`
- `tests/save-spot-reminder-blast-handler-isolated.test.ts`
- `tests/spot-saved-recovery-isolated.test.ts`
- `tests/a48-b2-send.test.ts` (existing Task 7 mock now exports the restored guard; assertions unchanged)
- `src/lib/AGENTS.md`, `roadmap.md`, this report.

## Test-first evidence
Before restoration: calculator 0 pass/1 fail; shared guard 0 pass/4 fail; spot senders 9 pass/34 fail. After restoration, the same files pass. The area-batch suite initially exposed a missing restored export in its Task 7 mock; adding that mock export made all 58 existing checks pass without changing assertions or application behaviour.

## All firm-quote files — each run separately
| File (`tests/`) | Passed | Failed |
|---|---:|---:|
| firm-quote-automatic.test.ts | 8 | 0 |
| firm-quote-calculator.test.tsx | 1 | 0 |
| firm-quote.core.test.ts | 22 | 0 |
| firm-quote-emails.core.test.ts | 19 | 0 |
| firm-quote-installer.core.test.ts | 3 | 0 |
| firm-quote-postintake.test.ts | 1 | 0 |
| firm-quote-request.test.ts | 14 | 0 |
| firm-quote-server.test.ts | 12 | 0 |
| firm-quote-spot-confirmation.test.ts | 1 | 0 |
| firm-quote-spot-guard.test.ts | 4 | 0 |
| firm-quote-spot-senders.test.ts | 43 | 0 |
| firm-quote-work.test.ts | 2 | 0 |
| **Firm-quote total** | **130** | **0** |

Also passed individually: save-spot-reminder-blast-handler-isolated (7), spot-saved-recovery-isolated (16), estimate-followup (32), spot-saved-send (18), spot-release.server (19), spot-release.core (33), save-spot-reminder-blast (30), a48-b2-area-batch-core (27), a48-b2-quick-taps (118), external-action-wiring (3), email-preliminary-save-spot (13), in-house-batch-server (26), in-house-batch-email (12), a48-b2-send (58), saved-spots-by-area (10), photo-quote-handoff-ui (2), installer-waiting-rank (9).

**29 files: 563 passed, 0 failed.** All delivery/database boundaries in sender tests are local mocks; no actual message was sent. Active live journey was not exercised because activation/atomic SQL remain pending.

`bun scripts/scan-retired-terms.ts`: exit 0, 978 advisory matches, 0 customer-visible failures. Preview build log: build OK. Whitespace check clear.

No SQL run, sends, switch changes, live record changes or publication. Stopped after restoring Task 6.