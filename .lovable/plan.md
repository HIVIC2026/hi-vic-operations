# Repair owner saving and optional closure emails

## Confirmed findings
- **Owner saving:** the three-question page is shown to real owners, but its save action is deliberately restricted to TEST enquiries in preview. It fails before Save my spot runs. The required answer-saving database function is still in pending migration 0222; removing the restriction alone is not a safe fix.
- **Optional closure email:** “Not eligible – close” cancels the enquiry without recording an official Office ineligible decision. The existing email sender correctly refuses to send an ineligible explanation when that decision is absent.
- **Baseline verification:** 17 focused isolated and practice-database tests passed. No application code or live records changed; nothing sent or published.

## Proposed changes
### 1. Restore the owner save journey
- Keep all three required questions, optional photos, current wording, quote figures and shared ranking.
- Prepare a complete, guarded answer-save → canonical spot-save journey in preview. Retain immutable website history and existing consent, opt-out, link, stage and five-year checks.
- Do not substitute the old below-R2 declaration: that would invent an answer for thicker or unknown insulation.
- Keep real-owner answer persistence inactive until separately approved. Do not apply migration 0222 or silently bypass it with direct writes.
- Confirm success only after the spot actually saves, including repeat submissions and recovery when the answers save but the spot-save step fails.

### 2. Correct the explicit closure action
- Record the reason, Office actor, time and previous eligibility decision when the office explicitly closes an enquiry as not eligible.
- Reuse the official decision-recording behavior without its automatic email, stage progression or quote preparation side effects.
- Keep all four photo rank buttons strictly rank-only: no eligibility change and no email.
- Leave email delivery as the separate checkbox-selected action through the existing guarded ineligible sender. Preserve consent, STOP/opt-out, TEST exclusion, suppression and duplicate checks.

## Verification
- Add isolated tests for complete valid answers, recent-home ineligibility, expired links, missing consent, repeated saves, save-step failure and successful saved-spot readback.
- Prove any pending database adjustment on PGlite only.
- Add tests that explicit closure records an official ineligible decision and preserves history; unticked closure never reaches delivery, and rank-only review never changes eligibility.
- Verify the checkbox-selected path with an isolated fake delivery adapter and ensure blocked recipients remain blocked.
- Exercise both screens using isolated TEST fixtures and blocked external delivery; no hosted sender scripts or real-owner mutations.
- Check automatic preview build/type-check results and resolve each monitoring finding only after its repaired behavior is verified.

## Technical details
- Preserve `insulationDraftSaveAllowed` until separate activation approval. Keep token-bound answer persistence in the pending SQL and canonical Save my spot handling rather than introducing parallel storage or delivery paths.
- The existing `setEligibility` action calls `maybeAutoRouteLeadEmail` and `autoAdvanceJob`; do not invoke it unchanged from photo closure. Isolate its audited decision-write behavior from those side effects.
- Closing must leave `eligibility_outcome=does_not_appear_eligible`, an admin decision source, a recorded reason/actor/time and no unresolved eligibility-review flag, while keeping the cancellation history. Do not weaken `officialOutcomeForDelivery`.

## Boundaries and release
This approval authorises preview implementation and isolated tests only. No live database changes, emails, texts, publication or activation. Restoring real-owner saving on the published site will still need separately approved persistence activation and publication; report that limitation explicitly.