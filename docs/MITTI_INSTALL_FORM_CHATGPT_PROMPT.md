# Prompt for ChatGPT: add the evidence, SWMS and sign-off items to the Install day form in Mitti

> **Superseded in part (24 Oct 2026).** For the whole-job videos, the multi-day re-check and the Part 8 closing text, `docs/MITTI_INSTALL_FORM_FIX_PROMPT.md` is the current instruction and wins over this file: the two whole-job videos (`Before installation, please record a clear video …` and the "AP Evidence – After Installation" section with `After installation, please record a clear video …`) are **deleted** — each zone's before / after 360° video in Part B is that evidence now; `SWMS — day 3 or later re-checks: one line per day (date, time, initials, changes)` is **not required**; and the last Part 8 text reads `Signing does not finish this form. After installation, complete the Zones and evidence page and the After-install sign-off.` Part C below is the slimmed SWMS of decision 256 (the same as the fix prompt §1).

Copy everything between the lines into ChatGPT (it edits the template with Mitti's "Build with AI"). It is ONE combined build: Part A relabels four existing photo questions, Part C adds the SWMS section, Part B adds the upgrade-zone evidence, Part E adds the foil question, Part D adds the after-install sign-off, Part F removes the old final-plan upload (the portal now draws the diagram). Nothing else existing is removed. Decisions 205, 206, 210, 211 and 213 (Jo, 24 Oct 2026). Every wording is fixed in `src/lib/install-evidence.core.ts` (`INSTALL_EVIDENCE_QUESTIONS`, `A3_RELABELS`, `SWMS_QUESTIONS`, `SWMS_HAZARDS`, `AFTER_INSTALL_QUESTIONS`, `FOIL_QUESTIONS`) and `tests/install-evidence-prompt.test.ts` fails if this file and the constants drift apart.

The template ID does **not** change, so nothing needs reconnecting. After publishing, open Office → Settings → Mitti forms → **Check form**: the portal lists any new question it cannot find by its exact wording.

---

You are editing my EXISTING **Install day** template in **Mitti** (mitti.com.au, "Build with AI" in the template builder). I will follow your instructions click by click; give me the edit as a numbered list of steps I can tick off, nothing skipped.

**Rules that must not be broken**

1. **Keep every existing question exactly as it is and in its current order** — same answer type, same Required setting, same "only show when" rule, same position. The only changes to existing items are the **four label changes in Part A** and the **one deletion in Part F**. In particular, the two existing Part 3 questions `Has the Safe Work Method Statement (SWMS) been completed for this job and all risks identified?` and `Have all Table 1 hazards been assessed and controlled in the SWMS?` stay on the form (the software cross-checks them against the new SWMS section).
2. The new wording below must be copied **character for character** — including the long dash "—", the short dash "–", the degree sign in "360°", "m²", "(geotagged…)", capitals and punctuation — because connected software reads each answer by its question text and refuses the job's rebate claim if an item is missing. Do not reword, shorten, merge, split, renumber the zones or drop anything. Do not move help text into the question line.
3. **Every Photo and Video item: Media type with location/GPS on** (and "camera only" / "capture date" if Mitti offers them). Video items must accept video. "allow several" means the item may hold more than one file.
4. If Mitti does not support an answer type I name, tell me the closest one and **ask me before substituting**. If a "Date & time" type is not available, use Mitti's date/time item and tell me.
5. **Do not use a repeating section.** Build the zone blocks and the three crew sign-offs exactly as written, so the question text itself carries the zone / installer number.
6. **Do not add a plan or floor-plan upload** — the portal draws the final diagram from the per-zone product and m² answers. The one existing plan upload is deleted in Part F.
7. Questions marked "portal fills this in" are pre-filled by the software when it creates each form; keep them as normal editable Text.

Answer-type key: Pick one = single-select multiple choice with the exact options listed; Tick all = multi-select multiple choice with the exact options listed; Yes/No = two choices "Yes" / "No"; Text = single-line text (long text is fine); Number = numeric; Date & time = date and time picker; Photo = media (photo), location on; Video = media (video), location on; Checkbox = single checkbox that must be ticked; Signature = signature capture (Mitti records the signer's name and time).

"Only show when `<question>` = Yes" means the item is shown only when that earlier question is answered Yes; "has `<option>` ticked" means that option is selected on a tick-all question; "is 2 or 3" means the pick-one answer is either of those.

## Part A: change the label of four EXISTING photo questions (same questions, same position, wording only)

Find each existing item by its current label and replace the label with the new wording. Keep it Required, keep location on, keep any "only show when" rule it has.

A1. Current: `Please take a clear, geotagged photo of every installer at this property. Unclear or incomplete evidence may be rejected by the Essential Services Commission (ESC).` (an older form reads `Installer photos — every installer onsite today (geotagged)`)
New: `Photo of each installer at the front of the premises with photo ID clearly visible — one photo per installer (geotagged)`

A2. Current: `Please take a clear, geotagged photo of the electrician attending this property. Unclear or incomplete evidence may be rejected by the Essential Services Commission (ESC).` (older: `Electrician photo — onsite today (geotagged)`)
New: `Photo of the electrician at the front of the premises with photo ID clearly visible (geotagged)`

A3. Current: `Before work starts, please take a clear, geotagged photo showing the power isolated, locked out and tagged. Unclear or incomplete evidence may be rejected by the Essential Services Commission (ESC).` (older: `Power isolation photo — isolated, locked out and tagged before work (geotagged)`)
New: `Before work starts: photo of the power isolated — lock-out tag on the switchboard, and the solar and battery isolators switched off where the home has them (geotagged)`

A4. Current: `Before installation, please take a clear, geotagged photo of each product label showing the brand, model and R-value. Unclear or incomplete evidence may be rejected by the Essential Services Commission (ESC).` (older: `Installed product photos — brand, model and R-value (geotagged)`)
New: `Photo of the product packaging on site showing the brand, model and R-value label — one per product (geotagged)`

## New questions (Parts C, B, E, D)

The numbering below is only for this checklist. Each Part says where in the form it goes. Within a Part, keep the order exactly as listed.

The SWMS is the legal minimum (decision 256, `docs/SWMS_REQUIREMENTS_VIC_2026-10-24.md`): high-risk work, the hazards ticked from one list, one standard-controls instruction with a tick, a box for anything specific to the house, the lead installer's declaration and signature, and a read-and-sign by each additional installer inside their own crew block. There are no per-hazard blocks, emergency items, worker-name rows or prepared-by / prepared-for / work / date items (the portal prints those on the filed SWMS from the job). **If the form still carries the older, longer SWMS, apply `docs/MITTI_INSTALL_FORM_FIX_PROMPT.md` §1 instead of this Part.**

## Part C: SWMS (crew sign-offs inside the Part 2 crew blocks; the SWMS questions AFTER the last crew question of Part 2 — `Additional installer` — and BEFORE `Has the Safe Work Method Statement (SWMS) been completed for this job and all risks identified?`)

1. `SWMS — additional installer 1: I have read this SWMS, understand the hazards and controls, and will follow it` — Checkbox (must tick) — Required — only show when the Additional installer 1 name is filled in (inside the same logic as that installer's CII number, directly after it)
2. `SWMS — additional installer 1: signature` — Signature — Required — only show when the Additional installer 1 name is filled in (inside the same logic as that installer's CII number, directly after it)
3. `SWMS — additional installer 2: I have read this SWMS, understand the hazards and controls, and will follow it` — Checkbox (must tick) — Required — only show when the Additional installer 2 name is filled in (inside the same logic as that installer's CII number, directly after it)
4. `SWMS — additional installer 2: signature` — Signature — Required — only show when the Additional installer 2 name is filled in (inside the same logic as that installer's CII number, directly after it)
5. `SWMS — additional installer 3: I have read this SWMS, understand the hazards and controls, and will follow it` — Checkbox (must tick) — Required — only show when the Additional installer 3 name is filled in (inside the same logic as that installer's CII number, directly after it)
6. `SWMS — additional installer 3: signature` — Signature — Required — only show when the Additional installer 3 name is filled in (inside the same logic as that installer's CII number, directly after it)
7. `SWMS — which high-risk construction work applies to this job? (tick all)` — Tick all: `Risk of a person falling more than 2 metres (ladder, manhole, roof, ceiling joists)` / `Work on or near energised electrical installations or services (ceiling cables, switchboard, solar/battery)` / `Work in or near a confined space` / `Work that may disturb asbestos (home built before 1990, or asbestos suspected)` / `Work on or near a roadway or in an area with powered mobile plant` / `None of these apply (explain in the next box)` — Required
8. `SWMS — if none of the high-risk work types apply, explain why` — Text — Required — only show when `SWMS — which high-risk construction work applies to this job? (tick all)` has "None of these apply (explain in the next box)" ticked
9. `SWMS — hazards on this job (tick every one that applies)` — Tick all: `Live electrical hazards` / `Hazardous substances (friable asbestos, harmful chemicals)` / `Biological hazards (mould, animal waste)` / `High temperatures and heat exhaustion` / `Unsafe noise and vibration levels` / `Respiratory hazards and irritants (dust, odours)` / `Working in enclosed spaces` / `Working at height (inside and outside the ceiling space)` / `Fire hazards and ignition sources (flues, chimneys, gas heaters, heat lamps, exhaust fans, downlights, cables over 400 mm surrounded by insulation)` — Required
10. `SWMS — the standard controls above are in place for every ticked hazard` — Checkbox (must tick) — Required — directly BEFORE it, add an Instruction (text only, not a question) reading exactly: `Standard controls. Live electrical: power isolated, locked out and tagged before entry (solar, battery and generator too, following their instructions); PIESA read and its conditions followed; electrician on site when the PIESA requires; test for dead before touching cables. Hazardous substances: if asbestos is suspected, do not disturb it — stop work and call the office (an asbestos control plan is needed before work continues); no chemicals or solvents used in the ceiling. Biological: do not disturb droppings or mould dry; P2 mask and gloves; wash hands before eating. Heat: work early, water and a break every 30 minutes, stop in extreme heat. Noise and vibration: hearing protection for blowers and power tools. Dust and irritants: P2 mask, goggles, gloves and long sleeves in the ceiling; removed material bagged in the ceiling. Enclosed spaces: exits kept clear, lighting set up first, stay in contact with someone outside the ceiling. Height: walk only on joists or crawl boards, never on plasterboard; ladder secured and footed with three points of contact; no roof access in wind or rain. Fire and ignition sources: AS 3999 clearances kept to flues, chimneys, gas heaters, heat lamps, exhaust fans and downlights; cables over 400 mm in insulation as the PIESA directs. How these are put in place: the lead installer directly supervises the crew, checks every control before anyone enters the ceiling and again at the start of each day, and stops work if any control cannot be followed.`
11. `SWMS — anything specific to this house, or any change to hazards or controls during the job (write 'None' if none)` — Text — Required
12. `SWMS — I am the lead installer. This SWMS was prepared for this address before work started, every hazard above was assessed with the crew, the controls are in place, and work will stop if the SWMS cannot be followed.` — Checkbox (must tick) — Required
13. `SWMS — lead installer signature` — Signature — Required
14. `SWMS — signed at (date and time)` — Date & time — Required

## Part B: upgrade zones and evidence (its own section "Zones and evidence", after Part 8, before the after-install sign-off; on older forms it sat after the now-deleted `After installation, please record a clear video …` question)

15. `How many upgrade zones are you insulating on this job?` — Pick one: `1` / `2` / `3` — Required
16. `Zone 1 — name of this ceiling area (use the same name as the Ready Check and floor plan)` — Text — Required — portal fills this in ("Area 1 – <Ready Check area name>"); keep it editable
17. `Zone 1 — is there existing insulation in this area (under-insulated)?` — Yes/No — Required
18. `Zone 1 — photo of the existing insulation with a ruler placed vertically showing its depth, and any brand, model or R-value markings (geotagged)` — Photo, location on, allow several — Required — only show when `Zone 1 — is there existing insulation in this area (under-insulated)?` = Yes
19. `Zone 1 — before 360° video of this ceiling area, lit and clearly labelled, showing any existing insulation (geotagged, under 250 MB)` — Video, location on — Required
20. `Zone 1 — insulation product installed` — Pick one: `Bradford Gold R5` / `Bradford Gold R6` / `Bradford Gold R7` / `Fletchers Pink Batts R5` / `Fletchers Pink Batts R6` / `Fletchers Pink Batts R7` / `Earthwool R5` / `ECOWOOL R5` — Required
21. `Zone 1 — area insulated (m²)` — Number — Required
22. `Zone 1 — after 360° video of this ceiling area, lit and clearly labelled, showing full coverage, depth without compression and no waste left (geotagged, under 250 MB)` — Video, location on — Required
23. `Zone 1 — after-install photo of the new insulation with a ruler placed vertically showing its depth (geotagged)` — Photo, location on, allow several — Required
24. `Zone 2 — name of this ceiling area (use the same name as the Ready Check and floor plan)` — Text — Required — only show when `How many upgrade zones are you insulating on this job?` is 2 or 3 — portal fills this in ("Area 2 – <Ready Check area name>"); keep it editable
25. `Zone 2 — is there existing insulation in this area (under-insulated)?` — Yes/No — Required — only show when `How many upgrade zones are you insulating on this job?` is 2 or 3
26. `Zone 2 — photo of the existing insulation with a ruler placed vertically showing its depth, and any brand, model or R-value markings (geotagged)` — Photo, location on, allow several — Required — only show when `Zone 2 — is there existing insulation in this area (under-insulated)?` = Yes
27. `Zone 2 — before 360° video of this ceiling area, lit and clearly labelled, showing any existing insulation (geotagged, under 250 MB)` — Video, location on — Required — only show when `How many upgrade zones are you insulating on this job?` is 2 or 3
28. `Zone 2 — insulation product installed` — Pick one: `Bradford Gold R5` / `Bradford Gold R6` / `Bradford Gold R7` / `Fletchers Pink Batts R5` / `Fletchers Pink Batts R6` / `Fletchers Pink Batts R7` / `Earthwool R5` / `ECOWOOL R5` — Required — only show when `How many upgrade zones are you insulating on this job?` is 2 or 3
29. `Zone 2 — area insulated (m²)` — Number — Required — only show when `How many upgrade zones are you insulating on this job?` is 2 or 3
30. `Zone 2 — after 360° video of this ceiling area, lit and clearly labelled, showing full coverage, depth without compression and no waste left (geotagged, under 250 MB)` — Video, location on — Required — only show when `How many upgrade zones are you insulating on this job?` is 2 or 3
31. `Zone 2 — after-install photo of the new insulation with a ruler placed vertically showing its depth (geotagged)` — Photo, location on, allow several — Required — only show when `How many upgrade zones are you insulating on this job?` is 2 or 3
32. `Zone 3 — name of this ceiling area (use the same name as the Ready Check and floor plan)` — Text — Required — only show when `How many upgrade zones are you insulating on this job?` is 3 — portal fills this in ("Area 3 – <Ready Check area name>"); keep it editable
33. `Zone 3 — is there existing insulation in this area (under-insulated)?` — Yes/No — Required — only show when `How many upgrade zones are you insulating on this job?` is 3
34. `Zone 3 — photo of the existing insulation with a ruler placed vertically showing its depth, and any brand, model or R-value markings (geotagged)` — Photo, location on, allow several — Required — only show when `Zone 3 — is there existing insulation in this area (under-insulated)?` = Yes
35. `Zone 3 — before 360° video of this ceiling area, lit and clearly labelled, showing any existing insulation (geotagged, under 250 MB)` — Video, location on — Required — only show when `How many upgrade zones are you insulating on this job?` is 3
36. `Zone 3 — insulation product installed` — Pick one: `Bradford Gold R5` / `Bradford Gold R6` / `Bradford Gold R7` / `Fletchers Pink Batts R5` / `Fletchers Pink Batts R6` / `Fletchers Pink Batts R7` / `Earthwool R5` / `ECOWOOL R5` — Required — only show when `How many upgrade zones are you insulating on this job?` is 3
37. `Zone 3 — area insulated (m²)` — Number — Required — only show when `How many upgrade zones are you insulating on this job?` is 3
38. `Zone 3 — after 360° video of this ceiling area, lit and clearly labelled, showing full coverage, depth without compression and no waste left (geotagged, under 250 MB)` — Video, location on — Required — only show when `How many upgrade zones are you insulating on this job?` is 3
39. `Zone 3 — after-install photo of the new insulation with a ruler placed vertically showing its depth (geotagged)` — Photo, location on, allow several — Required — only show when `How many upgrade zones are you insulating on this job?` is 3
40. `Will this installation run over more than one day?` — Yes/No — Required
41. `Before starting work each day, I re-checked every item on this safety assessment and they all still hold.` — Checkbox (must tick) — Required — only show when `Will this installation run over more than one day?` = Yes
42. `SWMS — day 2 re-check: date, time and lead installer initials (and any change to the SWMS)` — Text — Required — only show when `Will this installation run over more than one day?` = Yes
43. `SWMS — day 3 or later re-checks: one line per day (date, time, initials, changes)` — Text — NOT required (optional line) — only show when `Will this installation run over more than one day?` = Yes

## Part E: foil / conductive existing insulation (add straight after `Is the existing insulation suitable to lay new insulation over?` in Part 6)

44. `Is any of the existing insulation foil-backed, metallic or electrically conductive?` — Yes/No — Required — only show when `Is there existing insulation in the ceiling?` = Yes
45. `Photo of the existing insulation showing the facing (geotagged)` — Photo, location on, allow several — Required — only show when `Is any of the existing insulation foil-backed, metallic or electrically conductive?` = Yes

## Part D: after-install sign-off (add at the very END of the form, after the existing signature and date)

46. `After installation: have all lock-out devices been removed and the premises safely re-energised?` — Yes/No — Required
47. `Who removed the lock-out and re-energised the premises? (name and role — the person who applied the lock, or the attending electrician)` — Text — Required — only show when `After installation: have all lock-out devices been removed and the premises safely re-energised?` = Yes
48. `Photo of the switchboard after re-energising — lock-out tag removed, main switch on (geotagged)` — Photo, location on, allow several — Required — only show when `After installation: have all lock-out devices been removed and the premises safely re-energised?` = Yes
49. `Solar, battery or generator restarted following the shutdown/restart instructions?` — Pick one: `Yes` / `No` / `N/A – none at this property` — Required
50. `Installation finished at (date and time)` — Date & time — Required
51. `I, the lead installer, was on site for the whole installation, supervised every other installer and confirm the installation complies with the VEU program requirements.` — Checkbox (must tick) — Required
52. `Lead installer signature at completion` — Signature — Required


Note: the two whole-job video questions (`Before installation, please record a clear video …` and `After installation, please record a clear video …`) are deleted by `docs/MITTI_INSTALL_FORM_FIX_PROMPT.md` §2 — the per-zone before / after videos in Part B satisfy the before-work and completed-work video evidence. Older forms that still carry them keep working (a whole-job video still counts).

## Part F: remove the old final-plan upload (decision 211)

Delete ONE existing item, in the section "AP Evidence – After Installation": the media question whose label is `Please upload a clear final roof-space plan showing the installed area in m² and the products used. Unclear or incomplete evidence may be rejected by the Essential Services Commission (ESC).` (an older form reads `Final installation plan — actual installed area (m²) and products`). The portal now draws the final installation diagram from the Ready Check areas and the per-zone product and m² answers in Part B, so this upload is no longer needed. Delete only this item; everything else in that section stays.

## When you have given me the steps

Finish with a checklist I can use to verify the **published** template:

- the four reworded photo questions read exactly as the "New" text in Part A, each still Required with location on, in their original positions;
- 52 new questions in total: Part C (SWMS) 14 questions (six inside the Additional installer 1–3 blocks, the rest after `Additional installer`) placed before `Has the Safe Work Method Statement (SWMS) been completed for this job and all risks identified?`; Part B 29 questions; Part E 2 questions after the existing-insulation suitability question; Part D 7 questions at the very end;
- every label spelled exactly as above (check every "—" long dash, "360°", "250 MB", "m²", "R-value", the zone numbers 1/2/3 and the nine hazard answers);
- Required on every new question except the optional day-3-or-later re-check line;
- location on for every Photo and Video item; video allowed on the six zone video items;
- every "only show when" rule as written: Zone 2 block when question `How many upgrade zones are you insulating on this job?` is 2 or 3, Zone 3 block when it is 3, each zone's existing-insulation photo when that zone's under-insulated answer is Yes, each additional installer's SWMS tick and signature only when that installer's name is filled in, the high-risk "explain why" box when "None of these apply" is ticked, the daily re-check items when the multi-day answer is Yes, the foil photo when the foil answer is Yes, the lock-out name and switchboard-after photo when the lock-out answer is Yes;
- the eight product options on each `Zone N — insulation product installed` question, spelled exactly and in that order;
- no existing question was moved, removed or changed other than the four labels (Part A) and the deleted final-plan upload (Part F); no plan upload was added;
- a form already in progress still opens;
- the **template ID** is unchanged (it is in the web address when the template is open, or under the template's settings) — tell me where to read it so I can confirm it still matches what the portal has.

---

## After publishing (portal side)

1. The portal keeps the same template ID, so nothing is reconnected.
2. Office → Settings → Mitti forms → **Check form**: the portal lists any new question it cannot find by exact wording ("not on the form yet"). Fix the wording in Mitti and check again until the list is empty.
3. From **1 November 2026** (`INSTALL_EVIDENCE_EFFECTIVE_DATE` in `src/lib/install-evidence.core.ts`) every installation that starts on or after that date needs the new items before the start-of-work check, AP review and Ready for VEEC; installs that started earlier keep the old seven-item rule, so history is not disturbed.
4. When the form is marked Complete in Mitti and every check passes, the portal records the installation itself (decision 213); anything missing shows as the installer's Next line and the office "Complete installation" button remains the fallback.
