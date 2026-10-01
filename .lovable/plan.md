# Launch TODAY — Thursday 1 October

## The enquiries are safe right now

Every enquiry is captured with all answers, consent and photos. Nothing is lost, nothing auto-sends. They are queued waiting for you. Today we get you processing them live.

## What I build today (my side, no input needed from you)

1. **Form A2 brief** (our leads — same questions as A1, no pricing) + regenerated **A1 v6**, both with downlights Yes=red / No=green. Ready for you to paste into Mitti.
2. **Forms B (PIESA) and C (PIISA) briefs** rebuilt to the same standard — all four briefs done today.
3. **Shared gate timeline** for installers/electricians with the 30-day PIESA countdown tracked per job.
4. **To action tab** verified against live data — every stuck enquiry, booking, payment and form shows as a card with the exact action.
5. **Full regression run**: all tests, build, security scan, mobile screens.
6. **Dress rehearsal**: I drive a complete dummy journey in the browser — enquiry → Gate 1 → Ready Check → PIESA → quote → acceptance → invoice preview → deposit gate → install → PIISA → VEEC — and fix anything wrong on the spot.

## What only you can do today (in parallel with me)

1. **Paste the four briefs into Mitti** as I deliver them (A1 first), eyeball each against the brief, send me the four template IDs — I connect and test sync within minutes of each.
2. **Three quick decisions**: (a) hazard photo per area or one description, (b) is "Not sure" allowed on remove/top-up, (c) $220 lead fee inc or ex GST.
3. **Approve the invoice design** on screen when I show you the preflight.
4. **Final "go"** — explicit approval to switch on live customer communications. Nothing sends to a real customer until you say so.

## Tonight — go-live sequence (once the above is green)

1. All four Mitti IDs connected; sync tested on a dummy job.
2. Invoice preflight approved by you.
3. All tests pass; no build or security errors; no stage/action mismatches.
4. **You say "go"** → I switch on live communications.
5. The team starts working the enquiry backlog through the pipeline, oldest first, driven by the To action tab.
6. First real Xero invoice: you action it yourself, we reconcile it together before a second one is ever created.

## Honest limits

- If Mitti forms aren't built and connected today, the portal still launches — but Ready Check/PIESA/PIISA data entry falls back to the portal's own screens until Mitti is connected.
- Live communications stay off until your explicit approval — that lock is deliberate and I won't bypass it.
- If any go-live check is red tonight, we launch with that piece in manual mode (visible in To action), not silently broken.

## Technical details

- Locked Step 1 (Base44 handoff) and Gate 1 rules untouched.
- Test jobs stay flagged `qa_test`, excluded from live totals.
- Forms: `src/lib/mitti-forms.core.ts` spec generates the briefs; `validateTemplate` refuses drifted Mitti forms.
- Timeline: extends `src/lib/waiting.core.ts` + job journey strip to installer/electrician views.
