# Prompt for ChatGPT: build the PIESA form in Mitti

Copy everything between the lines into ChatGPT. It is self-contained. ChatGPT will give you click-by-click Mitti steps and the exact question list; follow it top to bottom, then send the template ID to the portal.

---

You are helping me build a form template in **Mitti** (mitti.com.au field inspection app, web template builder). I will follow your instructions click by click in the Mitti web app. Give me the build as a numbered list of steps I can tick off, nothing skipped. The question wording, answer types, Required settings and "only show when" logic below are **fixed and must be copied exactly, character for character, including punctuation and capitals**, because a connected software system reads every answer by its question text and fills the Victorian Government's official "Pre-installation electrical safety assessment" (PIESA) Word form from these answers. Do not reword, reorder, merge, split, add or drop any question. If Mitti does not offer an answer type I name, tell me the closest Mitti type and ask me before substituting.

**Template name:** `PIESA – Electrician safety assessment`
**Inspection title:** Job Reference ID + Address including postcode (use questions 1 and 2).
**Pages:** you may put a page break between the groups shown with ##, page breaks do not matter to the reading software.
**Photo questions (42–45):** turn on location/GPS for the photo item so the photo is geotagged. If Mitti has a "require location" or "camera only" setting, turn it on for 42, 43 and 44.
**Questions marked "portal fills this in"** are pre-filled by the software on every form it creates. Keep them as normal editable text so the electrician can correct them.

Answer-type key: Text = single line text; Date = date picker; Yes/No = two choices "Yes" and "No"; Pick one = single-select multiple choice with the exact options listed; Tick all = multi-select multiple choice with the exact options listed; Number = numeric; Photo = photo/attachment; Checkbox = single checkbox that must be ticked; Signature = signature capture.

## Group 1: Job
1. `Job Reference ID` — Text — Required — portal fills this in
2. `Address including postcode` — Text — Required — portal fills this in
3. `Date of inspection` — Date — Required

## Group 2: Life support
4. `Office life support record` — Text — Required — portal fills this in
5. `Is the life support record shown above still correct?` — Yes/No — Required
6. `Have you received written consent or a medical plan? Please attach a photo of it.` — Pick one: `Yes – received Consent` / `Yes – received Medical Plan` — Required — only show when question 5 = Yes
7. `Written consent or medical plan (kept as an attachment to this assessment)` — Photo — Required — only show when question 5 = Yes

## Group 3: Mains power
8. `Is the mains power set-up safe? This means the mains cable in the ceiling is identified and marked, the main switch works and can be locked off, the ceiling is confirmed dead when the switch is off, and safety switches (RCDs) are fitted and tested.` — Yes/No — Required
9. `Please tick each item that is not right.` — Tick all: `The mains cable in the ceiling has not been identified and marked.` / `The main switch is not accessible or does not work.` / `The main switch cannot isolate all of the cables in the ceiling space safely.` / `The main switch cannot be secured in the off position.` / `Testing has not confirmed that the ceiling is dead when the main switch is off.` / `Safety switches (RCDs) are missing for the circuits in the ceiling area.` / `The safety switches (RCDs) have not been tested.` — Required — only show when question 8 = No

## Group 4: Solar, battery, generator
10. `Is there solar, a battery or a generator at the property?` — Yes/No — Required
11. `Can it be safely shut down, and are its cables in the ceiling labelled, in conduit and protected?` — Yes/No — Required — only show when question 10 = Yes
12. `Please tick each item that is not right.` — Tick all: `There are no instructions for safely shutting down and restarting the system.` / `The isolator is not accessible, not working, or cannot be switched off safely.` / `The system cables in the ceiling are not in conduit or are not clearly labelled.` / `The system cables in the ceiling are not protected or supported where they could be damaged.` — Required — only show when question 11 = No

## Group 5: Ceiling wiring
13. `Are the cables, connections and fittings in the ceiling safe to work around and cover with insulation?` — Yes/No — Required
14. `Please tick each problem you found.` — Tick all: `There is electrically conductive conduit in the ceiling.` / `The cables are not supported, or are run in a way that risks damage during the installation.` / `Cables that will be surrounded by insulation do not meet the wiring rules for that situation.` / `Thermoplastic (TPS) cables in the ceiling are deteriorated or damaged.` / `Connections or terminations in the ceiling are exposed or not securely enclosed.` / `Plug bases for lights or fans are loose in the ceiling.` / `Foil-backed or electrically conductive insulation is present and has not been confirmed as not live.` / `There are mains-connected cables in the ceiling that are not TPS.` / `There is split metal conduit wiring in the ceiling.` / `There are damaged or deteriorated cables in the ceiling.` — Required — only show when question 13 = No

## Group 6: Lights, appliances
15. `Are there any downlights or other recessed lights in the ceiling?` — Yes/No — Required
16. `How many are there?` — Number — Required — only show when question 15 = Yes
17. `Are any of them not IC or IC-4 rated?` — Yes/No — Required — only show when question 15 = Yes
18. `Are there any appliances, exhaust fans or flues in the ceiling space?` — Yes/No — Required
19. `Please describe each one, where it is, the hazard it creates, and what was done or needs to be done about it.` — Text (long text is fine) — Required — only show when question 18 = Yes

