# Next phase: partner activation and launch hardening

## Goal
Turn signed REC and installer applications into usable partner records, then prove the core portal is safe to launch without enabling customer messages, payments, Xero writes, or automatic external actions.

## Priority 1 — Make every admin list dependable
- Apply the same reliable loading pattern used by the Pipeline to Partners, Businesses, Users, and job details.
- Keep previously loaded records visible during refreshes.
- Show a clear retry message instead of interpreting an access/session failure as “no records”.
- Test sign-in, refresh, navigation, and temporary request failures.

## Priority 2 — Complete partner approval
- Add an office approval screen for a signed REC or installer application.
- Show all submitted details, uploaded insurance/certification files, agreement version, signature, warnings, and agreed pricing together.
- On approval, create or link the partner business, user access, credentials, and a versioned rate card from the accepted application.
- Require an office reason for overrides; retain the original application and every approval change permanently.
- Prevent allocation when insurance, licence/certification, agreement, or required pricing is missing or expired.

## Priority 3 — Bank details after approval
- Request bank details only after approval through a private partner flow.
- Keep bank details out of general partner lists and customer/job views.
- Record who supplied, reviewed, and changed them, without exposing full details unnecessarily.

## Priority 4 — Launch proof
- Run complete role-based journeys for admin, REC, installer, and owner from enquiry through completion.
- Test installer-sourced jobs, rate-based quote costing and office-only margin, the $220 accepted-job fee, Ready Check separation, PIESA timing, deposits, evidence, AP review, and VEEC completion.
- Verify all customer/trade communications and live payment/integration switches remain off.
- Run the full automated suite, security review, desktop/mobile checks, and produce a launch checklist separating “safe now” from items awaiting legal approval or external configuration.

## External decisions that remain launch gates
- A lawyer must approve the REC v1.4 and installer v1.1 agreement wording before real signatures are treated as final.
- Xero, Mitti, customer delivery, and other external automation remain manual/off until separately configured and approved.

## Recommended order
```text
Reliable admin records
        ↓
Partner approval + rate cards
        ↓
Private post-approval bank details
        ↓
Full role-based launch rehearsal
        ↓
Legal/integration approvals
        ↓
Publish
```

## Technical safeguards
- Admin-wide reads use authenticated server functions with an explicit admin check; failures never become empty lists.
- Rates are versioned and effective-dated; historical jobs retain the rate version used.
- Internal costs and margins remain admin-only; customer amounts remain inc GST.
- Approval never creates a job or sends a message.
- Existing Gate 1, payment, PIESA, ESC, evidence, assignment, and communication locks remain unchanged.
