# Independent in-house review — partial completion

No settings, secrets, live records, database changes, real sends or publishing occurred. Pending SQL was exercised only on PGlite.

## Verification
- 14 focused files: 68 passed, 0 failed.
- Final regression reruns: deposit practice, held presentation and SIM: 21 passed, 0 failed.
- Additional booking practice/SIM/worker-email run: 38 passed, 3 existing presentation failures. Those three match the before-run.
- Latest app check: build OK.
- Full isolated comparison: before 993 files, 10,045 passed / 243 failed, 98 failing files; after 997 files, 10,052 passed / 253 failed, 100 failing files. New failures were repaired and rerun individually: corrected 10,062 passed / 243 failed, same 98 failing files. This is not a second full-suite run after repairs.
- Historical 97/243 differs by the already-known owner-accept-speed reporter exit anomaly; the comparison above counts it consistently. The before-run overlapped new-test creation, so new-test pass totals are not a pristine baseline. Existing-file failure comparison is the evidence used; no remaining new failing files.

## Regression repairs
- SIM harness now loads the real new electrician email helper with captured providers and asserts the selected worker email; no longer claims that missing notification as TODO.
- Deposit practice assertion now allows the deliberately requested pending/resolved intent history while retaining one invoice-keyed request and no unresolved pending intent.
- Held presentation test now expects the deliberately requested overdue booking warning for in-house jobs; other coordination suppressions unchanged.

## Implemented and focused-tested
- Booking notices recorded before quiet-hours/pause checks, with retry sweep; complete per-channel recovery still unfinished.
- Deposit pending request precedes invoice lookup; late/read-failed invoice retry and repeated-failure office facts.
- Installer paid-notice retry after definite failure, without the old 24-hour cutoff.
- Pending handback SQL accepts qa_test and cancels confirmed Ready Check/PIESA bookings; practice-tested. Recovery closes unused forms and removes returned-trade access with stable failure/recovery records.
- Exact empty Team blockers, owner deadline SMS without pay link, authorized batched To book contexts (405 rows tested).
- Late-install digest follow-up, booking overdue facts for PIESA/install, in-house payment next-action text.
- Worker-only booked PIESA email through the approved suite, captured in SIM; no worker SMS.

## Still unfinished — do not consider the request complete
- Items 1–3: independently durable per-channel completion, expired/replaced booking intent retirement, comms-blocked electrician intent and concurrency/uncertain-send retry hardening.
- Items 8–10: Book/Change Lead Installer still await external form/notice work; a durable post-save job with retry/office-task resolution is not yet implemented. Validation was moved before worker preparation, but transaction-bound revalidation and double-click proof remain incomplete.
- Item 10: full A5/SWMS failed-move recovery and office task clearance needs integration proof.
- Items 11–12: late-digest and stage-derived overdue readers have focused coverage; full production-path integration and timing proof remain incomplete.
- Two-user browser/RLS proof was not performed; all verification was isolated practice/test-double execution, not live end-to-end proof.

## Pending migration
`docs/pending-migrations/2026-11-01_task7_trade_hand_back.sql` — modified only locally; PGlite tests passed, not applied.

## Changed files
Production: in-house-booking.server.ts, deposit-request.server.ts, in-house-booking-notices.server.ts, office-needs.core.ts, office-needs.server.ts, needs-cards.core.ts, in-house-booking.core.ts, InHouseBookingCard.tsx, in-house-booking-list.server.ts, trade-view.functions.ts, field.index.tsx, payments.server.ts, in-house-electrician-booked.server.ts, booking.server.ts, trade-view.server.ts, in-house-forms.server.ts, in-house-handback-cleanup.server.ts, allocation-tick.ts, thirty-day-rule.core.ts.

Tests: in-house-review-rules.test.ts, helpers/sim-handback-practice.ts, in-house-task7.server.test.ts, deposit-request-task6.server.test.ts, in-house-task7-notices.test.ts, booking-overdue-needs.test.ts, deposit-task6-payment-hook.test.ts, in-house-booking-list-review.test.ts, in-house-worker-booked-review.test.ts, in-house-handback-cleanup-review.test.ts, in-house-task7-hand-back-db.test.ts, thirty-day-rule.test.ts, helpers/sim-in-house.ts, sim-in-house-journey.test.ts, deposit-request-task6-practice-db.test.ts, in-house-held-presentation.test.ts. Guidance/report: roadmap.md, src/lib/AGENTS.md, this report; pending SQL above.