## Group 7: Repair work
20. `Is any electrical repair work needed before insulation can be installed?` — Pick one: `No repair work is needed` / `Yes, repair work is needed` / `Repair work is not possible, so an electrician must be present on installation day` — Required
21. `Please tick the repair work that is required.` — Tick all: `Prohibited luminaires (e.g. CA-class luminaires, non-IC luminaires, or ‘do-not-cover’ light fittings) are present and need to be replaced with IC and/or IC4 rated LED lights.` / `Circuit protection rating needs to be upgraded to allow for effects of thermal insulation on the wiring system (derated)` / `Residual Current Devices (RCDs) need to be installed for circuit/s within the ceiling insulation area, as per the most current version of AS/NZS 3000` / `Cables in the ceiling or at the switchboard need to be replaced with ThermoPlastic Sheathed (TPS) cables, (or an equivalent cable) as per the most current version of AS/NZS 3000` / `Cables and wiring in the ceiling space need to be altered or repaired to meet Basic Protection requirements, as per the most current version of AS/NZS 3000.` / `Other (indicate below):` — Required — only show when question 20 = `Yes, repair work is needed`
22. `Please describe the other repair work.` — Text — Required — only show when question 21 has `Other (indicate below):` ticked

## Group 8: Electrician declaration
23. `Licence no:` — Text — Required — portal fills this in
24. `Full Name:` — Text — Required — portal fills this in
25. `Name:` — Text — Required — portal fills this in (this is the electrical contractor / REC business name)
26. `REC registration no:` — Text — Required — portal fills this in
27. `Telephone no:` — Text — Required — portal fills this in
28. `I declare that all information contained in and attached to this form is correct and not misleading by inclusion or omission` — Checkbox (must tick) — Required
29. `Electrician signature` — Signature — Required

## Group 9: After repair work (same visit only)
30. `Have you completed all of the repair work listed above, and is the ceiling now safe for insulation?` — Yes/No — Required — only show when question 20 = `Yes, repair work is needed`
31. `Certificate of Electrical Safety number (required for any electrical works completed):` — Text — Required — only show when question 20 = `Yes, repair work is needed`
32. `Date of Certification:` — Date — Required — only show when question 20 = `Yes, repair work is needed`
33. `Licence no:` — Text — Required — portal fills this in — only show when question 20 = `Yes, repair work is needed`
34. `Full Name:` — Text — Required — portal fills this in — only show when question 20 = `Yes, repair work is needed`
35. `Name:` — Text — Required — portal fills this in — only show when question 20 = `Yes, repair work is needed`
36. `REC registration no:` — Text — Required — portal fills this in — only show when question 20 = `Yes, repair work is needed`
37. `Telephone no:` — Text — Required — portal fills this in — only show when question 20 = `Yes, repair work is needed`

Note: questions 23–27 and 33–37 deliberately repeat the same labels. They are separate questions on the official form (declaration at assessment, then confirmation after repairs). Keep both sets.

## Group 10: Owner
38. `Please confirm that the assessment was completed today, and that you understand that anyone going into the ceiling before installation may cancel this assessment.` — Yes/No — Required
39. `Name:` — Text — Required — portal fills this in (owner's name)
40. `Date:` — Date — Required
41. `Owner signature` — Signature — Required

## Group 11: Evidence photos
42. `Photo of the cables at the switchboard (geotagged)` — Photo, location on — Required
43. `Photo showing you on site at the property, holding your licence / photo ID (geotagged)` — Photo, location on — Required
44. `Photo of each hazard listed (one per hazard; geotagged)` — Photo, location on, allow several photos — Required — only show when ANY of: question 8 = No, question 11 = No, question 13 = No, question 17 = Yes, question 18 = Yes
45. `Certificate of Electrical Safety (photo or PDF)` — Photo/attachment, PDF allowed — Required — only show when question 30 = Yes

## When you have given me the steps
Finish with a checklist I can use to verify the published template: 45 questions in this order, every "only show when" rule, Required on every question, location on for 42–44, and where in Mitti I find the **template ID** (it is in the web address when the template is open, or under the template's settings), because I must send that ID to my software team.

---

## Second prompt: add the two product options (Ready Check and Install forms)

---

In Mitti, I have two existing templates: the **Ready Check** form and the **Install day** form. Each has a multiple-choice question `Insulation product` with six options. Give me click-by-click steps to add two more options to that question on BOTH templates, spelled exactly as below, keeping the existing six unchanged and in their current order, and then re-publish each template. The final list must read, in this order:

1. `Bradford Gold R5`
2. `Bradford Gold R6`
3. `Bradford Gold R7`
4. `Fletchers Pink Batts R5`
5. `Fletchers Pink Batts R6`
6. `Fletchers Pink Batts R7`
7. `Earthwool R5`
8. `ECOWOOL R5`

Finish with a check: open each template, confirm eight options spelled exactly as above, and confirm a form already in progress still opens.

---
