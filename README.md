# Home Insulation Victoria

Build a production-ready MVP called "HI VIC Operating Portal V2" for Home Insulation Victoria (HI VIC), operated by DC Construction Solutions.

IMPORTANT ARCHITECTURE:
- This is the operational portal only. The public customer website remains in Base44 and must not be recreated or redesigned here.
- Build this as a full-stack TypeScript app with a proper PostgreSQL/Supabase-style relational backend. The database must be the single source of truth.
- Design database relationships first, then the screens.
- Use database-level role/access controls (RLS) so users cannot access jobs they are not permitted to access.
- Keep all workflow rules and quote calculations centralised server-side where practical, not duplicated across UI components.
- Mobile usability is critical for electricians/installers in the field.
- Maintain a permanent workflow/audit event history for meaningful job actions.

PRIMARY USER ROLES:
1. HI VIC Admin — full access.
2. Electrician/REC — only assigned jobs and permitted actions.
3. EEC Installer — only assigned jobs and permitted actions.
4. Owner/Homeowner — only their own job and approval/scheduling actions.
Structure the schema so Property Manager access can be added immediately after MVP without redesigning the database.

CORE BUSINESS WORKFLOW:
Gate 1 — Enquiry & Eligibility
- A Base44 website enquiry will later call a secure endpoint/webhook to create/update the owner, property and job here.
- Customer fields: name, email, phone, property address, rental vs owner-occupied, estimated ceiling area m² or "I don't know", life support flag.
- HIVIC enriches property information separately; technical matters are verified onsite.
- Eligibility outcome must be exactly:
  * Likely Eligible
  * Needs Onsite Confirmation
  * Does Not Appear Eligible
- Save outcome, reason and NEXT ACTION.
- Important business rules include: residential not commercial; building generally at least 5 years old; existing insulation eligibility is based on R-value and must be verified onsite.

Gate 2 — Combined Electrician Measure-Up + Electrical Safety Assessment
- Assigned licensed electrician attends once and records:
  measured ceiling area m²
  existing insulation present/absent
  confirmed/measured existing R-value
  measurement/photo evidence
  removal required yes/no
  removal m²
  access difficulty
  downlights quantity/type and items needing upgrade
  exhaust fans and clearances
  hazards
  switchboard condition
  RCDs
  life support
  PIESA outcome/pass-fail status
  rectification items and quantities
  assessor details/date
  notes and required evidence
- The field workflow will integrate with Mitti. Do not duplicate PIESA entry unnecessarily. Create an integration-ready assessment record with external_mitti_id and sync status fields.

Gate 3 — Quote Generation
- Quotes only after site assessment.
- Maintain versioned installer rate cards and versioned electrical pricing.
- Generate 2–3 installer quote options from measured m², removal m², access/travel, installer rates, AP margin/fee, VEEC discount/credit and configurable pricing settings.
- Electrical rectification quote auto-calculates from the assessment using agreed rate items, e.g. downlights, RCDs, switchboard, callout and other predefined items.
- Electrician can add an unusual "Other" item with description, quantity, price and explanation.
- Admin can manually adjust a generated quote, but every manual adjustment must be recorded in audit history with who/when/reason.
- All prices must clearly store whether inc GST and customer-facing totals must be inc GST.

Gate 4 — Acceptance & Scheduling
- If rectification is required: owner receives rectification quote -> approves -> owner and assigned electrician can coordinate/record rectification date -> rectification completed -> PIESA/sign-off uploaded/completed.
- If no rectification is required, proceed to installation quote/acceptance.
- Once owner accepts installer quote: assigned installer and owner can schedule installation and the date/time is recorded.
- Owner can request a different electrician or installer if contact/scheduling fails.
- Preserve communications/job history.

PIESA DEADLINE:
- Store PIESA completion date and calculate installation deadline = relevant PIESA date + 30 days.
- Show days remaining and Green/Amber/Red urgency.
- System must flag and block invalid progression when the 30-day rule is exceeded until the appropriate reassessment/update path is completed.
- Design this rule in one central place so it can be changed if regulation/process changes.

Gate 5 — Installation & Evidence
- Evidence must be requirement-driven, not a generic upload bucket.
- Each job has evidence requirements with category, required/not required, status, uploaded file, who uploaded it, timestamp, verification status, verifier and notes.
- Support photos, videos and PDFs.
- Examples: before ceiling space, existing insulation/R-value evidence, product evidence, installation progress, completed installation, access/manhole, PIESA/electrical sign-off, installer declaration.
- A job cannot proceed to VEEC-ready while required evidence is incomplete or unverified.

Gate 6 — AP Verification & VEEC
- Admin sees one consolidated compliance review page.
- Track eligibility, owner consent, participant eligibility, electrical assessment/PIESA, rectification, installer eligibility, product eligibility, installation evidence, declarations and QA.
- Final outcome can be Ready for VEEC only when all blocking requirements pass.
- Create VEEC lodgement record fields for quantity, status, submission reference, submitted date and notes.

ADMIN PIPELINE:
Create a clear operational pipeline using these stages:
New Enquiry
Eligibility Review
Awaiting Electrician
Assessment Booking
Assessment Booked
Assessment Complete
Rectification Required
Awaiting Owner Rectification Approval
Rectification Scheduling
Rectification Booked
Ready for Installer Quotes
Awaiting Quote Acceptance
Installation Scheduling
Installation Booked
Evidence Outstanding
AP Review
Ready for VEEC
Complete
Cancelled / On Hold as exception states.

Every job card should make clear:
job number
property address
owner
stage
assigned electrician
assigned installer
next action
important deadline/warning
last activity.

CORE RELATIONAL DATA MODEL:
Create a sensible normalized model including at minimum:
profiles/users/roles
businesses/participants
properties
owners/customer profiles
jobs
job_assignments
assessments
piesa_records
rectification_items
rate_cards
rate_card_items or equivalent
pricing_settings
quotes
quote_items
bookings
communications/messages
evidence_requirements
evidence_files
declarations
compliance_checks
workflow_events/audit_history
veec_lodgements
external_sync_logs
documents

Avoid duplicating the same business fact across several tables unless it is an intentional immutable snapshot for audit/quote history.

SECURITY:
- RLS must be enabled on all business tables containing customer/job data.
- Admin sees all.
- Electricians/installers see only assigned job data they need.
- Owners see only their own job(s).
- Sensitive internal pricing/margins must not be exposed to owners or contractors.
- File/evidence access must use protected storage and access rules, not public URLs.
- Provide a practical security test matrix in the project documentation.

UI:
- Clean, modern, highly practical, fast.
- HI VIC operational branding: professional and friendly, but this is a work portal, not a marketing site.
- Admin desktop-first but responsive.
- Electrician/installer flows mobile-first with large tap targets, short forms, progress indicators, autosave-friendly interaction.
- Never make a user fill the same information twice if already known.
- Use clear statuses, next action and blocking reasons.
- Avoid giant forms: progressive sections in the logical order the electrician/installer actually works onsite.

FIRST BUILD PRIORITY:
1. Database schema + migrations + RLS foundation.
2. Auth/role scaffolding.
3. Admin pipeline + job detail shell.
4. Electrician and installer assigned-job shells.
5. Owner action shell.
6. Core workflow transition rules.
7. Quote calculation scaffolding.
8. Evidence requirements framework.
9. Seed representative dummy records for development/testing only.

Do not spend time on advanced analytics, AI assistants, map/property research, native mobile apps or fancy marketing pages in this MVP.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://hi-vic-operations.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/fb35adfe-10bf-4d4c-987d-28567ca1ddeb).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
