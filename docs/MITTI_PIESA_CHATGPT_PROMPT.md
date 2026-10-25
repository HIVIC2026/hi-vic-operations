# Prompt for ChatGPT: build the PIESA form in Mitti

Copy everything between the lines into ChatGPT. It is self-contained. ChatGPT will give you click-by-click Mitti steps and the exact question list; follow it top to bottom, then send the template ID to the portal.

---

You are helping me build a form template in **Mitti** (mitti.com.au field inspection app, web template builder). I will follow your instructions click by click in the Mitti web app. Give me the build as a numbered list of steps I can tick off, nothing skipped. The question wording, answer types, Required settings and "only show when" logic below are **fixed and must be copied exactly, character for character, including punctuation and capitals**, because a connected software system reads every answer by its question text and fills the Victorian Government's official "Pre-installation electrical safety assessment" (PIESA) Word form from these answers. Do not reword, reorder, merge, split, add or drop any question. If Mitti does not offer an answer type I name, tell me the closest Mitti type and ask me before substituting.

**Template name:** `PIESA – Electrician safety assessment`
**Inspection title:** Job Reference ID + Address including postcode (use questions 1 and 2).
**Pages:** you may put a page break between the groups shown with ##, page breaks do not matter to the reading software.
**Photo questions:** turn on location/GPS for every photo item so the photo is geotagged. Photos sit with the question they belong to (decision 297); the owner confirms the assessment through their own secure link, not on this form (decision 296).
**Questions marked "portal fills this in"** are pre-filled by the software on every form it creates. Keep them as normal editable text so the electrician can correct them.

Answer-type key: Text = single line text; Date = date picker; Yes/No = two choices "Yes" and "No"; Pick one = single-select multiple choice with the exact options listed; Tick all = multi-select multiple choice with the exact options listed; Number = numeric; Photo = photo/attachment; Checkbox = single checkbox that must be ticked; Signature = signature capture.

## Group 1: Job
Text item (not a question), first item on this page (decision 318): `Paid only when this form is 100% complete and you press Complete. Take every photo in Mitti on site so it's geotagged.`
1. `Job Reference ID` — Text — Required — portal fills this in
2. `Address including postcode` — Text — Required — portal fills this in
2a. `I will not discuss any prices with the owner. Home Insulation Victoria sends the owner all prices.` — Checkbox (must tick) — Required — on EVERY job, no condition (decisions 312/323, not part of the official form)
   - Decision 323: do NOT ask `Whose customer is this?` — delete that question from the form if it is there (old answers are still read harmlessly).
3. `Date of inspection` — Date — Required
3a. `Photo showing you on site at the property, holding your licence / photo ID (geotagged)` — Photo, location on — Required

## Group 2: Life support
4. `Office life support record` — Text — Required — portal fills this in
5. `Is there life support equipment at the property?` — Yes/No — Required — portal fills this in from the office record; the electrician corrects it
6. `Have you received written consent or a medical plan? Please attach a photo of it.` — Pick one: `Yes – received Consent` / `Yes – received Medical Plan` / `No – not received` (red) — Required — only show when question 5 = Yes
7. `Written consent or medical plan (kept as an attachment to this assessment)` — Photo — Required — only show when question 6 = `Yes – received Consent` or `Yes – received Medical Plan`

## Group 3: Mains power
8. `Is the mains power set-up safe? This means the mains cable in the ceiling is identified and marked, the main switch works and can be locked off, the ceiling is confirmed dead when the switch is off, and safety switches (RCDs) are fitted and tested.` — Yes/No — Required
8a. `Photo of the cables at the switchboard (geotagged)` — Photo, location on — Required
9. `Please tick each item that is not right.` — Tick all: `The mains cable in the ceiling has not been identified and marked.` / `The main switch is not accessible or does not work.` / `The main switch cannot isolate all of the cables in the ceiling space safely.` / `The main switch cannot be secured in the off position.` / `Testing has not confirmed that the ceiling is dead when the main switch is off.` / `Safety switches (RCDs) are missing for the circuits in the ceiling area.` / `The safety switches (RCDs) have not been tested.` — Required — only show when question 8 = No
9a. `Photo of the problem` — Photo, location on, several files allowed — Required — only show when question 8 = No

## Group 4: Solar, battery, generator
10. `Is there solar, a battery or a generator at the property?` — Yes/No — Required
11. `Can it be safely shut down, and are its cables in the ceiling labelled, in conduit and protected?` — Yes/No — Required — only show when question 10 = Yes
12. `Please tick each item that is not right.` — Tick all: `There are no instructions for safely shutting down and restarting the system.` / `The isolator is not accessible, not working, or cannot be switched off safely.` / `The system cables in the ceiling are not in conduit or are not clearly labelled.` / `The system cables in the ceiling are not protected or supported where they could be damaged.` — Required — only show when question 11 = No
12a. `Photo of the problem` — Photo, location on, several files allowed — Required — only show when question 11 = No

