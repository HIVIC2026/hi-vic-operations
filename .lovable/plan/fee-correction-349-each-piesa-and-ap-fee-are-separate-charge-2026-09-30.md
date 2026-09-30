# Fee correction: $349 each — PIESA and AP fee are separate charges

## The correction
The $349 is not one combined fee. It is **$349 each**:
- **$349 inc GST — the pre-install electrical safety check (PIESA)** when done by our electrician.
- **$349 inc GST — our Accredited Person (AP) fee** on every job, always the same.

So on a standard job with our electrician, the owner's co-branded invoice shows both lines: PIESA $349 + AP fee $349. If the installer brings their own onboarded electrician, the owner pays that electrician's agreed price for the PIESA plus our $349 AP fee.

## What changes

1. **`src/lib/partner-howitworks.ts` — WHY_349 box** becomes "Our fees, plainly":
   - PIESA (our electrician): $349 inc GST.
   - AP fee: $349 inc GST on every job — covers eligibility checks, owner consent, official forms, 24-hour notices, the quote and invoice, payment chasing, evidence review, VEEC creation and lodgement, 6-year records and audits.
   - Installer's own electrician: owner pays that electrician's agreed PIESA price + our $349 AP fee.
   - All paid by the owner on the one co-branded invoice — never charged to the installer.
2. **Installer agreement v1.5 section 27** — update the fee paragraph to state the two separate $349 charges (currently describes one combined $349).
3. **Pricing settings check** — confirm `pricing_settings` holds the AP fee and PIESA price as separate values (ap_fee_ex_gst already exists; PIESA $349 already separate) so quotes/invoice previews render both lines. No new settings needed unless the audit shows otherwise.
4. **Onboarding "How we work with you"** — the two-option cards and FAQ already reference fees via settings; verify the wording shows both lines so installers see the full owner-facing price build-up.

## Already correct (no change)
- Referred jobs: owner quoted at our set customer price; installer paid agreed rate; $220 lead fee only on acceptance, deducted from payout.
- Payment terms: 50% deposit before scheduling, balance on install day, we chase payment.
- Portal-only comms, 24-hour rule, gate tracking.

## Technical notes
- Wording changes only in `partner-howitworks.ts` and `installer-agreement.text.ts` (v1.5, not yet signed by anyone — no re-sign cascade).
- Prices render from `pricing_settings`/`workflow_settings`, never hard-coded in copy.
- Run `bun test ./tests/` (baseline 738 pass) after edits.
