# Home Insulation Victoria — workflow source of truth

Version 2026-10-05. Owner-approved. **This file and `src/config/workflow-decisions.ts` override older prompts, comments and stale implementation text. `docs/STATUS.md` is the only implementation-status register.** Conflicts are found by `bun scripts/scan-retired-terms.ts`.

## Branding
Visible name everywhere: **Home Insulation Victoria**. Retired visible names: HI VIC, HI VIC!, HIVIC. Internal identifiers (e.g. `business_unit = 'hivic'`, the locked Xero reference) stay unchanged where renaming risks functionality; renaming needs separate approval.

## Approved workflow order
1. Online enquiry submitted.
2. Preliminary screening from declared information.
3. Preliminary quote/estimate sent after office approval.
4. Owner explicitly requests free Ready Check.
5. Installer allocated.
6. Owner and installer arrange Ready Check by approved direct contact.
7. Ready Check time entered and confirmed in portal.
8. Installer completes Ready Check.
9. Final Ready Check evidence submitted through Mitti.
10. Portal validates Ready Check evidence.
11. Office records verified eligibility: eligible / not_eligible / needs_review.
12. If eligible, confirmed insulation quote issued.
13. Owner approves current confirmed quote version.
14. Owner completes approved payment option.
15. Only then can PIESA be requested.
16. Owner and electrician arrange PIESA by approved direct contact.
17. Installer notified when PIESA is booked (planning visibility only).
18. Electrician completes PIESA.
19. Mitti syncs PIESA result.
20. No rectification: electrical clearance can unlock installation request.
21. Rectification: standard agreed-rate fix-up quotes release automatically; non-standard or manually priced items are held for office review.
22. Owner approves rectification quote.
23. Owner and electrician arrange rectification.
24. Electrician completes rectification and Section C.
25. Mitti syncs passed / OK to proceed.
26. Owner and installer arrange installation.
27. Installer completes installation and final Mitti evidence.
28. Final AP/compliance checks.
29. Job completes only when all final gates pass.

Retired: PIESA before confirmed quote/payment; combined Ready Check + PIESA visit; installation booking before PIESA/Section C clearance; Mitti moving job state without portal validation.

## Eligibility
Preliminary labels: "Preliminary: likely eligible", "Looking good - needs onsite confirmation", "Not eligible", "Needs office review". Verified values: pending, eligible, not_eligible, needs_review.
- "Likely eligible" is preliminary only; final "Eligible" needs verified evidence after Ready Check.
- Owner answers are Declared until verified.
- Existing insulation "Yes" is never an automatic fail; assess type, condition, area and average R-value. R2.0 exactly is not "less than R2.0".
- Previous VEU ceiling-insulation upgrade "Yes" → office review (potential certificate blocker until verified; office decides whether it is the same Activity 48 upgrade, whether it affects the proposed area, and whether the job can proceed).
- Missing, conflicting or unclear evidence → needs_review.

## Payment gate
Retired: 50% deposit gate; `AmountPaid >= 50%` as PIESA unlock; `total / 2`; `deposit_pct: 0.5`; and the texts "Waiting on 50% deposit payment in Xero", "Owner to pay 50% deposit", "Booking opens as soon as your 50% deposit", "Locked - awaiting owner's 50% deposit".

Implementation (pending live migration 0080): pure rule `evaluatePaymentGate` / `piesaRequestBlockers` in `src/lib/payment-gate.core.ts`, mirrored by `invoice_deposit_cleared` in SQL. Switch `payment_option_gate_enabled` defaults OFF; while OFF, PIESA and scheduling are blocked with "payment rule pending activation" (no 50% fallback). 10%/5% is the minimum upfront payment (rounded up to the cent); paying more counts, one cent short does not. A 3-instalment plan counts only when office approved the current quote's plan, the owner accepted the terms, the first instalment is verified in Xero, a payment method/collection arrangement is recorded, and it is not cancelled/failed/overdue/superseded. Installer-supplied and unknown sources: payment-rule exception.
PIESA only after: Ready Check complete, verified eligible, current confirmed quote version approved, approved payment option verified:
1. Upfront deposit paid — 10% under $20,000, 5% at/over $20,000 (pending legal confirmation);
2. Paid in full; or
3. Approved 3-instalment plan active.
Route-aware. Home Insulation Victoria lead: our confirmed-quote payment rule. Installer-supplied customer: do not assume the same gate; no lead fee; no margin on installer price; we receive the approved AP fee and VEEC spread. No approved payment rule for the route → PIESA blocked with a payment-rule exception.

