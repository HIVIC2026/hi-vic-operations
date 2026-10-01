# Calculator: insulation removal note, clearer register button, includes order

## 1. Homes that already have insulation
When the owner picks "Some there" or "Not sure", show a plain note under the price (replaces the current removal paragraph):

```text
Good to know: some existing insulation can stay, and yours may not need
to come out at all. If removal is needed, it's a discretionary extra of
$10–$15 per m² of the area removed — not your whole ceiling — depending
on the insulation type, and it only goes ahead with your approval.
We'll confirm exactly what's needed at your free Ready Check, before
you agree to anything.
```

- Just a note — no priced add-on, no live calculation, headline price unchanged.
- Soft pink card so it is easy to spot; hidden when they choose "None".
- Their insulation answer is already saved with their registration, so staff see it in Registered interest.

## 2. Clearer "Demand is high" register button
- Small pink badge above the form: "Demand is high — limited Ready Check spots".
- Bigger button, full width on phones, green, reading "Register my interest".
- One line under it: "No cost, no obligation. We'll call to confirm your price and book your free Ready Check."
- Wording stays truthful — no rebate promises.

## 3. "What this includes" order
1. Home Insulation Ready Check — free
2. Mandatory Pre-Installation Electrical Safety Assessment (PIESA)
3. R5.0 ceiling insulation — supply & install
4. Home Insulation Victoria — Accredited Person Management

## Technical details
- Reorder `INTEREST_INCLUDED` in `src/lib/interest.core.ts`.
- In `public-calculator.tsx`, replace the existing removal paragraph with the plain note; show only when insulation is `present` or `unknown`. Locked `QuoteBreakdown` untouched; the removal scenario calc stays unused.
- `register-interest.tsx`: badge + restyled button + reassurance line.
- Verify with tests and a browser check at 898x578 and 390x844.
