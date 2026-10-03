# PIESA allocation, direct self-scheduling and the Needs Home Insulation Victoria queue

Built inside the existing portal, reusing what is already there. No new stage system, no 50% deposit logic, Mitti never moves stages, no publishing, all sending switches stay off.

## What gets reused (not rebuilt)
- `partner_offers` and `offerBlocker` / `offerRespondBlocker` (currently used for installer offers). These get a `kind` so PIESA and rectification offers can go to REC partners.
- `appointment_proposals`, `bookings`, `confirmBooking`, `proposalResponse`, `appointmentSla` (already have the 24h/48h windows and the "proposal is not a booking" rule).
- `job_assignments` (assigned REC/installer), `owner_contact_consents`, `workflow_events` (audit), the communications outbox (reminders are queued but never sent while switches are off).
- `evaluatePaymentGate` / `piesaRequestBlockers` for the PIESA start gate; `stageEntryBlockers`, `installationDateBlocker`, `bookingLeadBlocker`, `commercialBlocker` stay the only progression guards.
- `serviceAreaMatch` / `verifiedServiceAreaMatch`, `rankElectricians`, approved partner credentials and capacity data for matching.
- `todo.core.ts` / admin dashboard for the exception queue.

## A. PIESA electrician allocation
- New pure rule `piesaOfferBlockers(job)`: refuses unless Ready Check complete, verified eligible, current confirmed quote approved, and the route's payment option cleared. While the payment switch is off this always blocks, so nothing goes live this turn.
- Pure `selectRecCandidates()`: only approved, active REC partners with verified coverage of the postcode, a current licence/registration and a qualified worker; ordered by exact coverage, spare capacity, fair distribution (fewest recent offers), then responsiveness. Price is never the ordering key. Preferred REC (installer team-up or owner nomination) goes first on its own.
- Offers go to a small batch (default 3, configurable in `workflow_settings`) with an expiry. On expiry/decline the next batch is offered automatically; when nobody is left a "No approved electrician coverage" exception is raised.
- Atomic acceptance through one database function: locks the offer row, checks it is still open and unexpired and the job has no active electrician, creates the assignment, supersedes all other open offers. Stale or second acceptances are rejected with a clear message.
- REC workspace (existing trade area): "Jobs you can accept" list showing only suburb, postcode, approximate measured area, access summary, relevant Ready Check observations and the agreed PIESA rate if one is live. A pre-acceptance projection returns no address, owner name, phone or email — enforced on the server, not by hiding fields.

## B. Owner and electrician coordinate directly
- On acceptance: one audited contact release for that visit (assignment + visit kind), showing the approved owner and trade notices word-for-word. The owner sees the REC business name and contact; the REC sees the owner's name, phone, email and address for that job only.
- Either side proposes a time via the existing proposal flow. Booked only when the other party or authorised office staff confirms.
- 24h with no proposed time: reminder queued (held by the off switches). 48h with no confirmed booking: Needs Home Insulation Victoria exception.
- When the PIESA is confirmed, the assigned installer gets a planning-only notice: "Do not book installation until electrical clearance is complete."
- Every release, proposal, confirmation, reminder and reassignment is written to the audit trail.

## C. PIESA result and rectification
- Mitti sync keeps recording facts/evidence only (existing test that sync never changes stage is extended).
- No rectification: electrical clearance comes from the signed initial PIESA; installation request unlocks only if all current gates pass.
- Rectification: the draft rectification quote is generated from current PIESA facts using the existing rate structures and always lands in office review; a server guard blocks sending until office approval. Unpriced items raise "Rectification pricing needs office review".
- Owner explicitly approves; then owner + the same assigned REC arrange the visit with the same contact/proposal/confirmation rules.
- Rectification completion and Section C are recorded separately. The 30-day timing date is the initial PIESA completion (no rectification) or Section C signing (rectification), with the existing "pending written confirmation" warning kept.
- Owner declining required rectification raises an exception; installation stays hard blocked.

## D. Installer scheduling
- The installer already agreed on the confirmed quote keeps the job. No auction, no silent swap.
- Installer workspace lists assigned jobs and what is waiting on them.
- After electrical clearance: audited contact release for the installation visit, then the same proposal/confirmation, 24h reminder and 48h exception rules.
- If the agreed installer declines or cannot proceed: job stops in Needs Home Insulation Victoria; a replacement needs a new owner-approved quote whenever commercial terms change.
- Confirmed install date still passes the existing AP pre-install notice, PIESA timing, PIISA and safety gates.

## E. One "Needs Home Insulation Victoria" queue
- Becomes the default office view on the admin dashboard; "All actions" stays as a separate tab.
- Only exceptions automation cannot resolve: coverage exhausted, 48h no PIESA booking, failed delivery that blocks progress, owner declined rectification, rectification pricing review, installer declined/unavailable, 48h no installation booking, invalid/at-risk 30-day PIESA timing, AP/ESC notice timing invalid near install, compliance correction, ESC/VEEC Registry query/rejection, any office-owned item overdue.
- Each row states why it is there and exactly what the office should do next, with a link to the right job tab.

## F. Privacy
- Contacts come only from one server function that checks an active, unexpired contact release for the caller's assignment; otherwise nothing is returned.
- Review current owner/trade RLS on `owners`, `profiles`, `properties`; if trades can read contact columns broadly, replace with a narrow job-scoped path. Secure-link hashing/expiry and outbox idempotency unchanged.

## Database changes (additive only)
Staged as `docs/pending-migrations/0086_piesa_allocation_self_scheduling.sql` with rollback, proven on the PGlite practice database (including two simultaneous acceptances). **Not applied live in this turn** — I'll ask before applying. Expected contents:
- `partner_offers`: add `kind` (default installer), `batch`, `superseded_at`.
- New `contact_releases` table (job, assignment, visit kind, released_at, revoked_at, actor) with grants and RLS.
- `piesa_records`/existing timing fields: add only missing ones (`section_c_signed_at`, `timing_date_used`) if not already present.
- `workflow_settings`: offer batch size and offer expiry hours.
- Atomic `accept_partner_offer()` security-definer function.

## Tests
New/extended tests for every item in section G of the request: payment gate before offers, no PII pre-accept, in-area eligibility, atomic/stale acceptance, release is not booking, confirmation by other party/office, 24h/48h, installer planning notice, no install booking before clearance, installer decline → exception, rectification office review before send, owner approval before visit, Section C timing date, contact privacy, Mitti sync no stage change. Then full suite, typecheck, wording scan and build.

## Report at the end
Files changed, migration status (staged, practice-tested, not live), test results, what remains manual, blockers.

## Assumptions to correct if wrong
- Offer batch of 3 RECs with a 24-hour expiry.
- Rectification uses the same REC who did the PIESA.
- Live database migration waits for your separate go-ahead.
