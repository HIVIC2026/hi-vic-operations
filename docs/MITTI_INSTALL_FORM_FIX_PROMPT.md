# Prompt for ChatGPT: build the Install day template in Mitti (decisions 260–262)

Copy everything between the lines into ChatGPT. It is ONE self-contained build of a NEW template, in the same style as
the Ready Check build. The old "A3 - PIISA + AP Evidence" template is left alone until the new one is checked, then
renamed "(old)" and unpublished. The portal reads every answer by its question text, so the wording below is fixed in
`src/lib/install-day.core.ts` and a test fails if this file and the code drift apart.

---

You are helping me build a form template in **Mitti** (mitti.com.au field inspection app, web template builder). I will
follow your instructions click by click in the Mitti web app. Give me the build as a numbered list of steps I can tick
off, nothing skipped. The question wording, answer types, options, Required settings, help texts and "only show when"
logic below are **fixed and must be copied exactly, character for character, including punctuation, capitals and the ²
symbol**, because a connected software system reads every answer by its question text. Do not reword, reorder, merge,
split, add or drop any question. If Mitti does not offer an answer type I name, tell me the closest Mitti type and ask me
before substituting.

**Template name:** `A3 – Install day`
Build it as a NEW template. The existing "A3 - PIISA + AP Evidence" stays as it is for now.

**Inspection title:** Portal Job Number + Site address (Q1 and Q2).
**Settings:** turn ON **mandatory mark-as-complete**. Turn ON location/GPS for every Photo and Video question.
**Pages:** one page per ## group below.
**Questions marked "portal fills this in"** are pre-filled by the software on every form it creates. Keep them as normal
editable items so the installer can correct them.
**Stop lines** are short red text items that only show when the answer before them is `No`; they are not questions.

Answer-type key: Text = single line text; Number = numeric; Date = date; Yes/No = two choices `Yes` and `No`; Pick one =
single-select multiple choice with the exact options listed; Tick all = multi-select multiple choice; Photo = photo with
location on; Video = video attachment with location on ("several files allowed" = let the installer attach more than one); Checkbox = single checkbox that must be ticked; Signature =
signature capture.

## Group 1: Job
Q1: `Portal Job Number` — Text — Required — portal fills this in
Q2: `Site address` — Text — Required — portal fills this in
Q3: `Install date` — Date — Required — portal fills this in
Q4: `Accredited person` — Text — Required — portal fills this in

## Group 2: Who's on site
Q5: `Installer business` — Text — Required — portal fills this in
Q6: `Lead installer` — Text — Required — portal fills this in
Q7: `Lead installer's CII number` — Text — Required — portal fills this in
Q8: `Is anyone else installing today?` — Yes/No — Required
Q9: `Second installer` — Text — Required — only show when Q8 = `Yes`
Q10: `Second installer's CII number` — Text — Required — only show when Q8 = `Yes`
Q11: `Is there a third installer?` — Yes/No — Required — only show when Q8 = `Yes`
Q12: `Third installer` — Text — Required — only show when Q11 = `Yes`
Q13: `Third installer's CII number` — Text — Required — only show when Q11 = `Yes`
Q14: `Photo of each installer at the front door, showing photo ID` — Photo — Required — help text: `One photo per person.`

## Group 3: Before anyone goes up
Q15: `Does the household know the power will be off today?` — Yes/No — Required — stop line when No: `Stop. Tell them before you go on.`
Q16: `Does anyone here rely on life support?` — Yes/No — Required — portal fills this in
Q17: `Do you have their written consent or medical plan?` — Yes/No — Required — only show when Q16 = `Yes` — stop line when No: `Stop. You need it before starting.`
Q18: `Upload the consent or medical plan` — Photo — Required — only show when Q17 = `Yes` — help text: `Every page readable.`
Q19: `Is the safety plan for this job signed?` — Yes/No — Required — help text: `It's on your job page.` — stop line when No: `Stop. Sign it on your job page first.`
Q20: `Are all the common hazards covered in it?` — Yes/No — Required — stop line when No: `Stop.`
Q21: `Is the power isolated, locked out and tagged, and the ceiling safe to enter?` — Yes/No — Required — stop line when No: `Stop. Isolate, lock out and tag first.`
Q22: `Photo of the switchboard with the lock-out tag on` — Photo — Required — help text: `Solar and battery isolators off too, if the home has them.`

## Group 4: Solar, battery or generator
Q23: `Is there solar, a battery or a generator?` — Yes/No — Required — portal fills this in
Q24: `Do you have the shutdown and restart instructions?` — Yes/No — Required — only show when Q23 = `Yes` — stop line when No: `Stop. An electrician must isolate it.`
Q25: `Does the ground-level isolator work and switch off safely?` — Yes/No — Required — only show when Q23 = `Yes` — stop line when No: `Stop. Get an electrician to check it.`

## Group 5: The electrician's check (PIESA)
The portal has the PIESA already: it fills in the light, cable and downlight answers on the official form itself, so none of
them are asked here.
Q26: `Have you read the PIESA and is it safe to start?` — Yes/No — Required — stop line when No: `Stop.`
Q27: `Does the PIESA need an electrician here at the start?` — Yes/No — Required — portal fills this in
Q28: `Is the electrician here?` — Yes/No — Required — only show when Q27 = `Yes` — stop line when No: `Stop. Wait for the electrician.`
Q29: `Photo of the electrician at the front door, showing photo ID` — Photo — Required — only show when Q28 = `Yes`
Q30: `Has anyone been in the ceiling since the PIESA?` — Yes/No — Required — help text: `Ask the owner.` — stop line when Yes: `Stop. An electrician must check again.`

## Group 6: Product
Q31: `Photo of the packaging showing brand, model and R-value` — Photo — Required — help text: `One per product.`

## Group 7: Declaration (sign before you start)
Q32: Text item (not a question), exactly the current official text starting `INSTALLER DECLARATION – Sign BEFORE insulation work starts.` — copy it from the old "A3 - PIISA + AP Evidence" template, including the item starting `d. I will ensure that:` and the `Privacy Collection Statement` item.
Q33: `Everything on this form is true and complete` — Checkbox — Required
Q34: `Lead installer's signature` — Signature — Required
Q35: Text item (not a question): `That's the before-work part done. Come back to the next page when the insulation is in.`

## Group 8: Videos and photos (after the install)
The before video of each area was taken at the Ready Check, so it is not asked again.
Q36: `After videos: one slow 360° of each ceiling area, lit, saying the area's name, showing full coverage and no rubbish left` — Video, several files allowed — Required
Q37: `Depth photos: the new insulation in each area with a ruler standing in it` — Photo, several files allowed — Required — help text: `Don't squash it.`
Q38: `Did the install take more than one day?` — Yes/No — Required
Q39: `I checked every item on this form again before starting each day` — Checkbox — Required — only show when Q38 = `Yes`

## Group 9: Finishing up
Q40: `Is the lock-out off and the power back on?` — Yes/No — Required — stop line when No: `Don't leave until it is.`
Q41: `Who turned it back on?` — Text — Required — only show when Q40 = `Yes` — help text: `Name, and whether it was the installer who locked it or the electrician.`
Q42: `Photo of the switchboard with the main switch on` — Photo — Required — only show when Q40 = `Yes`
Q43: `Is the solar, battery or generator back on?` — Pick one: `Yes` / `No` / `There isn't one` — Required
Q44: `I was here the whole time and supervised everyone` — Checkbox — Required
Q45: `Lead installer's signature` — Signature — Required

Publish.
