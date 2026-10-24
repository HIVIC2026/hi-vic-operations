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

**Inspection title:** Portal Job Number + Site address (questions 1 and 2).
**Settings:** turn ON **mandatory mark-as-complete**. Turn ON location/GPS for every Photo and Video question.
**Pages:** one page per ## group below.
**Questions marked "portal fills this in"** are pre-filled by the software on every form it creates. Keep them as normal
editable items so the installer can correct them.
**Stop lines** are short red text items that only show when the answer before them is `No`; they are not questions.

Answer-type key: Text = single line text; Number = numeric; Date = date; Yes/No = two choices `Yes` and `No`; Pick one =
single-select multiple choice with the exact options listed; Tick all = multi-select multiple choice; Photo = photo with
location on; Video = video attachment with location on; Checkbox = single checkbox that must be ticked; Signature =
signature capture.

## Group 1: Job
1. `Portal Job Number` — Text — Required — portal fills this in
2. `Site address` — Text — Required — portal fills this in
3. `Install date` — Date — Required — portal fills this in
4. `Accredited person` — Text — Required — portal fills this in

## Group 2: Who's on site
5. `Installer business` — Text — Required — portal fills this in
6. `Lead installer` — Text — Required — portal fills this in
7. `Lead installer's CII number` — Text — Required — portal fills this in
8. `Is anyone else installing today?` — Yes/No — Required
9. `Second installer` — Text — Required — only show when 8 = `Yes`
10. `Second installer's CII number` — Text — Required — only show when 8 = `Yes`
11. `Is there a third installer?` — Yes/No — Required — only show when 8 = `Yes`
12. `Third installer` — Text — Required — only show when 11 = `Yes`
13. `Third installer's CII number` — Text — Required — only show when 11 = `Yes`
14. `Photo of each installer at the front door, showing photo ID` — Photo — Required — help text: `One photo per person.`

## Group 3: Before anyone goes up
15. `Does the household know the power will be off today?` — Yes/No — Required — stop line when No: `Stop. Tell them before you go on.`
16. `Does anyone here rely on life support?` — Yes/No — Required — portal fills this in
17. `Do you have their written consent or medical plan?` — Yes/No — Required — only show when 16 = `Yes` — stop line when No: `Stop. You need it before starting.`
18. `Upload the consent or medical plan` — Photo — Required — only show when 17 = `Yes` — help text: `Every page readable.`
19. `Is the safety plan for this job signed?` — Yes/No — Required — help text: `It's on your job page.` — stop line when No: `Stop. Sign it on your job page first.`
20. `Are all the common hazards covered in it?` — Yes/No — Required — stop line when No: `Stop.`
21. `Is the power isolated, locked out and tagged, and the ceiling safe to enter?` — Yes/No — Required — stop line when No: `Stop. Isolate, lock out and tag first.`
22. `Photo of the switchboard with the lock-out tag on` — Photo — Required — help text: `Solar and battery isolators off too, if the home has them.`

## Group 4: Solar, battery or generator
23. `Is there solar, a battery or a generator?` — Yes/No — Required — portal fills this in
24. `Do you have the shutdown and restart instructions?` — Yes/No — Required — only show when 23 = `Yes` — stop line when No: `Stop. An electrician must isolate it.`
25. `Does the ground-level isolator work and switch off safely?` — Yes/No — Required — only show when 23 = `Yes` — stop line when No: `Stop. Get an electrician to check it.`

## Group 5: The electrician's check (PIESA)
The portal has the PIESA already: it fills in the light, cable and downlight answers on the official form itself, so none of
them are asked here.
26. `Have you read the PIESA and is it safe to start?` — Yes/No — Required — stop line when No: `Stop.`
27. `Does the PIESA need an electrician here at the start?` — Yes/No — Required — portal fills this in
28. `Is the electrician here?` — Yes/No — Required — only show when 27 = `Yes` — stop line when No: `Stop. Wait for the electrician.`
29. `Photo of the electrician at the front door, showing photo ID` — Photo — Required — only show when 28 = `Yes`
30. `Has anyone been in the ceiling since the PIESA?` — Yes/No — Required — help text: `Ask the owner.` — stop line when Yes: `Stop. An electrician must check again.`

