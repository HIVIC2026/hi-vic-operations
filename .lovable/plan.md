# Rebuild launch campaign emails from the approved V2 email

## Scope
- Change only the draft launch campaign email renderer, its focused tests, preview evidence, and the standing technical note.
- Keep sending disabled and do not publish.
- Do not alter the approved likely-eligible email output.

## Build
1. Remove the separate campaign shell, header, button, footer, and savings markup.
2. Reuse the existing `V2_THEME` shell/header/button/footer and extract the approved V2 savings module for both the likely email and campaign variants.
3. Keep the exact approved section order: logo and blush badge, green eyebrow and Outfit headline, mist savings panel with inclusions, blush next-step card, mist “What could change”, white footer.
4. Change campaign-only copy in the next-step card:
   - Shared truthful demand sentence exactly as supplied.
   - Group A button: “See my savings and save my spot →”.
   - Group B: one safe manhole-video sentence adapted from the existing video draft, then “Check my home →”.
   - Footer retains the campaign opt-out link.
5. Add regression checks proving the campaign renderer uses the shared V2 pieces, has one action, includes no extra sections, and leaves the approved likely output unchanged.

## Review
- Run focused email tests and type checking.
- Capture Group A and Group B email screenshots at 390px and 640px from the preview.
- Verify the preview build remains clean; do not send or publish.
