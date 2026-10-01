# REC onboarding and staff invitation audit

## Scope and safety

- Refined only the existing REC business onboarding, directly connected staff invitation management, and personal staff join screen.
- Installer onboarding and customer email output were not changed.
- Verification used sample/test states only. No application, agreement, invitation, worker, job assignment, email, or SMS was created or sent.

## Findings and decisions

1. **Business and staff were mixed together at entry.** The first screen now asks which path applies. An authorised REC business representative can start the business application; staff are immediately directed to obtain a personal link from their REC administrator and cannot continue into irrelevant business fields.
2. **The current agreement model still expects the business applicant to be a licensed electrician.** Copy now separates the business REC registration from the representative's personal Victorian electrical licence. An unlicensed authorised business representative still needs office assistance; the existing signed schema was not silently broadened.
3. **The thirteen persisted step keys remain unchanged.** Their headings, progress, and instructions are calmer and grouped conceptually, while resume keys and validation remain compatible.
4. **Electrical responsibilities are explicit.** The REC provides PIESA, authorised rectification, and installation-day attendance when required. The insulation installer performs the ceiling measure-up.
5. **Supplier rates are not customer prices.** Copy now says rates are proposed, reviewed and agreed before use, with no work-volume promise. Rate values and GST calculations are unchanged.
6. **The post-submission sequence is explicit.** Office review and rate agreement precede portal access; the business then creates personal staff links; each worker signs their declarations and needs office approval before job access.
7. **Invitation is the primary staff pathway.** The administrator creates and copies a 14-day, single-use link; nothing is automatically delivered. Manual entry remains an office-record fallback and is explicitly not represented as worker-signed declarations.
8. **Worker privacy and access are explicit.** Workers do not receive business rates or banking details and use private, revocable links for assigned jobs. A working REC owner must also be represented and approved as a worker.
9. **Confirmed activation mismatch fixed.** REC activation now derives the applicant worker through `effectiveElectricians`, matching the current form when the legacy `electricians` array is empty. Required worker, rates, and banking preflight validation now occurs before business creation.
10. **Existing signed terms were preserved.** Agreement wording, version, declarations, prices, and stored identifiers were not changed.

## Remaining operational limitation

Activation creates the approved business and worker records, but it does not automatically create the first `business_members` administrator link. The office must still link an approved REC administrator's existing portal profile to the business before `/partner/workers` becomes available. The UI now reports this honestly instead of implying automatic access.

## Verification

- Focused tests: **29 passed, 0 failed, 99 expectations** across REC onboarding, partner activation, partner worker access, worker invitations, and worker job links.
- Type check: **passed**.
- Production build: **passed**.
- Browser review: true **390px** and **640px** viewports for welcome/role choice, representative details, insurance, services and rates, review/sign, submitted receipt, staff invitation, staff join and staff receipt.
- Horizontal overflow: **none** in every captured state; exact viewport and document measurements are recorded in `rec-onboarding-refinement.json`.

## Direct preview routes

- `/electrician-onboarding` — live draft entry (do not submit during review).
- `/electrician-onboarding?sample=about` — safe sample flow; replace `about` with `insurance`, `services`, `assessment_pricing`, `review`, `sign`, or `submitted`.
- `/join/sample-electrician` — safe worker invitation sample.
- `/join/sample-electrician?receipt=1` — safe worker receipt sample.
- `/partner/workers?sample=1` — staff invitation sample for an authenticated staff/partner preview session.