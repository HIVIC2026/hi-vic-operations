# Correct the Step 3 customer quote and outcome emails

## Scope
Update the existing approved pricing presentation and all three customer outcome emails without changing Gate 1, delivery settings, schedules, or live sending.

## Implementation
- Remove the rejected savings tagline from every customer email renderer and plain-text version.
- Correct the itemised quote model so it always treats these as separate included fees:
  - Onsite Measure + PIESA — $349 inc GST
  - Home Insulation Victoria — AP & Compliance Management — $349 inc GST
- Keep the upfront $349 tied only to Measure + PIESA, clearly included in the project total and never charged twice.
- Feed the likely and onsite email renderers from the current approved estimate result and retail settings, including installation, both fixed fees, gross total, discount, customer price, upfront amount, and remaining balance.
- Add an `ADJUST MY ESTIMATE →` action in likely and onsite emails pointing to the existing secure personalised estimate page.
- Update the secure estimate calculator to offer 100, 125, 150, 200, and Other/custom while retaining the submitted area as its starting context. Continue using the existing Activity 48 and retail-settings pricing engine for every recalculation.
- Show the complete recalculated breakdown and payment split on the secure estimate page.
- Keep the ineligible email free of quote, discount, payment, and calculator actions while preserving review and referral paths.
- Apply the already verified Base44 visual system to likely, onsite, and ineligible email layouts.
- Expand the preview page to switch among all three outcomes and between responsive, 640px, and 390px views; disable preview links.

## Safety and validation
- Keep customer communications and delivery disabled; send and publish nothing.
- Add focused tests for both $349 fees, reconciliation, calculator choices, secure adjust link, ineligible exclusions, unsubscribe/tracking/referral safety, and removed tagline.
- Validate renderer/safety tests, calculator tests, typecheck, build status, and responsive screenshots.
