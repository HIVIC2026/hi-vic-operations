# Coverage visibility and workflow consistency

## What will be built

- Add an office **Coverage** screen showing REC and installer availability separately.
- Classify every active enquiry location as:
  - **Serviceable** — at least one approved, active, credential-current partner has verified postcode coverage.
  - **Partial** — only one required trade is covered, or a partner has an unverified radius/region claim that needs office confirmation.
  - **Unserviceable** — no eligible partner covers the postcode.
- Show partner names, credential blockers, missing coverage data, enquiry counts and affected jobs for each area.
- Add REC and installer match status to each enquiry, with clear warnings when either trade is unavailable.
- Make installer offering use the same area and credential checks already used for REC selection; never auto-assign a partner.
- Keep office-managed verified postcodes as the matching source of truth. Onboarding radius and excluded-area answers remain visible but cannot silently become verified coverage.

## Partner onboarding and activation

- Preserve each partner’s stated origin, radius and exclusions in their approved record.
- Require office confirmation of service postcodes before the portal claims an area is covered.
- Carry the installer’s free HI VIC quote-lead measure-up preference into activation and show it during matching.
- Distinguish **not configured** from **not covered** so incomplete partner setup is never presented as a definitive service refusal.

## “No partner in your area” customer message

- Add a reviewed customer template and an office action on uncovered enquiries.
- Keep it fail-closed behind the existing global communications switch, current owner consent, suppression/unsubscribe, configured delivery and idempotency checks.
- Record the rendered copy, actor, time and delivery result in the permanent job history.
- Do not enable communications or send any message during this work.

## Full workflow audit

- Reconcile every customer, installer and REC page, email, notification, agreement and test with:
  - free installer Ready Check / eligibility measure-up;
  - REC-only PIESA;
  - conditional $220 inc GST fee only when an installer-referred quote is accepted and the job proceeds.
- Remove remaining paid Ready Check behaviour, including obsolete service-only test payment functions, while preserving historical $99 records.
- Remove stale “credit” wording from customer follow-ups.
- Report the remaining commercial gap separately: the $220 term is contractual today and has no automated ledger or invoice workflow.

## Verification

- Test postcode and wildcard matching, credential expiry, missing configuration, one-trade-only coverage and fully uncovered enquiries.
- Test installer and REC matching independently and confirm unsafe offers are blocked server-side.
- Test the customer message in locked, no-consent, suppressed and duplicate-action states without sending.
- Run the relevant workflow/email tests, full test suite, typecheck, build, and desktop/mobile browser checks.
