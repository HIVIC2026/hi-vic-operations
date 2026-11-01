# Task 2 test results

Both approved migrations applied: `0181_in_house_quick_taps.sql` and `0182_in_house_team_electrician.sql`. Practice checks ran before each live application. No worker or job data was edited, no settings/secrets changed, no messages sent and no publication.

New tests: **17/17 pass** (9 pure verification checks, 4 practice office/own-Team security and atomic assignment checks, 4 mocked A3/A4 handover and read-only booking checks). Additional existing-file checks: installer-only batch and actual canonical booking refusal both pass.

Changed existing-file results:

| File | Before | Final |
|---|---:|---:|
| in-house-batch-practice-db.test.ts | 11 pass / 0 fail | 12 pass / 0 fail |
| in-house-booking-practice-db.test.ts | 22 pass / 3 fail | 23 pass / 3 fail |

Three new test files pass 9, 4 and 4 checks respectively. Superseded earliest-electrician selection assertions were updated in in-house-batch-server; its 11/0 result is unchanged. Final recheck of changed regressions: 113 pass / 3 already-existing booking presentation failures. installer-part1-d and mitti-retry-core are unchanged green after final fixes.

Bounded per-file full runs covered 963 baseline files and 966 final files. `register-interest-validation.test.tsx` stalled in both runs and was stopped, so the exact 98 failing files / 261 failures total cannot be confirmed. Remaining baseline records report 244 test failures; final corrections leave those existing failure results unchanged. `save-spot-uncertain-delivery.test.ts` was interrupted during the final full run but reran successfully, 31/0. No new failing file remains after final changed-file rechecks.

Two-user authorization/refusal checked on the practice database, not live worker records. Hosted verification/assignment and real Mitti handover were not exercised because live data and sends were forbidden. Automatic preview checks: build OK.