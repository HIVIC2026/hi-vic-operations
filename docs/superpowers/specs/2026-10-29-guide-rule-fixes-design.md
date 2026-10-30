# Portal fixes to match the business guide — Spec

**Date:** 29 Oct 2026 · **Approved design:** Jo, 29 Oct 2026

## Why
The new business guide for Tom, Dom and Dad states Jo's rules. In 7 places the portal does something different. These changes make the portal match the guide.

## Rules for all changes
- Each change has tests written first, and the whole test suite passes before it's done.
- Each change is saved to GitHub on its own branch / pull request. Nothing goes live until Jo says go.
- Only what's listed here changes. No extra features.
- Jobs already in progress are not re-priced or re-offered.
- Record each decision in `docs/JO_DECISIONS_LOG.md` as the next decision number.

## Part 1 — start now (no clash with waiting branches)

### 1. Remove the calculator line from owner emails
- Remove "Try a different ceiling size [calculator link]" from O1, the three O2 versions, O66, O67 and O68. Nothing replaces it.
- Code: `src/lib/jo-outcome-email.core.ts` (`CALCULATOR_LINE`, `mjRebateAndPrice`), `src/lib/jo-email-templates.core.ts`, `src/lib/estimate-followup.core.ts`, matching `docs/templates/mjml` files.
- Update the tests that expect the line.
- The calculator page itself stays.

### 2. "Pick your install day" email (O33) deposit wording
- Replace the "Lock in your day" text with exactly:
  "To book your day, sign your install consent and pay your 10% deposit of [deposit]. Once it's in, your day is locked in. The rest, [balance], is due on install day. Or you can pay in full now."
- Remove "We hold it for 48 hours while you do this."
- Code: `src/lib/install-days-email.core.ts`, `docs/templates/mjml/owner_O33.mjml`.

### 3. Missing or expired electrician licence blocks approval
- A missing licence number, missing expiry, or past expiry is a hard block — no "approve anyway" override.
- Move the licence checks from `electricianApprovalBlockers` to `mandatoryActivationBlockers` in `src/lib/partner-activation.core.ts`. The approval checklist shows it as blocked, not "needs override".
- Already-approved electricians are not affected.
- Replaces decision 415 (override with reason).

### 4. Emails tab replies any time
- Already on main (commit 761f6799): manual sends are not held 8pm–7am. Automatic messages keep quiet hours.
- Task: confirm the live site runs this version; if not, publish. No code change.

## Part 2 — after the waiting branches are merged
(Waiting: `fix/batch1-money-cancels`, `fix/batch2-messages`, `fix/batch3a-quotes-deposit`, `fix-held-quote-latest-price`.)

### 5. $100 fixes markup on our own jobs only
- New fixes quotes: add $100 inc GST when the job is an HIV website job (`channel = hivic_sourced`), whoever the electrician is. $0 on installers' own jobs.
- Fixes quotes already sent keep their price.
- Code: `src/lib/fixes-price.core.ts` (`fixesMarginFor`), `src/lib/quotes.server.ts` (`generateRectificationQuote`).
- Replaces decisions 313/349/351 where they tie the markup to the electrician.

### 6. Quote acceptance without typing a name
- On My job, the owner ticks to accept and taps Accept. No typed name, no "over 18" tick.
- The owner's name on file fills the agreement record (`signatory_name`, `signature_name`). `signatory_over_18` is left empty for these acceptances.
- Nothing else is signed at acceptance. Consent (install booking) and the rebate form (after install) keep their own signing screens.
- Fixes approval uses the same helper — it follows the same change.
- Code: `src/routes/my-job.$token.tsx`, `src/lib/owner-link.functions.ts`, `src/lib/portal.functions.ts`, `src/lib/assignment.core.ts`, `src/lib/assignment.server.ts`.

### 7. Safety check offers one at a time
- Our website jobs: offer to the nearest approved electrician only. 24 hours to accept. If they decline or don't answer, offer the next nearest. After 2 misses, back to the office.
- Installers' own jobs: the installer's chosen electrician first, 24 hours. If no answer, back to the office (not to another electrician).
- When the owner asks for new times, the re-offer follows the same one-at-a-time rule.
- The old batch path (many electricians at once, business-hours timer) is no longer used for new offers. Offers already out are left to finish.
- Code: `src/lib/auto-offer.core.ts`, `src/lib/auto-offer.server.ts`, `src/lib/allocation.server.ts`, `src/lib/allocation.core.ts`; check `workflow_settings` (`rec_offer_batch_size`, `offer_dispatch_mode`).

## Done when
- All 7 behave as above in tests, the full suite passes, and each is on its own pull request.
- The guide and the portal say the same thing on these 7 points.
