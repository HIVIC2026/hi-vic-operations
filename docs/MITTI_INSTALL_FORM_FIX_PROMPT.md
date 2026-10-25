# Prompt for ChatGPT: build the Install day template in Mitti (decisions 260–262)

Copy everything between the lines into ChatGPT. It is ONE self-contained build of a NEW template, in the same style as
the Ready Check build. The old "A3 - PIISA + AP Evidence" template is left alone until the new one is checked, then
renamed "(old)" and unpublished. The portal reads every answer by its question text, so the wording below is fixed in
`src/lib/install-day.core.ts` and a test fails if this file and the code drift apart.

Decision 328 (Jo, 25 Oct 2026): four changes so the after-work part can't be missed — the READ FIRST text item at the top
of Group 1, the new Q37 stop text, the AFTER THE INSTALL text item at the top of Group 8, and the required Q47 final tick
just before the last signature (now Q48). The portal reads the Q47 tick: unticked = the form is not complete. When the form
is marked Complete the portal checks it and texts the lead installer "All filled in" or what's missing
(`src/lib/install-day-confirm.core.ts`).

---

You are helping me build a form template in **Mitti** (mitti.com.au field inspection app, web template builder). I will
follow your instructions click by click in the Mitti web app. Give me the build as a numbered list of steps I can tick
off, nothing skipped. The question wording, answer types, options, Required settings, help texts and "only show when"
logic below are **fixed and must be copied exactly, character for character, including punctuation, capitals and the ²
symbol**, because a connected software system reads every answer by its question text. Do not reword, reorder, merge,
split, add or drop any question. If Mitti does not offer an answer type I name, tell me the closest Mitti type and ask me
before substituting.

**Template name:** `A5 – Install day`
Build it as a NEW template. The existing "A3 - PIISA + AP Evidence" stays as it is for now.

**Inspection title:** Portal Job Number + Site address (Q1 and Q2).
**Settings:** turn ON **mandatory mark-as-complete**. Turn ON location/GPS for every Photo and Video question.
**Pages:** one page per ## group below.
**Colours (decisions 304 + 339):** the safe or easier answer is GREEN, a problem or stop is RED, a plain fact with no good or bad side is GREY. Q9/Q13 grey; Q17 Yes green No red; Q18 No green Yes grey; Q19 Yes green No red; Q21 Yes green No red; Q22 Yes green No red; Q23 No green Yes grey; Q24 Yes green No red; Q25 Yes green No red; Q26 Yes green No red; Q28 Yes green No red; Q29 No green Yes grey; Q30 Yes green No red; Q32 No green Yes red; Q40 grey; Q42 Yes green No red; Q45 Yes green, There isn't one green, No red.
**Questions marked "portal fills this in"** are pre-filled by the software on every form it creates. Keep them as normal
editable items so the installer can correct them.
**Stop lines** are short red text items that only show when the answer before them is `No`; they are not questions.

Answer-type key: Text = single line text; Number = numeric; Date = date; Yes/No = two choices `Yes` and `No`; Pick one =
single-select multiple choice with the exact options listed; Tick all = multi-select multiple choice; Photo = photo with
location on; Video = video attachment with location on ("several files allowed" = let the installer attach more than one); Checkbox = single checkbox that must be ticked; Signature =
signature capture.

## Group 1: Job
Text item (not a question), first item on this page, before Q1 (decision 328; replaces the decision-318 line on this form): `READ FIRST: The VEU will not accept this job unless every answer, photo and video on this form is filled in. Do not leave site until the whole form is done, you have pressed Complete, and the portal has texted you "All filled in". You are only paid when this form is 100% complete.`
Q1: `Portal Job Number` — Text — Required — portal fills this in
Q2: `Site address` — Text — Required — portal fills this in
Q3: `Install date` — Date — Required — portal fills this in
Q4: `Accredited person` — Text — Required — portal fills this in

## Group 2: Who's on site
Q5: `Installer business` — Text — Required — portal fills this in
Q6: `Lead installer` — Text — Required — portal fills this in
Q7: `Lead installer's CII number` — Text — Required — portal fills this in
Q8: `Photo of the lead installer at the front door, showing photo ID` — Photo — Required — help text: `Photo ID readable.`
Q9: `Is anyone else installing today?` — Yes/No — Required — portal fills this in
Q10: `Second installer` — Text — Required — only show when Q9 = `Yes` — portal fills this in
Q11: `Second installer's CII number` — Text — Required — only show when Q9 = `Yes` — portal fills this in
Q12: `Photo of the second installer at the front door, showing photo ID` — Photo — Required — only show when Q9 = `Yes` — help text: `Photo ID readable.`
Q13: `Is there a third installer?` — Yes/No — Required — only show when Q9 = `Yes` — portal fills this in
Q14: `Third installer` — Text — Required — only show when Q13 = `Yes` — portal fills this in
Q15: `Third installer's CII number` — Text — Required — only show when Q13 = `Yes` — portal fills this in
Q16: `Photo of the third installer at the front door, showing photo ID` — Photo — Required — only show when Q13 = `Yes` — help text: `Photo ID readable.`