## Group 5: Ceiling wiring
13. `Are the cables, connections and fittings in the ceiling safe to work around and cover with insulation?` — Yes/No — Required
14. `Please tick each problem you found.` — Tick all: `There is electrically conductive conduit in the ceiling.` / `The cables are not supported, or are run in a way that risks damage during the installation.` / `Cables that will be surrounded by insulation do not meet the wiring rules for that situation.` / `Thermoplastic (TPS) cables in the ceiling are deteriorated or damaged.` / `Connections or terminations in the ceiling are exposed or not securely enclosed.` / `Plug bases for lights or fans are loose in the ceiling.` / `Foil-backed or electrically conductive insulation is present and has not been confirmed as not live.` / `There are mains-connected cables in the ceiling that are not TPS.` / `There is split metal conduit wiring in the ceiling.` / `There are damaged or deteriorated cables in the ceiling.` — Required — only show when question 13 = No
14a. `Photo of the problem` — Photo, location on, several files allowed — Required — only show when question 13 = No

## Group 6: Lights, appliances
15. `Are there any downlights or other recessed lights in the ceiling?` — Yes/No — Required
16. `How many are there?` — Number — Required — only show when question 15 = Yes
17. `Are any of them not IC or IC-4 rated?` — Yes/No — Required — only show when question 15 = Yes
17a. `How many are not IC or IC-4 rated?` — Number — Required — only show when question 17 = Yes
17b. `Photo of the problem` — Photo, location on, several files allowed — Required — only show when question 17 = Yes
18. `Are there any appliances, exhaust fans, flues or other hazards in the ceiling space?` — Yes/No — Required (decision 336: renamed from `Are there any appliances, exhaust fans or flues in the ceiling space?`; the old wording is still read)
19. Repeating block `Add an appliance or flue` (the electrician taps + for each one) — only show when question 18 = Yes — help text: `One per appliance, exhaust fan, flue or other hazard. Answer No if it needs work or clearance before insulation goes in.` — containing, in this order:
   1. `What type is it?` — Single choice: `Appliance` / `Exhaust fan` / `Flue` / `Other hazard` — Required
   2. `What is it?` — Text — Required
   3. `Where is it?` — Text — Required
   4. `Photo of it` — Photo, location on — Required
   5. `Can insulation be safely installed around it as it is?` — Yes/No — Required — No red, Yes grey
   6. `What is the problem?` — Text — Required — only show when 5 = No
   7. `What needs to be done to make it safe?` — Text — Required — only show when 5 = No
   - Decision 336 (Jo 25 Oct 2026): this replaces `What is it and where is it?` (delete it; old answers are still read as both What and Where). The portal fills the official Part 7 row by row: Flue and Exhaust fan rows answer the official flues question, Appliance rows the appliances question, and all three go in the Appliance / Location / Hazard table (Appliance = `What is it?`, Location = `Where is it?`, Hazard = `What is the problem?`, else "None — safe to insulate around"; the actions line = `What needs to be done to make it safe?`); Other hazard rows go in the official "other hazards" table.

## Group 7: Repair work
20. `Is any electrical repair work needed before insulation can be installed?` — Yes/No — Required — Yes red
   - Decision 309 (Jo 25 Oct 2026, "Remove it"): repairs always happen before installation (same visit or the A5 fixes visit). Do NOT ask `Can the repair work be done before installation?` and do NOT add the instruction `No means an electrician must be present on installation day instead.` — delete both if they are on the form.
