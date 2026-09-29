# Likely-eligible email quote breakdown

## Scope
- Update only the likely-eligible email renderer and its static preview.
- Leave onsite-confirmation and ineligible email output unchanged.
- Preserve URL validation, tracking, referral, and unsubscribe integration; do not send, enable, or publish anything.

## Changes
- Extend the likely-email input with optional dynamic quote-breakdown values: installation price/rate, assessment fee, AP fee, gross total, and remaining balance.
- Replace the existing money summary with one clear preliminary quote card showing the address, area, line items, total, dominant VEU deduction, and final estimated customer cost.
- Add the immediate $349 payment explanation, `PAY $349 & CONTINUE →` action, remaining estimated balance, change-after-assessment list, and customer-protection statement.
- Keep compatibility for existing callers by deriving totals only from already supplied estimate values and omitting unavailable optional line-item detail rather than inventing prices.
- Update the preview with the supplied sample-only figures at desktop and mobile widths.
- Update focused likely-email render assertions, then run the eligible renderer tests and the project build only.
