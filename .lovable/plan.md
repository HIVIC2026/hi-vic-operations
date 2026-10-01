# Perfect launch by TOMORROW — Friday 2 October

## The goal

By Friday: onboarding links sent and partners signing up, owners linked with their installers and electricians, Ready Checks going out to installers, and the enquiry backlog moving through the pipeline.

## Today (Thursday) — my side

1. **All four Mitti briefs delivered**: A1 v6 (installer-sourced, priced), A2 (our leads), B (PIESA), C (PIISA) — all with downlights Yes=red / No=green, prefilled office fields, draw-in-form diagram.
2. **Onboarding invites ready to send**: installer + electrician onboarding links work today (they don't need Mitti). Name-first step, team-up invites, agreement signing — already built; I verify the full path in the browser.
3. **Owner linking**: verify owner↔installer↔electrician linking on jobs works end to end.
4. **Shared gate timeline** for installers/electricians with the 30-day PIESA countdown.
5. **To action tab** verified against live data.
6. **Dress rehearsal**: full dummy journey in the browser — enquiry → Gate 1 → Ready Check → quote → acceptance → invoice preview → deposit gate → install → PIISA → VEEC. Fix anything wrong on the spot.
7. **Full regression**: tests, build, security, mobile screens.

## Today (Thursday) — your side

1. **Paste each brief into Mitti as I deliver it** (A1 first), eyeball against the brief, send me the four template IDs. I connect and test each within minutes. **A1 is built: template_01ee0428be6d4435b34d8b738935f099 — I connect and validate it first.**
2. **Send the onboarding links** to your installers and electricians — this can start as soon as I confirm the invite path (this morning).
3. **Three quick decisions**: (a) hazard photo per area or one description, (b) "Not sure" allowed on remove/top-up?, (c) $220 lead fee inc or ex GST.
4. **Approve the invoice design** when I show you the preflight.

## Friday morning — go-live

1. All four Mitti IDs connected; sync proven on a dummy job.
2. Final checks green: tests, build, security, no stage/action mismatches, invoice preflight approved.
3. **You say "go"** → live communications switch on.
4. Ready Checks go out to installers; the team works the enquiry backlog oldest-first via the To action tab.
5. First real Xero invoice: you action it, we reconcile together before any more are created.

## What could slip it — and the fallback

- **Mitti forms not built/connected today** → launch still happens Friday, but Ready Check/PIESA/PIISA data entry uses the portal's own screens until Mitti is connected. Not silent — shown in To action.
- **Any go-live check red** → that piece launches in manual mode with a visible To action card, never silently broken.
- **Live communications** stay off until your explicit approval — deliberate lock, won't be bypassed.

## Technical details

- Locked Step 1 (Base44 handoff) and Gate 1 rules untouched.
- Test jobs stay flagged `qa_test`, excluded from live totals.
- Briefs generated from `src/lib/mitti-forms.core.ts` so labels can't drift; `validateTemplate` refuses drifted Mitti forms.
- Timeline extends `src/lib/waiting.core.ts` + the job journey strip to installer/electrician views.
