# Deployment compatibility and B — 1 November 2026

No live records, settings, secrets, database changes, provider delivery or publishing.

## Straight answer
Before this change, Book and Change Lead Installer failed without the saved-work migration: `in_house_visit_revision` / `commit_in_house_visit` were unavailable. The migration adds functions using existing `workflow_events`, not saved-work tables.

The code now uses the original inline path when PostgREST explicitly reports the named RPC missing (`PGRST202`). Permission failures, network uncertainty, missing relations inside a deployed writer and other commit errors never trigger another writer. Inline installation preparation explicitly avoids re-entering the atomic dispatcher. Canonical validation occurs before allocation and is repeated by `confirmBooking`. Original inline form, ESC, invoice and guarded-notice work remains inline.

This restores pre-migration behavior; it does **not** make that legacy path atomic or give it the pending saved-work immediate-response/retry guarantees. It can still wait on providers. Captured tests are not published-site proof.

## B: NOT ready to apply

The new practice test loads the actual `drizzle/migrations/0073_guarded_stage_commit.sql`, replacing the former permissive test stub. It runs actual `installDepositBlockerFor`, `jobPaymentView`, payment ledger and owner PIESA confirmation readers on the same PGlite records. Unrelated repeat/rectification branches and provider configuration/official-copy presentation are isolated; no canonical deposit calculation or owner-confirmation decision is substituted.

Evidence:
- Paid installation invoice: deposit reader clears.
- Change that invoice from $449 paid to $349 paid: actual deposit reader blocks; job/Team revision is unchanged.
- Current signed-off PIESA with no owner confirmation: actual owner reader blocks.
- The pending writer still commits the booking/stage/crew/work intent for that blocked job. This is a diagnostic test PASS proving a **gate-enforcement gap**, not B completion.
- Pending SQL refuses an ESC-unregistered Lead Installer and unverified electrician with zero booking writes.
- Double-click, outsider, stale-version, single claimant and old A5-access removal tests remain covered.

The real stage writer checks expected stage/terminal/disposition, not canonical payment/signature gates. TypeScript validation and SQL commit use separate production requests; putting them together only in a test transaction would misrepresent production safety.

## Exactly what remains for B/readiness
1. Execute or bind every canonical gate inside the production locked transaction, including current invoice/ledger deposit and rectification payment, accepted quote, owner paperwork/current PIESA confirmation, eligibility, electrical clearance/repeat PIESA, commercial settings, date/30-day/24-hour window and live/stage rules. A Team revision or job timestamp alone is insufficient.
2. Prove changed dependent facts between validation and commit cannot produce a booking or allocation/crew/history/work write; cover first booking, same-stage reschedule and crew-only change. Current diagnostic demonstrates the opposite for deposit.
3. Prove complete CII/White Card/declarations/crew clearance and application/SQL actor permission parity, including the established staff crew-picker exception, under the same locked transaction.
4. Reconcile saved-work follow-through with every canonical inline hook, including assessment planning and booked notice and installation reschedule notice; prove replay-safe recovery.
5. Complete isolated two-user end-to-end authorization/row-access evidence and real canonical gate integration, not substitute mocks. Live checks remain NOT RUN under this request.

No pending SQL was applied or marked ready. B remains unfinished rather than introducing a second unproven rule engine or weakening locked rules.

## Related results
Eight focused files including SIM: 29 pass / 0 fail / 5 existing SIM TODOs before the final additional electrician refusal assertion; final rerun recorded in chat.
`in-house-booking-practice-db.test.ts`: 23 pass / 3 pre-existing presentation failures (loading access, error access, booked install panel). These were already recorded at this turn's start; no workflow-gate failure.
Retired-term scan: 164 matches / 0 customer-visible failures. Build checks: OK. No full suite was requested or run this turn.