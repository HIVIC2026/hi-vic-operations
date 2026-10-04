# Onboarding fixes, money check, per-job profit

Preview only, no publishing. Existing records stay as they are. Sending and the payment gate stay off.

## B. Money check (read-only results)

| Rule | Result |
|---|---|
| No lead fee, any source | **Matches in practice.** Nothing works out, takes off, shows or edits a lead fee, and a test guards this. One out-of-date note: the decisions list still says HIV leads may have a lead fee "if in the signed agreement". Fix: change that note to "none". |
| Rectification has no markup | **Matches.** The owner pays the electrician's agreed price plus GST. Folding it into the installation quote adds nothing. |
| PIESA markup on both sources | **Partly.** Installer-supplied jobs: the owner pays $349 and the electrician (including the installer's own electrician) is paid their agreed rate. Matches. HIV jobs: I found no separate $349 PIESA line on the installation quote; only one $349 (the AP fee) is built in. Needs a decision, see below. |
| AP fee $349 inc GST, both sources | **Matches on amount** (setting is $349, or $317.27 before GST). On HIV jobs it's spread into the installation prices, not shown as its own line. Installer-supplied jobs show it as its own line. |
| $3/m² installer markup, HIV jobs only | **Does not match.** HIV quotes add a **12% markup** on the installer's price, not $3/m². The same quote builder adds the 12% and spreads the AP fee into prices for any job it quotes, even installer-supplied jobs, which also get their own AP fee line. That risks charging the AP fee twice and adding a markup on the installer's price. Installer-supplied jobs normally use their own quote builder (installer price + $349 PIESA + AP fee, no markup), which matches. |

**Questions for Jo before any money change is built:**
1. Should HIV quotes switch from 12% to $3/m²?
2. On HIV jobs, should the $349 PIESA be its own quote line, separate from the $349 AP fee?

Until she answers, Part C will show today's real figures, with a warning wherever they differ from her rules.

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
