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

## Final independent-review correction — 21 Oct 04:41 instruction

Completed by 04:47 UTC on the local preview; earlier HV-2996 evidence remains historical. Only retry matching and focused regressions changed. Stored/current and requested start/end pairs are normalized to timestamp epochs, each side must be unique and their sets equal. Current-round selection, 3–5 count and existing open/taken/closed-with-taken status checks remain unchanged. No wording, prices or eligibility/coverage rules changed.

**Focused actual-module results: 13 PASS / 0 FAIL / 60 assertions.** Added stored A/B/C versus A/A/A refusal, duplicate persisted-key refusal (including received-state read), equivalent +00:00/Z timestamp and reordered exact retry success. Existing booked taken/closed retry now explicitly asserted without rewriting rows. Other focused existing runs: FREE/Ready Check 20 PASS; Ready Check core + installer roundtrip practice + owner-link/Mitti rules 37 PASS; owner-code/autolink/archive PGlite 5 PASS; atomic Ready Check windows and visit-history PGlite 10 PASS. These are separate bounded runs, not a full QA sweep. Automatic preview signal build OK at 04:42:22Z.

**One fresh fixture: HV-3000**, `5cf65a7d-4c4d-4286-b7a9-36c29475b23f`, source qa_test, synthetic TEST-only Frankston VIC 3199 address, unreachable reserved-domain owner email, null phone. Created through existing TEST Office action without broad prepareQaJourneyAccess; independent initial read proved zero assignments/acceptances/windows. Existing code verification path established this new owner's identity without delivery and four normal guarded Gate A actions signed consent. Estimate viewed normally and owner selected three legal 8–10am windows through the existing FREE request UI; one acceptance `0323f62b-8807-4fd2-88f9-101ca8bb69fb`, amount/snapshot 0, public paymentId null.

Initial round-1 OPEN windows: 23, 26, 27 October Melbourne 08:00–10:00, stored starts `2026-10-22T21:00:00Z`, `2026-10-25T21:00:00Z`, `2026-10-26T21:00:00Z`, ends two hours later. Two-business-day lead, three distinct weekdays and horizon preserved. First slot independently checked unoccupied. Existing approved active marked TEST Alpha retains verified coverage timestamp `2026-10-18T00:11:04.526Z`, postcodes 3199/3064 and permitted null acceptance/preferences; zero active non-qa assignments. No coverage, qualifications, approval, role or rate repair.

**Confirmed booking PASS, independently read before teardown:** ordinary Office chooseTrade created one offer `1a22b7eb-6e5c-4b8d-ba64-9ca95b7f2716`; existing Alpha session invoked normal respondToOffer for window `da041144-8a24-4b2f-bc50-b4b3050add4f`. Offer stored accepted by Alpha `b8202cb7-614c-4b89-905e-696c4245f995`; selected window TAKEN and alternatives CLOSED. Booking `b67a5ddb-7e8c-43b0-bb51-360a454eb9bc` stored confirmed / ready_check / Alpha business / scheduled_start `2026-10-22T21:00:00Z`; scheduled_end null as existing booking design. Job actually stored ready_check_scheduled. Alpha /field showed the Friday 23 8–10am appointment at the synthetic Frankston address. No failure-window/advance/booking events.

**Provider preflight qualification:** qa_test suppresses owner code delivery and signed-copy outbox, but is NOT a universal Mitti no-call barrier. Existing Alpha `mitti_account_invited=false` was read before acceptance: onReadyCheckBooked returns skipped before scheduling a form under that unchanged guard. ConfirmBooking's Ready Check path has no direct send/invoice step; automatic progression is portal-state-only at this stage. Zero Mitti claims were read after acceptance. No provider invocation or setting change was required or performed.

**Teardown PASS:** normal ownerChangeReadyCheckByToken cancel returned late=false/outcome=cancelled, stored owner_cancelled visit event with counts_against=none. Existing TEST Office archive action then archived only HV-3000 at `2026-10-21T04:47:07.953Z`, stage cancelled, deleted_at null. Independent read: zero confirmed bookings, active assignments/live worker links, payment rows/attempts, invoices, SMS, customer_email_sends, job communications, external outbox or post-intake work; cancelled booking and 19 workflow audit rows retained. No live synthetic appointment/assignment remains. Practice checks ran before each live setup/acceptance/teardown category; no SQL writes or migration.

Evidence under `/tmp/browser/final-confirmation`: owner request screenshot, Alpha coming-up appointment screenshot, sanitized acceptance result and teardown script. Initial missing #confirm section wait was corrected without duplicate fixture; no role-login failures. Prior calculator/mobile/customer and completed remaining UI QA evidence reused, not repeated. Prior three UI failures and unrelated NOT_RUN controls remain unchanged; this closes only the booking confirmation gap.