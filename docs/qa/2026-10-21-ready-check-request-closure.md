# Targeted Ready Check request closure

Observed by 2026-10-21T04:06:49Z. Target: preview `http://localhost:8080`, not published. Source during final checks: `01161a6da663f6dd0f1fc8786363dae1c7097fd7` (automatic workspace revision).

## Narrow correction
- `src/lib/readycheck-payment.server.ts`: propagate the existing window gate error after retaining its diagnostic/history; retry a current immutable acceptance whose windows are missing; verify exact current-round persisted picks before returning success; recognize already persisted identical picks without another submission. A unique acceptance conflict re-reads the existing current acceptance.
- Customer state reads no longer expose received/success solely because an acceptance exists. Missing/read-error windows leave the existing request/error path available after refresh. Normal taken/closed booked rounds remain recognized.
- Customer wording, FREE amount, assignment/owner-times/eligibility guards, routes and production security unchanged.

## Focused results
- Existing actual-module/in-memory persistence suite: **10 PASS, 0 FAIL**. Covers 3/4/5 windows, failed insertion, active-installer rejection, retained-acceptance retry, first/duplicate success, different-pick rejection, read-error refusal, normal booked round.
- FREE compatibility suite: **2 PASS, 0 FAIL**.
- Existing Ready Check/core booking suites: **25 PASS, 0 FAIL**.
- Existing archive actual-handler/PGlite suite: **2 PASS, 0 FAIL**.
- Practice-only exact assignment ending: TEST-only scope, replay no-op and non-TEST refusal PASS before live setup. No migrations.
- Latest automatic preview signal: build OK at 04:02:48Z. No manual build/typecheck or broad QA run.

## Actual synthetic owner proof
Only fresh **HV-2996**, ID `fbbf9e1c-f9dd-486e-8893-63812b4ddc69`, source `qa_test`, unchanged `hivic_sourced` channel. Reserved `hivic-test.example` email, no phone. Existing authenticated Office TEST controls created/prepared the fixture. Supported owner login and four Gate A signature actions completed; no manufactured signatures/events.

Preparation added Alpha's installer assignment. Only this newly added assignment `08b2b033-3d30-4af1-9671-685bdfc85b4f` was ended with normal active/ended-at/end-reason semantics, exact job/assignment/user/business/source fences and stored full before-image event. The historical marked TEST-business association remains. Independent pre-request read: **zero active installers, zero acceptances, zero windows**, job-specific Office-picks on. No global change.

| Targeted action | Result |
|---|---|
| Supported TEST owner login/consent/estimate view | PASS |
| Save My Spot first-save and hard refresh | PASS; one persisted saved campaign row |
| Simultaneous Save My Spot retry | PASS; both calls resolve |
| Owner selects 3 legal windows and requests FREE Ready Check | PASS |
| Desktop 1280×1800 and phone 390×844 received state after refresh | PASS; exact selected times visible; phone document width 390; zero captured page errors/failed requests |
| Actual simultaneous acceptance retries after saved request | PASS; same acceptance ID, $0/null |
| Independently read exact round-1 OPEN windows | PASS; below |
| Appointment confirmation | **NOT_RUN**; normal `chooseTrade` rejects TEST Alpha: `TEST Alpha Insulation can't take this Ready Check: Not available: does not have verified coverage for this area.` No coverage/approval repair or offer insertion |
| Existing archive control and independent cleanup read | PASS; only HV-2996 archived, source/history/windows/acceptance retained |

Requested windows (not a confirmed appointment):
- Fri 23 Oct 2026, 08:00–10:00 Melbourne: `2026-10-22T21:00:00+00:00` → `2026-10-22T23:00:00+00:00`.
- Mon 26 Oct 2026, 08:00–10:00 Melbourne: `2026-10-25T21:00:00+00:00` → `2026-10-25T23:00:00+00:00`.
- Tue 27 Oct 2026, 08:00–10:00 Melbourne: `2026-10-26T21:00:00+00:00` → `2026-10-26T23:00:00+00:00`.

All three are current round 1 / OPEN, distinct allowed Melbourne weekdays, at least two business days ahead and within 21 days. Stored acceptance count **1**, amount **0.00**, snapshot amount **0**, public `paymentId=null`; payment rows **0**, invoices **0**. Failure events **0**. Offers/bookings **0**.

Final cleanup: cancelled + `qa_archived_at=2026-10-21T04:06:39.641Z`; active assignments **0**, active worker links **0**, external outbox **0**, post-intake work **0**, provider-sent/delivered communication rows **0**. Existing Save My Spot implementation recorded **2 queued internal communication rows and 1 blocked_prelaunch TEST email log**; none reached a provider. These records are retained honestly, not described as zero communication logs.

Screenshots/private browser inputs remain under `/tmp/browser/booking-closure`; no credentials or private links in this report. HV-2991–2993 and all real jobs untouched. Historical calculator/mobile/34-route evidence reused unchanged; no sweep, publication, SMS/email/provider call, invoice or schema change.