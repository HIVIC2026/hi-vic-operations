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
- Agreement version `HI-VIC-A48-REC-2.3-2026-10-01` retains 27 coherent REC clauses and electrical measurements, incorporates all 19 sections of the supplied Business Partner and Installer Terms and Conditions vF.0, and is mapped clause-by-clause in `rec-agreement-source-reconciliation.md`. Jo's latest override and current official sources supersede F.0's $10m amount with a $5m REC public-liability minimum and no unsupported fixed product-liability floor. Signature is an offer; recorded office approval of the signed application and mutually agreed rates commences the agreement and activates access. It also covers individual personal access without duplicate owner signup, portal-only communication with matching safety/legal exceptions, mandatory rectification requiring owner-approved scope and price, no owner quotes/invoices/payments, no-poaching, mutually accepted rate revisions and the optional 48-hour no-contact replacement outcome without automatic cancellation or loss of Job history/accrued rights.
- The separate regulatory 24-hour PIESA/notification controls remain unchanged.

## Verification

- The final focused REC onboarding, scheduling and staff-link run passed 37 checks with 140 assertions and no failures.
- Type checking passed.
- Preview build reported OK with no runtime errors.
- Mock browser checks cover true 1280px and 390px widths; viewable embedded evidence is stored in `rec-onboarding-refinements.json`, including measurements for services, availability and rectification pricing.
- Browser flow covers incomplete About-you forward attempt, Back to Welcome, resume to the same sample draft, and electrician staff invitation rendering. These are no-write sample checks, not live applications.
- Read-only app-proxy smoke checks returned Australian suggestions for public Melbourne and Canberra addresses through `/api/public/address-search`. The onboarding's actual Base44-backed server-function provider was then exercised through the no-write sample UI: it resolved `100 Swanston Street, Melbourne VIC 3000` to a structured Melbourne address, returned Canberra suggestions, and displayed the exact Victorian rejection for `1 London Circuit, Canberra ACT 2601`. No address or application was stored.
- Database schema and generated types contain `rate_card_items.display_unit`; no business rows were changed during verification.