## Commercial wording
Jo 22 Oct 2026, Mitti installer-led Ready Check only: full installer price inc GST + $349 Home Insulation Victoria fee + electrician price − the existing VEU rebate (minimum contribution unchanged). Electrical choice: Home Insulation Victoria electrician ($349), My usual electrician (saved business-profile price), A different electrician (form price). Missing usual profile holds the quote with "Installer has no usual electrician saved". Store declared name/licence on the job, without granting verification or assignment. This supersedes own-electrician direct-billing exclusion for this new pathway only; accepted quotes and legacy intake billing remain unchanged. Preview-only, no automatic activation.

Jo 24 Oct 2026: the installer does NOT approve the quote (A1 installer jobs and A2 our leads alike; no "Measurements are final" step). A1 quote = installer total (which includes any difficult access fee, shown on the line, never added twice) + electrician price + $349 fee − VEU rebate; A2 prices come from the installer's agreed rates. Pressing Complete in the Mitti Ready Check prepares everything; for the first few weeks the office presses Send (switch `AUTO_QUOTE_SEND_ENABLED` off). No price-range or access-fee limit on the installer's own jobs (Jo: he charges what he wants; our AP fee and electrician fees come from our settings). Held for the office with the reason: a difficult access fee with no usable amount, and every existing send check. A form changed after a quote was sent is flagged for the office; the sent quote is never changed. Office Adjust leaves the draft for office Send — no installer reapproval; old installer approval records stay as history only.
Home Insulation Victoria lead: a lead fee only if separately approved in the current live installer agreement; old fee notes (e.g. $220) are not live rules unless confirmed there. Installer-supplied customer: no lead fee, no margin, approved AP fee and VEEC spread only. Never one fee model for all jobs.

## Direct-contact coordination
Owners and the assigned trade may receive each other's contacts for the specific visit (Ready Check, PIESA, rectification, installation) — active visit only, audited, never global. Sharing contacts, opening a link, sending a reminder or one party entering a time never books. Booked only when time is recorded and confirmed by the other party or authorised office staff. 24h without a time → reminder; 48h without confirmed booking → office Needs attention.
- Owner notice: "To arrange this visit, Home Insulation Victoria will share your name, phone number and email with the assigned trade for this job only."
- Trade notice: "Use these contact details only to arrange and complete this Home Insulation Victoria job. Do not use them for unrelated marketing or future work unless the owner separately agrees."
Retired: portal-only owner/trade chat as required model; global contact exposure; contact release treated as booking.

## PIESA 30-day operational rule
No rectification: clock starts when the initial PIESA is completed and signed. Rectification: when Section C is completed and signed. Installation must **commence** within 30 days; booking within 30 days is not enough. Store separately: first inspection, appointment, completed, submitted, accepted, rectification completion, Section C, timing date used, installation booking, actual commencement, completion. Operational rule pending written confirmation. At PIESA booked, installer sees: "Do not book installation until electrical clearance is complete."

## Communications
Sender: Home Insulation Victoria. External sending behind launch controls. Track prepared, queued, sent, delivered, failed, undelivered, suppressed. Failed → Needs attention. Delivered ≠ read; read ≠ accepted; link opened ≠ approved; sent never progresses workflow.

## Office-only actions
Every office-only action has a server-side role guard; hiding UI is not enough.

