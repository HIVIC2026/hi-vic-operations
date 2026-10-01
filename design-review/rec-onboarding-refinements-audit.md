# REC onboarding and staff refinement audit

Date: 1 October 2026

## Boundaries

- Preserved the restored `acdafb46` presentation: original welcome, coloured requirement tiles, spacing, cards and uppercase blue actions.
- Did not change customer email templates, the calculator, installer onboarding, or existing signed applications.
- Sample routes remained local/no-write; no invitations, submissions, signatures, messages, assignments, quotes, billing actions or publishing occurred.

## Completed checks

- Navigation lock releases after validation and save failures; Back is local-first and returning from Welcome resumes the same draft/token.
- Save responses preserve later local typing while server-side material-change resets remain authoritative.
- About-you keeps the explicit business/staff choice for legacy drafts and directs staff to their personal invitation.
- Registered Electrical Contractor (REC) is expanded at first use; staff terminology replaces visible worker terminology on affected administration screens.
- Address details require structured Australian provider provenance, an Australian state, a four-digit postcode and finite latitude/longitude within world bounds; Victorian service origin keeps the exact rejection message.
- Autocomplete/detail requests use sequence guards so stale responses cannot replace the latest selection.
- Services describe PIESA, mandatory safety rectification and installation-day attendance; ceiling measure-up remains the insulation installer's work.
- Availability and supplier-rate wording do not promise job volume or present supplier rates as customer prices.
- Standard rectification inputs map to the exact quoting codes; custom Schedule 3 items persist with a normalised calculation unit and their own display unit.
- Electrical quote generation requires the assigned REC business's active rate card and cannot fall back to another business.
- Approved custom items are available on the actual `/w/$token` electrician job path, require an approved active staff/job link, and lock once the quote is issued for owner approval.
- Agreement version `HI-VIC-A48-REC-2.1-2026-10-01` retains 27 coherent REC clauses and electrical measurements, incorporates all 19 sections of the supplied Business Partner and Installer Terms and Conditions vF.0, and is mapped clause-by-clause in `rec-agreement-source-reconciliation.md`. It covers REC-only $10m product/public liability, personal access, portal-only communication, safety/legal exceptions, mandatory rectification, no owner quotes/invoices/payments, no-poaching, mutually accepted rate revisions and the 48-hour replacement outcome without cancelling the job.
- The separate regulatory 24-hour PIESA/notification controls remain unchanged.

## Verification

- 63 focused onboarding, activation, pilot, scheduling and staff-link checks passed.
- Type checking passed.
- Preview build reported OK with no runtime errors.
- Mock browser checks passed at true 1280px and 390px widths; all recorded pages had `scrollWidth === innerWidth`.
- Browser flow covered incomplete About-you forward attempt, Back to Welcome, resume to the same sample step, and electrician staff invitation rendering.
- Read-only provider evidence previously returned Melbourne as VIC 3000 with a valid negative latitude and Canberra as ACT 2601; a repeat direct smoke request was provider-blocked with HTTP 403, so the implementation relies on the app's existing server-side proxy contract rather than browser-supplied country/state.
- Database schema and generated types contain `rate_card_items.display_unit`; no business rows were changed during verification.