## Group 6: What's up there now
31. `Is there insulation in the ceiling already?` — Yes/No — Required — portal fills this in
32. `How deep is it on average (mm)?` — Number — Required — only show when 31 = `Yes`
33. `What's its R-value, if you know?` — Text — only show when 31 = `Yes`
34. `What are you doing with it?` — Pick one: `Removing it` / `Topping it up` / `Some of each` — Required — only show when 31 = `Yes`
35. `Why is it staying?` — Text — Required — only show when 34 = `Topping it up` or `Some of each`
36. `Is it in good enough condition to lay over?` — Yes/No — Required — only show when 34 = `Topping it up` or `Some of each` — stop line when No: `Stop. Take it out first.`
37. `Is any of it foil, metallic or conductive?` — Yes/No — Required — only show when 31 = `Yes` — stop line when Yes: `It must come out before you start.`
38. `Photo of the foil or metallic insulation` — Photo — Required — only show when 37 = `Yes`

## Group 7: Product
39. `Photo of the packaging showing brand, model and R-value` — Photo — Required — help text: `One per product.`

## Group 8: Declaration (sign before you start)
40. Text item (not a question), exactly the current official text starting `INSTALLER DECLARATION – Sign BEFORE insulation work starts.` — copy it from the old "A3 - PIISA + AP Evidence" template, including the item starting `d. I will ensure that:` and the `Privacy Collection Statement` item.
41. `Everything on this form is true and complete` — Checkbox — Required
42. `Lead installer's signature` — Signature — Required
43. Text item (not a question): `That's the before-work part done. Come back to the next page when the insulation is in.`

## Group 9: Each ceiling area (after the install)
44. `How many ceiling areas did you insulate?` — Pick one: `1` / `2` / `3` — Required — help text: `Use the same areas as the Ready Check.`
45. `Area 1: which part of the home?` — Text — Required — portal fills this in
46. `Area 1: was there old insulation here?` — Yes/No — Required
47. `Area 1: photo of the old insulation with a ruler showing its depth` — Photo — Required — only show when 46 = `Yes`
48. `Area 1: video before you start` — Video — Required — help text: `Slow 360°, lit, say the area name.`
49. `Area 1: product installed` — Pick one — Required — the same product list as the Ready Check — portal fills this in
50. `Area 1: m² installed` — Number — Required — portal fills this in
51. `Area 1: video when it's done` — Video — Required — help text: `Slow 360°, lit, say the area name. Show full coverage and no rubbish left.`
52. `Area 1: photo of the new insulation with a ruler showing its depth` — Photo — Required — help text: `Ruler standing up, insulation not squashed.`
53–60. Same eight questions for `Area 2:` — only show when 44 = `2` or `3`
61–68. Same eight questions for `Area 3:` — only show when 44 = `3`
69. `Did the install take more than one day?` — Yes/No — Required
70. `I checked every item on this form again before starting each day` — Checkbox — Required — only show when 69 = `Yes`

## Group 10: Finishing up
71. `Is the lock-out off and the power back on?` — Yes/No — Required — stop line when No: `Don't leave until it is.`
72. `Who turned it back on?` — Text — Required — only show when 71 = `Yes` — help text: `Name, and whether it was the installer who locked it or the electrician.`
73. `Photo of the switchboard with the main switch on` — Photo — Required — only show when 71 = `Yes`
74. `Is the solar, battery or generator back on?` — Pick one: `Yes` / `No` / `There isn't one` — Required
75. `I was here the whole time and supervised everyone` — Checkbox — Required
76. `Lead installer's signature` — Signature — Required

Publish.