21. `What will you do? Tick everything included in your price.` — Tick all: `Replace downlights with IC-4 rated LED downlights` / `Install RCD safety switches` / `Upgrade circuit protection (breakers) for insulation` / `Replace old cables with TPS cable` / `Secure and support loose cables in the ceiling` / `Repair or replace damaged connections or junction boxes` / `Identify and mark the mains cable in the ceiling` / `Remove or make safe old unused cables` / `Label and protect solar or battery cables in the ceiling` / `Other` — NOT Required (decision 338: it may be empty when the only work is being on site at the start; the portal flags `No repair work ticked and no on-site attendance` if both are empty) — only show when question 20 = Yes — Mitti colours: all these grey (decisions 308/324: the portal fills the official form's repair ticks from this list)
21a. `How many downlights are you replacing?` — Number — Required — only show when question 21 has `Replace downlights with IC-4 rated LED downlights` ticked (decision 308)
21b. `How many RCD safety switches are you installing?` — Number — Required — only show when question 21 has `Install RCD safety switches` ticked (decision 308)
21c. `Describe the other work` — Text — Required — only show when question 21 has `Other` ticked — help text: `Say exactly what you'll do, where, and how many.` (decision 308)
21d. `Does an electrician need to be on site at the start of the install?` — Yes/No — Required — only show when question 20 = Yes — Mitti colours: Yes red, No green (decision 338: replaces the old `Be on site at the start of the install day` tick; Yes = the official "electrician present at the start of installation" outcome, priced inside the one total)
22. `Your total price for all the repair work, including GST` — Number — Required — only show when question 20 = Yes — LAST question on this page — for the owner's fixes quote only, not part of the official form (decisions 305/324)
   - Decision 324 (Jo 25 Oct 2026, ONE list): do NOT ask `Please tick the repair work that is required.` or `Please describe the other repair work.` — delete both from the form (old answers are still read). The repair questions are the tick list, the two counts, `Describe the other work`, `Does an electrician need to be on site at the start of the install?` (decision 338), then the price LAST.
   - If Mitti can't show a question based on one tick-all option, make it not Required with help text `Only if you ticked …` (naming the option).
   - Decision 338 (replaces the decision-314 tick): `Does an electrician need to be on site at the start of the install?` = Yes is priced inside the same total. The portal records the official "electrician present at the start of installation" outcome, lines the electrician up for the install day (decision 327), and if nothing else is ticked no fixes visit (A5 form) is needed. Remove `Be on site at the start of the install day` from the tick list (old forms that ticked it are still read the same way).
   - Decision 308 replaces the old `What's included in that price?` text question — delete it from the form (old answers are still read).

## Group 8: Electrician declaration
23. `Electrician licence number` — Text — Required — portal fills this in
24. `Electrician full name` — Text — Required — portal fills this in
25. `Electrical contractor (REC) business name` — Text — Required — portal fills this in
26. `REC registration number` — Text — Required — portal fills this in
27. `Electrician phone` — Text — Required — portal fills this in
28. `I declare that all information contained in and attached to this form is correct and not misleading by inclusion or omission` — Checkbox (must tick) — Required
29. `Electrician signature` — Signature — Required

## Group 9: After repair work (same visit only)
30. `Have you completed all of the repair work listed above, and is the ceiling now safe for insulation?` — Yes/No — Required — only show when question 20 = Yes
31. `Certificate of Electrical Safety number (required for any electrical works completed):` — Text — Required — only show when question 20 = Yes
32. `Date of Certification:` — Date — Required — only show when question 20 = Yes
32a. `Certificate of Electrical Safety (photo or PDF)` — Photo/attachment, PDF allowed — Required — only show when question 30 = Yes

Note: the official form repeats the electrician details in Section C; the portal copies them from questions 23–27, so the form does not ask twice.


## When you have given me the steps
Finish with a checklist I can use to verify the published template: 45 questions in this order, every "only show when" rule, Required on every question, location on for 42–44, and where in Mitti I find the **template ID** (it is in the web address when the template is open, or under the template's settings), because I must send that ID to my software team.

---

## Second prompt: add the two product options (the two Ready Check forms)

---

In Mitti, I have two existing **Ready Check** templates (one for installers' own customers, one for Home Insulation Victoria leads). Each has a single-select multiple-choice question `Insulation product` with six options. The Install day form does NOT have this question and must not be changed. Give me click-by-click steps to add two more options to that question on BOTH Ready Check templates, spelled exactly as below, keeping the existing six unchanged and in their current order, and then re-publish each template. The final list must read, in this order:

1. `Bradford Gold R5`
2. `Bradford Gold R6`
3. `Bradford Gold R7`
4. `Fletchers Pink Batts R5`
5. `Fletchers Pink Batts R6`
6. `Fletchers Pink Batts R7`
7. `Earthwool R5`
8. `ECOWOOL R5`

Finish with a check: open each Ready Check template, confirm eight options spelled exactly as above, and confirm a form already in progress still opens.

---

## Addendum (decision 210, Jo 24 Oct 2026): one more question after 19

Copy this into ChatGPT (or Mitti's "Build with AI") with the PIESA template open. It adds ONE question and changes nothing else; the wording is fixed in `src/lib/official-short.core.ts` (`PIESA_EFFECTIVE_QUESTION`).

---

In my existing **PIESA – Electrician safety assessment** template in Mitti, add one question directly AFTER `Please describe each one, where it is, the hazard it creates, and what was done or needs to be done about it.` and BEFORE `Is any electrical repair work needed before insulation can be installed?`. Keep every other question exactly as it is and in its order. The wording must be copied character for character:

19a. `Does the action you described effectively reduce the risk from each hazard listed?` — Yes/No — Required — only show when question 18 (`Are there any appliances, exhaust fans or flues in the ceiling space?`) = Yes

Finish with a check: the new question sits between 19 and 20, is Required, shows only when question 18 = Yes, and the template ID is unchanged.

---
