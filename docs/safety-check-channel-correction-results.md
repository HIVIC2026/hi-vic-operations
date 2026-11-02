# Safety-check channel correction — Jo 3 Nov, 10:30am

- Installer-sourced owner quotes use the installer's active business-owned PIESA price-list line, with no markup. Full fee belongs to that installer regardless of in-house/payment flags. Missing rate holds new quote pricing.
- Website quotes retain the standard $349 owner fee and the office electrician-payout setting ($275 default; approved saved-setting update remains pending).
- Issued/accepted quote amounts and recorded payout values retain precedence. No live jobs, quotes, offers, settings, TEST businesses or provider state changed; HV-3193 and HV-3682 untouched. No sends or publishing. Agreement text and repeat hint unchanged.

## Tests
- Red-first Rapid $275, Reinsulate $349, website $349/$275, missing-rate hold and actual payout-reader tests failed before implementation and pass afterwards.
- Core pricing: 14/14. Actual pricing/payee/trade-reader regression: 16/16.
- Related suites passing: installer-paid-electricians 6, installer-payer-fees 8, office payout timing 4, installer quote 6, website electrician 8, PIESA payment 8, installer quoted PGlite 1, Mitti electrician options 10, profit-card PGlite 3, job-profit/profit 20.
- Broader existing suites: installer-create-roundtrip 11 pass/13 fail; installer-own-job-e2e 1/16; installer-price 39/4. Untouched HEAD archive produces exactly the same pass/fail counts. These are not claimed as passing flows.
- Retired-term scan: 0 customer-visible failures. Automatic type/build validation checked after changes.
- Authenticated UI/two-user full pricing journey NOT RUN: Jo's admin session remains unavailable. Unit/actual-reader tests are not whole-job proof.

## Read-only saved-price check
RAPID INSULATION has an active installer v1 price list, but no saved PIESA line (not a confirmed $275). Reinsulate v2 still has $318.18 ex GST / $350 inc GST because the four separately approved normal recorded saves remain blocked. No price was invented or saved; the $275/$349 tests use Jo's requested examples.