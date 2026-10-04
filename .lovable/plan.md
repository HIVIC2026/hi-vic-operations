# Onboarding fixes, money check, per-job profit

Preview only, no publishing. Existing records stay as they are. Sending and the payment gate stay off.

## B. Money check (read-only results)

| Rule | Result |
|---|---|
| No lead fee, any source | **Matches in practice.** Nothing works out, takes off, shows or edits a lead fee, and a test guards this. One out-of-date note: the decisions list still says HIV leads may have a lead fee "if in the signed agreement". Fix: change that note to "none". |
| Rectification has no markup | **Matches.** The owner pays the electrician's agreed price plus GST. Folding it into the installation quote adds nothing. |
| PIESA markup on both sources | **Partly.** Installer-supplied jobs: the owner pays $349 and the electrician (including the installer's own electrician) is paid their agreed rate. Matches. HIV jobs: I found no separate $349 PIESA line on the installation quote; only one $349 (the AP fee) is built in. Needs a decision, see below. |
| AP fee $349 inc GST, both sources | **Matches on amount** (setting is $349, or $317.27 before GST). On HIV jobs it's spread into the installation prices, not shown as its own line. Installer-supplied jobs show it as its own line. |
| HIV jobs: owner pays $30/m², markup = ($30 − installer's agreed rate) × m² | **Estimate matches, final quote does not.** The estimate uses $30/m² inc GST for every installer. The final installation quote instead takes **that installer's agreed rate + 12%**, spreads the AP fee into the prices, then adds GST. So the owner's price per m² changes with the installer (for example, the TEST installers' R5 rates of $10.75–$12.90 give different final prices) and is not $30. |
| Installer-supplied jobs: no installer markup | **Matches on the normal path:** the installer's own price + $349 PIESA + AP fee, no markup. **Risk:** if the office presses "Generate installer quotes" on one of these jobs, the HIV quote builder still adds its 12% and spreads the AP fee into prices, on top of a separate AP fee line. That could charge the AP fee twice. |

**Fixes proposed (built only once you say go):**
1. HIV installation quotes: the owner's price is $30/m² inc GST (the current estimate setting) for any installer. The markup is $30 minus that installer's agreed rate, kept on the office's own figures only. The 12% is no longer used.
2. Installer-supplied jobs can't use the HIV quote builder. They always use their own.
3. The "lead fee" note is corrected to "none".

**Questions for Jo:**
1. Installers enter their agreed rates **including GST**. Should the markup be worked out as $30 minus that rate, both including GST? This is what's assumed.
2. Should removal ($15/m² on the estimate) and access extras follow the same rule, with the owner price fixed and the markup being that price minus the installer's agreed rate?
3. On HIV jobs, should the $349 PIESA be its own quote line, separate from the $349 AP fee?

Until fix 1 is built, Part C shows each job's real quoted figures and flags any HIV job not at $30/m².

## A. Onboarding form fixes

1. **Weekly installations:** the question is hidden. Saved answers are kept but ignored.
2. **Accepting new work now:** becomes a Yes / No choice. Either answer is allowed. "No" is shown to the office and does not block approval.
3. **Certifications:** each worker who holds a CII gets two new questions:
   - **Level:** Full / Provisional
   - **Expiry date:** must be in the future

   Provisional shows a clear note: "Can't receive work until Full." At office approval, these answers are copied into the existing certification records, so the office only checks them, not retypes them. Approval still needs the office to verify each one.
4. **No empty applications:** tapping Start no longer saves anything. The application is saved, and counted toward the start limit, only when the first answer is saved. Limits and abuse checks are unchanged.
5. **Brand fonts:** the onboarding page uses Space Grotesk headings and DM Sans text.

Applications already started keep working and can resume. Answers already given are not changed.

## C. Per-job profit breakdown (office only)

A new "Profit" card on the office job page. It is never shown to owners or trades. It has two columns, **Expected** and **Actual**:

- **AP fee:** $349 inc GST
- **VEEC spread:** VEECs × (sale price − $70)
  - The VEEC count comes from the official activity calculator (area, climate zone, metro/regional, existing insulation).
  - Sale price comes from a new office setting, "Current VEEC price" (starts at $83). It is replaced by the real sale price once sold.
- **PIESA markup:** $349 − the electrician's agreed rate. Shows "rate to be confirmed" if there's no rate.
- **Installer markup:** $3 × m², HIV jobs only. Installer-supplied jobs show $0 (see question 1).
- **Total:** inc GST and ex GST.

Area used: the estimate area before the Ready Check, then the measured area afterwards. The card shows which area it used. Actual figures use the accepted quote, the agreed rates, and the recorded VEEC sale once there is one.

## Effect on existing records

None are changed. New settings and fields are additions only. Past jobs only get the read-only card, worked out from their records.

## Undo

Roll back this version in History. Each database addition comes with an undo file that removes only what was added.

## Technical details

- A: `installer-onboarding.tsx` and `installer-onboarding.core.ts` (hide `capacity_band`, yes/no availability, `cii_level` + `cii_expiry` on `Installer`, plus validation). `installer-onboarding.functions.ts`: start creates a token only; the row is inserted on the first save, and `consume_onboarding_start` moves to that insert. `activate_partner_application` maps level and expiry into `worker_certification_levels`, still unverified. Font tokens move to the brand fonts for this route, with links added in `__root`.
- B fix (after Jo's answer only): `workflow-decisions.ts` note. `generateInstallerQuotes` must refuse jobs that aren't HIV-sourced (they use `installer-led.core` instead).
- C: pure `job-profit.core.ts` (reuses `activity48.core`, `electrician_rates`, `veec_spot_prices`); admin-only server function using `requireSupabaseAuth` + an admin check; new `workflow_settings.current_veec_price` (default 83) and nullable `veec_lodgements.sale_price_per_veec`. Additive only, proven on PGlite first.
- Tests: onboarding (no draft until first save, limit counted once, level/expiry rules), profit maths (both sources, estimate vs measured area, missing rate), and visibility (admin only).
