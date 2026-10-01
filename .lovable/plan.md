# Calculator bottom section — back on brand

The installer onboarding work is parked until the calculator is finished. Reminder: come back to the onboarding audit/refinement once this is done.

## What changes

1. **Remove the sticky price bar at the bottom of the screen on phones.**
   The price already lives in the result panel; the floating bar duplicates it and crowds the page. Deleted entirely — no replacement.

2. **Restyle the "Register my interest" panel to match the light, fresh page.**
   Today it's a heavy dark-navy block with white text — the only dark element on the page and visibly off brand. It becomes a light panel in the same language as the rest of the page:
   - White card, same soft rounded corners and shadow as the main calculator card
   - Soft pink tint behind the headline area (the brand pink already used in the notes)
   - "High demand" badge stays, restyled light (pink pill, navy text)
   - Headline in navy, same font and weight as the page heading: "Installer capacity is very limited across the state — register your interest now."
   - Form fields become standard light inputs (white, grey border) — same look as the address field above
   - Button stays the brand green, full width
   - Consent wording, reassurance line and success message unchanged (locked copy)

3. **Footer stays as-is** (already light and tidy).

## What does not change

- No pricing, calculation, discount or consent-logic changes
- The register form still saves to the same Registered interest list
- Desktop and mobile both get the same light panel

## Technical details

- Edit `src/components/portal/register-interest.tsx` only: swap the navy panel classes for the light card treatment, remove the `tone="dark"` combobox usage, keep all submit logic and locked copy.
- Edit `src/components/portal/public-calculator.tsx` only: delete the fixed mobile sticky bar block and its bottom padding.
- Verify with Playwright at phone (430px) and desktop (1280px) widths, run the full test suite, confirm the build is clean.
- Preview only — nothing is published without your say-so.
