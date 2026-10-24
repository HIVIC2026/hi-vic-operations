# Prompt for ChatGPT: add the evidence, SWMS and sign-off items to the Install day form in Mitti

Copy everything between the lines into ChatGPT (it edits the template with Mitti's "Build with AI"). It is ONE combined build: Part A relabels four existing photo questions, Part C adds the SWMS section, Part B adds the upgrade-zone evidence, Part E adds the foil question, Part D adds the after-install sign-off, Part F removes the old final-plan upload (the portal now draws the diagram). Nothing else existing is removed. Decisions 205, 206, 210, 211 and 213 (Jo, 24 Oct 2026). Every wording is fixed in `src/lib/install-evidence.core.ts` (`INSTALL_EVIDENCE_QUESTIONS`, `A3_RELABELS`, `SWMS_QUESTIONS`, `SWMS_HAZARDS`, `AFTER_INSTALL_QUESTIONS`, `FOIL_QUESTIONS`) and `tests/install-evidence-prompt.test.ts` fails if this file and the constants drift apart.

The template ID does **not** change, so nothing needs reconnecting. After publishing, open Office → Settings → Mitti forms → **Check form**: the portal lists any new question it cannot find by its exact wording.

---

You are editing my EXISTING **Install day** template in **Mitti** (mitti.com.au, "Build with AI" in the template builder). I will follow your instructions click by click; give me the edit as a numbered list of steps I can tick off, nothing skipped.

**Rules that must not be broken**

1. **Keep every existing question exactly as it is and in its current order** — same answer type, same Required setting, same "only show when" rule, same position. The only changes to existing items are the **four label changes in Part A** and the **one deletion in Part F**. In particular, the two existing Part 3 questions `Has the Safe Work Method Statement (SWMS) been completed for this job and all risks identified?` and `Have all Table 1 hazards been assessed and controlled in the SWMS?` stay on the form (the software cross-checks them against the new SWMS section).
2. The new wording below must be copied **character for character** — including the long dash "—", the short dash "–", the degree sign in "360°", "m²", "(geotagged…)", capitals and punctuation — because connected software reads each answer by its question text and refuses the job's rebate claim if an item is missing. Do not reword, shorten, merge, split, renumber the zones or drop anything. Do not move help text into the question line.
3. **Every Photo and Video item: Media type with location/GPS on** (and "camera only" / "capture date" if Mitti offers them). Video items must accept video. "allow several" means the item may hold more than one file.
4. If Mitti does not support an answer type I name, tell me the closest one and **ask me before substituting**. If a "Date & time" type is not available, use Mitti's date/time item and tell me.
5. **Do not use a repeating section.** Build the zone blocks and the SWMS hazard blocks exactly as written, so the question text itself carries the zone number / hazard name.
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

The SWMS section has thirteen hazard blocks of five questions each (present? → controls → other control → person responsible → other person). They are written out in full so nothing is guessed; the five questions of every block follow the same pattern, which Mitti's "duplicate section" can speed up — but check every label afterwards.

## Part C: SWMS section (insert this whole section AFTER the last crew question of Part 2 — `Additional installer` — and BEFORE `Has the Safe Work Method Statement (SWMS) been completed for this job and all risks identified?`)

1. `SWMS — prepared by (installer business name)` — Text — Required — portal fills this in (installer business name); keep it editable
2. `SWMS — prepared for (principal contractor / accredited person)` — Text — Required — portal fills this in (Home Insulation Victoria (DC Construction Solutions Pty Ltd)); keep it editable
3. `SWMS — work being done at this address` — Text — Required — portal fills this in (Ceiling insulation removal (if required) and installation of bulk ceiling insulation – VEU Activity 48); keep it editable
4. `SWMS — date this SWMS was prepared` — Date & time — Required
5. `SWMS — which high-risk construction work applies to this job? (tick all)` — Tick all: `Risk of a person falling more than 2 metres (ladder, manhole, roof, ceiling joists)` / `Work on or near energised electrical installations or services (ceiling cables, switchboard, solar/battery)` / `Work in or near a confined space` / `Work that may disturb asbestos (home built before 1990, or asbestos suspected)` / `Work on or near a roadway or in an area with powered mobile plant` / `None of these apply (explain in the next box)` — Required
6. `SWMS — if none of the high-risk work types apply, explain why` — Text — Required — only show when `SWMS — which high-risk construction work applies to this job? (tick all)` has "None of these apply (explain in the next box)" ticked
7. `SWMS — Electrical: present on this job?` — Yes/No — Required
8. `SWMS — Electrical: controls in place (tick all)` — Tick all: `Power isolated, locked out and tagged at the switchboard before entry` / `Solar, battery or generator isolated per the instructions` / `PIESA read and its conditions followed` / `Test for dead before touching cables` / `No work within 400 mm of cables unless treated per AS 3999` / `Electrician on site as the PIESA requires` / `Other control` — Required — only show when `SWMS — Electrical: present on this job?` = Yes
9. `SWMS — Electrical: other control (describe)` — Text — Required — only show when `SWMS — Electrical: controls in place (tick all)` has "Other control" ticked
10. `SWMS — Electrical: person responsible` — Pick one: `Lead installer` / `All crew` / `Attending electrician` / `Other (name in next box)` — Required — only show when `SWMS — Electrical: present on this job?` = Yes
11. `SWMS — Electrical: other person responsible (name)` — Text — Required — only show when `SWMS — Electrical: person responsible` = Other (name in next box)
12. `SWMS — Heat and heat stress: present on this job?` — Yes/No — Required
13. `SWMS — Heat and heat stress: controls in place (tick all)` — Tick all: `Work early or late; stop in extreme heat` / `Rest breaks and water every 30 minutes` / `Roof space temperature checked before entry` / `Buddy checks for heat illness` / `Other control` — Required — only show when `SWMS — Heat and heat stress: present on this job?` = Yes
14. `SWMS — Heat and heat stress: other control (describe)` — Text — Required — only show when `SWMS — Heat and heat stress: controls in place (tick all)` has "Other control" ticked
15. `SWMS — Heat and heat stress: person responsible` — Pick one: `Lead installer` / `All crew` / `Attending electrician` / `Other (name in next box)` — Required — only show when `SWMS — Heat and heat stress: present on this job?` = Yes
16. `SWMS — Heat and heat stress: other person responsible (name)` — Text — Required — only show when `SWMS — Heat and heat stress: person responsible` = Other (name in next box)
17. `SWMS — Falls and falling through the ceiling: present on this job?` — Yes/No — Required
18. `SWMS — Falls and falling through the ceiling: controls in place (tick all)` — Tick all: `Walk only on joists or crawl boards` / `Ladder secured and footed at the manhole` / `Three points of contact on the ladder` / `Harness or edge protection for external roof access` / `No work on the roof in wind or rain` / `Other control` — Required — only show when `SWMS — Falls and falling through the ceiling: present on this job?` = Yes
19. `SWMS — Falls and falling through the ceiling: other control (describe)` — Text — Required — only show when `SWMS — Falls and falling through the ceiling: controls in place (tick all)` has "Other control" ticked
20. `SWMS — Falls and falling through the ceiling: person responsible` — Pick one: `Lead installer` / `All crew` / `Attending electrician` / `Other (name in next box)` — Required — only show when `SWMS — Falls and falling through the ceiling: present on this job?` = Yes
21. `SWMS — Falls and falling through the ceiling: other person responsible (name)` — Text — Required — only show when `SWMS — Falls and falling through the ceiling: person responsible` = Other (name in next box)
22. `SWMS — Manual handling: present on this job?` — Yes/No — Required
23. `SWMS — Manual handling: controls in place (tick all)` — Tick all: `Bales split; two-person lifts over 20 kg` / `Mechanical lift or roof hoist for bales` / `Correct lifting technique; rotate tasks` / `Other control` — Required — only show when `SWMS — Manual handling: present on this job?` = Yes
24. `SWMS — Manual handling: other control (describe)` — Text — Required — only show when `SWMS — Manual handling: controls in place (tick all)` has "Other control" ticked
25. `SWMS — Manual handling: person responsible` — Pick one: `Lead installer` / `All crew` / `Attending electrician` / `Other (name in next box)` — Required — only show when `SWMS — Manual handling: present on this job?` = Yes
26. `SWMS — Manual handling: other person responsible (name)` — Text — Required — only show when `SWMS — Manual handling: person responsible` = Other (name in next box)
27. `SWMS — Dust, fibres and PPE: present on this job?` — Yes/No — Required
28. `SWMS — Dust, fibres and PPE: controls in place (tick all)` — Tick all: `P2 respirator, goggles, gloves, long sleeves worn in the ceiling` / `Disposable coveralls for removal work` / `Removed material bagged in the ceiling, not dropped through the house` / `Vacuum or wet methods, no dry sweeping` / `Other control` — Required — only show when `SWMS — Dust, fibres and PPE: present on this job?` = Yes
29. `SWMS — Dust, fibres and PPE: other control (describe)` — Text — Required — only show when `SWMS — Dust, fibres and PPE: controls in place (tick all)` has "Other control" ticked
30. `SWMS — Dust, fibres and PPE: person responsible` — Pick one: `Lead installer` / `All crew` / `Attending electrician` / `Other (name in next box)` — Required — only show when `SWMS — Dust, fibres and PPE: present on this job?` = Yes
31. `SWMS — Dust, fibres and PPE: other person responsible (name)` — Text — Required — only show when `SWMS — Dust, fibres and PPE: person responsible` = Other (name in next box)
32. `SWMS — Enclosed or restricted ceiling space: present on this job?` — Yes/No — Required
33. `SWMS — Enclosed or restricted ceiling space: controls in place (tick all)` — Tick all: `Entry and exit points identified and kept clear` / `Lighting set up before entry` / `Communication with a person outside the ceiling at all times` / `Confined-space entry procedure used if the space is confined` / `Other control` — Required — only show when `SWMS — Enclosed or restricted ceiling space: present on this job?` = Yes
34. `SWMS — Enclosed or restricted ceiling space: other control (describe)` — Text — Required — only show when `SWMS — Enclosed or restricted ceiling space: controls in place (tick all)` has "Other control" ticked
35. `SWMS — Enclosed or restricted ceiling space: person responsible` — Pick one: `Lead installer` / `All crew` / `Attending electrician` / `Other (name in next box)` — Required — only show when `SWMS — Enclosed or restricted ceiling space: present on this job?` = Yes
36. `SWMS — Enclosed or restricted ceiling space: other person responsible (name)` — Text — Required — only show when `SWMS — Enclosed or restricted ceiling space: person responsible` = Other (name in next box)
37. `SWMS — Asbestos (homes built before 1990, or suspected): present on this job?` — Yes/No — Required
38. `SWMS — Asbestos (homes built before 1990, or suspected): controls in place (tick all)` — Tick all: `Asbestos register or owner information checked` / `Suspected material not disturbed; work stopped and office called` / `Licensed removalist engaged before work resumes` / `No cutting, drilling or sanding of suspect sheeting` / `Other control` — Required — only show when `SWMS — Asbestos (homes built before 1990, or suspected): present on this job?` = Yes
39. `SWMS — Asbestos (homes built before 1990, or suspected): other control (describe)` — Text — Required — only show when `SWMS — Asbestos (homes built before 1990, or suspected): controls in place (tick all)` has "Other control" ticked
40. `SWMS — Asbestos (homes built before 1990, or suspected): person responsible` — Pick one: `Lead installer` / `All crew` / `Attending electrician` / `Other (name in next box)` — Required — only show when `SWMS — Asbestos (homes built before 1990, or suspected): present on this job?` = Yes
41. `SWMS — Asbestos (homes built before 1990, or suspected): other person responsible (name)` — Text — Required — only show when `SWMS — Asbestos (homes built before 1990, or suspected): person responsible` = Other (name in next box)
42. `SWMS — Vermin, droppings, mould and biological hazards: present on this job?` — Yes/No — Required
43. `SWMS — Vermin, droppings, mould and biological hazards: controls in place (tick all)` — Tick all: `Area inspected before entry; droppings not disturbed dry` / `P2 respirator and gloves; hands washed before eating` / `Pest treatment arranged before install if infestation found` / `Other control` — Required — only show when `SWMS — Vermin, droppings, mould and biological hazards: present on this job?` = Yes
44. `SWMS — Vermin, droppings, mould and biological hazards: other control (describe)` — Text — Required — only show when `SWMS — Vermin, droppings, mould and biological hazards: controls in place (tick all)` has "Other control" ticked
45. `SWMS — Vermin, droppings, mould and biological hazards: person responsible` — Pick one: `Lead installer` / `All crew` / `Attending electrician` / `Other (name in next box)` — Required — only show when `SWMS — Vermin, droppings, mould and biological hazards: present on this job?` = Yes
46. `SWMS — Vermin, droppings, mould and biological hazards: other person responsible (name)` — Text — Required — only show when `SWMS — Vermin, droppings, mould and biological hazards: person responsible` = Other (name in next box)
47. `SWMS — Lighting: present on this job?` — Yes/No — Required
48. `SWMS — Lighting: controls in place (tick all)` — Tick all: `Portable lighting set up to light the whole work area` / `Head torch for every person in the ceiling` / `Other control` — Required — only show when `SWMS — Lighting: present on this job?` = Yes
49. `SWMS — Lighting: other control (describe)` — Text — Required — only show when `SWMS — Lighting: controls in place (tick all)` has "Other control" ticked
50. `SWMS — Lighting: person responsible` — Pick one: `Lead installer` / `All crew` / `Attending electrician` / `Other (name in next box)` — Required — only show when `SWMS — Lighting: present on this job?` = Yes
51. `SWMS — Lighting: other person responsible (name)` — Text — Required — only show when `SWMS — Lighting: person responsible` = Other (name in next box)
52. `SWMS — Solar and battery systems: present on this job?` — Yes/No — Required
53. `SWMS — Solar and battery systems: controls in place (tick all)` — Tick all: `Shutdown and restart instructions located and followed` / `DC isolator and inverter isolated and tagged` / `Battery isolator off; no work near battery cables` / `Electrician isolates where the instructions are missing` / `Other control` — Required — only show when `SWMS — Solar and battery systems: present on this job?` = Yes
54. `SWMS — Solar and battery systems: other control (describe)` — Text — Required — only show when `SWMS — Solar and battery systems: controls in place (tick all)` has "Other control" ticked
55. `SWMS — Solar and battery systems: person responsible` — Pick one: `Lead installer` / `All crew` / `Attending electrician` / `Other (name in next box)` — Required — only show when `SWMS — Solar and battery systems: present on this job?` = Yes
56. `SWMS — Solar and battery systems: other person responsible (name)` — Text — Required — only show when `SWMS — Solar and battery systems: person responsible` = Other (name in next box)
57. `SWMS — Heat and ignition sources (flues, chimneys, heat lamps, exhaust fans, downlights, hot water units): present on this job?` — Yes/No — Required
58. `SWMS — Heat and ignition sources (flues, chimneys, heat lamps, exhaust fans, downlights, hot water units): controls in place (tick all)` — Tick all: `Clearances to flues and chimneys kept per AS 3999 and the manufacturer` / `Downlights confirmed IC/IC-4 by the PIESA; guards fitted where required` / `Exhaust fans and heat lamps kept clear` / `Gas appliances in the ceiling identified and kept clear` / `Other control` — Required — only show when `SWMS — Heat and ignition sources (flues, chimneys, heat lamps, exhaust fans, downlights, hot water units): present on this job?` = Yes
59. `SWMS — Heat and ignition sources (flues, chimneys, heat lamps, exhaust fans, downlights, hot water units): other control (describe)` — Text — Required — only show when `SWMS — Heat and ignition sources (flues, chimneys, heat lamps, exhaust fans, downlights, hot water units): controls in place (tick all)` has "Other control" ticked
60. `SWMS — Heat and ignition sources (flues, chimneys, heat lamps, exhaust fans, downlights, hot water units): person responsible` — Pick one: `Lead installer` / `All crew` / `Attending electrician` / `Other (name in next box)` — Required — only show when `SWMS — Heat and ignition sources (flues, chimneys, heat lamps, exhaust fans, downlights, hot water units): present on this job?` = Yes
61. `SWMS — Heat and ignition sources (flues, chimneys, heat lamps, exhaust fans, downlights, hot water units): other person responsible (name)` — Text — Required — only show when `SWMS — Heat and ignition sources (flues, chimneys, heat lamps, exhaust fans, downlights, hot water units): person responsible` = Other (name in next box)
62. `SWMS — Noise and vibration: present on this job?` — Yes/No — Required
63. `SWMS — Noise and vibration: controls in place (tick all)` — Tick all: `Hearing protection for blowers, saws and compressors` / `Noisy tasks kept short; tools maintained` / `Other control` — Required — only show when `SWMS — Noise and vibration: present on this job?` = Yes
64. `SWMS — Noise and vibration: other control (describe)` — Text — Required — only show when `SWMS — Noise and vibration: controls in place (tick all)` has "Other control" ticked
65. `SWMS — Noise and vibration: person responsible` — Pick one: `Lead installer` / `All crew` / `Attending electrician` / `Other (name in next box)` — Required — only show when `SWMS — Noise and vibration: present on this job?` = Yes
66. `SWMS — Noise and vibration: other person responsible (name)` — Text — Required — only show when `SWMS — Noise and vibration: person responsible` = Other (name in next box)
67. `SWMS — Working alone: present on this job?` — Yes/No — Required
68. `SWMS — Working alone: controls in place (tick all)` — Tick all: `Nobody works in the ceiling alone` / `Check-in calls every 30 minutes where alone on site` / `Other control` — Required — only show when `SWMS — Working alone: present on this job?` = Yes
69. `SWMS — Working alone: other control (describe)` — Text — Required — only show when `SWMS — Working alone: controls in place (tick all)` has "Other control" ticked
70. `SWMS — Working alone: person responsible` — Pick one: `Lead installer` / `All crew` / `Attending electrician` / `Other (name in next box)` — Required — only show when `SWMS — Working alone: present on this job?` = Yes
71. `SWMS — Working alone: other person responsible (name)` — Text — Required — only show when `SWMS — Working alone: person responsible` = Other (name in next box)
72. `SWMS — how the controls will be checked during the job` — Tick all: `Lead installer checks each control before the first entry` / `Lead installer re-checks at the start of each day` / `Any crew member can stop work and call the lead` / `Changed conditions are recorded below before work continues` — Required
73. `SWMS — changes to hazards or controls during this job (write 'None' if none)` — Text — Required
74. `SWMS — first aid kit location on site` — Text — Required
75. `SWMS — first aider on site (name)` — Text — Required
76. `SWMS — nearest hospital emergency department` — Text — Required
77. `SWMS — mobile phone reception at the property?` — Yes/No — Required
78. `SWMS — how emergency services will be called if there is no reception` — Text — Required — only show when `SWMS — mobile phone reception at the property?` = No
79. `SWMS — emergency assembly point` — Text — Required
80. `SWMS — electrical emergency: who isolates and how (switchboard location)` — Text — Required
81. `SWMS — worker 1: name` — Text — Required — portal fills this in (lead installer name); keep it editable
82. `SWMS — worker 1: I have read this SWMS, understand the hazards and controls, and will follow it` — Checkbox (must tick) — Required
83. `SWMS — worker 1: signature` — Signature — Required
84. `SWMS — worker 2: name` — Text — Required — portal fills this in (additional installer 1 name); keep it editable
85. `SWMS — worker 2: I have read this SWMS, understand the hazards and controls, and will follow it` — Checkbox (must tick) — Required
86. `SWMS — worker 2: signature` — Signature — Required
87. `SWMS — worker 3: name` — Text — Required — portal fills this in (additional installer 2 name); keep it editable
88. `SWMS — worker 3: I have read this SWMS, understand the hazards and controls, and will follow it` — Checkbox (must tick) — Required
89. `SWMS — worker 3: signature` — Signature — Required
90. `SWMS — worker 4: name` — Text — Required — portal fills this in (additional installer 3 name); keep it editable
91. `SWMS — worker 4: I have read this SWMS, understand the hazards and controls, and will follow it` — Checkbox (must tick) — Required
92. `SWMS — worker 4: signature` — Signature — Required
93. `SWMS — I am the lead installer. This SWMS was prepared for this address before work started, every hazard above was assessed with the crew, the controls are in place, and work will stop if the SWMS cannot be followed.` — Checkbox (must tick) — Required
94. `SWMS — lead installer signature` — Signature — Required
95. `SWMS — signed at (date and time)` — Date & time — Required

## Part B: upgrade zones and evidence (add after the existing `After installation, please record a clear video …` question, before the installer declaration and signature)

96. `How many upgrade zones are you insulating on this job?` — Pick one: `1` / `2` / `3` — Required
97. `Zone 1 — name of this ceiling area (use the same name as the Ready Check and floor plan)` — Text — Required — portal fills this in ("Area 1 – <Ready Check area name>"); keep it editable
98. `Zone 1 — is there existing insulation in this area (under-insulated)?` — Yes/No — Required
99. `Zone 1 — photo of the existing insulation with a ruler placed vertically showing its depth, and any brand, model or R-value markings (geotagged)` — Photo, location on, allow several — Required — only show when `Zone 1 — is there existing insulation in this area (under-insulated)?` = Yes
100. `Zone 1 — before 360° video of this ceiling area, lit and clearly labelled, showing any existing insulation (geotagged, under 250 MB)` — Video, location on — Required
101. `Zone 1 — insulation product installed` — Pick one: `Bradford Gold R5` / `Bradford Gold R6` / `Bradford Gold R7` / `Fletchers Pink Batts R5` / `Fletchers Pink Batts R6` / `Fletchers Pink Batts R7` / `Earthwool R5` / `ECOWOOL R5` — Required
102. `Zone 1 — area insulated (m²)` — Number — Required
103. `Zone 1 — after 360° video of this ceiling area, lit and clearly labelled, showing full coverage, depth without compression and no waste left (geotagged, under 250 MB)` — Video, location on — Required
104. `Zone 1 — after-install photo of the new insulation with a ruler placed vertically showing its depth (geotagged)` — Photo, location on, allow several — Required
105. `Zone 2 — name of this ceiling area (use the same name as the Ready Check and floor plan)` — Text — Required — only show when `How many upgrade zones are you insulating on this job?` is 2 or 3 — portal fills this in ("Area 2 – <Ready Check area name>"); keep it editable
106. `Zone 2 — is there existing insulation in this area (under-insulated)?` — Yes/No — Required — only show when `How many upgrade zones are you insulating on this job?` is 2 or 3
107. `Zone 2 — photo of the existing insulation with a ruler placed vertically showing its depth, and any brand, model or R-value markings (geotagged)` — Photo, location on, allow several — Required — only show when `Zone 2 — is there existing insulation in this area (under-insulated)?` = Yes
108. `Zone 2 — before 360° video of this ceiling area, lit and clearly labelled, showing any existing insulation (geotagged, under 250 MB)` — Video, location on — Required — only show when `How many upgrade zones are you insulating on this job?` is 2 or 3
109. `Zone 2 — insulation product installed` — Pick one: `Bradford Gold R5` / `Bradford Gold R6` / `Bradford Gold R7` / `Fletchers Pink Batts R5` / `Fletchers Pink Batts R6` / `Fletchers Pink Batts R7` / `Earthwool R5` / `ECOWOOL R5` — Required — only show when `How many upgrade zones are you insulating on this job?` is 2 or 3
110. `Zone 2 — area insulated (m²)` — Number — Required — only show when `How many upgrade zones are you insulating on this job?` is 2 or 3
111. `Zone 2 — after 360° video of this ceiling area, lit and clearly labelled, showing full coverage, depth without compression and no waste left (geotagged, under 250 MB)` — Video, location on — Required — only show when `How many upgrade zones are you insulating on this job?` is 2 or 3
112. `Zone 2 — after-install photo of the new insulation with a ruler placed vertically showing its depth (geotagged)` — Photo, location on, allow several — Required — only show when `How many upgrade zones are you insulating on this job?` is 2 or 3
113. `Zone 3 — name of this ceiling area (use the same name as the Ready Check and floor plan)` — Text — Required — only show when `How many upgrade zones are you insulating on this job?` is 3 — portal fills this in ("Area 3 – <Ready Check area name>"); keep it editable
114. `Zone 3 — is there existing insulation in this area (under-insulated)?` — Yes/No — Required — only show when `How many upgrade zones are you insulating on this job?` is 3
115. `Zone 3 — photo of the existing insulation with a ruler placed vertically showing its depth, and any brand, model or R-value markings (geotagged)` — Photo, location on, allow several — Required — only show when `Zone 3 — is there existing insulation in this area (under-insulated)?` = Yes
116. `Zone 3 — before 360° video of this ceiling area, lit and clearly labelled, showing any existing insulation (geotagged, under 250 MB)` — Video, location on — Required — only show when `How many upgrade zones are you insulating on this job?` is 3
117. `Zone 3 — insulation product installed` — Pick one: `Bradford Gold R5` / `Bradford Gold R6` / `Bradford Gold R7` / `Fletchers Pink Batts R5` / `Fletchers Pink Batts R6` / `Fletchers Pink Batts R7` / `Earthwool R5` / `ECOWOOL R5` — Required — only show when `How many upgrade zones are you insulating on this job?` is 3
118. `Zone 3 — area insulated (m²)` — Number — Required — only show when `How many upgrade zones are you insulating on this job?` is 3
119. `Zone 3 — after 360° video of this ceiling area, lit and clearly labelled, showing full coverage, depth without compression and no waste left (geotagged, under 250 MB)` — Video, location on — Required — only show when `How many upgrade zones are you insulating on this job?` is 3
120. `Zone 3 — after-install photo of the new insulation with a ruler placed vertically showing its depth (geotagged)` — Photo, location on, allow several — Required — only show when `How many upgrade zones are you insulating on this job?` is 3
121. `Will this installation run over more than one day?` — Yes/No — Required
122. `Before starting work each day, I re-checked every item on this safety assessment and they all still hold.` — Checkbox (must tick) — Required — only show when `Will this installation run over more than one day?` = Yes
123. `SWMS — day 2 re-check: date, time and lead installer initials (and any change to the SWMS)` — Text — Required — only show when `Will this installation run over more than one day?` = Yes
124. `SWMS — day 3 or later re-checks: one line per day (date, time, initials, changes)` — Text — Required — only show when `Will this installation run over more than one day?` = Yes

## Part E: foil / conductive existing insulation (add straight after `Is the existing insulation suitable to lay new insulation over?` in Part 6)

125. `Is any of the existing insulation foil-backed, metallic or electrically conductive?` — Yes/No — Required — only show when `Is there existing insulation in the ceiling?` = Yes
126. `Photo of the existing insulation showing the facing (geotagged)` — Photo, location on, allow several — Required — only show when `Is any of the existing insulation foil-backed, metallic or electrically conductive?` = Yes

## Part D: after-install sign-off (add at the very END of the form, after the existing signature and date)

127. `After installation: have all lock-out devices been removed and the premises safely re-energised?` — Yes/No — Required
128. `Who removed the lock-out and re-energised the premises? (name and role — the person who applied the lock, or the attending electrician)` — Text — Required — only show when `After installation: have all lock-out devices been removed and the premises safely re-energised?` = Yes
129. `Photo of the switchboard after re-energising — lock-out tag removed, main switch on (geotagged)` — Photo, location on, allow several — Required — only show when `After installation: have all lock-out devices been removed and the premises safely re-energised?` = Yes
130. `Solar, battery or generator restarted following the shutdown/restart instructions?` — Pick one: `Yes` / `No` / `N/A – none at this property` — Required
131. `Installation finished at (date and time)` — Date & time — Required
132. `I, the lead installer, was on site for the whole installation, supervised every other installer and confirm the installation complies with the VEU program requirements.` — Checkbox (must tick) — Required
133. `Lead installer signature at completion` — Signature — Required


Note: the two existing single video questions (`Before installation, please record a clear video …` and `After installation, please record a clear video …`) stay on the form unchanged; the portal now reads the per-zone videos in Part B.

## Part F: remove the old final-plan upload (decision 211)

Delete ONE existing item, in the section "AP Evidence – After Installation": the media question whose label is `Please upload a clear final roof-space plan showing the installed area in m² and the products used. Unclear or incomplete evidence may be rejected by the Essential Services Commission (ESC).` (an older form reads `Final installation plan — actual installed area (m²) and products`). The portal now draws the final installation diagram from the Ready Check areas and the per-zone product and m² answers in Part B, so this upload is no longer needed. Delete only this item; everything else in that section stays.

## When you have given me the steps

Finish with a checklist I can use to verify the **published** template:

- the four reworded photo questions read exactly as the "New" text in Part A, each still Required with location on, in their original positions;
- 133 new questions in total: Part C (SWMS) 95 questions placed after `Additional installer` and before `Has the Safe Work Method Statement (SWMS) been completed for this job and all risks identified?`; Part B 29 questions; Part E 2 questions after the existing-insulation suitability question; Part D 7 questions at the very end;
- every label spelled exactly as above (check every "—" long dash, "360°", "250 MB", "m²", "R-value", the zone numbers 1/2/3 and the hazard names in the SWMS labels);
- Required on every new question;
- location on for every Photo and Video item; video allowed on the six zone video items;
- every "only show when" rule as written: Zone 2 block when question `How many upgrade zones are you insulating on this job?` is 2 or 3, Zone 3 block when it is 3, each zone's existing-insulation photo when that zone's under-insulated answer is Yes, each hazard's controls / person when that hazard is Yes, each "other control" when `Other control` is ticked, each "other person" when `Other (name in next box)` is chosen, the no-reception line when reception is No, the daily re-check items when the multi-day answer is Yes, the foil photo when the foil answer is Yes, the lock-out name and switchboard-after photo when the lock-out answer is Yes;
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
