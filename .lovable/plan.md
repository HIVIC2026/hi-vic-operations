# Simplified email conversion flow

## Scope
- Shorten the shared Likely Eligible and Needs Onsite Confirmation email after the itemised estimate.
- Keep the current quote order, live two-fee arithmetic, inline ceiling-size calculator, conditional insulation note, rectification rules, tracking, referral and unsubscribe safety.
- Replace the email payment and long next-step sections with the approved reassurance copy and one “CONFIRM MY QUOTE →” action.
- Leave the ineligible email unchanged and keep customer delivery disabled.

## Secure next step
- Extend the existing token-protected estimate page with a branded confirmation state opened by the email action.
- Show dynamic estimated price, $349 due today, remaining balance, visit checklist, and site-specific cost protections.
- Preserve the existing calculator and add a back-to-estimate action.
- Connect “PAY $349 & PROCEED →” only to an existing approved payment mechanism. If none exists, render it disabled with accurate unavailable wording rather than inventing payment behavior.
- Include the requested payment-received state only where an existing verified payment result can drive it; do not simulate success.

## Preview and validation
- Add a safe next-step sample preview beside the email preview without writes or payment activity.
- Verify Likely and Needs Onsite email variants plus the confirmation screen at 390px.
- Check one email CTA, secure token routing, arithmetic, no duplicated fee explanations, focused tests, typecheck, automatic build, and both delivery locks OFF.
