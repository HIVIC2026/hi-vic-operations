# Remove "PIISA training" from the portal — design

Jo, 29 Oct 2026: "PIISA training doesn't exist." Decision 428.

## What Jo agreed

- Installers are no longer asked about PIISA training or for a PIISA training certificate.
- Nobody is blocked from Ready Checks or install days because of PIISA training.
- The office no longer sees PIISA training flags or a verify list.
- The **PIISA safety assessment form** (A5, filled in on install day) is NOT touched.
- Data already saved (piisa_status, piisa_completed_on, piisa_certificate_path, piisa_verified_at/by) stays in the
  database, unused. No migration.

## Changes

| Where | Today | After |
| --- | --- | --- |
| Installer sign-up form (`routes/installer-onboarding.tsx`, `installer-onboarding.core.ts` checks) | Asks "Have you completed the PIISA training?", date, certificate upload; required | Question, date and upload removed; not checked |
| Sign-up upload endpoint (`installer-onboarding.functions.ts` PIISA certificate slot) | Stores certificate | Removed (nothing calls it) |
| Approval → worker rows (`partner-activation.core.ts`) | Copies piisa answers onto `partner_workers` | Stops copying them |
| Worker rules (`worker-compliance.core.ts`) | `piisaState`; approval flags "PIISA training not done/missing", "PIISA certificate to verify"; `workerOfferBlocker` blocks; `missingItems` lists "piisa" | All PIISA-training parts removed |
| Ready Check offers (`readycheck-booking.server.ts` / `.core.ts`) | `piisaBlocked` → "The installer's PIISA training isn't uploaded and verified yet…" | Removed |
| Team page + office list (`components/portal/worker-compliance.tsx`, `worker-compliance.functions.ts`) | "PIISA training" Add-it prompt + upload; office "Licences and PIISA training" with Verify | Prompt, upload and verify removed; office heading "Licences" |
| Partner profile (`partner-profile.core.ts`) | Shows "PIISA training" licence row + 4 issue lines | Removed |
| "How it works" copy (`application-review.core.ts`) | "CII certification, public liability insurance (min $5 million) and PIISA training." | "CII certification and public liability insurance (min $5 million)." |
| Test journey setup (`journey-setup.server.ts`) | Uploads + verifies a fake PIISA certificate | Step removed |

## Not changed

Everything about the PIISA install-day form: Mitti A5, `piisa-*` workflow, crew picker, official PIISA document,
Final check, office "PIISA form failed" alerts, the word "PIISA" in the guide's word list.

## Testing

- New test `tests/guide-fix-no-piisa-training.test.ts`: an installer with `piisa_status: "not_done"` (or unverified
  upload) is offerable (`workerOfferBlocker` null, no `piisaBlocked` gap) and has no PIISA approval flags or missing
  items; sign-up validation passes with no PIISA answers; profile shows no PIISA training row.
- Update the existing tests that expect the old training rules (worker-compliance, onboarding, partner-email,
  installer-sign-activation, esc-collection-notice, onboarding-no-repeats, onboarding-fixes-oct4,
  installer-onboarding-pages).
- Compare every test file against clean main; no new failures.