## Group 3: Before anyone goes up
Q17: `Does the household know the power will be off today?` — Yes/No — Required — stop line when No: `Stop. Tell them before you go on.`
Q18: `Does anyone here rely on life support?` — Yes/No — Required — portal fills this in
Q19: `Do you have their written consent or medical plan?` — Yes/No — Required — only show when Q18 = `Yes` — stop line when No: `Stop. You need it before starting.`
Q20: `Upload the consent or medical plan` — Photo — Required — only show when Q19 = `Yes` — help text: `Every page readable.`
Q21: `Is the safety plan for this job signed?` — Yes/No — Required — help text: `It's on your job page.` — stop line when No: `Stop. Sign it on your job page first.`
Q22: `Are all the common hazards covered in it?` — Yes/No — Required — stop line when No: `Stop.`

## Group 4: Solar, battery and power off
Q23: `Is there solar, a battery or a generator?` — Yes/No — Required — portal fills this in
Q24: `Do you have the shutdown and restart instructions?` — Yes/No — Required — only show when Q23 = `Yes` — stop line when No: `Stop. An electrician must isolate it.`
Q25: `Does the ground-level isolator work and switch off safely?` — Yes/No — Required — only show when Q23 = `Yes` — stop line when No: `Stop. Get an electrician to check it.`
Q26: `Is the power isolated, locked out and tagged, and the ceiling safe to enter?` — Yes/No — Required — stop line when No: `Stop. Isolate, lock out and tag first.`
Q27: `Photo of the switchboard with the lock-out tag on` — Photo — Required — help text: `If there's solar, a battery or a generator, it must be off too.`

## Group 5: The electrician's check (PIESA)
The portal has the PIESA already: it fills in the light, cable and downlight answers on the official form itself, so none of
them are asked here.
Q28: `Have you read the PIESA and is it safe to start?` — Yes/No — Required — stop line when No: `Stop.`
Q29: `Does the PIESA need an electrician here at the start?` — Yes/No — Required — portal fills this in
Q30: `Is the electrician here?` — Yes/No — Required — only show when Q29 = `Yes` — stop line when No: `Stop. Wait for the electrician.`
Q31: `Photo of the electrician at the front door, showing photo ID` — Photo — Required — only show when Q30 = `Yes`
Q32: `Has anyone been in the ceiling since the PIESA?` — Yes/No — Required — help text: `Ask the owner.` — stop line when Yes: `Stop. An electrician must check again.`

## Group 6: Product
Q33: `Photo of the packaging showing brand, model and R-value` — Photo — Required — help text: `One per product.`

## Page between Group 6 and Group 7: Ruler photos (each ceiling area) — decision 396
One repeating section, button `Add a ceiling area`, help text on the section: `Add one for each ceiling area, in the same order as the Ready Check areas.` Inside it, in this order (not numbered — they are not part of Q1–Q48):
- `Existing insulation depth — photo with a ruler standing upright in it` — Photo — NOT required (the portal requires it for each area that had insulation, from the Ready Check) — help text: `Only if this area had insulation before. Take it before any work starts.`
- `New insulation depth after install — photo with a ruler standing upright in it` — Photo — Required — help text: `Come back to this page when the insulation is in. Don't squash it.`
(Already-built forms: add it with docs/mitti-paste-A5-ruler-photos.md.)

## Group 7: Declaration (sign before you start)
Q34: Text item (not a question), exactly the current official text starting `INSTALLER DECLARATION – Sign BEFORE insulation work starts.` — copy it from the old "A3 - PIISA + AP Evidence" template, including the item starting `d. I will ensure that:` and the `Privacy Collection Statement` item.
Q35: `Everything on this form is true and complete` — Checkbox — Required
Q36: `Lead installer's signature` — Signature — Required
Q37: Text item (not a question) (decision 328): `STOP. You are only halfway. Do not leave site. When the insulation is in, come back and finish the next pages: after videos, depth photos and finishing up.`

## Group 8: Videos and photos (after the install)
The before video of each area was taken at the Ready Check, so it is not asked again.
Text item (not a question), first item on this page, before Q38 (decision 328): `AFTER THE INSTALL: do this before you pack up. Every ceiling area needs its after video and depth photo.`
Q38: `After videos: one slow 360° of each ceiling area, lit, saying the area's name, showing full coverage and no rubbish left` — Video, several files allowed — Required
Q39: `Depth photos: the new insulation in each area with a ruler standing in it` — Photo, several files allowed — Required — help text: `Don't squash it.`
Q40: `Did the install take more than one day?` — Yes/No — Required
Q41: `I checked every item on this form again before starting each day` — Checkbox — Required — only show when Q40 = `Yes`

## Group 9: Finishing up
Q42: `Is the lock-out off and the power back on?` — Yes/No — Required — stop line when No: `Don't leave until it is.`
Q43: `Who turned it back on?` — Pick one: `Lead installer` / `Second installer` / `Third installer` / `The electrician` — Required — only show when Q42 = `Yes`
Q44: `Photo of the switchboard with the main switch on` — Photo — Required — only show when Q42 = `Yes`
Q45: `Is the solar, battery or generator back on?` — Pick one: `Yes` / `No` / `There isn't one` — Required
Q46: `I was here the whole time and supervised everyone` — Checkbox — Required
Q47: `Every answer, photo and video on this form is filled in, and I won't leave site until the portal texts me "All filled in".` — Checkbox — Required
Q48: `Lead installer's signature` — Signature — Required

Publish.