## Quotes
Preliminary: estimate only, not binding, never the final price, unlocks neither payment nor PIESA. Confirmed insulation quote: only after verified eligibility, priced from the current rates and measured area. It releases automatically unless its price differs from the owner's current estimate by more than the configured tolerance (default 15%), it contains an extra not on the agreed rate card, or an installer-supplied price falls outside the configured per-m² range (blank means no range check). Fix-up quotes release automatically only when every item uses a standard agreed rate; non-standard, other or manually priced items are held. A held quote shows the office the reason. While either the quote or customer-communications launch switch is off, an otherwise releasable quote remains queued and nothing goes to the owner. Owner approval still locks to the exact quote version, with the permanent audit trail and required signing unchanged.

## Hard stops (Needs attention)
See `hardStops` in `src/config/workflow-decisions.ts`.

## Xero reference (locked 2026-10-03)
Xero invoice and all customer/trade/financial-facing references use "Home Insulation Victoria <job>". HI VIC, HI VIC! and HIVIC are retired visible names. Internal-only identifiers (business_unit value `hivic`, `hivic-` idempotency keys, `assertHivic*` function names) stay for compatibility and never appear on invoices, quotes, receipts, emails, SMS, portal screens or exports.

## Electrician rate vs customer PIESA price (owner decision 2026-10-04)
- $349 inc GST is the CUSTOMER-facing PIESA charge. It is never an electrician fee, payout, REC fee or amount payable to the electrician.
- The electrician's payable rate comes only from their onboarding agreement / approved REC rate card / the specific job offer. Home Insulation Victoria keeps the difference.
- Electrician-facing screens show only that electrician's own agreed rate ("Your agreed rate: $X inc GST") or "Rate to be confirmed".
- Customer-facing screens may show the customer price. Office screens may show customer price, electrician rate and the spread.
- A PIESA/rectification offer is not made to an electrician without a recorded agreed rate, unless office explicitly marks it "rate to be confirmed"; acceptance is blocked when neither applies.
- Enforced by `offerRateBlocker` / `electricianRateText` (allocation.core.ts), the retired-term scan, and tests/allocation.core.test.ts.


