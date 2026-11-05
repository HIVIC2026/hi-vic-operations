# Deep first-job work — ordered delivery

## First: tonight’s fix queue
Finish actionable outstanding fixes before starting these parts. Reconcile older queue entries with tonight’s completed work; do not rebuild the portal Ready Check form, Crew repair or Parts 2/2b/3.
Keep unavailable signed-in checks and republished A5 verification marked **NOT RUN**, never bypass their safeguards.

### Installer refresh regression — launch check
Investigate the reported HV-3675 refresh sign-out on a disposable TEST account, not the real job. Compare normal login and restored session, delayed authentication, expired session and exact job-link return after re-login. Repair only a reproduced defect and run the same assertions before/after; never weaken authentication.
Initial clean signed-out browser check preserved the exact job path, query and hash through sign-in redirect and refresh. Signed-in cases are currently blocked: TEST-session permission was unavailable. No authentication changes are justified by that partial check.

## Part 1 — business pause
Keep only the per-business pause switch requested tonight. Preserve current settings; do not turn messages on or send anything. Verify it cannot affect another business.

## Job-page work
Remove the current **Job details** card and replace its money display with exactly one **Money** card.
- Own customers: no Money card at Ready Check until the price is submitted. After the quote, show recorded **Your price inc GST**, **Safety check (owner pays you)** and **Rebate taken off the owner's total**.
- Later, show **Deposit paid**, **Balance paid** and **Paid to you** only with their actual recorded dates.
- Home Insulation Victoria leads: **Your install pay** and **Your safety check pay** using their recorded amounts. Never a lone “Your PIESA pay” row.
- Treat the supplied amounts as examples, not new rates or changes to agreed prices.
- Collapsed Owner / Visits / Site notes / What the owner's been told become one title-and-chevron row, with no reserved empty height. Expanded details and actions remain available.

## Part 4 — bookings and quotes
Cover each partner-booked visit with the owner’s “You're booked” notice, retaining consent, payment and duplicate-message protections. Own-customer Ready Check still has no booking.
Quotes are valid for **30 days**. Add the partner logo to own-customer quote pages and emails, not agreements.
Show proposed new notice wording to Jo before live use. Preserve existing issued/signed versions.

## Part 5 — installation
- Owner “You're clear to install” email opens the existing PIESA confirmation, ESC consent and 10% deposit steps.
- Partner office books the install within the official PIESA window; Lead Installer and day lock **2 days before**.
- No Lead Installer: partner-office reminder **3 days before**, Home Insulation Victoria red flag **2 days before**.
- Crew remain changeable until the start, with existing SWMS and form-update safeguards.
- GO / DON'T START emails to the partner office at **2pm the day before** and **6:30am on install day**; DON'T START copied to info@. No White Card checks.
- Balance due **on install day**, superseding the older completion+7-day decision for this build; migrate reminders consistently without altering historical accepted terms silently.
- Installer pay: own jobs after owner paid in full; Home Insulation Victoria leads 7 days after paperwork approval; no pay without green light.
- Apply the same installation rules to leads given to Reinsulate/Rapid/INSolation. Draft the corrected partner “Owner accepted” email for Jo’s approval.

## Delivery and checks
Each numbered part is a separate review unit/commit and PR where repository access permits. Do not publish, send, change message switches or edit Mitti templates. Jo publishes.
Run focused rules tests, practice-database proofs before any database change, and isolated TEST phone/desktop checks. Report each part briefly, with failures and unreached checks stated plainly.

## Technical details
Reuse canonical payment, booking, audit, delivery and business-scoped access paths. Money rows are presentation of recorded quote/payment/payout facts, not new calculations or payment writers. Restrict compact-fold changes to the installer job page rather than every portal screen.
PR creation requires repository integration not yet verified; do not represent local commits as PRs. Check existing scheduling support before preparing reminder callbacks; do not activate schedules or unapproved wording.
