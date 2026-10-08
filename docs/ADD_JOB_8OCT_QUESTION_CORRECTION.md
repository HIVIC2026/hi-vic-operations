# Installer Add job — 8 October 2026, 11:26 UTC correction

## Result and revision
- Application correction revision: `49f22ebbc189a71933ff6d12e276b73707b10b66` (includes optional price agreement and legacy-entry redirect). Baseline read before changes: `5e9cc3ecadb3f2bf88b77d0cf83a7895d26304ba`. Documentation follows separately.
- No CSS, layout, fonts, colour, spacing, performance polling/index changes, server intake handlers, database, settings, safety/payment/eligibility or exact owner-acceptance gates changed.
- Previously agreed price is explicitly labelled optional. `ownerAgreed=false` passes review when fee-awareness and below-R2 are true; the unchanged confirmation payload carries false, never a manufactured owner acceptance.

## Current questions on each path
All paths ask address (street/suburb/postcode), owner name, mobile, email and contact permission once. Back/Edit preserves in-memory answers. Stored drafts never restore consent. All intermediate buttons remain **Next**.

1. **I'm at the property now:** exact required unticked consent “The homeowner has given Home Insulation Victoria permission to contact them for the eligibility assessment.” Electrician preference uses the existing picker; choosing/adding is not proof of an invitation. No measurements/quote/visited questions. Final action saves and prepares the guarded Ready Check form. Existing Preparing/Available/Blocked outcomes and approximate 90-second copy remain; only available forms automatically open.
2. **A job for later:** same exact required unticked permission, visit date/time, optional measurements (area/method/site notes through Enter now). No quote or visited questions. Only a confirmed booking claims Upcoming visits under My work; no external calendar-sync claim. Existing visit-day form action unchanged.
3. **A job I've already visited:** unchanged required existing contact permission; ceiling m², measurement method, own quoted price inc GST, inclusions, optional customer file, electrician preference, required fee-awareness and existing-insulation-if-any-below-R2 confirmations. Prior owner price agreement is optional and initially unchecked. No quoted/visited Yes/No branches, no new Ready Check required by this form. Existing office eligibility/full quote approval next steps and honest no-contact-yet outcome remain.

Add job is installer-customer intake. Home Insulation Victoria leads retain their separate existing workflow/pricing controls; no installer owner-price question was added to that route.

## Entry audit and rollback
- My work Add a job, TradeShell, legacy portal trade navigation and AppShell link to `/partner/import`, the single shared three-choice flow.
- `/partner/add` already redirects to `/partner/import` and remains unchanged.
- A definite obsolete form remained directly reachable at `/partner/bulk-import`. Installer bookmarks now redirect to `/partner/import`; office retains original historical batch tools and records. No bulk data or handler was removed.
- Roll back only the optional-tick/validation hunks, legacy redirect/helper and related tests/AGENTS rule from this correction; preserve today's performance changes and concurrent work.

## Verification
- 41 tests passed, 0 failed, 113 assertions across `add-job-flow`, `add-job-next-steps`, `add-job-confirmations`, `onsite-ready-check-7oct`, `owner-confirm-7oct`, `add-job-legacy-entry`.
- Concrete tests cover ownerAgreed false success, each required review disclosure, restored consent false, ACT rejection and installer-vs-office legacy entry.
- Sealed fixture click-through of all three modes at 1280×1800 and 390×1800 passed using actual existing global CSS/Tailwind processing. Permission blocks progression until ticked; Back/Edit preserves values; existing final stub receives owner_agreed=false with other declarations true and never invokes onsite creation. No horizontal overflow or page exceptions. All writes/integrations/address calls were stubbed or blocked.
- Screenshots: `/tmp/browser/add-job-correction/{onsite,later,existing}-{review,outcome}-{1280,390}.png`. Styled phone existing review and desktop onsite review visually inspected. An initial unstyled fixture run was discarded; styled rerun passed.
- Automatic harness: latest entry `build OK` at 11:29:42 UTC after code edits. Manual builds/typechecks were not run under harness rules; no separate typecheck result claimed.
- Retired-term scan: 27 pre-existing warnings, zero customer-visible failures.

## Actual TEST and published verification limits
- Supported existing cached TEST session restored only to localhost. Actual `/partner/add` reached `/partner/import`; `/partner/import` remained Loading with no business-backed choices, so actual authenticated question click-through could not be completed. `/partner/bulk-import` retained office tool access under that session. No claim of installer-role runtime redirect proof; pure redirect tests and source wiring cover it. No new account/session mint or password/role change.
- Read-only publish settings confirm the site is public. Published `/auth` redirects to the custom customer domain. Retrieved actual published `partner.import-C1nSfujV.js` (HTTP 200): it contains the 90-second wording but **still requires ownerAgreed** (`ownerAgreed||...Tick that the owner agreed to your quoted price`) and the tick has no optional label. Therefore this correction was not in that published bundle at inspection time. Entry bundle changed during inspection (`index-ccnAhQIE.js` then `index-Bbh7gOJX.js`); the tools supplied no authoritative deployed commit SHA, so none is claimed.
- No live job/draft saves, messages, invitations, Mitti audits/API actions, database/settings/template changes or publication performed. Actual end-to-end save, owner outreach/acceptance notices and Mitti availability remain outside these sealed checks.

## Exact changed project files
- `src/lib/add-job-flow.core.ts`
- `src/components/trade/add-job-flow.tsx`
- `src/lib/route-guards.ts`
- `src/routes/_authenticated/partner.bulk-import.tsx`
- `tests/add-job-flow.test.ts`
- `tests/add-job-legacy-entry.test.ts`
- `AGENTS.md`
- `roadmap.md`
- `docs/STATUS.md`
- `docs/ADD_JOB_8OCT_QUESTION_CORRECTION.md`

Project preference memory updated separately to supersede obsolete quoted/visited branching.