## Payment rule (Jo, 24 Oct 2026) — supersedes the 7 Oct rule below (BEING BUILT; Stripe card, fee absorbed)
- Owner accepts the quote and pays the $349 safety check in one step (Stripe). Switched on straight away (Jo's call; lawyer still to confirm cooling-off and deposit limits).
- Booking the install day: 10% of what is left on the invoice after the $349, paid when the day is booked. When the owner taps one of the installer's days they pay on the same screen; when the installer accepts a day the owner suggested, the day is held 48 hours for the 10%, then released and the installer told.
- Remainder on install day; the owner can always pay the full balance now.
- Electrical fixes: the office checks the fixes quote; the owner approves it, pays in full and picks one of the electrician's times in one step; if none suit, owner and electrician go back and forth (no office).

## VEEC assignment form (Jo, decisions 119/120, 24 Oct 2026)
The official ESC "VEEC Assignment Form Template: Ceiling Insulation (Activity 48)" v1.1 (1 Oct 2026; `docs/official-forms/…v1.1-20261001.docx`, SHA-256 465de27d…) is the only assignment form. Its Sections 1, 3 and 4 are stored verbatim (AP name filled) as `compliance_templates` version `ESC-Activity48-VEEC-Assignment-v1.1-20261001` (pending 0225; unapproved and inactive until Jo approves it in Compliance Setup); Section 2 is prefilled from the job record by `src/lib/veec-assignment-form.core.ts` and anything not held (AP phone/address, product brand/model, CES number…) is entered by the office — missing facts block signing, nothing is guessed. It is signed AFTER the install is recorded complete, in this order: (1) lead installer, Section 3 Part B, from their job screen; (2) AP, Section 3 Part A, in Office only once four things are recorded — PIESA copy to installer AND owner ≥24h before install, ESC notification sent ≥24h before, product warranty copy given to the consumer (`warranty_copy_provided` event), ESC scheme participant collection notice given to each installer (`esc_collection_notice_provided`, business/worker level); (3) owner, Section 4 Part B, via their secure My job link with a 6-digit code (never at quote acceptance — the Gate B `veec_assignment_consent` is only consent to assign). The executed copy is stored in the job file and emailed to the owner within 10 business days as the approved O62 email with the signed PDF attached (`veec-copy-email.server.ts`, `VEEC_COPY_EMAIL_APPROVED=true`). Decision 120: the owner is asked by email AND text when the install is recorded complete, reminded on days 1, 3 and 7 (email + text), and the office is alerted on day 10 (Needs me `veec_assignment_unsigned`); no job reaches Ready for VEEC without the owner-signed form. Decision 169 (Jo 24 Oct): the day-0 request email IS the approved All done email (O44, `renderInstallCompleteEmail`, sent once per job by `veec-reminders.server.ts` through `emailOwnerInstallComplete`, key `install-complete:v1:<job>`) plus the approved request text; days 1/3/7 send the approved O61 reminder (`veec-emails.core.ts`, `VEEC_SIGN_EMAIL_APPROVED=true`) plus the reminder text. Real delivery still needs `customer_comms_enabled` and the owner's contact consent through the guarded owner-email path and the one real SMS sender; TEST jobs use test-send. Retired: the separate portal installer declaration (`DEECA-PIISA-March-2026-DRAFT`, superseded by the PIISA + Part B) and applying the acceptance consent as the form signature.

## Our-lead Ready Check (Jo, 24 Oct 2026, decisions 49–54)
Our leads only (`jobs.channel = 'hivic_sourced'`). The office picks ONE installer on the job ("Choose installer": nearby approved installers with area and rates); there is no automatic batch offer. The installer is told by text ("New job offer near [suburb] – tap to see times", wording held until the template review) and in the app. The offer is open 24 hours: "Not for me" or no answer sends it back to the office as one item to pick another installer. The installer accepts by offering the owner 3 Ready Check times (day + exact time, business days 24h+ ahead, within 21 days). The owner taps one (booked through the normal booking path, then the Mitti form) or suggests 1–5 days; the installer takes one at a time they choose or offers 3 new times — back and forth, no office step. Owners no longer pick Ready Check times when they save their spot or request the Ready Check. Installers' own customers: arranged directly, nothing entered in the portal. Rules: `ready-check-times.core.ts`; server: `ready-check-times.server.ts`.

## Install days (Jo, 24 Oct 2026)
Once electrical clearance is in (PIESA pass, or fixes done + Section C), the quoted installer offers 3 days inside the 30-day window (or every day left if fewer). The owner taps one (booked) or suggests 1–5 of their own; the installer takes one (booked) or offers 3 new ones; back and forth until agreed. The office is never involved, except one alert when 10 days are left with nothing booked. Both screens show the last day and days left. Rules: `install-days.core.ts` (`installDayTurn`, `dayOfferBlockers`); server: `install-days.server.ts`.

Decision 157 (Jo, 24 Oct 2026) — our-lead (A2) PIESA electrician: the PIESA goes to the quoted installer's usual electrician (saved under My business: name, licence, price inc GST) at the onboarding rate; the office still chooses and sends the offer, and the Choose trades screen marks that REC and shows that rate. No usual electrician saved, or not an approved REC on the portal → the office sends to any approved REC in the area at that REC's agreed rate. The owner's quote line stays HIV's standard safety-check price either way. Pure: `our-lead-piesa-electrician.core.ts`; server: `our-lead-piesa-electrician.server.ts` (offer summary rate + internal `piesa_usual_electrician_applied`). A1 keeps `resolveMittiElectrician`.

Decision 158 (Jo, 24 Oct 2026) — 30-day rule cost: if the PIESA lapses before the install, the repeat PIESA is paid by whoever caused the delay. Owner AND installer get a text + email at 20 and 10 days before the last day (`thirty-day-rule.core.ts`, DRAFT wording, `THIRTY_DAY_REMINDER_APPROVED=false`, SMS types `install_window_reminder` / `install_window_reminder_installer` unapproved; TEST → test sender); the single office 10-day alert is unchanged. When the window lapses with nothing booked, `repeatPiesaPayer` (installer never offered within 5 days → installer; owner never answered an offer → owner; installer never answered owner days → installer; owner days all outside the window → owner; a changed booked day → the changer, unless the other side then sat for >5 days → undetermined; system booking failure → undetermined) is recorded once as internal `install_window_expired` with a one-line reason, shown in the office job history. Lawyer wording draft: `docs/LAWYER_30_DAY_RULE_WORDING.md` (not applied to agreements).

## Payment rule (Jo, 7 Oct 2026) — superseded 24 Oct (above); kept for history
- Safety check payment (default $349, `workflow_settings.safety_check_payment_inc_gst`) is paid after Step B and before the PIESA can be booked. Kept once the check is done (even if the job can't go ahead); refunded in full if the check never happens.
- Balance = total after VEU discount − safety check payment. Owner chooses at Step B: two instalments (half when install is booked, half on install day) or pay the full total now. If the job can't go ahead after the check, refund everything except the safety check payment.
- Step B payment wording is DRAFT (`draft-2026-10-07`) pending lawyer; blocks real jobs until Jo approves it in Settings.
- Refunds are office-recorded; no money moves automatically. Payment gate, Xero live calls and sending stay OFF until switched on.

## Installer Add job coordination choice (current, Jo 8 Oct)
One intake (Customer → Job details → Review). Coordination is one of two options: "Home Insulation Victoria manages the process" (Recommended) or "I'll organise the job myself" (requires an unticked acknowledgement). The retired onsite/later/already-visited selector is not used. The choice never transfers AP duties and never books, signs or completes evidence. A portal Ready Check draft is saved partially and is never treated as submitted or verified.

## Installer Add job — Jo, 9 Oct 2026 01:17 Sydney (supersedes earlier intake order)
- Order: Customer (owner name/address/mobile/email + unticked "The owner has given permission for Home Insulation Victoria to contact them to check eligibility and discuss this job.") → "How would you like to organise this job?" (HIV manages — Recommended / I’ll manage the job myself + unticked responsibility acknowledgement) → "Have you measured and quoted this job?" Yes (area, existing insulation, quote upload or GST-inclusive amount + inclusions) / No (job saved with null facts; add later on the same `/field/$jobId`) → Review & submit.
- Electrician choice is separate from who manages: "Home Insulation Victoria arranges — $349 including GST" / "I’ll use my own electrician" / "To be arranged". Own electrician invoices the owner directly; HIV's $349 PIESA fee is excluded from our quote (`piesaChargeIncGst` → 0, no PIESA line); the $349 AP fee remains. PROVISIONAL user-approved commercial arrangement — regulator confirmation of external direct billing is PENDING; it is a coordination/billing change, not a compliance waiver (office still verifies REC, compliant PIESA, conditions, evidence, notices).
- Fee declaration (Yes branch, unticked, exact wording per payer) is logged as `installer_owner_fee_awareness` with actor/time/source/payer/version; it is not owner paperwork. Missing, undecided electrician or a declaration for a different payer holds the owner quote (`installerQuoteReleaseBlockers`). Installer may record it later on the job; office may record it too.
- Next action: quoted → eligibility then owner quote; HIV-managed + not quoted → eligibility then Ready Check; self-managed + not quoted → eligibility then installer measures/quotes.

### Electrician payer on installer-supplied jobs (Jo, 9 Oct 2026 — provisional, regulator confirmation of direct billing pending)
- The owner quote's PIESA line follows the current recorded payer: own electrician = not on our quote (electrician invoices the owner); HIV-arranged = standard PIESA fee; undecided = owner quote held. AP fee unchanged.
- Changing the payer is a material change: quotes are re-drafted/withdrawn/reconfirmed, and the owner fee declaration must be given again for the new arrangement. Blocked once an electrician accepted or the owner's invoice exists (office changes it).
- This is a billing/coordination change only; all REC, PIESA, evidence and notice checks still apply.
