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
- Name the working page **ENQUIRIES** while the records are still enquiries. Do not call this page “Jobs pipeline” or “Enquiries & Jobs”. Once work moves beyond enquiry qualification, present it in the appropriate later-work view without changing the retained record.
- Keep the useful status dropdowns, but remove competing summaries, explanatory clutter, and secondary labels that obscure the page purpose.
- Make mobile and desktop page titles equally clear.

### Chosen visual direction
- Use a **focused sidebar**: compact permanent navigation on desktop, a simple mobile drawer, and one spacious task-led work area.
- Change typography to **Outfit for headings** and **Figtree for body/UI text**.
- Keep the exact approved HI VIC palette, but make it feel prettier through bright off-white working surfaces, a composed navy frame, crisp HI VIC blue hierarchy, and restrained green for successful states and primary progress actions.
- Use disciplined spacing, fine borders, shallow shadows, square-to-soft 6–8px corners, clear section rhythm, and very limited animation. Avoid nested cards, excessive pills, colour clutter, gradients, and decorative effects.

## 3. Make Enquiries an at-a-glance working list
- Show one unmistakable eligibility tag on every enquiry card:
  - **LIKELY ELIGIBLE** — Gate 1 supports progression, but onsite requirements remain;
  - **ELIGIBLE** — all eligibility criteria have been positively confirmed, including the Ready Check evidence required onsite;
  - **INELIGIBLE** — a recorded eligibility rule has failed.
- Keep internal **REVIEW REQUIRED** and **TO BE CONFIRMED** states visibly distinct so the portal never turns uncertainty into “Eligible”. The **ELIGIBLE** tag will be a derived display state backed by completed evidence, not a new shortcut around Gate 1.
- Show a compact **Service coverage** status on every enquiry card:
  - tick: verified installer and REC coverage;
  - warning: coverage is incomplete or not yet verified;
  - X: verified as outside service coverage.
- For a verified X state, expose the existing guarded **Send service-area email** action directly from the enquiry workflow.
- Keep the existing safety checks: the action must still fail closed when communications, owner consent, delivery setup, or verified postcode coverage is missing.
- Reduce each card to the essentials: job/reference, owner/property, current step, eligibility, service coverage, and next action.
- Make the next action explicit and executable where permitted: **Send ineligible email**, **Review eligibility**, or **Move to Ready Check**. No card should say only a vague status when an office action is required.
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
- Make the portal’s **Customer calculator** a clean standalone calculator page. Remove the old sample eligibility result, preliminary quote, Step 3 heading, Ready Check pitch, and every other fixture block currently shown above it.
- Open the calculator at the top of the page, with only a clear **CUSTOMER CALCULATOR** heading and the inputs/results needed for the what-if calculation.
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
- Add an admin **Customer communications** screen listing every customer email and electronic form by the real stage that triggers it. Jo must be able to personally inspect every active template before it can be used.
- Let the office open a faithful desktop/mobile preview of every email, edit its approved editable copy, save a draft, and preview again before activation. Show which version is active and retain superseded versions for audit.
- Protect regulated wording and calculated facts: official Activity 48/VEU text, prices, customer/job facts, mandatory disclosures, signatures, and legal timing cannot be casually overwritten in an email editor. Changes to official forms create a new approval-required version; editable email framing and calls to action remain clearly separated.
- At each manual step, show an exact instruction panel: **What is ready**, **What is blocking it**, **What you must do now**, **What will be sent/signed**, and **What happens next**. The primary action uses the exact command, such as **Preview and send quote package** rather than “Continue”.

## 7. Make mandatory documents stage-correct and electronic
- Put every mandatory Activity 48 form under **COMPLIANCE** as the controlled master document library. For each form, show its plain-English purpose, who receives it, who signs it, when it becomes due, what it blocks, its source/version, whether it is approved, and where its completed signed copy is retained.
- Clearly distinguish: quote-stage information and acceptance; ESC information-sharing consent; PIESA and pre-install documents; installer declaration; AP sign-off; final Activity 48 VEEC assignment; and completion documents. Do not group unlike requirements under vague names.
- Use **electronic signing across every signing requirement**: customer quote acceptance, ESC owner consent, installer declaration, AP signature, final customer VEEC assignment, partner agreements, and any approved variation or reconfirmation.
- Do not ask anyone to sign in person. Each electronic signature must retain the approved wording/version, signer, role, timestamp, signature, and immutable audit evidence already required by that form.
- Build one visible **Documents due now** package for each stage rather than attaching every document to the first email:
  - quote email/package: quote, all current VEU consumer information and rights, approved commercial terms, pricing/payment terms, and every other document that can legally be acknowledged at quote acceptance;
  - booking/pre-install package: ESC consent when the installation date exists;
  - PIESA/pre-install package: PIESA copy, CES when applicable, Consumer Factsheet, and Code of Conduct information at their required time;
  - completion package: invoice, dispute information, instructions, contacts, warranty, installer declaration, and the completed VEEC assignment when final facts exist.
- **Recommendation:** use both the stage email and the portal package. The email contains a secure link to the same current documents and signing task in the portal. This avoids stale attachments, keeps one signed version, and prevents documents from being sent before the facts or legal timing exist.
- Use one quote-stage electronic signature to acknowledge every document actually presented in that package. After acceptance, show a tick beside each included document only when the signed record proves that exact document version was presented and accepted; never pre-tick based only on sending the email.
- Keep later forms separate when they depend on later facts or prescribed timing. In particular, the ESC owner consent requires an installation date, and the final Activity 48 VEEC assignment requires completed installation facts plus installer → AP → customer signatures. They cannot be validly bundled into the earlier quote signature.
- Keep launch behaviour **manual-first**: the office previews and sends each ready package. Automated sending switches remain off until the wording, timing, recipients, and end-to-end rehearsal are approved.
- Never combine documents whose timing or facts are different merely for convenience; the portal may present them as one stage package only when they are all legally due.

## 8. Verification
- Add regression checks proving the visible workflow order is Ready Check before PIESA and that no active screen uses obsolete Owner Authority, paid Ready Check, or “Step 3” wording.
- Test service-coverage tick/warning/X states and confirm the email action only appears for verified out-of-area enquiries.
- Test every eligibility card state and prove **ELIGIBLE** appears only when all remote and onsite eligibility criteria are confirmed.
- Test each stage package, electronic signing order, immutable signature evidence, and document timing blockers.
- Compare active web and email templates for matching brand, labels, price order, and calls to action.
- Test admin desktop, admin mobile, customer estimate mobile/desktop, REC view, installer view, and both onboarding forms.
- Run the focused workflow/template tests, full test suite, type check, preview build, and browser checks. Keep communications, payments, Xero, Mitti, and publishing off.

## Boundaries
- Do not change locked Gate 1 decisions, Activity 48 rules, pricing formulas, payment guards, or retained audit history.
- Do not delete old database records merely because their interface is retired.
- Do not change Base44 or publish the portal.
