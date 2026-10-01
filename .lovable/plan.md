# Launch plan — onboarding, emails, dummy run-throughs, automations

## 1. Partner onboarding — refined and verified

- Walk the full installer and electrician onboarding in the browser exactly as they see it, screen by screen, and fix anything unclear or ugly.
- Confirm it covers everything: name-first step, business details, insurance/REC (head of business only, not workers under someone else's REC), service areas, rates, the two ways we work together (you bring the customer / we bring the customer), electrician preference and team-up invites, portal-only communication rule, 24-hour response rule, agreement signing.
- Onboarding invite goes out with an email that explains who we are, what we do as the Accredited Person, and what they're signing up for.

## 2. Customer-facing emails — full redesign

- Redesign every email the portal sends (onboarding invites, owner updates, quote, booking confirmations, nudges) in the Home Insulation Victoria brand: blue/green/navy, Outfit/Figtree, "Home Insulation Victoria" wording throughout.
- Each email is plain-language: what happened, what they need to do, one clear button.
- Nothing sends until live communications are switched on with your approval — redesign is safe to do now.

## 3. Dummy job run-throughs — every scenario

Run full end-to-end dummy jobs in the browser, fixing anything wrong on the spot:

1. Website enquiry → Gate 1 → Ready Check → quote → acceptance → invoice → deposit gate → install → PIISA → VEEC.
2. Installer-brings-the-customer job with complete measure-up (skips Ready Check).
3. Installer job with partial measure-up (only missing items requested).
4. Our-lead job: installer offer, 24-hour rule, free Ready Check, $220 lead fee on acceptance.
5. Rectification path: PIESA fails → rectification quote same day → deposit gate → rectification → install.
6. Overdue/exception paths: no response, missed windows, To action cards appear correctly.

## 4. Automations — agreed set only

Safe automations that don't send anything externally without approval:

- To action tab stays live and accurate (already built — verify against live data).
- Automatic stage/next-step text from the single shared rule (already built — verify).
- Overdue flags: PIESA 30-day countdown, 24h/48h trade response, owner reminders — visible in To action.
- Anything that emails or writes externally stays behind the launch lock until you say go.

## 5. Mitti

- A1 is built (template_01ee0428be6d4435b34d8b738935f099) — I connect it and run the portal's checks against it first.
- You build A2, B and C from the briefs in Files as I finalise them; I connect and validate each.

## Go-live gate

Launch only when: all dummy run-throughs pass, Mitti forms connected and validated, emails approved by you, tests/build/security green. Then you say "go" and live communications switch on.

## Technical details

- Locked Step 1 (Base44 handoff) and Gate 1 rules untouched.
- Test jobs stay flagged `qa_test`, excluded from live totals.
- Email templates live in `src/lib/email-templates/`; sends stay server-side only.
- No automation retries or bypasses provider errors; external sends remain gated.
