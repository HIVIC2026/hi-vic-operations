# Customer-facing quote consistency pass

## Scope
- Add one shared customer quote system containing the exact Home Insulation Victoria brand tokens, logo, font, quote labels/order, payment wording, what-could-change list, and existing-insulation note.
- Refactor the likely and onsite email renderer, ineligible branding, secure estimate, calculator, confirmation screen, and preview fixtures to consume that shared system.
- Preserve the secure calculator and payment anchors, dynamic AP fee and estimates, local-only what-if behavior, existing insulation rules, and disabled delivery/payment controls.

## Implementation
- Replace customer-facing shorthand and alternative labels with the canonical full wording while leaving genuinely internal/admin terminology unchanged.
- Introduce shared helpers for the canonical ordered quote rows so React and email rendering cannot drift.
- Keep ineligible messages on the shared visual system without rendering any quote, discount, or payment content.
- Add regression coverage for identical ordering, exact copy, shared brand values, absence of customer-facing “HI VIC,” ineligible exclusions, and both delivery locks remaining off.

## Validation
- Run focused estimate, email, secure-link, and safety tests, then the relevant broader suite, TypeScript checks, and the automatic build.
- Browser-check likely, onsite, ineligible, calculator, and secure next-step previews at 390px and 640px for overflow and required content.
- Do not send messages, enable payment or delivery, change settings/data/pricing/Gate 1, deploy, or publish.
