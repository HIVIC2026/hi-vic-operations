# Office-controlled owner Ready Check booking

Jo request: 21 October 2026, 23:39 UTC. No sends or publication.

## Result
- New `workflow_settings.ready_check_booking_enabled` defaults OFF. Live SELECT confirms false. No unrelated switches changed.
- Explicit per-job Office offer, authenticated and role-checked inside `offer_owner_ready_check_booking`, records actor/time plus permanent workflow event; no link creation, outbox, email/SMS, booking or pricing work.
- Office job Ready Check disclosure contains the master switch and Offer Ready Check booking action. Enabling the master alone authorises nobody; each job needs its Office offer. While OFF, offers cannot be made.
- Public estimate replaces the Ready Check close/action with Save my spot linking to the existing canonical campaign page. Saved spot OR existing recorded request shows the held message without another save or picker. Existing estimate caveats/price content preserved.
- Saved personal estimate and installer times links also respect the gate. More-times picker uses the same read gate. Accepted legacy requests without windows can choose their first times only after both permissions exist.
- Shared acceptance and time writers recheck authorization before retries/writes. Database INSERT triggers protect against old deployed/new-window requests. Existing acceptance/windows remain untouched. Timer/refill/more-times queues stop while locked; DB also suppresses new Ready Check time-prompt outbox rows from older deployed code.

## HV-2524 / real-owner audit
Read-only audit of every non-qa_test job with Ready Check acceptance, windows, or recorded request/window-chosen events found **only HV-2524, Kurt Obrist, postcode 3352**.
- One acceptance, accepted 20 Oct 2026 02:13:29 UTC, $0; five round-1 windows, all closed; no Ready Check booking.
- No campaign spot_saved_at recorded; the existing Ready Check acceptance is sufficient for the held receipt. No artificial Save My Spot response was created.
- Existing more-times outbox row is blocked, not sent. It was not edited/retried.
- No booking offer recorded; gate is OFF. Preview reads display **Spot held — we'll be in touch to book your Ready Check**. Estimate, saved details, acceptance, windows, job stage and history were not changed.
- Other real owners found: **none**.

## Practice proof / live change
`docs/pending-migrations/0220_office_ready_check_booking.sql` tested on PGlite before live application, including real SQL triggers/RPCs. Applied by migration tool as `drizzle/migrations/0162_office_ready_check_booking.sql`; generated types refreshed. SELECT verifies setting false, all four new triggers, and Kurt's acceptance/window counts retained.

## Verification
| Check | Result |
|---|---|
| Practice SQL permissions, default OFF, ON without offer, exact-job offer, OFF after offer, unchanged rows, prompt suppression | 6 PASS, 24 assertions |
| Actual server acceptance/windows/readback/receipt/timer against sealed persistence | 23 PASS, 112 assertions |
| Existing Ready Check/free/booking regressions | 27 PASS |
| Customer confirmation/receipt rendering | 6 PASS |
| Saved personal estimate/PGlite pricing and isolation regressions | 19 PASS |
| Total focused tests | **81 PASS, 0 FAIL** |
| Required terminology scan | 0 customer-visible failures |
| Harness compilation/typecheck | latest build OK |
| Actual owner estimate route + actual Office control, sealed TEST data, 1280×1800 and 390×844 | PASS: OFF/save, ON/no-offer/save, Office-offer/picker, held receipt/reload; no submit/provider call/page errors |
| Hosted real-owner page / live TEST Office offer mutation | NOT_RUN: test data only; no live switch or per-job offer changed |

Browser evidence: `/tmp/browser/ready-check-office/`; reproducible fixture in `tests/ready-check-office-browser.*` (separate Vite harness, no live auth/persistence/provider).

## Publication boundary
The database default-OFF insert/prompt protection is already live. The revised owner pages, Office button and pre-retry server checks remain unpublished. The published old page may still display its old button/prompt until publication; new acceptance/time inserts are rejected by the live database. An old deployed exact retry of already persisted times may return its earlier receipt without writing—new code rejects this while OFF. No publication was performed.

## Files
- Access rule/server/functions: `src/lib/ready-check-booking-access.{core,server,functions}.ts`.
- Shared owner/automatic paths: `readycheck-payment.server.ts`, `readycheck-booking.server.ts`, `installer-ready-check.server.ts`, `visit-events.server.ts`.
- Read payloads: `estimatelink.server.ts`, `personal-estimate.server.ts`, `launch-campaign.server.ts`.
- Owner views: estimate route, saved-estimate route, times route, estimate component, ready-check-times component.
- Office action: `ready-check-booking-access.tsx`, Office job route.
- Migration, practice/isolated/browser tests, `src/lib/AGENTS.md`, roadmap and project requirement memory.