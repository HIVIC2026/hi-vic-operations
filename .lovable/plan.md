# Calculator: insulation removal, clearer register button, includes order

## 1. Homes that already have insulation
When the owner picks "Some there" or "Not sure", show a clear note right under the price:

```text
Existing insulation may need to come out
If removal is needed: + $2,250 (150 m² x $15/m² removal)
Your total would then be about $X. We confirm at the free Ready Check — before you agree to anything.
```

- The "+ $X" is the extra cost (removal total minus the standard total), worked out live from their ceiling size and the existing $15/m² removal rate — it updates as they change the size.
- Soft pink card with a bold amount so it is easy to spot; hidden when they choose "None".
- The headline price stays the standard (no-removal) price — removal is shown as a possible add-on, never assumed.
- Their insulation answer is already saved with their registration, so staff see it in Registered interest.

## 2. Clearer "Demand is high" register button
- Add a small pink badge above the form: "Demand is high — limited Ready Check spots".
- Make the button bigger, full width on phones, green, reading "Register my interest".
- One line under it: "No cost, no obligation. We'll call to confirm your price and book your free Ready Check."
- Wording stays truthful — no rebate promises.

## 3. "What this includes" order
1. Home Insulation Ready Check — free
2. Mandatory Pre-Installation Electrical Safety Assessment (PIESA)
3. R5.0 ceiling insulation — supply & install
4. Home Insulation Victoria — Accredited Person Management

## Technical details
- Reorder `INTEREST_INCLUDED` in `src/lib/interest.core.ts`.
- In `public-calculator.tsx`, replace the existing removal paragraph with the new card using `removal.by_access.standard.estimated_customer_total - standard.estimated_customer_total`; show only when insulation is `present` or `unknown`. Locked `QuoteBreakdown` untouched.
- `register-interest.tsx`: badge + restyled button + reassurance line.
- Verify with tests and a browser check at 898x578 and 390x844.
