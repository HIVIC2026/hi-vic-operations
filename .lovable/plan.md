# Ready Check form: two variants + quoted price section

## What the audit found

Form A (Ready Check) currently covers the AP evidence requirements well: front-of-premises photo with ID, floor plan with dimensions, per-room 360 video, insulation depth photos with ruler, existing R-value, measured m2, access, roof type, hazards, measurement method. Those map to the ESC Activity 48 evidence table and feed the official forms.

**Gap: it captures no pricing at all.** For installer-brings-customer jobs we need the installer's quoted price in a fixed format so the portal can build the co-branded owner quote without retyping.

## The two variants

The Ready Check becomes two variants of the same form. The evidence questions are identical in both; only the pricing section at the bottom differs.

### Variant 1 — "Installer brings the customer" (Form A1)

Same evidence fields, plus a **"Your quoted price"** section at the bottom, in the exact line format the portal uses, so it drops straight into the co-branded owner quote:

- "Quoted price lines" — a repeatable section, one repeat per line item, each with:
  - "Line description" (text, mandatory) — e.g. "Supply and install ceiling insulation"
  - "Quantity" (number, mandatory)
  - "Unit" (choice, mandatory) — m2 / each / flat / hour
  - "Unit price incl GST $" (number, mandatory)
- "Total quoted price incl GST $" (number, mandatory) — must equal the sum of the lines; the portal checks this and flags mismatches for review instead of trusting either figure
- "What this price includes" (text, mandatory) — e.g. removal, tile lift, travel — so nothing the installer priced in gets lost
- "Price already agreed with the owner?" (Yes / No, mandatory) — per the locked decision: if Yes, their price stays and our fees go on top, less the VEU discount

The portal reads these lines and builds the owner quote automatically: installer's lines + PIESA ($349 or their electrician's price) + AP fee ($349) − VEU discount = owner total. No retyping, no invented numbers — if a line is missing or the total doesn't add up, the job goes to review, never guessed.

### Variant 2 — "We bring the customer" (Form A2)

Same evidence fields, **no pricing section**. On our leads the owner is quoted at our set customer price and the installer is paid their agreed onboarding rate — the installer never enters a customer price, and the customer price is never shown against their payout. Adding a price box here would only create confusion.

## How the portal picks the right variant

The job already knows its channel (installer-sourced vs HI VIC-sourced). The Mitti sync/link the installer receives points at the matching variant automatically — the installer never chooses.

## Changes

1. `src/lib/mitti-forms.core.ts` — add the pricing section fields to the Form A spec as a conditional block (only required on installer-sourced jobs), and split the template check so each variant has its own expected label set and template ID slot.
2. `src/lib/mitti.core.ts` — parse the quoted price lines on sync; validate lines sum to the stated total; store them as draft quote lines (never auto-accepted — office reviews before the owner quote is built).
3. `src/lib/installer-led.core.ts` — map the price lines into the installer-led quote flow; mismatch or missing lines → review flag with a plain reason.
4. `Mitti_template_briefs_v4.md` — new paste-ready briefs: Form A1 (with pricing), Form A2 (without), Form B and Form C unchanged from v3. Strict label rules and geotagging rules carried over.
5. Settings: two template ID slots for Form A (installer-sourced / HI VIC-sourced) instead of one.
6. Tests: variant selection by job channel, price-line parsing, total-mismatch flagging, template label checking per variant.

## Not changing

- Form B (PIESA) and Form C (PIISA) — already correct.
- The locked rule that Lovable never invents a price: unpriced or mismatched lines block and go to the office.
