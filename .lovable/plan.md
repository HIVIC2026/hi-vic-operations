# Refine the secure Step 3 calculator

## Scope
- Restyle the existing secure what-if calculator to match the approved Home Insulation Victoria quote email.
- Add the prominent calculator callout to likely-eligible and onsite-confirmation emails without changing their approved quote or payment sections.
- Extend the existing preview to show the calculator at desktop and mobile widths.

## Implementation
1. **Calculator presentation**
   - Add the branded calculator heading, live logo, input controls, current-area context, and the explicit non-persistence notice.
   - Render the current pricing engine output using the approved itemised quote hierarchy, including dynamic installation, PIESA, AP fee, gross total, discount, customer total, payable-now amount, and remaining balance.
   - Show the existing-insulation note only when the stored declaration is `present`.
   - Add the always-visible “What could change?” disclosure and the disabled payment block while payment remains unavailable.

2. **Secure route context**
   - Pass the property address into the calculator where available.
   - Keep `#calculator` opening the calculator with the current recorded area prefilled.
   - Keep all what-if changes in local browser state; no property, job, or measurement writes.

3. **Email prominence**
   - Add the requested calculator callout immediately after the quote card in both eligible email variants.
   - Link it to the existing secure estimate token plus `#calculator`.
   - Leave the separate payment action linked to `#confirm`.

4. **Preview and validation**
   - Add a calculator preview mode using postcode 3336, 150 m², and current settings values.
   - Test 100, 125, 150, 200, custom 175, and invalid boundaries.
   - Run focused calculator, renderer, and secure-link tests, typecheck, automatic build verification, and 390px/640px browser checks.

## Guardrails
- No Gate 1, pricing formula, settings, delivery, payment, or communication changes.
- No customer messages, data writes, publishing, or deployment.
