# Form A2 — Ready Check (we bring the customer)

Form A2 is the Ready Check an installer fills in on jobs where Home Insulation Victoria brings the customer. The evidence questions are identical to Form A1 — the only difference is there is no pricing section, because on our leads the owner is quoted at our set customer price and the installer is paid their agreed onboarding rate.

## What the form contains

Same field list as the rebuilt Form A1, minus the price section:

1. **Check the job details** — job number, owner name, address, property type and the office life-support result, all prefilled by the portal. The installer confirms, or says what needs correcting.
2. **Getting into the ceiling** — roof type (Tiles / Metal sheet / Other), ceiling access (Easy / Moderate / Difficult), ceiling access point photo.
3. **Ceiling areas** — "How many separate ceiling areas are there?" (1–6+), then that many sections open. Each area asks: where it is, length (m), width (m) (the portal works out the m2), existing insulation Yes/No, insulation type (tick all that apply — Batts / Loose fill), depth (mm) with tape-measure photo, remove / top up / not sure, area to remove (m2) if removing, empty ceiling space photo if no insulation, recessed downlights (Yes/No + how many), hazards (Yes/No + describe + photo).
4. **Whole job** — how the ceiling was measured (Laser in the ceiling space / Tape in the ceiling space / Scaled from floor plan / Other), method explanation if floor plan or Other, upgrade area diagram or floor plan (draw inside the form, photograph a sketch, or upload a plan — with the regulator note), ceiling or roof built/replaced in the last 5 years.
5. **Finish** — anything else the office should know (optional), accuracy confirmation tick (mandatory).

No price fields anywhere. The installer never sees or enters a customer price on our leads.

**Downlight colours (A1 and A2):** "Recessed downlights in this area?" shows **Yes in red** and **No in green**, so the installer can see straight away that downlights need attention. The brief tells Mitti's AI to colour the two answers this way. If Mitti can't colour answers, the brief falls back to a red warning note that appears when Yes is picked: "Downlights need clearance — the electrician will check these at the safety check." The A1 brief is regenerated (v6) with the same change.

## What gets built

- Verify the A2 field spec in the portal matches the A1 evidence fields exactly (it already shares the same field list — confirm nothing pricing-related leaks in).
- Generate the paste-ready brief **Mitti_template_briefs_v5_A2.md** in Files, same format as the A1 brief: exact labels in quotes, mandatory rules, conditional logic, geotagging settings, and the strict "no rephrasing or extra questions" instruction so Mitti's AI builds it to match.
- Round-trip check: confirm every label in the brief matches the portal's spec verbatim and a template built from it passes the portal's validator.

## Technical details

- `src/lib/mitti-forms.core.ts` — A2 is the existing `ready_check` key (READY_CHECK_FIELDS, no PRICING_FIELDS); verify only, change only if a mismatch is found.
- Brief generated from the spec via the existing `mittiAiPrompt` generator so labels cannot drift.
- Tests: extend `tests/ready-check-variants.test.ts` with an A2 round-trip test (spec labels all present in the generated brief; matching template passes `validateTemplate`).
- Run `bun test ./tests/` — baseline 751 pass.

## After this

Once A2's brief is approved, you paste it into Mitti, build the form, and send me the template ID — then we move on to Form B (PIESA) the same way.
