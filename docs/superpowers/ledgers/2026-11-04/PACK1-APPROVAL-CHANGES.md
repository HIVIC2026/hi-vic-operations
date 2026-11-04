# Pack 1 approval code changes (Jo, 4 Nov) — run on new-job-flow-joined AFTER the p10 merge

One small task, fresh implementer, then task reviewer. No new features. Tests one file per process.

## 1. installer-accepted-email.core.ts (items 13/14)
- v2 lead line: `has paid the $349 for the PIESA` → `has paid for the PIESA`. Installers must never see Home Insulation Victoria's PIESA price. Grep the whole repo for other installer-facing "$349" strings in emails/texts/screens (own-customer Part 10 lines where the installer SETS their own $349 PIESA line are theirs — leave those). Update tests/pins.

## 2. non-compliance-notice.core.ts (item 39) — APPROVED redraft
- subject: `About your ceiling insulation — one thing we need to put right`
- body (text and html, same words):
  `Hi {first},`
  `We've checked your job and found one thing that doesn't meet the program's rules: {what}.`
  `We'll fix it at no cost to you: {fix}.`
  `{Installer} will call you to arrange a time.`
  `Nothing else changes — your rebate and your price stay as they are.`
  `Questions? Reply to this email or call {Installer} on {office phone}.`
- {Installer} = installerName(contact); office phone = contact office number only (never a mobile). Remove the `// draft for Jo` markers. Key stays `non-compliance:v1`. NON_COMPLIANCE_NOTICE_APPROVED remains false until go-live.

## 3. piesa-delivery.core.ts owner copy, post-rectification variant (item 44) — APPROVED redraft
When repairs.completed === true AND recipient === "owner":
- subject: `Your electrical upgrades are done — updated safety check attached`
- headline: `{first}, your electrical upgrades are done`
- result card: `Safe to insulate` (drop "(after repairs)")
- intro: `Here's your updated copy of your electrical safety check (PIESA), now that the upgrades are complete. Please keep it: the VEU program says you must have it at least 24 hours before your install.`
- row: `Electrical upgrades` → `Completed · certificate {no}` (not "CES")
- preview: `Electrical upgrades done — safe to insulate. Please keep this copy – you need it at least 24 hours before your install.`
- Never the word "repairs" anywhere an owner sees (subject, headline, preview, rows, attachment line). Installer-recipient variant: "repairs" → "electrical upgrades" too (same rule, trade wording), rest unchanged.
- The all-clear owner variant is unchanged byte-for-byte (pin).

## Done when
- bun test on the three files' suites + templates hub pins; scan 0; vite build; sample renders (scripts/render-*-samples) regenerated for 13/14/39/44 into .superpowers/pictures/pack1/ (same numbers, suffix -v2).
