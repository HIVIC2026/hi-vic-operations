# One automated Leads system

## Goal
Replace the overlapping lead layouts with one clear Leads screen. Every real homeowner appears once, and the system immediately selects and sends the correct email after the official eligibility result.

## Categories shown to the office
Each homeowner has exactly one visible outcome, in this order:

1. **Spot saved** — the homeowner pressed Save my spot.
2. **Email sent — offering a spot** — the approved Save my spot email was sent and no spot is saved yet.
3. **Email sent — insulation details required** — the existing-insulation email was sent and the office is waiting for details or assessment.
4. **Ineligible** — the official result is ineligible and the ineligible email was sent.
5. **Needs attention** — automation could not finish because of a missing/invalid email, missing consent, missing estimate details, an opt-out, a delivery failure, or an unresolved eligibility check.

There will be no normal “Ready for offer”, “Ready for insulation request”, or general “Not emailed yet” category. A short processing state may exist while the official checks are still running, but it will not become an office queue unless automation fails.

## Automatic routing
After the official eligibility result and preliminary estimate are ready, one central rule will choose exactly one path:

- Eligible + no insulation + usable ceiling size → send the locked Save my spot email.
- Existing insulation requiring assessment → send the matching preliminary-estimate and insulation-details email.
- Officially ineligible → send the approved ineligible email.
- Incomplete or unsafe-to-send records → do not guess or send; place them in Needs attention with the exact reason.

Every send remains consent-checked, opt-out-safe, TEST-isolated, and idempotent so retries cannot send duplicates. A later homeowner action moves the same record to Spot saved rather than creating another entry.

## Portal layout
- Consolidate **Spot saved**, **Hot leads**, and **Email groups** into one **Leads** destination.
- Show the five exclusive outcome tabs with counts that always total the number of included real enquiries.
- Use one table beneath the tabs with homeowner, job, outcome, sent/saved time, estimate, and next office action.
- Keep existing URLs working by opening or forwarding to the matching Leads tab, so bookmarks do not break.
- Keep TEST, installer-sourced, and duplicate same-contact/property records out of real homeowner totals; show exclusions separately for audit.

## Data correction and verification
- Reconcile the 100 recorded campaign sends against their actual email type and repair presentation classification where legacy send keys are interpreted incorrectly.
- Reclassify every existing real enquiry through the same exclusive rule without changing its official eligibility result or job stage.
- Add matrix tests proving one category per enquiry, one email choice per completed result, no duplicate sends, correct movement after Save my spot, and clear Needs attention reasons.
- Verify the real counts add up, test each email path with TEST jobs only, and check the consolidated Leads screen at desktop and phone widths.

## Release safety
No real email will be sent during implementation or testing. The existing-insulation email will be shown for final visual approval before its automatic real sending is enabled. Nothing will be published without Jo’s explicit instruction.
