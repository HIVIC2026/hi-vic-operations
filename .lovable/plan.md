# Plan: R-value as a per-job fact (minimum R5.0) — updated with Jo's answers

Starts only after the queued work and only on Jo's "go". Same rules: preview only, practice database first with an undo file, no existing records or issued/accepted quotes changed, sending stays off.

## Jo's decisions (5 Oct)
1. Owner price per m² for R6.0/R7.0 on our own leads: undecided. It becomes an editable office price setting, blank by default. While blank, R6/R7 cannot be quoted on our leads, and the office sees "Set R6/R7 owner price".
2. Our markup = owner price minus the installer's agreed rate for that R-value.
3. Our own leads: R5.0 by default. R6/R7 is offered only if the assessor records "Owner requested R6/R7" at the Ready Check. Installer-supplied jobs: R5, R6 or R7 allowed.
4. Only R5.0, R6.0 and R7.0. No "Other" values. Minimum R5.0.
5. Approved quote wording: "The government discount is the same whatever R-value you choose (minimum R5.0)."

## What exists today
- Installer onboarding, agreements, the office partner page and the installer profile already have optional R6.0, R7.0 and Top up to R5.0 rates (built in preview).
- The installer declaration and VEEC assignment form already record product and R-value.
- Quote lines and rate-card lines have an R-value field, but it is always 5.
- The rebate calculation uses climate region and area only, so it already ignores R-value.

## Parts and size

1. **Choosing and recording the R-value (about 1.5 days)**
   - Quote stores product (brand/model) and R-value: one of R5.0 / R6.0 / R7.0.
   - Ready Check price section (Mitti A1): the tick becomes "Ceiling insulation supply and install", with a required R-value choice (R5.0 / R6.0 / R7.0) and product. Needs a new or edited Mitti template, set up by the office.
   - Ready Check on our own leads: a new "Owner requested R6/R7" answer. Without it, our leads stay R5.0.
   - Bulk import: the AI reads R-value and product from the files. Anything outside R5/R6/R7, or nothing stated, gets "R-value not stated – confirm" and goes to office review. It never quietly assumes R5.
   - Office quote builder: R-value picker. On our leads R6/R7 is only shown when the owner request is recorded and an owner price is set. Otherwise it shows "Set R6/R7 owner price" or "Owner has not requested R6/R7".
   - Owner quote shows the chosen product and R-value.
2. **Checks (about 1 day)**
   - Only R5.0/R6.0/R7.0 are accepted wherever an R-value is entered (forms, import, quote builder, declaration). The database refuses anything else too.
   - Install day: the brand/model/R-value on the packaging photo is compared with the quote. Same or higher passes. Lower or a different product goes to office review and blocks AP approval until the office clears it with a reason.
3. **Documents show the real product (about 1 day)**
   - Quote line, Xero tax invoice line, VEEC assignment pre-fill, job file and confirmation emails use the quote's product and R-value. Existing issued quotes and signed forms are not touched.
4. **Rebate unchanged (about 0.5 day)**
   - The calculation stays as it is, and a test proves the R-value doesn't change the discount.
   - Quotes show Jo's approved line: "The government discount is the same whatever R-value you choose (minimum R5.0)."
5. **Pricing (about 1 day)**
   - Office price settings: new R6.0 and R7.0 owner prices per m², blank by default, with change history and a reason, the same as the current prices.
   - HIV quotes: owner price for the chosen R-value; markup = that owner price minus the installer's agreed rate for that R-value. If the installer has no rate for it, the quote can't be priced and the office is asked.
   - Margins view and profit card: show R6/R7 columns and flag negative margins.
   - Installer-supplied jobs: the installer's own price (no markup) + $349 AP + $349 PIESA − discount, as now. Automatic pricing (the queued "pricing method") uses the installer's rate for the chosen R-value.

**Total: about 5 days, plus the Mitti template change.**

## Still open (not blocking the build)
- R6/R7 owner prices: Jo sets them in office settings once she has seen installers' rates.
- The locked "likely" estimate email still says R5.0. It stays unchanged unless Jo asks; R5 is the default there anyway.

## Technical notes
- New nullable columns: `quotes.product_name`, `quotes.product_r_value`, the install-day `packaging_product` / `packaging_r_value`, `quotes.owner_requested_higher_r` (or on the Ready Check record), and `pricing_settings.r6_install_inc_gst_per_m2` / `r7_install_inc_gst_per_m2` (null = not set). A trigger only allows 5.0, 6.0 or 7.0. Rate-card codes `R6_BATTS` / `R7_BATTS` use the R6/R7 onboarding rates.
- One pure `rvalue.core.ts` handles parsing ("R6", "R 6.0", "R6.0 batts"), the allowed-values check, the HIV-lead offer rule (owner request + price set) and the packaging comparison, with tests.
- Hard-coded R5 places (list from the previous plan) are updated to read the quote's R-value. Database columns are kept, never renamed or dropped. Old quotes without an R-value display as R5.0 only, and their stored data is never rewritten.
