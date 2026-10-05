# Plan: R-value as a per-job fact (minimum R5.0)

Starts only after the current build (gaps 1, 3, 4) and only on Jo's go. Same rules: preview only, practice database first with an undo file, no existing records or issued/accepted quotes changed, sending stays off.

## What exists today
- The installer's after-install declaration and the VEEC assignment form already record the installed product and R-value. The assignment screen has an optional "R-value" box.
- Quote lines and installer rate-card lines already have an R-value field, but it is always set to 5.
- Everything else assumes R5.0: onboarding asks only for an R5.0 rate, the Mitti price section requires "R5.0 supply and install" to be ticked, and quote, estimate and email wording all say R5.0.
- The rebate calculation uses climate region and area only. It does not use R-value, so it already works the way Jo described.

## Parts and size

1. **Where the R-value is chosen or recorded (about 1.5 days)**
   - Job: add a "quoted product" with brand/model and an R-value of 5.0 or higher. This is stored on the quote.
   - Ready Check price section (Mitti A1): change the tick from "R5.0 supply and install" to "Ceiling insulation supply and install", and add required questions for R-value (R5.0 / R6.0 / R7.0 / Other, with a number) and product. Changing the form layout needs a new Mitti template, which the office would set up, or an edit to the current one.
   - Bulk import: the AI reads the R-value and product from files and prices (for example "R6 batts"). If none is found, the job is marked "R-value not stated – confirm" and goes to office review. It never quietly defaults to R5.
   - Office quote builder: add an R-value picker (default R5.0, which can be changed) plus a product field.
   - Owner quote: shows the chosen product and R-value.
2. **Checks (about 1 day)**
   - Reject anything below R5.0 everywhere it can be entered: forms, import, quote builder, and the after-install declaration. The database also refuses it.
   - Install day: the packaging photo's brand/model/R-value is entered or read and compared with the quote. If it is the same or higher, it passes. If it is lower or a different product, it goes to office review and blocks AP approval until the office clears it with a reason.
3. **Documents show the real product (about 1 day)**
   - The quote line, tax invoice line (Xero), VEEC assignment pre-fill, job file and confirmation emails take the quote's product and R-value. Existing issued quotes and signed forms stay as they are.
4. **Rebate unchanged (about 0.5 day)**
   - The calculation stays the same, and a test will prove that changing the R-value doesn't change the rebate.
   - The quote gets a plain line: "The government discount is the same whatever R-value you choose." Jo must approve this wording.
5. **Pricing (about 1–1.5 days after Jo decides)**
   - Installer onboarding: R5.0 stays required, and R6.0 and R7.0 rates are added as optional. Automatic pricing (the queued "pricing method") uses the rate for the chosen R-value. If that rate is missing, it can't price automatically and asks the office or assessor.
   - Office price settings: add owner price per m² for each R-value, with change history.
   - **Decisions for Jo:**
     - What do owners pay per m² for R6.0 and R7.0 on our own leads? Today R5.0 is $30/m².
     - Does our markup stay "owner price minus the installer's agreed rate", per R-value?
     - Do we offer higher R-values on our own leads at all at launch, or only on installer-supplied jobs?
     - Should "Other" R-values (for example R5.5 or R8) be allowed, or only R5/R6/R7?
     - Approve the wording of the rebate line.

**Total: about 5–6 days, plus a new Mitti template.**

## Part 6: every hard-coded R5 / R5.0
- `src/routes/installer-onboarding.tsx:463` (rate row label), and `src/lib/installer-onboarding.core.ts:215, 317` (check and summary)
- `src/lib/partner-activation.core.ts:130` (rate card line `R5_BATTS`, r_value 5)
- `src/lib/mitti-forms.core.ts:64, 66, 68, 259, 290, 309` (price items, alias, multichoice, form spec, "must be ticked" check)
- `src/lib/hiv-quote.core.ts:27, 29, 32, 38, 43, 50` (R5 rate, owner R5 price, quote line, markup)
- `src/lib/quotes.server.ts:131` (quote label "R5.0 ceiling insulation")
- `src/lib/customer-quote-system.ts:33` and `src/lib/readycheck.core.ts:240` (customer line labels)
- `src/lib/estimate-email.ts:220` (estimate email line; the likely email is LOCKED, so changing it needs Jo's sign-off and a byte check)
- `src/lib/interest.core.ts:32` (calculator line)
- `src/components/portal/estimate.tsx:186` (office estimate summary)
- `src/lib/owner-prices.functions.ts:30, 42, 49` and `src/routes/_authenticated/admin.pricing.tsx:31, 42, 46` (owner price `r5_install_inc_gst_per_m2`)
- `src/lib/profit.functions.ts:141–168` (looks up `R5_BATTS` rate)
- `src/lib/partner.core.ts:91` (partner enquiry "indicative R5.0 rate")
- `src/components/portal/assignment.tsx:311` (R-value placeholder, optional)
- `src/routes/_authenticated/partner.import.tsx:72` (example text)
- `src/lib/test-accounts.functions.ts:28, 39, 49` (test rate cards)
- Database: `pricing_settings.r5_install_inc_gst_per_m2`, `partner_enquiries.estimated_r5_install_rate_per_sqm_inc_gst` and the onboarding `r5_rate` field. These are kept; new columns are added alongside them, and nothing is renamed or dropped.
- Official PIESA/PIISA Word templates are not R5-specific. Existing-insulation R-value fields are about the old insulation, so they stay unchanged.

## Technical notes
- New nullable columns: `quotes.product_name`, `quotes.product_r_value`, and the job's install-day `packaging_product` / `packaging_r_value`. A trigger rejects values below 5.0. Rate-card lines get `R6_BATTS` / `R7_BATTS` codes.
- One pure `rvalue.core.ts` handles parsing ("R6", "R 6.0", "R6.0 batts"), the minimum check and the packaging comparison, with tests.
- Old quotes with no R-value are shown as R5.0 for display only. Their stored data is never rewritten.

## Addition (Jo, 5 Oct): install-day product check (plan only)
- Install-day Mitti form: required product label photo plus brand, model and R-value fields.
- Portal checks brand/model against an office-maintained copy of the VEU product register (no live lookup assumed); not found → office review.
- Product type must be batts, blanket or rigid board, minimum R5.0, and at least the quoted R-value.
- Blocked: foil / foil-faced, combustible, blow-in / loose-fill, expanding / foaming products → AP review cannot pass; office flag with reason.
- Result recorded on the job file and VEEC form record; AP queue shows it as a flag.
- Size: about 1.5 days on top of the R-value plan, plus Mitti template update.
