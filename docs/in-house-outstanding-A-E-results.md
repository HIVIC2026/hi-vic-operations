# In-house outstanding A–E — isolated verification

No settings, secrets, live records, database changes, real messages or publishing. New SQL remains pending and was exercised only on PGlite.

## Results
- A/C: booking and crew save commit durable follow-through; claim/checkpoint retry covers forms, A5/SWMS and notices. Failed/recovered office events are work-scoped. Old direct A5 access is removed before new sharing. Failed-revoke/retry, immediate response and double-click tests pass.
- B: pending service-only locked compare-and-set tests prove one booking/crew change and one retry claimant, including outsider refusal. Full production canonical-gate transaction parity remains unproven; do not treat pending SQL as launch-ready or apply it.
- D: paused electrician email intent is retained; uncertain retries keep the provider key inside its validity period; successful delivery is not repeated and expired uncertainty remains office work. No worker or installer-office SMS introduced.
- Focused combined: 22 pass, 5 existing SIM TODOs, 0 fail. Related: 30 pass, 0 fail.
- Retired terms: 164 matches, zero customer-visible failures.
- Authenticated UI and live provider delivery were not exercised under the no-live-mutation/no-send restrictions. Practice/mocked tests are not live whole-job proof.

## Complete file-by-file suite comparison
Two known stallers (`register-interest-validation.test.tsx`, `save-spot-uncertain-delivery.test.ts`) were excluded identically. Tests ran separately with bounded timeouts; TODOs were counted separately.

| Snapshot | Files | Passed | Failed tests | Failing files |
|---|---:|---:|---:|---:|
| Archived start of this repair | 997 | 10,053 | 244 | 98 |
| Final repairs | 1,000 | 10,058 | 244 | 98 |
| Reconstructed Task 7 `f358d6a1` | 987 | 10,012 | 244 | 98 |

No new failing file and no existing file lost passing tests or gained failing tests against either archived comparison. No file can honestly be named as newly failing against the historical 97/243: that count was not reproduced; fresh Task 7 itself returns 98/244.

Full failure inventories are recorded in `docs/in-house-outstanding-failures.json`.

## Changed files for A–E
- Pending SQL: `docs/pending-migrations/2026-11-01_in_house_saved_work.sql`.
- Save/retry modules: `src/lib/in-house-atomic-save.server.ts`, `src/lib/in-house-saved-work.server.ts`.
- Integration: `src/lib/trade-view.server.ts`, `src/lib/visit-allocation.server.ts`, `src/routes/api/public/hooks/allocation-tick.ts`.
- Recovery/access/notices: `src/lib/in-house-forms.server.ts`, `src/lib/in-house-booking.server.ts`, `src/lib/in-house-electrician-booked.server.ts`, `src/lib/office-needs.server.ts`.
- Tests: `tests/in-house-atomic-booking.test.ts`, `tests/in-house-saved-work.test.ts`, `tests/in-house-immediate-save.test.ts`, `tests/in-house-worker-booked-review.test.ts`, `tests/in-house-task7-handover.test.ts`, `tests/in-house-booking-practice-db.test.ts`, `tests/helpers/sim-in-house.ts`.
- Guidance/report: `AGENTS.md`, `src/lib/AGENTS.md`, `roadmap.md` and this report.

Remaining blocker: independent full transactional payment/workflow gate-parity verification before the pending writer can be considered production-ready; live two-user/UI checks remain NOT RUN.