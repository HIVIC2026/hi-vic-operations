# Home Insulation Victoria — workflow source of truth

Version 2026-10-03. Owner-approved. **This file and `src/config/workflow-decisions.ts` override older prompts, comments, audit notes, labels and stale implementation text.** Conflicts are found by `bun scripts/scan-retired-terms.ts`.

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
21. Rectification: Home Insulation Victoria reviews the draft rectification quote before sending.
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
Retired: 50% deposit gate; `AmountPaid >= 50%` as PIESA unlock.
PIESA only after: Ready Check complete, verified eligible, current confirmed quote version approved, approved payment option verified:
1. Upfront deposit paid — 10% under $20,000, 5% at/over $20,000 (pending legal confirmation);
2. Paid in full; or
3. Approved 3-instalment plan active.
Route-aware. Home Insulation Victoria lead: our confirmed-quote payment rule. Installer-supplied customer: do not assume the same gate; no lead fee; no margin on installer price; we receive the approved AP fee and VEEC spread. No approved payment rule for the route → PIESA blocked with a payment-rule exception.

## Commercial wording
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
Preliminary: estimate only, not binding, never the final price, unlocks neither payment nor PIESA. Confirmed insulation quote: only after verified eligibility, excludes rectification unless separately quoted, approval locks to the exact version. Rectification quote: from PIESA/Mitti data, always office-reviewed before sending, separate. Generated quotes enter office review unless that type and route are explicitly approved for automatic sending.

## Hard stops (Needs attention)
See `hardStops` in `src/config/workflow-decisions.ts`.
