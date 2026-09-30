# Clean portal and correct the active workflow

## Outcome
Make the portal feel like one finished operating system: every page has an unmistakable heading, only current processes are visible, the workflow reads in the right order, and customer templates use one clean HI VIC design and one set of approved wording.

## 1. Establish the one visible workflow
Use this plain-language sequence everywhere the workflow is shown:

1. **Enquiry & eligibility**
2. **Free Home Insulation Ready Check** — installer measure-up and eligibility evidence
3. **Measured project quote** — office review, then owner acceptance
4. **Quote acceptance & deposit**
5. **PIESA** — completed by a licensed electrician/REC close to installation
6. **Electrical rectification** — only when required, with owner-approved variations
7. **Installation**
8. **Evidence & AP review**
9. **VEEC & finalised**

The underlying retained records and audit history will stay intact, but obsolete and duplicate stage names will no longer appear in the working interface. PIESA will never appear before the Ready Check/installer measure-up.

## 2. Rebuild the main navigation and page headings
- Add one shared, prominent page heading pattern and use it on every active office page: **ENQUIRIES**, **SERVICE COVERAGE**, **PARTNER APPLICATIONS**, **APPROVED PARTNERS**, **COMPLIANCE**, and **USERS & ACCESS**.
- Rename “Jobs pipeline” to **Enquiries & Jobs** and make the selected page unmistakable.
- Keep the useful status dropdowns, but remove competing summaries, explanatory clutter, and secondary labels that obscure the page purpose.
- Make mobile and desktop page titles equally clear.

## 3. Make Enquiries an at-a-glance working list
- Show a compact **Service coverage** status on every enquiry card:
  - tick: verified installer and REC coverage;
  - warning: coverage is incomplete or not yet verified;
  - X: verified as outside service coverage.
- For a verified X state, expose the existing guarded **Send service-area email** action directly from the enquiry workflow.
- Keep the existing safety checks: the action must still fail closed when communications, owner consent, delivery setup, or verified postcode coverage is missing.
- Reduce each card to the essentials: job/reference, owner/property, current step, eligibility, service coverage, and next action.
- Keep inactive, ineligible, cancelled, test, and finalised records in retained views rather than the active list.

## 4. Strip the job file back to active information
- Reorder tabs to match the visible workflow above.
- Rename **Measure-up** to **Ready Check** everywhere it means the installer visit.
- Keep PIESA in its later electrician-only position.
- Remove the visible **Legacy Owner Authority** panel and old Owner Authority wording; preserve historical records only in the audit/document history.
- Hide superseded payment, assessment, and stage terminology from normal views while retaining immutable history.
- Put technical calculations, raw source data, old versions, and audit payloads behind clearly labelled history/details areas instead of mixing them into daily work.

## 5. Replace the Step 3 shambles with one current customer journey
- Remove the internal “Step 3” language and obsolete preview/template navigation from active portal pages.
- Replace “Step 3 · Indicative estimate” with the current customer terms: **Preliminary estimate**, **Free Ready Check**, **Measured project quote**, and **PIESA**.
- Simplify the preliminary estimate to the exact decision information: eligibility result, property, estimated area, ordered price breakdown, discount, estimated cost after discount, what may change, and the free Ready Check action.
- Keep PIESA clearly described as a later licensed-electrician/REC assessment, never part of the installer Ready Check.
- Remove duplicate explanations, repeated disclaimers, decorative sections that do not help the decision, and admin calculation detail from the customer-facing preview.
- Keep the calculator local-only and retain the approved price order, GST treatment, minimum co-payment, reassurance, and no-quote rule for ineligible owners.

## 6. Unify every active template and brand surface
- Audit the preliminary result, ineligible result, follow-ups, service-area email, secure estimate page, Ready Check confirmation, measured quote, PIESA/variation communication, onboarding forms, sign-in, loading, and completion states.
- Apply one HI VIC system throughout: approved logo, exact blue/green/navy/off-white palette, consistent typography, heading hierarchy, button treatment, spacing, and footer identity.
- Make the web view and email version use the same names, order, facts, and calls to action.
- Keep previews available only as deliberate test tools; they will not be presented as live templates or normal navigation.

## 7. Verification
- Add regression checks proving the visible workflow order is Ready Check before PIESA and that no active screen uses obsolete Owner Authority, paid Ready Check, or “Step 3” wording.
- Test service-coverage tick/warning/X states and confirm the email action only appears for verified out-of-area enquiries.
- Compare active web and email templates for matching brand, labels, price order, and calls to action.
- Test admin desktop, admin mobile, customer estimate mobile/desktop, REC view, installer view, and both onboarding forms.
- Run the focused workflow/template tests, full test suite, type check, preview build, and browser checks. Keep communications, payments, Xero, Mitti, and publishing off.

## Boundaries
- Do not change locked Gate 1 decisions, Activity 48 rules, pricing formulas, payment guards, or retained audit history.
- Do not delete old database records merely because their interface is retired.
- Do not change Base44 or publish the portal.
