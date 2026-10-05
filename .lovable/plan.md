# Shared trade offer screens

## Outcome
Build the approved electrician offer first, then reuse the same phone-first component for installer Ready Check offers. Keep the work preview-only; no messages are sent and no switches or real jobs are changed.

## Build
1. Create one shared trade-offer presentation model and component with the approved countdown, two-hour time tiles, atomic first-tap states, decline/propose actions, success banner, losing-race message, and locked contact/actions view.
2. Complete the electrician variant using the electrician's own agreed rate and approved hidden-field rules.
3. Add the installer Ready Check variant with area provenance, insulation state, and rough install value calculated from that installer's current agreed installation rate and the displayed area.
4. Build the installer Ready Check day state using the shared electrician on-the-day pattern: Mitti A1 launch, self-updating quoted/not-eligible outcomes, and couldn't-enter recovery.
5. Record couldn't-enter reasons as an office rebooking exception and preserve the same installer as first re-offer, without bypassing existing booking guards.
6. Extend the existing offer payload loader so only the required anonymised facts are present before acceptance, while owner identity and address remain available only after the atomic booking succeeds.
7. Add focused tests for both variants, including owner-versus-Nearmap area wording, own-rate maths, no-guarantee copy, two-hour windows, losing atomic race, Mitti outcomes and rebooking priority.
8. Check offer, taken and Ready Check day states at 390px, then confirm the preview build and relevant tests.

## Technical details
- Preserve `accept_ready_check_offer` and the existing electrician atomic acceptance function as the only booking writes.
- Keep pricing derivation in a pure `*.core.ts` function; never expose customer pricing, margins, or unrelated job details.
- Use the existing postcode-distance text until Google Maps drive time is connected.
- Keep external delivery behind the current fail-closed communication switches.