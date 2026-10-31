# Installer screens towards 1 second: plan

Spec: `docs/superpowers/specs/2026-10-31-installer-one-second-design.md` (waiting for Jo's approval)

Global constraints:
- Speed only.
- Every server function still checks access itself.
- Staff are refused owner data exactly as today.
- TEST-only live checks.
- No database or hosting change without Jo's yes.

### Task 0: Measure (read-only, via Lovable)
- [ ] Add a "warm" mode to `scripts/installer-speed.ts`: the app is already in the phone's cache, then a fresh page load. Report cold and warm side by side.
- [ ] Measure the page start: first byte for `/favicon.png` vs `/field`, five in a row, with the `cf-ray` and `server-timing` headers.

### Task 1: Job list starts with the page
- [ ] Route loaders (or prefetch) for `/field`, `/field/$jobId`, `/field/day/$jobId`, `/field/business`, `/field/money` start the screen's server call as soon as the route matches. They reuse the same query keys, so the cached last copy still works.
- [ ] Screen-only guards (`route-guards.ts`, `_authenticated/route.tsx`, `field.tsx`) use the local session, and fall back to the network check when there's none. Server calls are unchanged.
- [ ] Tests: the loader starts the call before the component renders; signed-out users still go to /auth; staff refusals are unchanged.

### Task 2: Cut unneeded code from installer screens
- [ ] Move the constants the trade screens use from mitti-invite, fixes-day, rec-onboarding, enquiry and piesa-owner-confirm into one small file with no imports. Re-export them from the old places so nothing else changes.
- [ ] Test: a source-scan test that the trade routes' import graph doesn't reach email-kit, official-forms or rec-onboarding.

### Task 3: Fonts
- [ ] Load the Google font so it doesn't block the page, or host it ourselves. Same look.

### Task 4: Fewer sign-in trips per call
- [ ] QA-office boundary: no `user_roles` read unless the token's email is a TEST office email.
- [ ] Find out (read-only) whether the project signs tokens with asymmetric keys. If yes, `getClaims` verifies locally. If not, report it to Jo and don't change the setting.
- [ ] Tests: the TEST office is still limited to its allowlist; real office and trades are unchanged.

### Task 5 (separate yes from Jo): page start
### Task 6 (separate yes from Jo, live DB change): one read for the installer home

After each task:
- independent review
- merge without publishing
- Lovable runs tsc, the same-information compare and the screen checks
- Jo's yes to publish
- Lovable times the screens, cold and warm
