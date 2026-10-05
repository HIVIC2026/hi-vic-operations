# Plan: VEU $200 minimum customer contribution — audit findings and fix

PLAN ONLY. Queued after the extras removal, before the live-safety check. Rule from energy.vic.gov.au: ceiling insulation under VEU has a minimum customer contribution of $200 inc GST. The "$1,500 metro / $2,100 regional" figures are a government example for an average 150 m² home, not a cap.

## Answers from the code

### 1) Is the $200 minimum enforced, and where?

| Place | Enforced? | How |
|---|---|---|
| Public calculator + Step 3 estimate (`estimate.core.ts`) | YES | Discount is capped so the customer total never goes below the $200 setting; a flag shows "The discount is limited so your contribution meets the program minimum." |
| Installer-supplied draft quotes (`installer-led.core.ts`) | PARTLY | If the total after discount would be under $200, the quote is BLOCKED with "Owner co-payment would be below the $200 minimum." The discount is not reduced automatically — the office has to fix it by hand. |
| Owner quote on our own leads (`quotes.server.ts`) | NO | Discount = area × a flat per-m² credit, capped only at the quote subtotal. The customer total can fall below $200 — even to $0. |
| Tax invoice (Xero) | NO | It copies the quote's discount as a negative line. Correct once the quote is correct; no check of its own. |

Also already correct: the compliance timeline and the installer agreement both record the $200 co-payment as a VEEC-creation requirement.

### 2) Hard-coded maximum discount?
None. No "up to $1,500 / $2,100" cap exists anywhere.

### 3) "Up to $X" wording in the calculator?
None. The calculator shows the computed estimate only. The benchmark note mentions the government's 150 m² example (about $1,482) as a calibration reference, not as an "up to" claim.

### 4) Suggested wording when the discount is reduced
"Your discount has been reduced so your contribution meets the VEU program minimum of $200 (including GST)." (Jo to approve.)

## What's missing and the fix (about half a day)

1. One shared rule `applyMinCopay(total, rawDiscount)` in a pure core file: returns the discount reduced so the customer pays at least $200, plus a "reduced" flag. Tested.
2. HIV owner quote builder: use it (replacing the subtotal-only cap).
3. Installer-supplied draft quotes: use it to reduce the discount automatically instead of blocking (block only if the total before discount is under $200).
4. Quote and invoice text: when the flag is set, show the approved sentence above near the discount line.
5. Tests: calculator (already covered), HIV quote, installer draft, and a case where the raw discount would take the customer below $200.

No database change needed — the $200 setting already exists in the price settings. No existing quotes or records touched; new quotes only. Preview only, sending stays off.
